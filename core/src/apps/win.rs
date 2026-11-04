//! Windows : programmes inscrits dans « Uninstall », applis du Store, ouverture de session, winget.
//! Désinstaller lance TOUJOURS le programme officiel de l'appli (ou Remove-AppxPackage) : on ne
//! supprime jamais un dossier de programme nous-mêmes.

use super::{App, CRASH_DAYS, DAY, Listing, Startup, Update, date_ms, is_system_name, valid_package_id};
use crate::fsutil::{self, is_under, same_path, tree_stat};
use crate::os::{self, Hive, RegKey};
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

const UNINSTALL: [(Hive, &str); 3] = [
    (Hive::User, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    (Hive::Machine, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    (Hive::Machine, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
];

fn env(v: &str) -> Option<PathBuf> {
    std::env::var_os(v).filter(|x| !x.is_empty()).map(PathBuf::from)
}

fn filetime_ms(ft: u64) -> Option<i64> {
    (ft > 116_444_736_000_000_000).then(|| (ft / 10_000) as i64 - 11_644_473_600_000)
}
fn now_filetime() -> u64 {
    (fsutil::now_ms() as u64 + 11_644_473_600_000) * 10_000
}

fn rot13(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='m' | 'A'..='M' => (c as u8 + 13) as char,
            'n'..='z' | 'N'..='Z' => (c as u8 - 13) as char,
            _ => c,
        })
        .collect()
}

/// Dossiers connus par lesquels UserAssist abrège ses chemins.
fn known_folder(guid: &str) -> Option<PathBuf> {
    Some(match guid.to_ascii_uppercase().as_str() {
        "{6D809377-6AF0-444B-8957-A3773F02200E}" => env("ProgramFiles")?,
        "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}" => env("ProgramFiles(x86)")?,
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}" => env("SystemRoot")?.join("System32"),
        "{F38BF404-1D43-42F2-9305-67DE0B28FC23}" => env("SystemRoot")?,
        "{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}" => env("ProgramData")?.join(r"Microsoft\Windows\Start Menu\Programs"),
        "{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}" => env("APPDATA")?.join(r"Microsoft\Windows\Start Menu\Programs"),
        "{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}" => env("LOCALAPPDATA")?,
        "{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}" => env("APPDATA")?,
        _ => return None,
    })
}

fn expand_user_assist(n: &str) -> String {
    if let (true, Some(end)) = (n.starts_with('{'), n.find('}')) {
        if let Some(dir) = known_folder(&n[..=end]) {
            return dir.join(n[end + 1..].trim_start_matches('\\')).to_string_lossy().into_owned();
        }
    }
    n.to_string()
}

/// Ouvertures notées par l'Explorateur : (chemin, raccourci ou AUMID du Store, date).
/// Vide quand « suivre les lancements d'applis » est coupé.
fn user_assist() -> Vec<(String, i64)> {
    let base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist";
    let Some(root) = RegKey::open(Hive::User, base) else { return vec![] };
    let mut out = vec![];
    for g in root.subkeys() {
        let Some(k) = RegKey::open(Hive::User, &format!(r"{base}\{g}\Count")) else { continue };
        for (name, _, data) in k.values() {
            // 72 octets depuis Windows 7 ; la date de dernière ouverture est aux octets 60..68
            let Some(ft) = data.get(60..68).map(|b| u64::from_le_bytes(b.try_into().unwrap())) else { continue };
            if let Some(t) = filetime_ms(ft) {
                out.push((expand_user_assist(&rot13(&name)), t));
            }
        }
    }
    out
}

/// Dossiers trop larges pour représenter UNE appli (un InstallLocation « C:\Program Files » existe).
fn too_broad() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "PUBLIC"]
        .iter()
        .filter_map(|e| env(e))
        .collect();
    let sub = |e: &str, s: &[&str]| env(e).map(|b| s.iter().map(|x| b.join(x)).collect::<Vec<_>>()).unwrap_or_default();
    v.extend(sub("LOCALAPPDATA", &["Programs", "Microsoft", "Temp", "Packages"]));
    v.extend(sub("APPDATA", &["Microsoft"]));
    v.extend(sub("ProgramData", &["Microsoft", "Package Cache"]));
    v.extend(sub("USERPROFILE", &["AppData", "Desktop", "Documents", "Downloads"]));
    v
}

/// Le dossier d'une appli, s'il la désigne seule : au moins deux niveaux sous la racine du lecteur,
/// hors de Windows et des dossiers partagés.
fn app_dir(raw: &str, broad: &[PathBuf]) -> Option<PathBuf> {
    let p = PathBuf::from(raw.trim().trim_matches('"').trim_end_matches('\\'));
    let deep = p.components().filter(|c| matches!(c, std::path::Component::Normal(_))).count() >= 2;
    let windows = env("SystemRoot").is_some_and(|w| same_path(&w, &p) || is_under(&p, &w));
    let ok = deep && fsutil::is_clean_abs(&p) && !windows && !broad.iter().any(|b| same_path(b, &p)) && fsutil::path_without_reparse(&p) && p.is_dir();
    ok.then_some(p)
}

/// « "C:\x\app.exe",0 » -> C:\x\app.exe
fn icon_file(raw: &str) -> Option<PathBuf> {
    let s = raw.trim();
    let s = match s.rfind(',') {
        Some(i) if s[i + 1..].trim().trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) => &s[..i],
        _ => s,
    };
    let p = PathBuf::from(s.trim().trim_matches('"'));
    let ext = p.extension()?.to_string_lossy().to_lowercase();
    (matches!(ext.as_str(), "exe" | "ico") && p.is_file()).then_some(p)
}

/// Noms d'exécutables (minuscules) sous un dossier d'appli, deux niveaux au plus.
fn exes(dir: &Path, depth: u32, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten().take(2000) {
        let Ok(md) = std::fs::symlink_metadata(e.path()) else { continue };
        if fsutil::is_reparse(&md) {
            continue;
        }
        if md.is_dir() {
            if depth > 0 {
                exes(&e.path(), depth - 1, out);
            }
        } else {
            let n = e.file_name().to_string_lossy().to_lowercase();
            let helper = n.starts_with("unins") || n.contains("uninstall") || n.contains("updater") || n == "update.exe" || n.contains("crashpad");
            if n.ends_with(".exe") && !helper {
                out.push(n);
            }
        }
    }
}

/// « AppCrash_chrome.exe_… » -> ("chrome.exe", plantage) ; « AppHang_… » -> blocage.
fn wer_entry(folder: &str) -> Option<(String, bool)> {
    let (rest, hang) = if let Some(r) = folder.strip_prefix("AppCrash_") {
        (r, false)
    } else {
        (folder.strip_prefix("AppHang_")?, true)
    };
    let low = rest.to_lowercase();
    let end = low.find(".exe_")? + 4;
    Some((low[..end].to_string(), hang))
}

/// Plantages et blocages des 30 derniers jours, par exécutable, d'après les rapports d'erreurs.
fn wer_counts() -> HashMap<String, (u32, u32)> {
    let cut = fsutil::now_ms() - CRASH_DAYS * DAY;
    let mut m: HashMap<String, (u32, u32)> = HashMap::new();
    for base in [env("LOCALAPPDATA"), env("ProgramData")].into_iter().flatten() {
        for sub in ["ReportArchive", "ReportQueue"] {
            let Ok(rd) = std::fs::read_dir(base.join(r"Microsoft\Windows\WER").join(sub)) else { continue };
            for e in rd.flatten() {
                let Some((exe, hang)) = wer_entry(&e.file_name().to_string_lossy()) else { continue };
                let recent = e.metadata().map(|md| fsutil::item_time(&md) >= cut).unwrap_or(false);
                if recent {
                    let c = m.entry(exe).or_default();
                    if hang { c.1 += 1 } else { c.0 += 1 }
                }
            }
        }
    }
    m
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

struct Reg {
    id: String,
    name: String,
    publisher: Option<String>,
    version: Option<String>,
    size: u64,
    installed: Option<i64>,
    dir: Option<PathBuf>,
    icon: Option<PathBuf>,
}

fn read_uninstall_entries() -> Vec<Reg> {
    let broad = too_broad();
    let mut out: Vec<Reg> = vec![];
    for (i, (hive, path)) in UNINSTALL.iter().enumerate() {
        let Some(root) = RegKey::open(*hive, path) else { continue };
        for sub in root.subkeys() {
            let Some(k) = RegKey::open(*hive, &format!(r"{path}\{sub}")) else { continue };
            let Some(name) = k.string("DisplayName") else { continue };
            let patch = k.string("ParentKeyName").is_some() || k.string("ReleaseType").is_some_and(|t| t.to_lowercase().contains("update") || t.eq_ignore_ascii_case("hotfix"));
            if k.dword("SystemComponent") == Some(1) || patch || k.string("UninstallString").is_none() {
                continue;
            }
            let version = k.string("DisplayVersion");
            if out.iter().any(|r| r.name == name && r.version == version) {
                continue; // même programme inscrit en 32 et 64 bits
            }
            let icon = k.string("DisplayIcon").and_then(|s| icon_file(&s));
            let dir = k
                .string("InstallLocation")
                .and_then(|s| app_dir(&s, &broad))
                .or_else(|| icon.as_ref().and_then(|i| i.parent()).and_then(|d| app_dir(&d.to_string_lossy(), &broad)));
            out.push(Reg {
                id: format!("reg:{i}:{sub}"),
                name: name.trim().to_string(),
                publisher: k.string("Publisher").map(|s| s.trim().to_string()),
                version,
                size: k.dword("EstimatedSize").map(|kb| kb as u64 * 1024).unwrap_or(0),
                installed: k.string("InstallDate").and_then(|d| date_ms(&d)),
                dir,
                icon,
            });
        }
    }
    out
}

#[derive(Deserialize)]
struct Pkg {
    name: String,
    family: String,
    full: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    dir: Option<String>,
}

/// Applis du Store visibles dans le menu Démarrer et désinstallables.
const STORE_LIST: &str = r#"$s=@{}; try { Get-StartApps | ForEach-Object { $f=($_.AppID -split '!')[0]; if (-not $s.ContainsKey($f)) { $s[$f]=$_.Name } } } catch {}
$p = @(Get-AppxPackage -PackageTypeFilter Main | Where-Object { -not $_.NonRemovable -and -not $_.IsFramework -and $_.SignatureKind -eq 'Store' -and $s.ContainsKey($_.PackageFamilyName) } | ForEach-Object { [pscustomobject]@{ name=$s[$_.PackageFamilyName]; family=$_.PackageFamilyName; full=$_.PackageFullName; version=[string]$_.Version; dir=$_.InstallLocation } })
ConvertTo-Json -Compress -InputObject $p"#;

fn store_packages() -> Vec<Pkg> {
    let Ok(out) = os::powershell(STORE_LIST, &[]) else { return vec![] };
    match serde_json::from_str::<Value>(out.trim()) {
        Ok(v @ Value::Array(_)) => serde_json::from_value(v).unwrap_or_default(),
        Ok(v @ Value::Object(_)) => serde_json::from_value(v).map(|p| vec![p]).unwrap_or_default(),
        _ => vec![],
    }
}

pub fn list() -> Listing {
    let (store, (regs, assist, wer)) = rayon::join(store_packages, || (read_uninstall_entries(), user_assist(), wer_counts()));
    let running = os::running_processes();
    let tracking = !assist.is_empty();
    let cancel = AtomicBool::new(false);
    let lnks: Vec<(String, i64)> = assist
        .iter()
        .filter(|(p, _)| p.to_lowercase().ends_with(".lnk"))
        .filter_map(|(p, t)| Some((norm(Path::new(p).file_stem()?.to_str()?), *t)))
        .collect();
    let mut apps: Vec<App> = regs
        .into_par_iter()
        .map(|r| {
            let mut names = vec![];
            if let Some(d) = &r.dir {
                exes(d, 2, &mut names);
            }
            // dernière ouverture : un exécutable sous son dossier, ou un raccourci qui porte son nom
            let n = norm(&r.name);
            let by_exe = r.dir.as_ref().and_then(|d| assist.iter().filter(|(p, _)| is_under(Path::new(p), d)).map(|(_, t)| *t).max());
            let by_lnk = lnks.iter().filter(|(l, _)| !l.is_empty() && (*l == n || (l.len() >= 6 && n.starts_with(l.as_str())))).map(|(_, t)| *t).max();
            let (crashes, hangs) = names.iter().filter_map(|x| wer.get(x)).fold((0, 0), |a, c| (a.0 + c.0, a.1 + c.1));
            let size = if r.size > 0 { r.size } else { r.dir.as_ref().map(|d| tree_stat(d, &cancel).size).unwrap_or(0) };
            let installed = r.installed.or_else(|| r.dir.as_ref().and_then(|d| d.metadata().ok()).and_then(|m| m.created().ok()).map(|t| fsutil::now_ms().min(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0))));
            App {
                system: is_system_name(&r.name),
                id: r.id,
                publisher: r.publisher,
                version: r.version,
                size,
                installed,
                last_used: by_exe.max(by_lnk),
                crashes,
                hangs,
                kind: "app",
                icon: r.icon.or_else(|| r.dir.as_ref().and_then(|d| names.first().map(|e| d.join(e))).filter(|p| p.is_file())).map(|p| p.to_string_lossy().into_owned()),
                running: names.iter().any(|x| running.binary_search(x).is_ok()),
                name: r.name,
                data: 0,
            }
        })
        .collect();
    let local = env("LOCALAPPDATA");
    let store: Vec<App> = store.into_par_iter().map(|p| {
        let pre = format!("{}!", p.family.to_lowercase());
        let dir = p.dir.as_deref().map(PathBuf::from).filter(|d| d.is_dir());
        let data = local.as_ref().map(|l| tree_stat(&l.join("Packages").join(&p.family), &cancel).size).unwrap_or(0);
        App {
            id: format!("appx:{}", p.full),
            system: is_system_name(&p.name),
            name: p.name,
            publisher: None,
            version: p.version,
            size: dir.as_ref().map(|d| tree_stat(d, &cancel).size).unwrap_or(0),
            data,
            installed: dir.as_ref().and_then(|d| d.metadata().ok()).and_then(|m| m.created().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64),
            last_used: assist.iter().filter(|(a, _)| a.to_lowercase().starts_with(&pre)).map(|(_, t)| *t).max(),
            crashes: 0,
            hangs: 0,
            kind: "store",
            icon: None,
            running: false,
        }
    }).collect();
    apps.extend(store);
    apps.sort_by_key(|a| a.name.to_lowercase());
    Listing { apps, tracking }
}

const STORE_REMOVE: &str = r#"$p = Get-AppxPackage -PackageTypeFilter Main | Where-Object { $_.PackageFullName -eq $env:KC_PKG -and -not $_.NonRemovable -and -not $_.IsFramework }
if (-not $p) { throw 'appli introuvable' }
Remove-AppxPackage -Package $p.PackageFullName -ErrorAction Stop
'ok'"#;

/// Relit l'inscription au moment même : l'identifiant venu de l'interface ne désigne qu'une clé.
pub fn uninstall(id: &str) -> Result<Value, String> {
    if let Some(full) = id.strip_prefix("appx:") {
        if full.is_empty() || !full.chars().all(|c| c.is_ascii_alphanumeric() || "._-~".contains(c)) {
            return Err("identifiant invalide".into());
        }
        os::powershell(STORE_REMOVE, &[("KC_PKG", full)])?;
        return Ok(json!({ "removed": true }));
    }
    let rest = id.strip_prefix("reg:").ok_or("identifiant invalide")?;
    let (i, sub) = rest.split_once(':').ok_or("identifiant invalide")?;
    let (hive, path) = *i.parse::<usize>().ok().and_then(|i| UNINSTALL.get(i)).ok_or("identifiant invalide")?;
    if sub.is_empty() || sub.contains('\\') {
        return Err("identifiant invalide".into());
    }
    let k = RegKey::open(hive, &format!(r"{path}\{sub}")).ok_or("ce programme n'est plus installé")?;
    let cmd = k.string("UninstallString").ok_or("ce programme n'a pas de désinstalleur")?;
    let (file, params) = os::split_command(&cmd).ok_or("désinstalleur illisible")?;
    os::launch(&file, &params)?;
    Ok(json!({ "launched": true }))
}

/// Restes d'applis supprimées : sous Windows, rien ne relie sûrement un dossier à une appli disparue.
pub fn leftovers() -> Result<Value, String> {
    Err("disponible sur macOS seulement".into())
}
pub fn trash_leftovers(_ids: &[String]) -> Result<Value, String> {
    Err("disponible sur macOS seulement".into())
}

// ---------- ouverture de session ----------

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

/// État noté par le Gestionnaire des tâches : premier octet pair = activé ; absent = activé.
fn approved(hive: Hive, sub: &str) -> HashMap<String, bool> {
    RegKey::open(hive, &format!(r"{APPROVED}\{sub}"))
        .map(|k| k.values().into_iter().filter_map(|(n, _, d)| Some((n.to_lowercase(), d.first()? & 1 == 0))).collect())
        .unwrap_or_default()
}

fn startup_folder(base: Option<PathBuf>) -> Vec<(String, PathBuf)> {
    let Some(dir) = base.map(|b| b.join(r"Microsoft\Windows\Start Menu\Programs\Startup")) else { return vec![] };
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut v: Vec<_> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .filter(|(n, _)| !n.eq_ignore_ascii_case("desktop.ini"))
        .collect();
    v.sort();
    v
}

fn command_icon(cmd: &str) -> Option<String> {
    let (f, _) = os::split_command(cmd)?;
    let f = fsutil::expand_env(&f)?;
    f.is_file().then(|| f.to_string_lossy().into_owned())
}

pub fn startup() -> Vec<Startup> {
    let mut out = vec![];
    let label = |n: &str| Path::new(n).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| n.to_string());
    let mut runs = |hive: Hive, key: &str, sub: &str, prefix: &str, scope: &'static str| {
        let state = approved(hive, sub);
        for (name, ty, data) in RegKey::open(hive, key).map(|k| k.values()).unwrap_or_default() {
            if ty != 1 && ty != 2 {
                continue; // REG_SZ / REG_EXPAND_SZ
            }
            let command = os::reg_value_text(&data);
            out.push(Startup {
                id: format!("{prefix}:{name}"),
                enabled: *state.get(&name.to_lowercase()).unwrap_or(&true),
                editable: matches!(hive, Hive::User),
                scope,
                icon: command_icon(&command),
                name: name.clone(),
                command,
            });
        }
    };
    runs(Hive::User, RUN, "Run", "run", "user");
    runs(Hive::Machine, RUN, "Run", "hklm", "machine");
    runs(Hive::Machine, RUN32, "Run32", "hklm32", "machine");
    for (hive, base, prefix, scope) in [(Hive::User, env("APPDATA"), "folder", "user"), (Hive::Machine, env("ProgramData"), "common", "machine")] {
        let state = approved(hive, "StartupFolder");
        for (file, path) in startup_folder(base) {
            out.push(Startup {
                id: format!("{prefix}:{file}"),
                name: label(&file),
                command: path.to_string_lossy().into_owned(),
                enabled: *state.get(&file.to_lowercase()).unwrap_or(&true),
                editable: matches!(hive, Hive::User),
                scope,
                icon: Some(path.to_string_lossy().into_owned()),
            });
        }
    }
    out
}

/// Même écriture que le Gestionnaire des tâches, réversible : la commande n'est jamais touchée.
pub fn set_startup(id: &str, enabled: bool) -> Result<Value, String> {
    let item = startup().into_iter().find(|s| s.id == id).ok_or("élément introuvable")?;
    if !item.editable {
        return Err("élément commun à tous les utilisateurs : à régler depuis le Gestionnaire des tâches".into());
    }
    let (sub, name) = match id.split_once(':') {
        Some(("run", n)) => ("Run", n),
        Some(("folder", n)) => ("StartupFolder", n),
        _ => return Err("élément introuvable".into()),
    };
    let mut data = [0u8; 12];
    if enabled {
        data[0] = 2;
    } else {
        data[0] = 3;
        data[4..].copy_from_slice(&now_filetime().to_le_bytes());
    }
    let k = RegKey::create_user(&format!(r"{APPROVED}\{sub}")).ok_or("registre inaccessible")?;
    if !k.set_binary(name, &data) {
        return Err("écriture refusée".into());
    }
    Ok(json!({ "enabled": enabled }))
}

// ---------- mises à jour ----------

/// Identifiants de la dernière liste : seuls ceux-là peuvent être mis à jour.
static LISTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn winget(args: &[&str]) -> Result<std::process::Output, String> {
    os::command_no_window("winget")
        .args(args)
        .args(["--accept-source-agreements", "--disable-interactivity"])
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|_| "winget est absent : installe « Programme d'installation d'application » depuis le Microsoft Store".to_string())
}

/// Tableau de `winget upgrade` : colonnes repérées sur l'en-tête (traduit selon la langue).
fn parse_upgrade_table(text: &str) -> Vec<Update> {
    let lines: Vec<&str> = text.lines().map(|l| l.rsplit('\r').next().unwrap_or(l)).collect();
    let Some(sep) = lines.iter().position(|l| l.len() >= 10 && l.trim().chars().all(|c| c == '-')) else { return vec![] };
    let Some(header) = sep.checked_sub(1).map(|i| lines[i].chars().collect::<Vec<char>>()) else { return vec![] };
    let starts: Vec<usize> = (0..header.len()).filter(|&i| header[i] != ' ' && (i == 0 || header[i - 1] == ' ')).collect();
    if starts.len() < 4 {
        return vec![];
    }
    let mut out = vec![];
    for l in &lines[sep + 1..] {
        let c: Vec<char> = l.chars().collect();
        if c.len() <= starts[3] {
            break; // fin du tableau (« 3 mises à niveau disponibles. »)
        }
        let col = |i: usize| -> String {
            let end = starts.get(i + 1).copied().unwrap_or(c.len()).min(c.len());
            c[starts[i].min(end)..end].iter().collect::<String>().trim().to_string()
        };
        let (name, id, version, available) = (col(0), col(1), col(2), col(3));
        if valid_package_id(&id) && !available.is_empty() {
            out.push(Update { id, name, version, available });
        }
    }
    out
}

pub fn updates() -> Result<Vec<Update>, String> {
    let out = winget(&["upgrade"])?;
    let list = parse_upgrade_table(&String::from_utf8_lossy(&out.stdout));
    *LISTED.lock().unwrap_or_else(|e| e.into_inner()) = list.iter().map(|u| u.id.clone()).collect();
    Ok(list)
}

pub fn upgrade(id: &str) -> Result<Value, String> {
    if !valid_package_id(id) || !LISTED.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|x| x == id) {
        return Err("mise à jour inconnue : actualise la liste".into());
    }
    let out = winget(&["upgrade", "--id", id, "--exact", "--accept-package-agreements"])?;
    if out.status.success() {
        LISTED.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| x != id);
        Ok(json!({ "updated": true }))
    } else {
        let text = String::from_utf8_lossy(&out.stdout);
        let last = text.lines().map(|l| l.rsplit('\r').next().unwrap_or(l).trim()).filter(|l| l.len() > 3).last().unwrap_or("échec de la mise à jour");
        Err(last.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn user_assist_names_decode() {
        assert_eq!(rot13("{6Q809377-6NS0-444O-8957-N3773S02200R}\\Fcbgvsl\\Fcbgvsl.rkr"), "{6D809377-6AF0-444B-8957-A3773F02200E}\\Spotify\\Spotify.exe");
        let pf = env("ProgramFiles").unwrap();
        assert_eq!(PathBuf::from(expand_user_assist(r"{6D809377-6AF0-444B-8957-A3773F02200E}\Spotify\Spotify.exe")), pf.join(r"Spotify\Spotify.exe"));
        assert_eq!(expand_user_assist("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App");
        assert_eq!(filetime_ms(116_444_736_000_000_000 + 10_000), Some(1));
        assert_eq!(filetime_ms(0), None);
    }
    #[test]
    fn crash_reports_and_dirs() {
        assert_eq!(wer_entry("AppCrash_my_app.exe_3f2a_abc_cab_1234"), Some(("my_app.exe".into(), false)));
        assert_eq!(wer_entry("AppHang_Chrome.EXE_99_cab"), Some(("chrome.exe".into(), true)));
        assert_eq!(wer_entry("Kernel_141_abc"), None);
        let broad = too_broad();
        let pf = env("ProgramFiles").unwrap();
        assert_eq!(app_dir(&pf.to_string_lossy(), &broad), None, "Program Files entier n'est pas une appli");
        assert_eq!(app_dir(r"C:\Windows\System32", &broad), None);
        assert_eq!(icon_file(r#""C:\Windows\explorer.exe",0"#), Some(PathBuf::from(r"C:\Windows\explorer.exe")));
        assert_eq!(icon_file(r"C:\Windows\explorer.exe,-101"), Some(PathBuf::from(r"C:\Windows\explorer.exe")));
        assert_eq!(icon_file(r"C:\nope\x.dll"), None);
    }
    #[test]
    fn winget_table_parses_in_french() {
        let t = "   - \r   \\ \rNom                         ID                          Version       Disponible    Source\n\
                 -------------------------------------------------------------------------------------------------\n\
                 Microsoft Visual Studio Code Microsoft.VisualStudioCode  1.94.0        1.95.1        winget\n\
                 Spotify                     Spotify.Spotify             1.2.3.4       1.2.5.0       winget\n\
                 2 mises à niveau disponibles.\n";
        let u = parse_upgrade_table(t);
        assert_eq!(u.len(), 2);
        assert_eq!((u[1].id.as_str(), u[1].version.as_str(), u[1].available.as_str()), ("Spotify.Spotify", "1.2.3.4", "1.2.5.0"));
        assert_eq!(u[0].name, "Microsoft Visual Studio Code");
        assert!(parse_upgrade_table("Aucune mise à niveau disponible.").is_empty());
        assert!(upgrade("Spotify.Spotify").is_err(), "jamais listé dans ce processus de test");
    }
    #[test]
    fn startup_and_uninstall_ids_are_checked() {
        assert!(uninstall("reg:9:x").is_err());
        assert!(uninstall(r"reg:0:a\b").is_err());
        assert!(uninstall("appx:a;b").is_err());
        assert!(uninstall("C:/x").is_err());
        assert!(set_startup("hklm:nope", false).is_err());
        assert!(set_startup("run:kubeclean-absent-de-toute-liste", false).is_err());
    }
    #[test]
    fn real_listing_reads_only() {
        let l = list();
        assert!(!l.apps.is_empty());
        let _ = startup();
    }
}
