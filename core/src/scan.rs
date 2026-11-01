//! Turning rules into concrete items.

use crate::fsutil::*;
use crate::rules::{Kind, Rule, RuleSet, Task};
use crate::store::Settings;
use crate::win;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

const DAY: i64 = 86_400_000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(serialize_with = "lossy_path")]
    pub path: PathBuf,
    pub size: u64,
    pub newest: i64,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_days: Option<i64>,
    pub default: bool,
}

fn lossy_path<S: serde::Serializer>(p: &Path, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&p.to_string_lossy())
}

/// Everything the cleaner needs to re-check an item before touching it.
#[derive(Clone, Debug)]
pub struct RuleScan {
    pub rule: Rule,
    pub roots: Vec<PathBuf>,
    pub cutoff: i64,
    pub items: Vec<Item>,
    pub size_known: bool,
}

pub struct Ctx<'a> {
    pub settings: &'a Settings,
    pub global_exclude: Option<Mask>,
    pub now: i64,
    pub cancel: &'a AtomicBool,
}

fn file_item(f: FoundFile) -> Item {
    Item { path: f.path, size: f.size, newest: f.time, is_dir: false, label: None, idle_days: None, default: true }
}

pub fn task_roots(t: Task) -> (Vec<PathBuf>, u32) {
    let sr = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let pd = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
    match t {
        Task::WindowsTemp => (vec![Path::new(&sr).join("Temp")], 2),
        Task::SystemWer => (["ReportArchive", "ReportQueue", "Temp"].iter().map(|d| Path::new(&pd).join(r"Microsoft\Windows\WER").join(d)).collect(), 0),
        Task::DeliveryOptimization => (vec![Path::new(&sr).join(r"ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache")], 0),
        Task::ComponentStore => (vec![], 0),
    }
}

pub fn scan_rule(rule: &Rule, cx: &Ctx) -> RuleScan {
    let cutoff = rule.older_than_days.map(|d| cx.now - d as i64 * DAY).unwrap_or(0);
    let mut roots: Vec<PathBuf> = rule.paths.iter().flat_map(|p| resolve_paths(p)).collect();
    let mut items: Vec<Item> = vec![];
    let mut size_known = true;
    match rule.kind {
        Kind::Files => {
            let (mask, exclude) = (Mask::parse(rule.mask.as_deref()), Mask::parse(rule.exclude.as_deref()));
            let exclude_dirs: Vec<PathBuf> = rule.exclude_dirs.iter().filter_map(|d| expand_env(d)).collect();
            let o = WalkOpts {
                depth: rule.depth.unwrap_or(50),
                mask: mask.as_ref(),
                exclude: exclude.as_ref(),
                global_exclude: cx.global_exclude.as_ref(),
                exclude_dirs: &exclude_dirs,
                cutoff,
            };
            for r in &roots {
                items.extend(walk_files(r, o.depth, &o, cx.cancel).into_iter().map(file_item));
            }
        }
        Kind::Children => {
            let mask = Mask::parse(rule.mask.as_deref());
            // "old version" = a newer version of the same product sits next to it,
            // not merely "unused for a while" (that could be the only, current one)
            let latest = rule.superseded_only.then(|| latest_versions(&roots));
            let mut cands: Vec<Item> = roots
                .par_iter()
                .flat_map(|r| {
                    let ents: Vec<_> = fs::read_dir(r).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default();
                    ents.into_par_iter()
                        .filter_map(|p| {
                            let md = fs::symlink_metadata(&p).ok()?;
                            let name = p.file_name()?.to_string_lossy().to_string();
                            if is_reparse(&md) || mask.as_ref().is_some_and(|m| !m.hit(&name)) {
                                return None;
                            }
                            if latest.as_ref().is_some_and(|l| !is_superseded(&name, l)) {
                                return None;
                            }
                            let s = tree_stat(&p, cx.cancel);
                            (s.size > 0 && (cutoff == 0 || s.newest <= cutoff)).then(|| Item {
                                path: p, size: s.size, newest: s.newest, is_dir: md.is_dir(), label: None,
                                idle_days: Some((cx.now - s.newest) / DAY), default: true,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .collect();
            // overlapping patterns can list a folder and its own children: keep the folder
            cands.sort_by_key(|c| c.path.as_os_str().len());
            for c in cands {
                if !items.iter().any(|i| is_under(&c.path, &i.path)) {
                    items.push(c);
                }
            }
        }
        Kind::RecycleBin => {
            let (size, count) = win::recycle_bin_info();
            if size > 0 || count > 0 {
                items.push(Item { path: PathBuf::from("Corbeille"), size, newest: 0, is_dir: true, label: Some(format!("{count}")), idle_days: None, default: true });
            }
        }
        Kind::Projects => {
            roots = cx.settings.project_roots.iter().filter_map(|r| expand_env(r)).collect();
            items = scan_projects(&roots, cx);
        }
        Kind::LargeFiles => {
            if let Some(home) = expand_env("%USERPROFILE%") {
                roots = vec![home.clone()];
                let min = cx.settings.large_file_min_mb * 1024 * 1024;
                // CrossDevice = the phone's storage seen through Phone Link: deleting there
                // can delete on the phone. Never list it.
                let mut skip: Vec<PathBuf> = ["AppData", "Downloads", "CrossDevice"].iter().map(|d| home.join(d)).collect();
                for v in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
                    if let Ok(p) = std::env::var(v) {
                        skip.push(PathBuf::from(p)); // deleting a synced file deletes it in the cloud too
                    }
                }
                items = large_files(&home, &skip, min, 12, cx.cancel);
            }
        }
        Kind::OldDownloads => {
            if let Some(dl) = expand_env("%USERPROFILE%/Downloads") {
                let cut = cx.now - cx.settings.downloads_older_than_days as i64 * DAY;
                roots = vec![dl.clone()];
                let ents: Vec<PathBuf> = fs::read_dir(&dl).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default();
                items = ents
                    .into_par_iter()
                    .filter_map(|p| {
                        let md = fs::symlink_metadata(&p).ok()?;
                        if is_reparse(&md) || p.file_name()?.to_string_lossy().eq_ignore_ascii_case("desktop.ini") {
                            return None;
                        }
                        let s = tree_stat(&p, cx.cancel);
                        (s.size > 0 && s.newest <= cut).then(|| Item {
                            path: p, size: s.size, newest: s.newest, is_dir: md.is_dir(), label: None,
                            idle_days: Some((cx.now - s.newest) / DAY), default: false,
                        })
                    })
                    .collect();
            }
        }
        Kind::Elevated => {
            let task = rule.task.expect("validated");
            let (troots, days) = task_roots(task);
            let tcut = if days > 0 { cx.now - days as i64 * DAY } else { 0 };
            roots = troots.clone();
            size_known = task != Task::ComponentStore;
            for r in &troots {
                if fs::read_dir(r).is_err() {
                    size_known = false; // readable only by an administrator
                    continue;
                }
                let o = WalkOpts { depth: 50, mask: None, exclude: None, global_exclude: None, exclude_dirs: &[], cutoff: tcut };
                items.extend(walk_files(r, 50, &o, cx.cancel).into_iter().map(file_item));
            }
        }
    }
    items.retain(|i| !cx.settings.is_ignored(&i.path));
    // biggest first, once: the UI designates items by this position
    items.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path)));
    if rule.per_item() && rule.kind != Kind::Projects {
        for i in &mut items {
            i.default = false;
        }
    }
    RuleScan { rule: rule.clone(), roots, cutoff, items, size_known }
}

/// "PyCharm2025.2" -> ("pycharm", [2025, 2]); None when there is no version tail.
pub fn split_version(name: &str) -> Option<(String, Vec<u32>)> {
    let i = name.find(|c: char| c.is_ascii_digit())?;
    let (prod, ver) = name.split_at(i);
    let v: Vec<u32> = ver.split('.').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    (!prod.is_empty()).then(|| (prod.to_lowercase(), v))
}

fn latest_versions(roots: &[PathBuf]) -> std::collections::HashMap<String, Vec<u32>> {
    let mut m: std::collections::HashMap<String, Vec<u32>> = Default::default();
    for r in roots {
        for e in fs::read_dir(r).into_iter().flatten().flatten() {
            if let Some((p, v)) = split_version(&e.file_name().to_string_lossy()) {
                let cur = m.entry(p).or_default();
                if v > *cur {
                    *cur = v;
                }
            }
        }
    }
    m
}

fn is_superseded(name: &str, latest: &std::collections::HashMap<String, Vec<u32>>) -> bool {
    split_version(name).is_some_and(|(p, v)| latest.get(&p).is_some_and(|l| *l > v))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions_superseded_only_by_newer_sibling() {
        assert_eq!(split_version("PyCharm2025.2"), Some(("pycharm".into(), vec![2025, 2])));
        assert_eq!(split_version("AndroidStudio2025.2.3"), Some(("androidstudio".into(), vec![2025, 2, 3])));
        assert_eq!(split_version("Chrome"), None);
        let latest: std::collections::HashMap<String, Vec<u32>> =
            [("pycharm".to_string(), vec![2025, 3]), ("androidstudio".to_string(), vec![2025, 2, 3])].into();
        assert!(is_superseded("PyCharm2025.2", &latest));
        assert!(is_superseded("PyCharm2024.3.5", &latest));
        assert!(!is_superseded("PyCharm2025.3", &latest), "the newest is never old");
        assert!(!is_superseded("AndroidStudio2025.2.3", &latest), "the only version is never old");
        assert!(!is_superseded("IntelliJIdea2023.1", &latest), "no newer sibling of that product");
    }
}

// ---------- project build folders ----------

pub struct Artifact {
    pub name: &'static str,
    pub label: &'static str,
    /// files that must sit next to the folder (in the project), or inside it
    pub beside: &'static [&'static str],
    pub inside: &'static [&'static str],
    pub beside_ext: Option<&'static str>,
}
const JS: &[&str] = &["package.json"];
pub const ARTIFACTS: &[Artifact] = &[
    Artifact { name: "node_modules", label: "Node", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".next", label: "Next.js", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".nuxt", label: "Nuxt", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".svelte-kit", label: "SvelteKit", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".turbo", label: "Turbo", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".parcel-cache", label: "Parcel", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: ".angular", label: "Angular", beside: JS, inside: &[], beside_ext: None },
    Artifact { name: "target", label: "Rust / Maven", beside: &["Cargo.toml", "pom.xml"], inside: &[], beside_ext: None },
    Artifact { name: ".venv", label: "Python", beside: &[], inside: &["pyvenv.cfg"], beside_ext: None },
    Artifact { name: "venv", label: "Python", beside: &[], inside: &["pyvenv.cfg"], beside_ext: None },
    Artifact { name: ".gradle", label: "Gradle", beside: &["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"], inside: &[], beside_ext: None },
    Artifact { name: "build", label: "Gradle", beside: &["build.gradle", "build.gradle.kts"], inside: &[], beside_ext: None },
    Artifact { name: "obj", label: ".NET", beside: &[], inside: &[], beside_ext: Some("proj") },
];
const SKIP_DIRS: &[&str] = &[".git", ".hg", ".svn", "appdata", "$recycle.bin", "program files", "program files (x86)", "windows"];

fn has_any(dir: &Path, names: &[&str]) -> bool {
    names.iter().any(|n| fs::symlink_metadata(dir.join(n)).is_ok())
}

pub fn artifact_label(dir: &Path) -> Option<&'static str> {
    let name = dir.file_name()?.to_string_lossy().to_string();
    let a = ARTIFACTS.iter().find(|a| a.name.eq_ignore_ascii_case(&name))?;
    let project = dir.parent()?;
    let ok = if !a.inside.is_empty() {
        has_any(dir, a.inside)
    } else if let Some(ext) = a.beside_ext {
        fs::read_dir(project).map(|rd| rd.filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().to_lowercase().ends_with(ext))).unwrap_or(false)
    } else {
        has_any(project, a.beside)
    };
    ok.then_some(a.label)
}

/// Last activity of a project: newest file outside its build folders and .git.
fn project_activity(dir: &Path, depth: u32) -> i64 {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    let mut newest = 0;
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        let Ok(md) = fs::symlink_metadata(&p) else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        if is_reparse(&md) || name == ".git" || ARTIFACTS.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        newest = newest.max(if md.is_dir() { if depth > 0 { project_activity(&p, depth - 1) } else { 0 } } else { mtime(&md) });
    }
    newest
}

fn find_artifacts(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, &'static str)>, cancel: &AtomicBool) {
    if cancel.load(Ordering::Relaxed) {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        let Ok(md) = fs::symlink_metadata(&p) else { continue };
        if !md.is_dir() || is_reparse(&md) {
            continue;
        }
        if let Some(l) = artifact_label(&p) {
            out.push((p, l));
            continue;
        }
        let name = e.file_name().to_string_lossy().to_lowercase();
        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        if depth > 0 {
            find_artifacts(&p, depth - 1, out, cancel);
        }
    }
}

pub fn scan_projects(roots: &[PathBuf], cx: &Ctx) -> Vec<Item> {
    let mut found = vec![];
    let mut seen: Vec<PathBuf> = vec![];
    for r in roots {
        let ok = fs::symlink_metadata(r).map(|m| m.is_dir() && !is_reparse(&m)).unwrap_or(false);
        if !ok || seen.iter().any(|s| same_path(s, r) || is_under(r, s)) {
            continue;
        }
        seen.push(r.clone());
        find_artifacts(r, 8, &mut found, cx.cancel);
    }
    let idle_days = cx.settings.project_idle_days as i64;
    let mut items: Vec<Item> = found
        .into_par_iter()
        .filter_map(|(p, label)| {
            let s = tree_stat(&p, cx.cancel);
            if s.size == 0 {
                return None;
            }
            let act = project_activity(p.parent()?, 3);
            let idle = (act > 0).then(|| (cx.now - act) / DAY);
            Some(Item { default: idle.is_some_and(|d| d >= idle_days), path: p, size: s.size, newest: s.newest, is_dir: true, label: Some(label.into()), idle_days: idle })
        })
        .collect();
    items.sort_by(|a, b| b.size.cmp(&a.size));
    items
}

fn large_files(dir: &Path, skip: &[PathBuf], min: u64, depth: u32, cancel: &AtomicBool) -> Vec<Item> {
    if cancel.load(Ordering::Relaxed) || skip.iter().any(|s| same_path(s, dir)) {
        return vec![];
    }
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let ents: Vec<(PathBuf, fs::Metadata)> = rd.filter_map(|e| e.ok()).filter_map(|e| { let p = e.path(); fs::symlink_metadata(&p).ok().map(|m| (p, m)) }).collect();
    ents.into_par_iter()
        .flat_map(|(p, md)| {
            if is_reparse(&md) {
                return vec![];
            }
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if md.is_dir() {
                // tool caches (.gradle, .cargo…) and build folders are other rules' business
                if depth == 0 || name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) || artifact_label(&p).is_some() {
                    return vec![];
                }
                large_files(&p, skip, min, depth - 1, cancel)
            } else if md.len() >= min {
                let t = mtime(&md);
                vec![Item { newest: t, size: md.len(), path: p, is_dir: false, label: None, idle_days: Some((now_ms() - t) / DAY), default: false }]
            } else {
                vec![]
            }
        })
        .collect()
}

// ---------- whole scan ----------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleSummary {
    pub id: String,
    pub cat: String,
    pub title: String,
    pub hint: String,
    pub kind: Kind,
    pub per_item: bool,
    pub to_recycle: bool,
    pub needs_admin: bool,
    pub default: bool,
    pub size: u64,
    pub count: usize,
    pub size_known: bool,
    pub blocked_by: Vec<String>,
    /// all items for per-item rules, the 5 biggest otherwise
    pub items: Vec<Item>,
}

pub fn summarize(s: &RuleScan, running: &[String]) -> RuleSummary {
    let r = &s.rule;
    let mut items = s.items.clone();
    if !r.per_item() {
        items.sort_by(|a, b| b.size.cmp(&a.size));
        items.truncate(5);
    }
    RuleSummary {
        id: r.id.clone(),
        cat: r.cat.clone(),
        title: r.title.clone(),
        hint: r.hint.clone(),
        kind: r.kind,
        per_item: r.per_item(),
        to_recycle: r.to_recycle(),
        needs_admin: r.kind == Kind::Elevated,
        default: r.default,
        size: s.items.iter().map(|i| i.size).sum(),
        count: if r.kind == Kind::RecycleBin { s.items.first().and_then(|i| i.label.as_ref()?.parse().ok()).unwrap_or(0) } else { s.items.len() },
        size_known: s.size_known,
        blocked_by: r.apps.iter().filter(|a| running.contains(&a.to_lowercase())).map(|a| a.trim_end_matches(".exe").to_string()).collect(),
        items,
    }
}

pub fn scan_all(set: &RuleSet, settings: &Settings, cancel: &AtomicBool, progress: &(dyn Fn(usize, usize, &str) + Sync)) -> Vec<RuleScan> {
    let cx = Ctx { settings, global_exclude: Mask::from_list(&set.global_exclude), now: now_ms(), cancel };
    let done = AtomicUsize::new(0);
    let total = set.rules.len();
    set.rules
        .par_iter()
        .map(|r| {
            let s = scan_rule(r, &cx);
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total, &r.title);
            s
        })
        .collect()
}
