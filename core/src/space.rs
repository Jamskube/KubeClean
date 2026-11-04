//! Cartographie de l'espace : ce qui occupe un dossier, élément par élément. Lecture seule ;
//! jamais de lien ni de jonction, jamais un autre volume ; sur Mac un paquet (.app, .photoslibrary…)
//! est mesuré d'un bloc par `du`, sans être parcouru.

use crate::fsutil::{device, is_clean_abs, is_reparse, path_without_reparse};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Tailles déjà mesurées, jusqu'à MEMO_DEPTH niveaux sous un dossier ouvert : descendre d'un
/// cran ne remesure rien.
/// ponytail: mémoire sans limite ni péremption ; « Actualiser » vide la branche affichée.
const MEMO_DEPTH: u32 = 4;
static MEMO: Mutex<Option<HashMap<String, (u64, u64)>>> = Mutex::new(None);
/// Au-delà, les plus petits éléments sont regroupés en une ligne « autres ».
const SHOWN: usize = 150;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub files: u64,
    pub is_dir: bool,
    pub package: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub size: u64,
    pub files: u64,
    pub entries: Vec<Entry>,
    pub rest: u64,
    pub rest_count: usize,
}

#[derive(Serialize)]
pub struct Root {
    pub label: String,
    pub path: String,
}

fn key(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(windows) { s.to_lowercase() } else { s.into_owned() }
}

fn is_package(p: &Path) -> bool {
    cfg!(target_os = "macos") && p.extension().is_some()
}

#[cfg(target_os = "macos")]
fn package_size(p: &Path) -> u64 {
    std::process::Command::new("/usr/bin/du")
        .arg("-sk")
        .arg(p)
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().next()?.parse::<u64>().ok())
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}
#[cfg(not(target_os = "macos"))]
fn package_size(_: &Path) -> u64 {
    0
}

/// Le stockage du téléphone vu par Mobile connecté : le lire le ferait transiter depuis le téléphone.
fn phone(p: &Path) -> bool {
    cfg!(windows) && p.file_name().is_some_and(|n| n.eq_ignore_ascii_case("CrossDevice")) && std::env::var_os("USERPROFILE").is_some_and(|h| p.parent().is_some_and(|d| d.as_os_str().eq_ignore_ascii_case(&h)))
}

fn entries(dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        // Windows : métadonnées de l'énumération elle-même, sans rouvrir chaque fichier (lien non suivi)
        .filter_map(|e| e.metadata().ok().map(|m| (e.path(), m)))
        .collect()
}

/// (taille, fichiers) d'un élément ; les dossiers peu profonds sont notés dans `memo`.
fn measure(p: &Path, md: &std::fs::Metadata, dev: u64, depth: u32, cancel: &AtomicBool, memo: &Mutex<Vec<(String, (u64, u64))>>) -> (u64, u64) {
    if is_reparse(md) || cancel.load(Ordering::Relaxed) {
        return (0, 0);
    }
    if !md.is_dir() {
        return (md.len(), 1);
    }
    if device(md) != dev || phone(p) {
        return (0, 0);
    }
    if is_package(p) {
        return (package_size(p), 1);
    }
    let r = entries(p)
        .into_par_iter()
        .map(|(c, m)| measure(&c, &m, dev, depth + 1, cancel, memo))
        .reduce(|| (0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
    if depth <= MEMO_DEPTH && !cancel.load(Ordering::Relaxed) {
        memo.lock().unwrap_or_else(|e| e.into_inner()).push((key(p), r));
    }
    r
}

pub fn roots() -> Vec<Root> {
    let mut v = vec![];
    if let Some(h) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).filter(|p| p.is_absolute()) {
        v.push(Root { label: "Dossier personnel".into(), path: h.to_string_lossy().into_owned() });
    }
    // macOS : « / » est le volume système scellé, les données vivent sur un autre volume
    if cfg!(target_os = "macos") {
        v.push(Root { label: "Applications".into(), path: "/Applications".into() });
    } else {
        v.extend(crate::os::fixed_drives().into_iter().map(|d| Root { label: d.root.trim_end_matches('\\').to_string(), path: d.root }));
    }
    v
}

pub fn list(path: &str, refresh: bool, cancel: &AtomicBool, progress: &(dyn Fn(usize, usize, &str) + Sync)) -> Result<Listing, String> {
    let p = PathBuf::from(path);
    if !is_clean_abs(&p) || !path_without_reparse(&p) {
        return Err("dossier invalide".into());
    }
    let md = std::fs::symlink_metadata(&p).map_err(|_| "dossier introuvable".to_string())?;
    if !md.is_dir() || (is_package(&p) && p.parent().is_some()) {
        return Err("ce n'est pas un dossier que KubeClean peut ouvrir".into());
    }
    let dev = device(&md);
    if refresh {
        let k = key(&p);
        if let Some(m) = MEMO.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            m.retain(|x, _| !x.starts_with(&k));
        }
    }
    let ents = entries(&p);
    let (total, done) = (ents.len(), AtomicUsize::new(0));
    let memo = Mutex::new(vec![]);
    let cached = |c: &Path| MEMO.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(&key(c)).copied());
    let mut out: Vec<Entry> = ents
        .into_par_iter()
        .map(|(c, m)| {
            let is_dir = m.is_dir() && !is_reparse(&m);
            let (size, files) = match (is_dir, cached(&c)) {
                (true, Some(v)) => v,
                _ => measure(&c, &m, dev, 1, cancel, &memo),
            };
            let name = c.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total, &name);
            Entry { package: is_dir && is_package(&c), name, path: c.to_string_lossy().into_owned(), size, files, is_dir }
        })
        .collect();
    if cancel.load(Ordering::Relaxed) {
        return Err("analyse annulée".into());
    }
    MEMO.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).extend(memo.into_inner().unwrap_or_else(|e| e.into_inner()));
    out.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
    let (size, files) = out.iter().fold((0, 0), |a, e| (a.0 + e.size, a.1 + e.files));
    let tail = out.split_off(out.len().min(SHOWN));
    Ok(Listing { path: p.to_string_lossy().into_owned(), size, files, entries: out, rest: tail.iter().map(|e| e.size).sum(), rest_count: tail.len() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sizes_add_up_and_memo_serves_children() {
        let t = tempfile::tempdir().unwrap();
        let w = |p: &str, n: usize| {
            let f = t.path().join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, vec![b'x'; n]).unwrap();
        };
        w("big/a/1.bin", 3000);
        w("big/b.bin", 1000);
        w("small/c.txt", 10);
        w("top.txt", 5);
        let cancel = AtomicBool::new(false);
        let l = list(&t.path().to_string_lossy(), false, &cancel, &|_, _, _| {}).unwrap();
        assert_eq!((l.size, l.files), (4015, 4));
        assert_eq!(l.entries.iter().map(|e| (e.name.as_str(), e.size, e.is_dir)).collect::<Vec<_>>(), [("big", 4000, true), ("small", 10, true), ("top.txt", 5, false)]);
        // le sous-dossier est servi par la mémoire : un fichier ajouté n'apparaît qu'après « Actualiser »
        w("big/a/2.bin", 500);
        let big = t.path().join("big");
        let inner = list(&big.to_string_lossy(), false, &cancel, &|_, _, _| {}).unwrap();
        assert_eq!(inner.size, 4000);
        let fresh = list(&big.to_string_lossy(), true, &cancel, &|_, _, _| {}).unwrap();
        assert_eq!(fresh.size, 4500);
        assert!(list("relative/path", false, &cancel, &|_, _, _| {}).is_err());
        assert!(list(&t.path().join("top.txt").to_string_lossy(), false, &cancel, &|_, _, _| {}).is_err());
    }
}
