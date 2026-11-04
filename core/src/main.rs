//! kubeclean-core: JSON lines on stdin/stdout.
//!   request  {"id":1,"method":"scan","params":{}}
//!   response {"id":1,"result":…} | {"id":1,"error":"…"}
//!   event    {"event":"progress","data":{…}}
//! `kubeclean-core --elevated <tasks> --out <file>` is the UAC-elevated helper.

mod apps;
mod clean;
mod fsutil;
mod rules;
mod scan;
mod space;
mod store;
#[cfg_attr(windows, path = "win.rs")]
#[cfg_attr(target_os = "macos", path = "mac.rs")]
mod os;

use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

struct Core {
    store: store::Store,
    scans: Mutex<Vec<scan::RuleScan>>,
    cancel: AtomicBool,
    busy: AtomicBool,
    /// la carte de l'espace ne fait que lire : elle tourne à côté d'une analyse ou d'un nettoyage
    space_busy: AtomicBool,
    space_cancel: AtomicBool,
    out: Mutex<std::io::Stdout>,
}

impl Core {
    fn send(&self, v: Value) {
        let mut o = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(o, "{v}");
        let _ = o.flush();
    }
    fn event(&self, name: &str, data: Value) {
        self.send(json!({ "event": name, "data": data }));
    }
    fn data_dir(&self) -> Option<&std::path::Path> {
        self.store.dir.as_deref()
    }
}

/// Clears `busy` however the guarded call ends (also on panic).
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn take_busy(c: &Core) -> Result<Busy<'_>, String> {
    if c.busy.swap(true, Ordering::SeqCst) {
        return Err("une analyse ou un nettoyage est déjà en cours".into());
    }
    c.cancel.store(false, Ordering::SeqCst);
    Ok(Busy(&c.busy))
}

fn handle(c: &Core, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "hello" => Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "dataDir": c.data_dir(), "drives": os::fixed_drives() })),
        "drives" => Ok(json!(os::fixed_drives())),
        "cancel" => {
            let space = params.get("what").and_then(Value::as_str) == Some("space");
            (if space { &c.space_cancel } else { &c.cancel }).store(true, Ordering::SeqCst);
            Ok(json!(true))
        }
        "scan" => {
            let _b = take_busy(c)?;
            let set = rules::RuleSet::load(c.data_dir())?;
            let settings = c.store.settings();
            let running = os::running_processes();
            // le libellé nomme ce qui tourne ENCORE : c'est là qu'une analyse qui s'éternise attend
            let finished = std::sync::Mutex::new(std::collections::HashSet::new());
            let on_rule = |done: usize, total: usize, s: &scan::RuleScan| {
                let label = {
                    let mut f = finished.lock().unwrap_or_else(|e| e.into_inner());
                    f.insert(s.rule.id.clone());
                    let waiting: Vec<&str> = set.rules.iter().filter(|r| !f.contains(&r.id)).map(|r| r.title.as_str()).collect();
                    match waiting.as_slice() {
                        [] => s.rule.title.clone(),
                        [one] => one.to_string(),
                        [first, rest @ ..] => format!("{first} +{}", rest.len()),
                    }
                };
                c.event("progress", json!({ "phase": "scan", "done": done, "total": total, "label": label }));
                c.event("rule", json!(scan::summarize(s, &running))); // live reveal, same shape as the final list
            };
            let scans = scan::scan_all(&set, &settings, &c.cancel, &on_rule);
            if c.cancel.load(Ordering::SeqCst) {
                return Err("analyse annulée".into());
            }
            let rules: Vec<_> = scans.iter().map(|s| scan::summarize(s, &running)).collect();
            *c.scans.lock().unwrap_or_else(|e| e.into_inner()) = scans;
            Ok(json!({ "rules": rules, "drives": os::fixed_drives(), "at": fsutil::now_ms(), "settings": settings }))
        }
        "items" => {
            #[derive(Deserialize)]
            struct P { rule: String, #[serde(default)] offset: usize, #[serde(default = "lim")] limit: usize }
            fn lim() -> usize { 200 }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let scans = c.scans.lock().unwrap_or_else(|e| e.into_inner());
            let s = scans.iter().find(|s| s.rule.id == p.rule).ok_or("règle inconnue ou analyse périmée")?;
            let items: Vec<Value> = s.items.iter().enumerate().skip(p.offset).take(p.limit.min(1000))
                .map(|(i, it)| { let mut v = json!(it); v["index"] = json!(i); v }).collect();
            Ok(json!({ "total": s.items.len(), "items": items }))
        }
        "clean" => {
            #[derive(Deserialize)]
            struct P { picks: Vec<clean::Pick> }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let _b = take_busy(c)?;
            let scans = std::mem::take(&mut *c.scans.lock().unwrap_or_else(|e| e.into_inner())); // a clean always needs a fresh scan
            if scans.is_empty() {
                return Err("aucune analyse récente : relance une analyse".into());
            }
            let settings = c.store.settings();
            let progress = |done: usize, total: usize, label: &str, freed: u64| c.event("progress", json!({ "phase": "clean", "done": done, "total": total, "label": label, "freed": freed }));
            let rep = clean::clean(&scans, &p.picks, &settings, c.data_dir(), &c.cancel, &progress);
            let _ = c.store.push_history(clean::history_entry(&rep, &scans));
            Ok(json!(rep))
        }
        "settings.get" => Ok(json!(c.store.settings())),
        "settings.set" => {
            let s: store::Settings = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let s = s.sanitized();
            c.store.save_settings(&s)?;
            Ok(json!(s))
        }
        "ignore.add" | "ignore.remove" => {
            #[derive(Deserialize)]
            struct P { path: String }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            if !fsutil::is_clean_abs(&PathBuf::from(&p.path)) {
                return Err("chemin invalide".into());
            }
            let mut s = c.store.settings();
            if method == "ignore.add" { s.ignore.push(p.path) } else { s.ignore.retain(|x| !x.eq_ignore_ascii_case(&p.path)) }
            let s = s.sanitized();
            c.store.save_settings(&s)?;
            Ok(json!(s))
        }
        "history" => Ok(json!(c.store.history())),
        "apps" => Ok(json!(apps::list())),
        "startup" => Ok(json!(apps::startup())),
        "updates" => apps::updates().map(|u| json!(u)),
        "apps.uninstall" | "apps.reset" | "updates.install" => {
            #[derive(Deserialize)]
            struct P { id: String }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let _b = take_busy(c)?; // jamais pendant une analyse ou un nettoyage
            match method {
                "apps.uninstall" => apps::uninstall(&p.id),
                "updates.install" => apps::upgrade(&p.id),
                #[cfg(target_os = "macos")]
                _ => apps::reset(&p.id),
                #[cfg(not(target_os = "macos"))]
                _ => Err("réinitialisation disponible sur macOS seulement".into()),
            }
        }
        "space" => {
            #[derive(Deserialize)]
            struct P { path: Option<String>, #[serde(default)] refresh: bool }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let Some(path) = p.path else { return Ok(json!({ "roots": space::roots() })) };
            if c.space_busy.swap(true, Ordering::SeqCst) {
                return Err("une mesure est déjà en cours".into());
            }
            let _b = Busy(&c.space_busy);
            c.space_cancel.store(false, Ordering::SeqCst);
            let progress = |done: usize, total: usize, label: &str| c.event("progress", json!({ "phase": "space", "done": done, "total": total, "label": label }));
            space::list(&path, p.refresh, &c.space_cancel, &progress).map(|l| json!(l))
        }
        "apps.leftovers" => apps::leftovers(),
        "apps.trashLeftovers" => {
            #[derive(Deserialize)]
            struct P { ids: Vec<String> }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            let _b = take_busy(c)?;
            apps::trash_leftovers(&p.ids)
        }
        "startup.set" => {
            #[derive(Deserialize)]
            struct P { id: String, enabled: bool }
            let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
            apps::set_startup(&p.id, p.enabled)
        }
        _ => Err(format!("méthode inconnue : {method}")),
    }
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(windows)] // admin tasks exist on Windows only
    if let Some(tasks) = arg(&args, "--elevated") {
        let out = arg(&args, "--out").map(PathBuf::from).unwrap_or_default();
        std::process::exit(clean::elevated_main(&tasks, &out));
    }
    let core = Arc::new(Core {
        store: store::Store { dir: arg(&args, "--data-dir").map(PathBuf::from) },
        scans: Mutex::new(vec![]),
        cancel: AtomicBool::new(false),
        busy: AtomicBool::new(false),
        space_busy: AtomicBool::new(false),
        space_cancel: AtomicBool::new(false),
        out: Mutex::new(std::io::stdout()),
    });
    core.event("ready", json!({ "version": env!("CARGO_PKG_VERSION") }));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                core.event("error", json!(format!("requête illisible : {e}")));
                continue;
            }
        };
        let c = Arc::clone(&core);
        std::thread::spawn(move || {
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(&c, &req.method, req.params)))
                .unwrap_or_else(|_| Err("erreur interne du moteur".into()));
            match res {
                Ok(v) => c.send(json!({ "id": req.id, "result": v })),
                Err(e) => c.send(json!({ "id": req.id, "error": e })),
            }
        });
    }
    // stdin closed: Electron is gone. Stop any running work and leave.
    core.cancel.store(true, Ordering::SeqCst);
    core.space_cancel.store(true, Ordering::SeqCst);
}
