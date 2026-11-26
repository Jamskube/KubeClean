//! « Ça grossit vite » : taille de chaque dossier d'application et du système (ProgramData,
//! AppData ; Bibliothèque sur Mac), gardée d'une mesure à l'autre et comparée à celle de la veille.
//! Lecture seule. Ne sert qu'à prévenir : rien n'est proposé à la suppression d'ici.

use crate::fsutil::{expand_env, is_reparse, now_ms, read_dir_md, tree_stat_md};
use crate::store::Store;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Snapshot {
    pub at: i64,
    pub sizes: BTreeMap<String, u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Grower {
    pub path: String,
    /// « ProgramData › McAfee »
    pub name: String,
    pub before: u64,
    pub after: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub growers: Vec<Grower>,
    pub measured_at: i64,
    /// mesure de référence ; None tant qu'aucune n'a au moins 20 h
    pub since: Option<i64>,
}

const FILE: &str = "growth.json";
const HOUR: i64 = 3_600_000;
/// on remesure au plus toutes les 6 h : la comparaison porte sur des jours, pas des minutes
const MIN_GAP: i64 = 6 * HOUR;
const BASE_AGE: i64 = 20 * HOUR;
const KEEP: usize = 12;
const GB: u64 = 1 << 30;
const MB: u64 = 1 << 20;

fn roots() -> Vec<PathBuf> {
    // Mac : ni Containers ni Group Containers, que macOS protège derrière une demande d'accès
    let list: &[&str] = if cfg!(windows) {
        &["%ProgramData%", "%LOCALAPPDATA%", "%APPDATA%"]
    } else {
        &["%HOME%/Library/Application Support", "%HOME%/Library/Caches", "%HOME%/Library/Logs", "/Library/Logs", "/Library/Application Support"]
    };
    list.iter().filter_map(|r| expand_env(r)).collect()
}

fn label(p: &Path) -> String {
    let parent = p.parent().and_then(|x| x.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let me = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    format!("{parent} › {me}")
}

fn measure(cancel: &AtomicBool) -> Snapshot {
    let mut sizes = BTreeMap::new();
    for r in roots() {
        let found: Vec<(String, u64)> = read_dir_md(&r)
            .into_par_iter()
            .filter(|(_, md)| md.is_dir() && !is_reparse(md))
            .map(|(p, md)| (p.to_string_lossy().into_owned(), tree_stat_md(&p, &md, cancel).size))
            .collect();
        sizes.extend(found);
    }
    Snapshot { at: now_ms(), sizes }
}

/// Ce qui a grossi entre la plus récente mesure de référence (≥ 20 h) et la dernière.
pub fn compare(snaps: &[Snapshot], now: i64) -> Report {
    let Some(last) = snaps.last() else { return Report { growers: vec![], measured_at: 0, since: None } };
    let base = snaps.iter().rev().find(|s| s.at <= last.at.min(now) - BASE_AGE);
    let mut growers: Vec<Grower> = base
        .map(|b| {
            last.sizes
                .iter()
                .filter_map(|(p, &after)| {
                    let before = b.sizes.get(p).copied().unwrap_or(0);
                    let delta = after.saturating_sub(before);
                    // 2 Go de plus, ou 500 Mo de plus quand le dossier a au moins doublé
                    (delta >= 2 * GB || (delta >= 500 * MB && after >= 2 * before)).then(|| Grower { path: p.clone(), name: label(Path::new(p)), before, after })
                })
                .collect()
        })
        .unwrap_or_default();
    growers.sort_by(|a, b| (b.after - b.before).cmp(&(a.after - a.before)));
    growers.truncate(5);
    Report { growers, measured_at: last.at, since: base.map(|b| b.at) }
}

/// Remesure si la dernière mesure a plus de 6 h (ou sur demande), puis compare.
pub fn check(store: &Store, force: bool, cancel: &AtomicBool) -> Result<Report, String> {
    let mut snaps: Vec<Snapshot> = store.read(FILE);
    let now = now_ms();
    if force || snaps.last().is_none_or(|s| now - s.at >= MIN_GAP) {
        let s = measure(cancel);
        if cancel.load(Ordering::SeqCst) {
            return Err("mesure annulée".into());
        }
        snaps.push(s);
        // garder les plus récentes, mais toujours une référence d'au moins 20 h
        while snaps.len() > KEEP && snaps.get(1).is_some_and(|s| now - s.at >= BASE_AGE) {
            snaps.remove(0);
        }
        store.write(FILE, &snaps)?;
    }
    Ok(compare(&snaps, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(at_h: i64, v: &[(&str, u64)]) -> Snapshot {
        Snapshot { at: at_h * HOUR, sizes: v.iter().map(|(k, s)| (k.to_string(), *s)).collect() }
    }

    #[test]
    fn flags_big_or_doubling_growth_against_a_day_old_baseline() {
        let p = if cfg!(windows) { ["C:\\ProgramData\\McAfee", "C:\\ProgramData\\Calme", "C:\\ProgramData\\Petit", "C:\\ProgramData\\Neuf"] } else { ["/L/McAfee", "/L/Calme", "/L/Petit", "/L/Neuf"] };
        let old = snap(0, &[(p[0], GB), (p[1], 50 * GB), (p[2], 300 * MB)]);
        let recent = snap(30, &[(p[0], GB), (p[1], 50 * GB), (p[2], 300 * MB)]);
        let now = snap(48, &[(p[0], 16 * GB), (p[1], 51 * GB), (p[2], 900 * MB), (p[3], 700 * MB)]);
        // pas encore de référence de 20 h : rien
        assert!(compare(&[recent.clone(), now.clone()], 48 * HOUR).growers.is_empty());
        let r = compare(&[old, recent, now], 48 * HOUR);
        assert_eq!(r.since, Some(0));
        let names: Vec<&str> = r.growers.iter().map(|g| g.path.as_str()).collect();
        // +15 Go ; +700 Mo depuis rien ; +600 Mo et triplé ; pas +1 Go sur 50
        assert_eq!(names, vec![p[0], p[3], p[2]]);
        assert!(r.growers[0].name.ends_with("› McAfee"));
    }
}
