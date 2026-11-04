//! macOS : applis de /Applications et ~/Applications, leurs données dans ~/Library, agents de
//! lancement. Désinstaller ou réinitialiser envoie à la Corbeille (« Remettre » marche), rien de plus.

use super::{App, CRASH_DAYS, DAY, Listing, Startup, Update, date_ms, is_system_name};
use crate::fsutil::{self, tree_stat};
use crate::os;
use rayon::prelude::*;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute() && p != Path::new("/"))
}

/// Clés d'une plist (binaire ou XML) ; `plutil` refuse le JSON si la plist porte une date : on
/// retombe alors sur une extraction clé par clé.
fn plist(path: &Path, keys: &[&str]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    if let Ok(o) = Command::new("/usr/bin/plutil").args(["-convert", "json", "-o", "-"]).arg(path).output() {
        if let (true, Ok(v)) = (o.status.success(), serde_json::from_slice::<Value>(&o.stdout)) {
            for k in keys {
                let (head, idx) = k.split_once('.').map(|(h, i)| (h, i.parse::<usize>().ok())).unwrap_or((k, None));
                let val = match idx {
                    Some(i) => v.get(head).and_then(|a| a.get(i)),
                    None => v.get(head),
                };
                match val {
                    Some(Value::String(s)) => drop(m.insert(k.to_string(), s.clone())),
                    Some(Value::Bool(b)) => drop(m.insert(k.to_string(), b.to_string())),
                    _ => {}
                }
            }
            return m;
        }
    }
    for k in keys {
        if let Ok(o) = Command::new("/usr/bin/plutil").args(["-extract", k, "raw", "-o", "-"]).arg(path).output() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if o.status.success() && !s.is_empty() {
                m.insert(k.to_string(), s);
            }
        }
    }
    m
}

/// Spotlight : dernière ouverture, date d'ajout, taille sur disque (sans parcourir le paquet).
fn spotlight(app: &Path) -> (Option<i64>, Option<i64>, Option<u64>) {
    let Ok(o) = Command::new("/usr/bin/mdls")
        .args(["-raw", "-nullMarker", "", "-name", "kMDItemLastUsedDate", "-name", "kMDItemDateAdded", "-name", "kMDItemPhysicalSize"])
        .arg(app)
        .output()
    else {
        return (None, None, None);
    };
    let s = String::from_utf8_lossy(&o.stdout);
    let f: Vec<&str> = s.split('\0').collect();
    let get = |i: usize| f.get(i).map(|x| x.trim()).filter(|x| !x.is_empty() && *x != "(null)");
    (get(0).and_then(date_ms), get(1).and_then(date_ms), get(2).and_then(|x| x.parse().ok()))
}

/// Taille d'un paquet par `du` quand Spotlight ne la donne pas : le moteur ne parcourt pas un .app.
fn du(app: &Path) -> u64 {
    Command::new("/usr/bin/du")
        .arg("-sk")
        .arg(app)
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().next()?.parse::<u64>().ok())
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

fn bundles() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    roots.extend(home().map(|h| h.join("Applications")));
    let mut out = vec![];
    let visit = |dir: &Path, out: &mut Vec<PathBuf>| -> Vec<PathBuf> {
        let mut sub = vec![];
        let Ok(rd) = std::fs::read_dir(dir) else { return sub };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(md) = std::fs::symlink_metadata(&p) else { continue };
            if fsutil::is_reparse(&md) || !md.is_dir() {
                continue;
            }
            if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("app")) {
                out.push(p);
            } else {
                sub.push(p); // « /Applications/Adobe X/… » : un niveau de plus
            }
        }
        sub
    };
    for r in roots {
        for s in visit(&r, &mut out) {
            visit(&s, &mut out);
        }
    }
    out
}

/// Identifiant d'appli à au moins `parts` segments, sans rien qu'un chemin ou une requête Spotlight
/// interprète : jamais vide (`join("")` désignerait le dossier parent lui-même).
fn id_ok(id: &str, parts: usize) -> bool {
    let p: Vec<&str> = id.split('.').collect();
    p.len() >= parts
        && p.iter().all(|x| !x.is_empty())
        && id.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
}

/// Données d'une appli dans ~/Library, désignées par son seul identifiant : un nom (« Firefox »,
/// « Steam ») est partagé par plusieurs éditions ou porte des jeux entiers.
fn app_data(bundle: &str) -> Vec<PathBuf> {
    let Some(lib) = home().map(|h| h.join("Library")) else { return vec![] };
    if !id_ok(bundle, 2) {
        return vec![];
    }
    let mut v = vec![
        lib.join("Application Support").join(bundle),
        lib.join("Caches").join(bundle),
        lib.join("Preferences").join(format!("{bundle}.plist")),
        lib.join("Containers").join(bundle),
        lib.join("Saved Application State").join(format!("{bundle}.savedState")),
        lib.join("HTTPStorages").join(bundle),
        lib.join("HTTPStorages").join(format!("{bundle}.binarycookies")),
        lib.join("WebKit").join(bundle),
        lib.join("Cookies").join(format!("{bundle}.binarycookies")),
        lib.join("Application Scripts").join(bundle),
        lib.join("Logs").join(bundle),
    ];
    // chaque chemin est exactement Library/<dossier>/<élément>
    v.retain(|p| p.parent().and_then(Path::parent) == Some(lib.as_path()) && p.file_name().is_some_and(|n| !n.is_empty()));
    v.retain(|p| std::fs::symlink_metadata(p).is_ok_and(|m| !fsutil::is_reparse(&m)) && fsutil::path_without_reparse(p));
    v.sort();
    v.dedup();
    v
}

/// « Google Chrome-2026-10-01-120000.ips » -> ("google chrome", plantage) ; « .hang » = blocage.
fn report_process(file: &str) -> Option<(String, bool)> {
    let (stem, ext) = file.rsplit_once('.')?;
    let hang = matches!(ext, "hang" | "spin");
    if !hang && !matches!(ext, "ips" | "crash") {
        return None;
    }
    let b = stem.as_bytes();
    let i = (1..b.len()).find(|&i| matches!(b[i - 1], b'-' | b'_') && b.get(i..i + 4).is_some_and(|y| y.starts_with(b"20") && y.iter().all(u8::is_ascii_digit)))?;
    Some((stem[..i - 1].to_lowercase(), hang))
}

fn report_counts() -> HashMap<String, (u32, u32)> {
    let cut = fsutil::now_ms() - CRASH_DAYS * DAY;
    let mut m: HashMap<String, (u32, u32)> = HashMap::new();
    let Some(h) = home() else { return m };
    let base = h.join("Library/Logs/DiagnosticReports");
    for dir in [base.clone(), base.join("Retired")] {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        for e in rd.flatten() {
            let Some((p, hang)) = report_process(&e.file_name().to_string_lossy()) else { continue };
            if e.metadata().is_ok_and(|md| fsutil::mtime(&md) >= cut) {
                let c = m.entry(p).or_default();
                if hang { c.1 += 1 } else { c.0 += 1 }
            }
        }
    }
    m
}

struct Found {
    app: App,
    exec: String,
    leftovers: Vec<PathBuf>,
}

fn scan() -> Vec<Found> {
    let running = os::running_processes();
    let reports = report_counts();
    let cancel = AtomicBool::new(false);
    bundles()
        .into_par_iter()
        .filter_map(|p| {
            let info = plist(&p.join("Contents/Info.plist"), &["CFBundleIdentifier", "CFBundleName", "CFBundleDisplayName", "CFBundleShortVersionString", "CFBundleExecutable"]);
            let bundle = info.get("CFBundleIdentifier")?.clone();
            if bundle.starts_with("com.apple.") || !id_ok(&bundle, 2) {
                return None; // applis du système (protégées) ou identifiant inutilisable
            }
            let file_name = p.file_stem()?.to_string_lossy().into_owned();
            let name = info.get("CFBundleDisplayName").or(info.get("CFBundleName")).cloned().unwrap_or_else(|| file_name.clone());
            let exec = info.get("CFBundleExecutable").cloned().unwrap_or(file_name.clone()).to_lowercase();
            let (last_used, added, size) = spotlight(&p);
            let left = app_data(&bundle);
            let (crashes, hangs) = reports.get(&exec).copied().unwrap_or_default();
            let app = App {
                id: p.to_string_lossy().into_owned(),
                system: is_system_name(&name),
                name,
                publisher: None,
                version: info.get("CFBundleShortVersionString").cloned(),
                size: size.filter(|s| *s > 0).unwrap_or_else(|| du(&p)),
                data: left.iter().map(|l| tree_stat(l, &cancel).size).sum(),
                installed: added,
                last_used,
                crashes,
                hangs,
                kind: "mac",
                icon: Some(p.to_string_lossy().into_owned()),
                running: running.binary_search(&exec).is_ok(),
                data_paths: left.iter().map(|l| l.to_string_lossy().into_owned()).collect(),
            };
            Some(Found { app, exec, leftovers: left })
        })
        .collect()
}

pub fn list() -> Listing {
    let mut apps: Vec<App> = scan().into_iter().map(|f| f.app).collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    let tracking = apps.iter().any(|a| a.last_used.is_some()); // Spotlight coupé : aucune date
    Listing { apps, tracking }
}

/// L'appli est recherchée à nouveau : seul un .app trouvé maintenant, fermé, peut partir.
fn find(id: &str) -> Result<Found, String> {
    let f = scan().into_iter().find(|f| f.app.id == id).ok_or("appli introuvable : actualise la liste")?;
    if os::running_processes().binary_search(&f.exec).is_ok() {
        return Err(format!("{} est ouverte : quitte-la d'abord", f.app.name));
    }
    Ok(f)
}

fn trash(paths: Vec<PathBuf>) -> Value {
    let gone = os::recycle(&paths);
    let left: Vec<String> = paths.iter().filter(|p| !gone.contains(p)).map(|p| p.to_string_lossy().into_owned()).collect();
    json!({ "removed": gone.len(), "left": left })
}

pub fn uninstall(id: &str) -> Result<Value, String> {
    let f = find(id)?;
    // l'appli d'abord, seule : refusée (installée par un .pkg, propriété de root), ses données restent
    os::recycle(&[PathBuf::from(&f.app.id)]);
    if Path::new(&f.app.id).exists() {
        return Err("macOS a refusé de déplacer l'appli (installée par l'administrateur ?) : glisse-la dans la Corbeille depuis le Finder. Ses données n'ont pas été touchées.".into());
    }
    let mut r = trash(f.leftovers);
    r["removed"] = json!(r["removed"].as_u64().unwrap_or(0) + 1);
    Ok(r)
}

/// Remet l'appli à neuf : ses réglages et données partent à la Corbeille, l'appli reste.
pub fn reset(id: &str) -> Result<Value, String> {
    let f = find(id)?;
    if f.leftovers.is_empty() {
        return Err("aucune donnée à réinitialiser".into());
    }
    Ok(trash(f.leftovers))
}

// ---------- restes d'applis supprimées ----------

/// « com.editeur.appli » : identifiant d'appli plausible, sans rien qu'une requête Spotlight interprète.
fn bundle_like(id: &str) -> bool {
    id_ok(id, 3)
}

/// « com.editeur » : deux premiers segments. Une extension ou un assistant porte souvent un
/// identifiant qui ne prolonge pas celui de son appli, mais garde l'éditeur.
fn vendor(id: &str) -> String {
    id.split('.').take(2).collect::<Vec<_>>().join(".")
}

/// Spotlight connaît-il une appli portant cet identifiant, n'importe où sur le Mac ?
fn bundle_known(id: &str) -> bool {
    Command::new("/usr/bin/mdfind")
        .arg(format!("kMDItemCFBundleIdentifier == '{id}'c")) // c : sans tenir compte de la casse
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(true) // dans le doute, l'appli existe
}

/// Données de ~/Library dont l'appli n'existe plus nulle part : (identifiant, chemins).
fn orphans() -> Result<Vec<(String, Vec<PathBuf>)>, String> {
    let lib = home().ok_or("dossier personnel introuvable")?.join("Library");
    let installed: Vec<String> = bundles()
        .into_par_iter()
        .filter_map(|p| plist(&p.join("Contents/Info.plist"), &["CFBundleIdentifier"]).remove("CFBundleIdentifier"))
        .filter(|s| id_ok(s, 2))
        .map(|s| s.to_lowercase())
        .collect();
    // Spotlight coupé ou incomplet : sans lui, toute donnée paraîtrait orpheline
    if !installed.iter().take(3).any(|id| bundle_known(id)) {
        return Err("Spotlight ne répond pas : impossible de savoir quelles applis existent encore".into());
    }
    let mut by_id: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for (dir, suffix) in [("Containers", ""), ("Application Support", ""), ("Caches", ""), ("HTTPStorages", ""), ("WebKit", ""), ("Saved Application State", ".savedState"), ("Preferences", ".plist")] {
        let Ok(rd) = std::fs::read_dir(lib.join(dir)) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Some(id) = (if suffix.is_empty() { Some(name.as_str()) } else { name.strip_suffix(suffix) }) else { continue };
            let low = id.to_lowercase();
            let mine = installed.iter().any(|i| low == *i || low.starts_with(&format!("{i}.")) || vendor(&low) == vendor(i));
            if !bundle_like(id) || low.starts_with("com.apple.") || mine {
                continue;
            }
            if std::fs::symlink_metadata(e.path()).is_ok_and(|m| !fsutil::is_reparse(&m)) && fsutil::path_without_reparse(&e.path()) {
                by_id.entry(id.to_string()).or_default().push(e.path());
            }
        }
    }
    let mut out: Vec<(String, Vec<PathBuf>)> = by_id.into_par_iter().filter(|(id, _)| !bundle_known(id)).collect();
    out.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    Ok(out)
}

pub fn leftovers() -> Result<Value, String> {
    let cancel = AtomicBool::new(false);
    let groups: Vec<Value> = orphans()?
        .into_par_iter()
        .map(|(id, paths)| {
            let size: u64 = paths.iter().map(|p| tree_stat(p, &cancel).size).sum();
            json!({ "id": id, "size": size, "paths": paths })
        })
        .collect();
    Ok(json!(groups))
}

/// Seuls les identifiants encore orphelins à cet instant partent, avec tous leurs chemins.
pub fn trash_leftovers(ids: &[String]) -> Result<Value, String> {
    let paths: Vec<PathBuf> = orphans()?.into_iter().filter(|(id, _)| ids.contains(id)).flat_map(|(_, p)| p).collect();
    if paths.is_empty() {
        return Err("rien à envoyer à la Corbeille : actualise la liste".into());
    }
    Ok(trash(paths))
}

// ---------- ouverture de session ----------

fn uid() -> u32 {
    unsafe { libc::getuid() }
}

/// `launchctl print-disabled` : « "com.x.y" => disabled » (ou « => true » sur les anciens systèmes).
fn disabled_labels() -> HashMap<String, bool> {
    let Ok(o) = Command::new("/bin/launchctl").arg("print-disabled").arg(format!("gui/{}", uid())).output() else { return HashMap::new() };
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter_map(|l| {
            let (k, v) = l.split_once("=>")?;
            let v = v.trim();
            Some((k.trim().trim_matches('"').to_string(), v == "disabled" || v == "true"))
        })
        .collect()
}

pub fn startup() -> Vec<Startup> {
    let state = disabled_labels();
    let mut dirs: Vec<(PathBuf, bool, &'static str)> = vec![];
    if let Some(h) = home() {
        dirs.push((h.join("Library/LaunchAgents"), true, "user"));
    }
    dirs.push((PathBuf::from("/Library/LaunchAgents"), true, "machine"));
    dirs.push((PathBuf::from("/Library/LaunchDaemons"), false, "machine"));
    let mut out = vec![];
    for (dir, editable, scope) in dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "plist")).collect();
        files.sort();
        for f in files {
            if std::fs::symlink_metadata(&f).map_or(true, |m| fsutil::is_reparse(&m)) {
                continue;
            }
            let k = plist(&f, &["Label", "Program", "ProgramArguments.0", "Disabled"]);
            let Some(label) = k.get("Label").cloned() else { continue };
            if label.starts_with("com.apple.") {
                continue;
            }
            let command = k.get("Program").or(k.get("ProgramArguments.0")).cloned().unwrap_or_default();
            let off = state.get(&label).copied().unwrap_or(k.get("Disabled").is_some_and(|d| d == "true"));
            out.push(Startup {
                id: f.to_string_lossy().into_owned(),
                name: label,
                enabled: !off,
                editable,
                scope,
                icon: app_of(&command),
                command,
            });
        }
    }
    out
}

/// « /Applications/X.app/Contents/MacOS/x » -> /Applications/X.app (pour l'icône).
fn app_of(cmd: &str) -> Option<String> {
    let i = cmd.find(".app/")?;
    Some(cmd[..i + 4].to_string())
}

pub fn set_startup(id: &str, enabled: bool) -> Result<Value, String> {
    let item = startup().into_iter().find(|s| s.id == id).ok_or("élément introuvable")?;
    if !item.editable {
        return Err("service système : réservé à l'administrateur".into());
    }
    let label = &item.name;
    if label.is_empty() || label.starts_with('-') || label.contains('/') {
        return Err("étiquette invalide".into());
    }
    let o = Command::new("/bin/launchctl")
        .arg(if enabled { "enable" } else { "disable" })
        .arg(format!("gui/{}/{label}", uid()))
        .output()
        .map_err(|e| e.to_string())?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(json!({ "enabled": enabled }))
}

// ---------- mises à jour ----------

pub fn updates() -> Result<Vec<Update>, String> {
    Err("pas de gestionnaire de mises à jour commun sur macOS : l'App Store et chaque appli s'en chargent".into())
}

pub fn upgrade(_id: &str) -> Result<Value, String> {
    Err("indisponible sur macOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn report_names() {
        assert_eq!(report_process("Google Chrome-2026-10-01-120000.ips"), Some(("google chrome".into(), false)));
        assert_eq!(report_process("Spotify_2025-01-02-030405_MacBook-Air.crash"), Some(("spotify".into(), false)));
        assert_eq!(report_process("Foo Bar_2026-03-04-050607_host.hang"), Some(("foo bar".into(), true)));
        assert_eq!(report_process("notes.txt"), None);
        assert_eq!(app_of("/Applications/Zoom.app/Contents/MacOS/zoom"), Some("/Applications/Zoom.app".into()));
        assert!(bundle_like("com.spotify.client"));
        assert!(bundle_like("us.zoom.xos"));
        assert!(!bundle_like("Google"), "dossier d'éditeur partagé");
        assert!(!bundle_like("com.x"));
        assert!(!bundle_like("com.x.y' || true"));
        assert!(!bundle_like(".hidden.thing.x"));
        assert!(!id_ok("", 2), "un identifiant vide désignerait le dossier Library/<x> entier");
        assert!(!id_ok("..", 2));
        assert!(app_data("").is_empty());
        assert!(id_ok("org.mozilla.firefox", 2));
        assert_eq!(vendor("com.vendor.safari"), vendor("com.vendor.app"));
    }
    #[test]
    fn real_listing_reads_only() {
        let l = list();
        for a in &l.apps {
            assert!(a.id.ends_with(".app"));
        }
        let _ = startup();
    }
}
