//! Cleaning a selection taken from the last scan. Nothing is deleted on the
//! scan's word alone: each item is re-checked against its rule right before.

use crate::fsutil::*;
use crate::rules::{Kind, Task};
use crate::scan::{RuleScan, artifact_label, task_roots};
use crate::store::{HistoryEntry, Settings};
use crate::win;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub rule: String,
    /// every item except `except`
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub except: Vec<usize>,
    /// only these items (used when `all` is false)
    #[serde(default)]
    pub only: Vec<usize>,
}

#[derive(Serialize, Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskReport {
    pub task: String,
    pub ok: bool,
    pub error: Option<String>,
    pub stats: DelStats,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub freed: u64,
    pub deleted: u64,
    pub skipped: u64,
    pub recycled: u64,
    pub disk_gain: i64,
    pub by_rule: BTreeMap<String, DelStats>,
    pub tasks: Vec<TaskReport>,
    pub elevation: Option<String>, // "refused" | error text
}

fn chosen<'a>(s: &'a RuleScan, p: &Pick) -> Vec<&'a crate::scan::Item> {
    s.items
        .iter()
        .enumerate()
        .filter(|(i, _)| if p.all { !p.except.contains(i) } else { p.only.contains(i) })
        .map(|(_, it)| it)
        .collect()
}

/// Is this item still exactly what its rule allowed at scan time?
fn still_valid(s: &RuleScan, path: &Path, settings: &Settings, cancel: &AtomicBool) -> bool {
    if !s.roots.iter().any(|r| is_under(path, r)) || settings.is_ignored(path) {
        return false;
    }
    let Ok(md) = fs::symlink_metadata(path) else { return false };
    if is_reparse(&md) {
        return false;
    }
    match s.rule.kind {
        Kind::Files | Kind::Elevated => md.is_file() && (s.cutoff == 0 || item_time(&md) <= s.cutoff),
        // a folder that became active again since the scan (a live session) is left alone
        Kind::Children => s.cutoff == 0 || tree_stat(path, cancel).newest <= s.cutoff,
        Kind::Projects => artifact_label(path).is_some(),
        Kind::LargeFiles | Kind::OldDownloads => true,
        Kind::RecycleBin => false,
    }
}

fn total_free() -> u64 {
    win::fixed_drives().iter().map(|d| d.free).sum()
}

pub fn clean(
    scans: &[RuleScan],
    picks: &[Pick],
    settings: &Settings,
    data_dir: Option<&Path>,
    cancel: &AtomicBool,
    progress: &dyn Fn(usize, usize, &str, u64), // (done, total, label, bytes freed so far)
) -> CleanReport {
    let before = total_free();
    let mut rep = CleanReport::default();
    let mut tasks: Vec<Task> = vec![];
    let total = picks.len();
    for (n, p) in picks.iter().enumerate() {
        let Some(s) = scans.iter().find(|s| s.rule.id == p.rule) else { continue };
        progress(n, total, &s.rule.title, rep.freed);
        let mut st = DelStats::default();
        match s.rule.kind {
            Kind::Elevated => {
                if let Some(t) = s.rule.task {
                    tasks.push(t);
                }
                continue;
            }
            Kind::RecycleBin => {
                let (b, _) = win::recycle_bin_info();
                win::empty_recycle_bin();
                let (a, _) = win::recycle_bin_info();
                st.freed = b.saturating_sub(a);
                st.deleted = (a < b) as u64;
                st.skipped = (a > 0) as u64;
            }
            _ => {
                let items = chosen(s, p);
                let mut to_bin: Vec<(PathBuf, u64)> = vec![];
                for it in items {
                    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                        break;
                    }
                    if !still_valid(s, &it.path, settings, cancel) {
                        st.skipped += 1;
                        continue;
                    }
                    if s.rule.to_recycle() {
                        to_bin.push((it.path.clone(), it.size));
                    } else {
                        st.add(delete_tree(&it.path, cancel));
                    }
                }
                if !to_bin.is_empty() {
                    let paths: Vec<PathBuf> = to_bin.iter().map(|(p, _)| p.clone()).collect();
                    let gone = win::recycle(&paths);
                    for (p, size) in &to_bin {
                        if gone.contains(p) {
                            st.freed += size;
                            st.deleted += 1;
                        } else {
                            st.skipped += 1;
                        }
                    }
                    rep.recycled += gone.len() as u64;
                }
                if s.rule.kind == Kind::Files {
                    let excl: Vec<PathBuf> = s.rule.exclude_dirs.iter().filter_map(|d| expand_env(d)).collect();
                    for r in &s.roots {
                        prune_empty_dirs(r, &excl, s.cutoff);
                    }
                }
            }
        }
        rep.freed += st.freed;
        rep.deleted += st.deleted;
        rep.skipped += st.skipped;
        rep.by_rule.insert(s.rule.id.clone(), st);
    }
    if !tasks.is_empty() {
        progress(total, total, "Nettoyage système (admin)", rep.freed);
        run_elevated(&tasks, data_dir, &mut rep);
    }
    rep.disk_gain = total_free() as i64 - before as i64;
    rep
}

fn run_elevated(tasks: &[Task], data_dir: Option<&Path>, rep: &mut CleanReport) {
    let dir = data_dir.map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir);
    let _ = fs::create_dir_all(&dir);
    let out = dir.join(format!("elevated-{}.json", now_ms()));
    let names: Vec<&str> = tasks.iter().map(|t| t.name()).collect();
    // only fixed task names and our own data path reach the elevated command line
    let args = format!("--elevated {} --out \"{}\"", names.join(","), out.display());
    match win::run_self_elevated(&args) {
        win::ElevatedRun::Refused => rep.elevation = Some("refused".into()),
        win::ElevatedRun::Failed(e) => rep.elevation = Some(e),
        win::ElevatedRun::Done(code) if code != 0 => rep.elevation = Some(format!("le processus admin s'est arrêté avec le code {code}")),
        win::ElevatedRun::Done(_) => match fs::read_to_string(&out).ok().and_then(|t| serde_json::from_str::<Vec<TaskReport>>(&t).ok()) {
            Some(list) => {
                for t in &list {
                    rep.freed += t.stats.freed;
                    rep.deleted += t.stats.deleted;
                    rep.skipped += t.stats.skipped;
                }
                rep.tasks = list;
            }
            None => rep.elevation = Some("le processus admin n'a pas rendu de rapport".into()),
        },
    }
    let _ = fs::remove_file(&out);
}

/// Body of the elevated process (`--elevated a,b --out file`).
pub fn elevated_main(task_list: &str, out: &Path) -> i32 {
    if out.extension().and_then(|e| e.to_str()) != Some("json") || !out.parent().is_some_and(|p| p.is_dir()) {
        return 2;
    }
    let cancel = AtomicBool::new(false);
    let mut reports = vec![];
    for name in task_list.split(',') {
        let Some(t) = Task::parse(name) else { continue }; // unknown names are ignored, never run
        let mut r = TaskReport { task: t.name().into(), ok: true, ..Default::default() };
        match t {
            Task::WindowsTemp | Task::SystemWer => {
                let (roots, days) = task_roots(t);
                let cutoff = if days > 0 { now_ms() - days as i64 * 86_400_000 } else { 0 };
                let o = WalkOpts { depth: 50, mask: None, exclude: None, global_exclude: None, exclude_dirs: &[], cutoff };
                for root in &roots {
                    for f in walk_files(root, 50, &o, &cancel) {
                        r.stats.add(delete_tree(&f.path, &cancel));
                    }
                    prune_empty_dirs(root, &[], cutoff);
                }
            }
            Task::DeliveryOptimization | Task::ComponentStore => {
                let before = total_free();
                let res = if t == Task::ComponentStore { win::run_dism_component_cleanup() } else { win::run_delivery_optimization_cleanup() };
                if let Err(e) = res {
                    r.ok = false;
                    r.error = Some(e);
                }
                r.stats.freed = total_free().saturating_sub(before);
            }
        }
        reports.push(r);
    }
    match serde_json::to_vec(&reports).map(|b| fs::write(out, b)) {
        Ok(Ok(())) => 0,
        _ => 3,
    }
}

pub fn history_entry(rep: &CleanReport, scans: &[RuleScan]) -> HistoryEntry {
    let mut by_cat = BTreeMap::new();
    for (id, st) in &rep.by_rule {
        if let Some(s) = scans.iter().find(|s| &s.rule.id == id) {
            *by_cat.entry(s.rule.cat.clone()).or_insert(0) += st.freed;
        }
    }
    for t in &rep.tasks {
        *by_cat.entry("admin".to_string()).or_insert(0) += t.stats.freed;
    }
    HistoryEntry { at: now_ms(), freed: rep.freed, disk_gain: rep.disk_gain, deleted: rep.deleted, skipped: rep.skipped, recycled: rep.recycled, by_cat }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Rule;
    use crate::scan::{Ctx, scan_rule};
    use std::process::Command;

    const DAY: i64 = 86_400_000;
    fn w(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }
    fn junction(link: &Path, target: &Path) {
        let ok = Command::new("cmd").args(["/c", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
        assert!(ok, "mklink /J failed");
    }
    fn rule(json: serde_json::Value) -> Rule {
        serde_json::from_value(json).unwrap()
    }
    fn future_ctx<'a>(settings: &'a Settings, cancel: &'a AtomicBool) -> Ctx<'a> {
        // scanning 30 days in the future: every file on disk counts as 30 days old
        Ctx { settings, global_exclude: None, now: now_ms() + 30 * DAY, cancel }
    }
    fn all(id: &str) -> Pick {
        Pick { rule: id.into(), all: true, except: vec![], only: vec![] }
    }
    fn names(s: &RuleScan) -> Vec<String> {
        let mut v: Vec<_> = s.items.iter().map(|i| i.path.file_name().unwrap().to_string_lossy().to_string()).collect();
        v.sort();
        v
    }

    #[test]
    fn files_rule_respects_age_masks_excludes_and_junctions() {
        let t = tempfile::tempdir().unwrap();
        let (root, outside) = (t.path().join("tmp"), t.path().join("outside"));
        w(&outside.join("keep.txt"), "precious");
        w(&root.join("old.log"), "old");
        w(&root.join("sub").join("old2.tmp"), "old");
        w(&root.join("skipme").join("x.bin"), "x");
        w(&root.join("ro.log"), "readonly");
        let mut perm = fs::metadata(root.join("ro.log")).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(root.join("ro.log"), perm).unwrap();
        junction(&root.join("link"), &outside);

        let r = rule(serde_json::json!({ "id": "t", "cat": "x", "title": "t", "kind": "files", "paths": [root.to_str().unwrap()],
            "depth": 10, "olderThanDays": 7, "exclude": "*.tmp", "excludeDirs": [root.join("skipme").to_str().unwrap()] }));
        let (settings, cancel) = (Settings::default(), AtomicBool::new(false));
        let s = scan_rule(&r, &future_ctx(&settings, &cancel));
        assert_eq!(names(&s), ["old.log", "ro.log"], "tmp excluded, skipme excluded, junction not followed");

        let rep = clean(&[s], &[all("t")], &settings, None, &cancel, &|_, _, _, _| {});
        assert_eq!(rep.deleted, 2, "read-only file deleted too");
        assert_eq!(rep.freed, 3 + 8, "freed = measured bytes actually unlinked");
        assert!(outside.join("keep.txt").exists(), "junction target survives");
        assert!(root.join("link").exists(), "the junction itself is not an item of a files rule");
    }

    #[test]
    fn children_rule_deletes_through_nested_junction_safely_and_rechecks_activity() {
        let t = tempfile::tempdir().unwrap();
        let (root, outside) = (t.path().join("sessions"), t.path().join("outside"));
        w(&outside.join("keep.txt"), "precious");
        w(&root.join("s1").join("big.bin"), "0123456789");
        w(&root.join("s2").join("live.txt"), "x");
        junction(&root.join("s1").join("link"), &outside);
        junction(&root.join("toplink"), &outside);

        let r = rule(serde_json::json!({ "id": "c", "cat": "x", "title": "c", "kind": "children", "paths": [root.to_str().unwrap()], "olderThanDays": 3 }));
        let (settings, cancel) = (Settings::default(), AtomicBool::new(false));
        let s = scan_rule(&r, &future_ctx(&settings, &cancel));
        assert_eq!(names(&s), ["s1", "s2"], "the top-level junction is never an item");

        // s2 becomes active after the scan: it must be left alone
        let f = fs::File::options().write(true).open(root.join("s2").join("live.txt")).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60 * 86_400)).unwrap();
        drop(f);

        let rep = clean(&[s], &[all("c")], &settings, None, &cancel, &|_, _, _, _| {});
        assert!(!root.join("s1").exists());
        assert!(root.join("s2").join("live.txt").exists(), "re-activated folder skipped");
        assert_eq!(rep.skipped, 1);
        assert!(outside.join("keep.txt").exists(), "deleting s1 removed its junction, not the target");
        assert!(root.join("toplink").exists());
    }

    #[test]
    fn overlapping_children_keep_parent_only() {
        let t = tempfile::tempdir().unwrap();
        let caches = t.path().join("g").join("caches");
        w(&caches.join("mod").join("files").join("a").join("x.jar"), "jar");
        let r = rule(serde_json::json!({ "id": "o", "cat": "x", "title": "o", "kind": "children",
            "paths": [caches.join("*").to_str().unwrap(), caches.join("mod").join("files").to_str().unwrap()], "olderThanDays": 3 }));
        let (settings, cancel) = (Settings::default(), AtomicBool::new(false));
        let s = scan_rule(&r, &future_ctx(&settings, &cancel));
        assert_eq!(s.items.len(), 1);
        assert!(same_path(&s.items[0].path, &caches.join("mod").join("files")));
    }

    #[test]
    fn refuses_out_of_root_and_newly_ignored_items() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("tmp");
        w(&root.join("a.log"), "a");
        w(&root.join("b.log"), "b");
        w(&t.path().join("victim.txt"), "v");
        let r = rule(serde_json::json!({ "id": "t", "cat": "x", "title": "t", "kind": "files", "paths": [root.to_str().unwrap()] }));
        let (settings, cancel) = (Settings::default(), AtomicBool::new(false));
        let mut s = scan_rule(&r, &future_ctx(&settings, &cancel));
        s.items.push(crate::scan::Item { path: t.path().join("victim.txt"), size: 1, newest: 0, is_dir: false, label: None, idle_days: None, default: true });
        // the user ignores b.log between the scan and the clean
        let later = Settings { ignore: vec![root.join("b.log").to_string_lossy().to_string()], ..Default::default() };
        let rep = clean(&[s], &[all("t")], &later, None, &cancel, &|_, _, _, _| {});
        assert_eq!(rep.deleted, 1);
        assert!(!root.join("a.log").exists());
        assert!(root.join("b.log").exists(), "ignored after the scan: kept");
        assert!(t.path().join("victim.txt").exists(), "outside the rule roots: kept");
    }

    #[test]
    fn pick_only_and_except_select_exact_items() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("tmp");
        w(&root.join("big.log"), "0123456789");
        w(&root.join("mid.log"), "01234");
        w(&root.join("small.log"), "0");
        let r = rule(serde_json::json!({ "id": "t", "cat": "x", "title": "t", "kind": "files", "paths": [root.to_str().unwrap()] }));
        let (settings, cancel) = (Settings::default(), AtomicBool::new(false));
        let s = scan_rule(&r, &future_ctx(&settings, &cancel));
        assert_eq!(s.items[0].size, 10, "items sorted biggest first: indices are stable");
        let rep = clean(&[s.clone()], &[Pick { rule: "t".into(), all: true, except: vec![0], only: vec![] }], &settings, None, &cancel, &|_, _, _, _| {});
        assert_eq!(rep.deleted, 2);
        assert!(root.join("big.log").exists());
        let s2 = scan_rule(&r, &future_ctx(&settings, &cancel));
        clean(&[s2], &[Pick { rule: "t".into(), all: false, except: vec![], only: vec![] }], &settings, None, &cancel, &|_, _, _, _| {});
        assert!(root.join("big.log").exists(), "only:[] with all:false deletes nothing");
    }

    #[test]
    fn project_markers_and_idle_days() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path();
        w(&p.join("web").join("package.json"), "{}");
        w(&p.join("web").join("node_modules").join("lib").join("i.js"), "js");
        w(&p.join("docs").join("target").join("notes.md"), "not rust");
        w(&p.join("rs").join("Cargo.toml"), "");
        w(&p.join("rs").join("target").join("debug").join("a.exe"), "bin");
        w(&p.join("py").join(".venv").join("pyvenv.cfg"), "home=x");
        w(&p.join("py2").join(".venv").join("random.txt"), "x");
        w(&p.join("cs").join("app.csproj"), "<Project/>");
        w(&p.join("cs").join("obj").join("x.cache"), "c");
        let settings = Settings { project_roots: vec![p.to_string_lossy().to_string()], ..Default::default() };
        let cancel = AtomicBool::new(false);
        let r = rule(serde_json::json!({ "id": "projects", "cat": "projects", "title": "p", "kind": "projects", "default": true }));
        let s = scan_rule(&r, &future_ctx(&settings, &cancel));
        let mut got: Vec<_> = s.items.iter().map(|i| i.path.strip_prefix(p).unwrap().to_string_lossy().replace('\\', "/")).collect();
        got.sort();
        assert_eq!(got, ["cs/obj", "py/.venv", "rs/target", "web/node_modules"]);
        let find = |n: &str| s.items.iter().find(|i| i.path.parent().unwrap().ends_with(n)).unwrap().clone();
        assert!(find("web").idle_days.unwrap() >= 29 && find("rs").idle_days.unwrap() >= 29);
        assert_eq!(find("py").idle_days, None, "no own files: activity unknown");
        assert!(!find("py").default, "unknown activity is never pre-ticked");

        // marker removed after the scan: no longer a build folder, keep it
        fs::remove_file(p.join("rs").join("Cargo.toml")).unwrap();
        let rep = clean(&[s], &[all("projects")], &settings, None, &cancel, &|_, _, _, _| {});
        assert!(p.join("rs").join("target").exists());
        assert!(!p.join("web").join("node_modules").exists());
        assert_eq!(rep.skipped, 1);
    }
}
