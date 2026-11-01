//! Filesystem primitives. Every walker here refuses to follow reparse points
//! (junctions, symlinks, OneDrive placeholders, dedup stubs).

use rayon::prelude::*;
use std::fs::{self, Metadata};
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
pub const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
pub const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

pub fn now_ms() -> i64 {
    ms(SystemTime::now())
}
fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn is_reparse(md: &Metadata) -> bool {
    md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// Newest of write, creation and change time. A file just extracted from an old
/// archive keeps an old mtime but gets a fresh creation time: it is not "old".
pub fn item_time(md: &Metadata) -> i64 {
    let w = md.modified().map(ms).unwrap_or(0);
    let c = md.created().map(ms).unwrap_or(0);
    w.max(c)
}

/// Last write only: what "the user worked on it" means for a project folder.
pub fn mtime(md: &Metadata) -> i64 {
    md.modified().map(ms).unwrap_or(0)
}

/// `%VAR%` expansion; returns None when a variable is unknown (rule does not apply).
pub fn expand_env(p: &str) -> Option<PathBuf> {
    let mut out = String::new();
    let mut rest = p;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        let val = std::env::var(&after[..end]).ok()?;
        out.push_str(&val);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(PathBuf::from(out.replace('/', "\\")))
}

fn key(p: &Path) -> String {
    let s = p.to_string_lossy().to_lowercase().replace('/', "\\");
    s.trim_end_matches('\\').to_string()
}

/// Strictly inside `parent` (never equal), case-insensitive, component-aware.
pub fn is_under(child: &Path, parent: &Path) -> bool {
    let (c, p) = (key(child), key(parent));
    c.len() > p.len() + 1 && c.starts_with(&p) && c.as_bytes()[p.len()] == b'\\'
}
pub fn same_path(a: &Path, b: &Path) -> bool {
    key(a) == key(b)
}
/// No `..` and absolute: rule and settings paths must not climb out of their roots.
pub fn is_clean_abs(p: &Path) -> bool {
    p.is_absolute() && !p.components().any(|c| matches!(c, Component::ParentDir))
}

/// Case-insensitive `*` / `?` wildcard match on a single name.
pub fn wildcard(pat: &str, name: &str) -> bool {
    let p: Vec<char> = pat.to_lowercase().chars().collect();
    let n: Vec<char> = name.to_lowercase().chars().collect();
    let (mut pi, mut ni, mut star, mut mark) = (0usize, 0usize, None::<usize>, 0usize);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[derive(Clone, Default)]
pub struct Mask(Vec<String>);
impl Mask {
    pub fn parse(s: Option<&str>) -> Option<Mask> {
        let v: Vec<String> = s?.split(';').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
        if v.is_empty() { None } else { Some(Mask(v)) }
    }
    pub fn from_list(v: &[String]) -> Option<Mask> {
        if v.is_empty() { None } else { Some(Mask(v.to_vec())) }
    }
    pub fn hit(&self, name: &str) -> bool {
        self.0.iter().any(|p| wildcard(p, name))
    }
}

fn read_dir_sorted(dir: &Path) -> Vec<(PathBuf, Metadata)> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    rd.filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            fs::symlink_metadata(&p).ok().map(|m| (p, m))
        })
        .collect()
}

/// Expand a rule path with wildcard segments (`User Data/*/Cache`) into the
/// existing, non-reparse directories it designates.
pub fn resolve_paths(pattern: &str) -> Vec<PathBuf> {
    let Some(full) = expand_env(pattern) else { return vec![] };
    if !is_clean_abs(&full) {
        return vec![];
    }
    let s = full.to_string_lossy().to_string();
    let mut parts = s.split('\\').filter(|x| !x.is_empty());
    let Some(first) = parts.next() else { return vec![] };
    let mut bases = vec![PathBuf::from(format!("{first}\\"))];
    for seg in parts {
        let mut next = vec![];
        for b in &bases {
            if seg.contains('*') || seg.contains('?') {
                for (p, md) in read_dir_sorted(b) {
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    if md.is_dir() && !is_reparse(&md) && wildcard(seg, &name) {
                        next.push(p);
                    }
                }
            } else {
                // a literal segment must not be a junction either
                let p = b.join(seg);
                if let Ok(md) = fs::symlink_metadata(&p) {
                    if md.is_dir() && !is_reparse(&md) {
                        next.push(p);
                    }
                }
            }
        }
        bases = next;
    }
    bases
}

#[derive(Clone, Copy, Default, Debug)]
pub struct TreeStat {
    pub size: u64,
    pub newest: i64,
    pub files: u64,
}

pub fn tree_stat(p: &Path, cancel: &AtomicBool) -> TreeStat {
    let Ok(md) = fs::symlink_metadata(p) else { return TreeStat::default() };
    if is_reparse(&md) {
        return TreeStat::default();
    }
    if !md.is_dir() {
        return TreeStat { size: md.len(), newest: item_time(&md), files: 1 };
    }
    if cancel.load(Ordering::Relaxed) {
        return TreeStat::default();
    }
    let own = item_time(&md);
    read_dir_sorted(p)
        .into_par_iter()
        .map(|(c, _)| tree_stat(&c, cancel))
        .reduce(
            || TreeStat { size: 0, newest: own, files: 0 },
            |a, b| TreeStat { size: a.size + b.size, newest: a.newest.max(b.newest), files: a.files + b.files },
        )
}

pub struct WalkOpts<'a> {
    pub depth: u32,
    pub mask: Option<&'a Mask>,
    pub exclude: Option<&'a Mask>,
    pub global_exclude: Option<&'a Mask>,
    pub exclude_dirs: &'a [PathBuf],
    pub cutoff: i64, // 0 = no age filter
}

#[derive(Clone, Debug)]
pub struct FoundFile {
    pub path: PathBuf,
    pub size: u64,
    pub time: i64,
}

pub fn walk_files(dir: &Path, depth: u32, o: &WalkOpts, cancel: &AtomicBool) -> Vec<FoundFile> {
    if cancel.load(Ordering::Relaxed) {
        return vec![];
    }
    let entries = read_dir_sorted(dir);
    let (dirs, files): (Vec<_>, Vec<_>) = entries.into_iter().filter(|(_, m)| !is_reparse(m)).partition(|(_, m)| m.is_dir());
    let mut out: Vec<FoundFile> = files
        .into_iter()
        .filter_map(|(p, md)| {
            let name = p.file_name()?.to_string_lossy().to_string();
            if o.mask.is_some_and(|m| !m.hit(&name)) { return None; }
            if o.exclude.is_some_and(|m| m.hit(&name)) || o.global_exclude.is_some_and(|m| m.hit(&name)) { return None; }
            let t = item_time(&md);
            if o.cutoff != 0 && t > o.cutoff { return None; }
            Some(FoundFile { path: p, size: md.len(), time: t })
        })
        .collect();
    if depth > 0 {
        let sub: Vec<FoundFile> = dirs
            .into_par_iter()
            .filter(|(p, _)| !o.exclude_dirs.iter().any(|x| same_path(x, p)))
            .flat_map(|(p, _)| walk_files(&p, depth - 1, o, cancel))
            .collect();
        out.extend(sub);
    }
    out
}

#[derive(Default, Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct DelStats {
    pub freed: u64,
    pub deleted: u64,
    pub skipped: u64,
}
impl DelStats {
    pub fn add(&mut self, o: DelStats) {
        self.freed += o.freed;
        self.deleted += o.deleted;
        self.skipped += o.skipped;
    }
}

fn remove_file_force(p: &Path, md: &Metadata) -> std::io::Result<()> {
    match fs::remove_file(p) {
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied && md.file_attributes() & FILE_ATTRIBUTE_READONLY != 0 => {
            let mut perm = md.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perm.set_readonly(false);
            fs::set_permissions(p, perm)?;
            fs::remove_file(p)
        }
        r => r,
    }
}

/// Delete one file, or a directory tree bottom-up. Links met inside are removed as
/// links (their target is never entered); other reparse points (cloud placeholders)
/// are left alone. Locked files are skipped and counted; the rest still goes.
pub fn delete_tree(p: &Path, cancel: &AtomicBool) -> DelStats {
    let mut st = DelStats::default();
    let Ok(md) = fs::symlink_metadata(p) else { return st };
    if is_reparse(&md) {
        if fs::read_link(p).is_ok() {
            let r = if md.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0 { fs::remove_dir(p) } else { fs::remove_file(p) };
            if r.is_ok() { st.deleted += 1 } else { st.skipped += 1 }
        } else {
            st.skipped += 1;
        }
        return st;
    }
    if !md.is_dir() {
        match remove_file_force(p, &md) {
            Ok(()) => { st.freed += md.len(); st.deleted += 1; }
            Err(_) => st.skipped += 1,
        }
        return st;
    }
    for (c, _) in read_dir_sorted(p) {
        if cancel.load(Ordering::Relaxed) {
            st.skipped += 1;
            return st;
        }
        st.add(delete_tree(&c, cancel));
    }
    let _ = fs::remove_dir(p); // fails if something stayed (locked file): fine, counted above
    st
}

/// Remove empty directories under `root` (never `root` itself), bottom-up.
pub fn prune_empty_dirs(dir: &Path, exclude_dirs: &[PathBuf], cutoff: i64) {
    for (p, md) in read_dir_sorted(dir) {
        if !md.is_dir() || is_reparse(&md) || exclude_dirs.iter().any(|x| same_path(x, &p)) {
            continue;
        }
        prune_empty_dirs(&p, exclude_dirs, cutoff);
        if cutoff == 0 || fs::symlink_metadata(&p).map(|m| item_time(&m) <= cutoff).unwrap_or(false) {
            let _ = fs::remove_dir(&p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wildcard_and_under() {
        assert!(wildcard("*.dmp", "A.DMP") && wildcard("thumbcache_*.db", "thumbcache_32.db"));
        assert!(!wildcard("*.dmp", "a.dmpx") && wildcard("a?c", "abc") && wildcard("*", ""));
        assert!(is_under(Path::new(r"C:\a\b\c"), Path::new(r"C:\a\b")));
        assert!(!is_under(Path::new(r"C:\a\bc"), Path::new(r"C:\a\b")));
        assert!(!is_under(Path::new(r"C:\a\b"), Path::new(r"C:\A\B\")));
        assert!(!is_clean_abs(Path::new(r"C:\a\..\Windows")) && !is_clean_abs(Path::new(r"a\b")));
    }
}
