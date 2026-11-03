//! Settings and history, stored as JSON in the app data folder given by Electron.

use crate::fsutil::{HOME, expand_env, is_clean_abs, is_under, same_path};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub project_roots: Vec<String>,
    pub project_idle_days: u32,
    pub large_file_min_mb: u64,
    pub downloads_older_than_days: u32,
    /// Absolute paths never listed nor touched (and everything under them).
    pub ignore: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            project_roots: ["Desktop", "Documents", "PycharmProjects", "PyCharmMiscProject", "source", "Projects", "dev", "code", "repos"]
                .iter()
                .map(|d| format!("{HOME}/{d}"))
                .collect(),
            project_idle_days: 14,
            large_file_min_mb: 500,
            downloads_older_than_days: 90,
            ignore: vec![],
        }
    }
}

impl Settings {
    pub fn is_ignored(&self, p: &Path) -> bool {
        self.ignore.iter().filter_map(|i| expand_env(i)).any(|i| same_path(&i, p) || is_under(p, &i))
    }
    /// Keep only absolute, `..`-free paths; clamp numbers to sane ranges.
    pub fn sanitized(mut self) -> Settings {
        let ok = |s: &String| expand_env(s).is_some_and(|p| is_clean_abs(&p));
        self.project_roots.retain(ok);
        self.ignore.retain(ok);
        self.ignore.sort();
        self.ignore.dedup();
        self.project_idle_days = self.project_idle_days.clamp(1, 3650);
        self.large_file_min_mb = self.large_file_min_mb.clamp(50, 1_000_000);
        self.downloads_older_than_days = self.downloads_older_than_days.clamp(7, 3650);
        self
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: i64,
    pub freed: u64,
    pub disk_gain: i64,
    pub deleted: u64,
    pub skipped: u64,
    pub recycled: u64,
    pub by_cat: std::collections::BTreeMap<String, u64>,
}

pub struct Store {
    pub dir: Option<PathBuf>,
}

impl Store {
    fn read<T: for<'de> Deserialize<'de> + Default>(&self, name: &str) -> T {
        self.dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join(name)).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }
    /// Write through a temp file and rename, so a crash never leaves half a file.
    fn write<T: Serialize>(&self, name: &str, v: &T) -> Result<(), String> {
        let Some(d) = &self.dir else { return Ok(()) };
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        let tmp = d.join(format!("{name}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, d.join(name)).map_err(|e| e.to_string())
    }
    pub fn settings(&self) -> Settings {
        self.read::<Settings>("settings.json").sanitized()
    }
    pub fn save_settings(&self, s: &Settings) -> Result<(), String> {
        self.write("settings.json", s)
    }
    pub fn history(&self) -> Vec<HistoryEntry> {
        self.read("history.json")
    }
    pub fn push_history(&self, e: HistoryEntry) -> Result<(), String> {
        let mut h = self.history();
        h.push(e);
        let skip = h.len().saturating_sub(500);
        self.write("history.json", &h[skip..].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn ignore_and_sanitize_on_unix_paths() {
        let s = Settings { ignore: vec!["/keep/this".into(), "rel/path".into(), "/a/../b".into()], ..Default::default() }.sanitized();
        assert_eq!(s.ignore, vec!["/keep/this".to_string()]);
        assert!(s.is_ignored(Path::new("/keep/this/file.txt")) && !s.is_ignored(Path::new("/keep/thisother")));
    }
    #[cfg(windows)]
    #[test]
    fn ignore_matches_path_and_children_only() {
        let s = Settings { ignore: vec![r"C:\keep\this".into()], ..Default::default() };
        assert!(s.is_ignored(Path::new(r"C:\keep\this")));
        assert!(s.is_ignored(Path::new(r"C:\KEEP\this\file.txt")));
        assert!(!s.is_ignored(Path::new(r"C:\keep\thisother")));
    }
    #[cfg(windows)]
    #[test]
    fn sanitize_drops_relative_and_dotdot() {
        let s = Settings { ignore: vec!["rel\\path".into(), r"C:\a\..\b".into(), r"C:\ok".into()], ..Default::default() }.sanitized();
        assert_eq!(s.ignore, vec![r"C:\ok".to_string()]);
    }
    #[test]
    fn roundtrip_on_disk() {
        let d = tempfile::tempdir().unwrap();
        let st = Store { dir: Some(d.path().to_path_buf()) };
        let mut s = st.settings();
        s.project_idle_days = 30;
        st.save_settings(&s).unwrap();
        assert_eq!(st.settings().project_idle_days, 30);
    }
}
