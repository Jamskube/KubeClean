//! Rule model. Shape observed in AVG TuneUp's embedded rule database (paths with
//! wildcards, mask, exclude mask, depth, olderThan), rules written from scratch.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[cfg(windows)]
pub const DEFAULT_RULES: &str = include_str!("../rules/default.json");
#[cfg(target_os = "macos")]
pub const DEFAULT_RULES: &str = include_str!("../rules/macos.json");

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Files,
    Children,
    RecycleBin,
    Projects,
    LargeFiles,
    OldDownloads,
    Elevated,
}

/// The only operations ever run elevated. Fixed in code: nothing from a file or
/// the UI reaches the elevated command line except these names.
#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    WindowsTemp,
    SystemWer,
    DeliveryOptimization,
    ComponentStore,
}
impl Task {
    pub fn name(self) -> &'static str {
        match self {
            Task::WindowsTemp => "windowsTemp",
            Task::SystemWer => "systemWer",
            Task::DeliveryOptimization => "deliveryOptimization",
            Task::ComponentStore => "componentStore",
        }
    }
    #[cfg_attr(not(windows), allow(dead_code))] // only the Windows elevated helper reads task names
    pub fn parse(s: &str) -> Option<Task> {
        [Task::WindowsTemp, Task::SystemWer, Task::DeliveryOptimization, Task::ComponentStore].into_iter().find(|t| t.name() == s)
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub cat: String,
    pub title: String,
    #[serde(default)]
    pub hint: String,
    pub kind: Kind,
    #[serde(default)]
    pub paths: Vec<String>,
    pub mask: Option<String>,
    pub exclude: Option<String>,
    #[serde(default)]
    pub exclude_dirs: Vec<String>,
    pub depth: Option<u32>,
    pub older_than_days: Option<u32>,
    #[serde(default)]
    pub default: bool,
    /// Process names that keep these files open (cleaning while they run skips files).
    #[serde(default)]
    pub apps: Vec<String>,
    pub task: Option<Task>,
    /// Children rule: keep only versioned folders with a newer sibling of the same product.
    #[serde(default)]
    pub superseded_only: bool,
    #[serde(default)]
    pub disabled: bool,
}

impl Rule {
    /// Item rules are reviewed one item at a time in the UI.
    pub fn per_item(&self) -> bool {
        matches!(self.kind, Kind::Projects | Kind::LargeFiles | Kind::OldDownloads)
    }
    /// User content goes to the Recycle Bin, never straight to deletion.
    pub fn to_recycle(&self) -> bool {
        matches!(self.kind, Kind::LargeFiles | Kind::OldDownloads)
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleSet {
    #[serde(default)]
    pub global_exclude: Vec<String>,
    pub rules: Vec<Rule>,
}

impl RuleSet {
    /// Built-in rules, then `rules.user.json` from the data folder: a user rule with
    /// an existing id replaces it (or disables it with `"disabled": true`).
    pub fn load(data_dir: Option<&Path>) -> Result<RuleSet, String> {
        let mut set: RuleSet = serde_json::from_str(DEFAULT_RULES).map_err(|e| format!("règles intégrées : {e}"))?;
        if let Some(d) = data_dir {
            let f = d.join("rules.user.json");
            if f.exists() {
                let txt = std::fs::read_to_string(&f).map_err(|e| format!("rules.user.json : {e}"))?;
                let user: RuleSet = serde_json::from_str(&txt).map_err(|e| format!("rules.user.json : {e}"))?;
                for r in user.rules {
                    if r.kind == Kind::Elevated {
                        return Err(format!("rules.user.json : la règle {} ne peut pas être une tâche admin", r.id));
                    }
                    match set.rules.iter_mut().find(|x| x.id == r.id) {
                        Some(x) => *x = r,
                        None => set.rules.push(r),
                    }
                }
                set.global_exclude.extend(user.global_exclude);
            }
        }
        set.rules.retain(|r| !r.disabled);
        set.validate()?;
        Ok(set)
    }

    pub fn validate(&self) -> Result<(), String> {
        let mut seen = HashSet::new();
        for r in &self.rules {
            if !seen.insert(r.id.as_str()) {
                return Err(format!("identifiant de règle en double : {}", r.id));
            }
            if r.id.contains('#') || r.id.is_empty() {
                return Err(format!("identifiant de règle invalide : {:?}", r.id));
            }
            if (r.kind == Kind::Elevated) != r.task.is_some() {
                return Err(format!("{} : une tâche admin et seulement elle a un champ task", r.id));
            }
            if matches!(r.kind, Kind::Files | Kind::Children) && r.paths.is_empty() {
                return Err(format!("{} : aucun chemin", r.id));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builtin_rules_are_valid() {
        let s = RuleSet::load(None).expect("default rules parse and validate");
        #[cfg(windows)]
        {
            assert!(s.rules.len() > 30);
            assert!(s.rules.iter().any(|r| r.kind == Kind::Elevated && r.task == Some(Task::ComponentStore)));
        }
        // macOS : ni tâche admin, ni Corbeille, ni projets ; chaque chemin part du dossier personnel
        #[cfg(target_os = "macos")]
        {
            assert!(s.rules.len() >= 10);
            assert!(!s.rules.iter().any(|r| matches!(r.kind, Kind::Elevated | Kind::RecycleBin | Kind::Projects)));
            assert!(s.rules.iter().flat_map(|r| r.paths.iter().chain(&r.exclude_dirs)).all(|p| p.starts_with("%HOME%/Library/")));
        }
    }
    #[test]
    fn duplicate_ids_rejected() {
        let mut s = RuleSet::load(None).unwrap();
        let dup = s.rules[0].clone();
        s.rules.push(dup);
        assert!(s.validate().is_err());
    }
    #[test]
    fn task_names_roundtrip() {
        for t in [Task::WindowsTemp, Task::SystemWer, Task::DeliveryOptimization, Task::ComponentStore] {
            assert_eq!(Task::parse(t.name()), Some(t));
        }
        assert_eq!(Task::parse("rm -rf"), None);
    }
}
