//! Doublons : fichiers de même contenu, groupés par taille, puis par empreinte de quelques
//! morceaux, puis par empreinte complète. Avant tout envoi à la Corbeille, la copie retirée et
//! celle qu'on garde sont recomparées octet par octet : l'empreinte ne décide jamais seule.

use crate::fsutil::{is_reparse, mtime, path_without_reparse, read_dir_md, same_path, is_under};
use crate::os;
use crate::scan::ARTIFACTS;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::Hasher;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Copy {
    pub path: String,
    pub modified: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub size: u64,
    /// la plus récente d'abord
    pub copies: Vec<Copy>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub groups: Vec<Group>,
    /// place prise par les copies en trop
    pub wasted: u64,
    pub files: usize,
    pub truncated: bool,
}

const MIN: u64 = 1 << 20;
const MAX_GROUPS: usize = 300;
const CHUNK: usize = 1 << 20;
/// Données d'applis, système, dépôts et dossiers régénérables : leurs « doublons » ne sont pas
/// à l'utilisateur, en retirer un casserait une appli ou un projet.
const SKIP: &[&str] = &[".git", "appdata", "library", "$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", "programdata", ".trash", ".trashes", ".pnpm-store"];

fn skipped_name(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.starts_with('.') && name != "." || SKIP.contains(&name.as_str()) || ARTIFACTS.iter().any(|a| a.name.eq_ignore_ascii_case(&name))
}

fn skipped_dir(p: &Path) -> bool {
    // macOS : un paquet (.app, .photoslibrary…) est un seul document pour l'utilisateur
    skipped_name(p) || cfg!(target_os = "macos") && p.extension().is_some()
}

/// Hors du périmètre de la recherche : un dossier exclu (caché, données d'applis, artefacts)
/// contient `p`, ou l'est lui-même. Sans la règle des paquets : `/Users/jean.dupont` en a l'air.
pub fn excluded(p: &Path) -> bool {
    p.ancestors().any(skipped_name)
}

/// Même fichier sous deux écritures (nom court 8.3, lecteur `subst`, préfixe `\\?\`, forme
/// Unicode) : comparé par identité, jamais par l'orthographe du chemin.
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => true, // illisible : prudence, traité comme le même
        }
    }
    #[cfg(not(unix))]
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => same_path(&x, &y),
        _ => true,
    }
}

fn walk(dir: &Path, cancel: &AtomicBool) -> Vec<(PathBuf, u64, i64)> {
    if cancel.load(Ordering::Relaxed) {
        return vec![];
    }
    read_dir_md(dir)
        .into_par_iter()
        .flat_map(|(p, md)| {
            if is_reparse(&md) {
                vec![] // lien, jonction, fichier en ligne (OneDrive, iCloud) : jamais lu
            } else if md.is_dir() {
                if skipped_dir(&p) { vec![] } else { walk(&p, cancel) }
            } else if md.is_file() && md.len() >= MIN {
                vec![(p, md.len(), mtime(&md))]
            } else {
                vec![]
            }
        })
        .collect()
}

fn sip() -> std::hash::DefaultHasher {
    std::hash::DefaultHasher::new() // clés fixes : même empreinte pour le même contenu, le temps d'une recherche
}

/// Début, milieu et fin : écarte vite les fichiers de même taille au contenu différent.
fn sample(p: &Path, size: u64) -> std::io::Result<u64> {
    let mut f = File::open(p)?;
    let mut h = sip();
    let mut buf = vec![0u8; 64 * 1024];
    for off in [0, size / 2, size.saturating_sub(buf.len() as u64)] {
        f.seek(SeekFrom::Start(off))?;
        let n = f.read(&mut buf)?;
        h.write(&buf[..n]);
    }
    Ok(h.finish())
}

fn full(p: &Path) -> std::io::Result<u64> {
    let mut f = File::open(p)?;
    let mut h = sip();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            return Ok(h.finish());
        }
        h.write(&buf[..n]);
    }
}

/// Regroupe par clé, garde les groupes d'au moins deux fichiers.
fn regroup<K: std::hash::Hash + Eq + Send>(files: Vec<(K, (PathBuf, u64, i64))>) -> Vec<Vec<(PathBuf, u64, i64)>> {
    let mut m: HashMap<K, Vec<(PathBuf, u64, i64)>> = HashMap::new();
    for (k, f) in files {
        m.entry(k).or_default().push(f);
    }
    m.into_values().filter(|g| g.len() > 1).collect()
}

/// Deux chemins vers le même fichier (lien physique) ne sont pas des doublons : en retirer un ne libère rien.
#[cfg(unix)]
fn same_inode(g: Vec<(PathBuf, u64, i64)>) -> Vec<(PathBuf, u64, i64)> {
    use std::os::unix::fs::MetadataExt;
    let mut seen = std::collections::HashSet::new();
    g.into_iter().filter(|(p, _, _)| fs::symlink_metadata(p).map(|m| seen.insert((m.dev(), m.ino()))).unwrap_or(false)).collect()
}
// ponytail: Windows ne détecte pas les liens physiques (rares hors .pnpm-store, écarté) ; les retirer ne perd rien, ne libère juste rien.
#[cfg(windows)]
fn same_inode(g: Vec<(PathBuf, u64, i64)>) -> Vec<(PathBuf, u64, i64)> {
    g
}

pub fn find(roots: &[PathBuf], cancel: &AtomicBool, progress: &(dyn Fn(usize, usize, &str) + Sync)) -> Report {
    // une racine dans une autre ne compte qu'une fois : sinon chaque fichier serait son propre doublon
    let mut tops: Vec<&PathBuf> = vec![];
    for r in roots {
        if !roots.iter().any(|o| !same_path(o, r) && is_under(r, o)) && !tops.iter().any(|t| same_path(t, r)) {
            tops.push(r);
        }
    }
    progress(0, 0, "Inventaire des fichiers");
    let files: Vec<(PathBuf, u64, i64)> = tops.par_iter().flat_map(|r| walk(r, cancel)).collect();
    let n_files = files.len();
    let by_size = regroup(files.into_iter().map(|f| (f.1, f)).collect());
    let total: usize = by_size.iter().map(Vec::len).sum();
    let done = AtomicUsize::new(0);
    let tick = |p: &Path| {
        let d = done.fetch_add(1, Ordering::Relaxed) + 1;
        if d % 50 == 0 || d == total {
            progress(d.min(total), total, &p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        }
    };
    // empreinte partielle, puis complète seulement pour ce qui se ressemble encore
    let sampled: Vec<(u64, u64, (PathBuf, u64, i64))> = by_size
        .into_par_iter()
        .flatten()
        .filter_map(|f| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let s = sample(&f.0, f.1).ok()?;
            Some((f.1, s, f))
        })
        .collect();
    let close = regroup(sampled.into_iter().map(|(size, s, f)| ((size, s), f)).collect());
    let hashed: Vec<((u64, u64), (PathBuf, u64, i64))> = close
        .into_par_iter()
        .flatten()
        .filter_map(|f| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let h = full(&f.0).ok();
            tick(&f.0);
            Some(((f.1, h?), f))
        })
        .collect();
    let mut groups: Vec<Group> = regroup(hashed)
        .into_iter()
        .map(same_inode)
        .filter(|g| g.len() > 1)
        .map(|mut g| {
            g.sort_by(|a, b| b.2.cmp(&a.2));
            Group { size: g[0].1, copies: g.into_iter().map(|(p, _, m)| Copy { path: p.to_string_lossy().into_owned(), modified: m }).collect() }
        })
        .collect();
    let waste = |g: &Group| g.size * (g.copies.len() as u64 - 1);
    groups.sort_by(|a, b| waste(b).cmp(&waste(a)));
    let wasted = groups.iter().map(waste).sum();
    let truncated = groups.len() > MAX_GROUPS;
    groups.truncate(MAX_GROUPS);
    Report { groups, wasted, files: n_files, truncated }
}

/// Même contenu, octet par octet, et deux fichiers distincts bien réels.
pub fn same_content(a: &Path, b: &Path) -> bool {
    let real = |p: &Path| path_without_reparse(p) && fs::symlink_metadata(p).is_ok_and(|m| m.is_file());
    if same_path(a, b) || !real(a) || !real(b) || same_file(a, b) {
        return false;
    }
    let (Ok(ma), Ok(mb)) = (fs::metadata(a), fs::metadata(b)) else { return false };
    if ma.len() != mb.len() {
        return false;
    }
    let (Ok(mut fa), Ok(mut fb)) = (File::open(a), File::open(b)) else { return false };
    let (mut ba, mut bb) = (vec![0u8; CHUNK], vec![0u8; CHUNK]);
    loop {
        let Ok(n) = fa.read(&mut ba) else { return false };
        if n == 0 {
            return matches!(fb.read(&mut bb[..1]), Ok(0)); // `b` aussi à sa fin
        }
        if fb.read_exact(&mut bb[..n]).is_err() || ba[..n] != bb[..n] {
            return false;
        }
    }
}

#[derive(Deserialize)]
pub struct Pair {
    pub remove: String,
    pub keep: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub trashed: Vec<String>,
    pub size: u64,
    /// copies laissées en place : plus identiques, disparues, ou refusées par le système
    pub left: Vec<String>,
}

/// Envoie à la Corbeille chaque copie encore identique à celle qu'on garde.
pub fn trash(pairs: &[Pair]) -> TrashReport {
    let checked: Vec<(PathBuf, u64)> = pairs
        .par_iter()
        // même périmètre que la recherche : rien sous AppData, Bibliothèque, .git, node_modules…
        .filter(|p| Path::new(&p.remove).parent().is_some_and(|d| !excluded(d)) && same_content(Path::new(&p.remove), Path::new(&p.keep)))
        .map(|p| (PathBuf::from(&p.remove), fs::metadata(&p.remove).map(|m| m.len()).unwrap_or(0)))
        .collect();
    // une copie gardée ailleurs ne doit jamais partir dans le même lot
    let keeps: Vec<&str> = pairs.iter().map(|p| p.keep.as_str()).collect();
    let checked: Vec<(PathBuf, u64)> = checked.into_iter().filter(|(p, _)| !keeps.iter().any(|k| same_path(Path::new(k), p))).collect();
    let paths: Vec<PathBuf> = checked.iter().map(|(p, _)| p.clone()).collect();
    let gone = os::recycle(&paths);
    let size = checked.iter().filter(|(p, _)| gone.iter().any(|g| same_path(g, p))).map(|(_, s)| s).sum();
    let trashed: Vec<String> = gone.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let left = pairs.iter().map(|p| p.remove.clone()).filter(|r| !gone.iter().any(|g| same_path(g, Path::new(r)))).collect();
    TrashReport { trashed, size, left }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_identical_content_only_and_verifies_bytes() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let data: Vec<u8> = (0..2 * MIN as usize + 7).map(|i| (i * 31 % 251) as u8).collect();
        let mut other = data.clone();
        *other.last_mut().unwrap() ^= 1; // même taille, même début et même milieu, fin différente
        for (rel, bytes) in [("a/film.bin", &data), ("b/film (copie).bin", &data), ("c/autre.bin", &other), ("node_modules/film.bin", &data)] {
            let p = d.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, bytes).unwrap();
        }
        fs::write(d.join("a/petit.txt"), b"x").unwrap();
        fs::write(d.join("b/petit.txt"), b"x").unwrap(); // sous 1 Mo : ignoré

        let no = AtomicBool::new(false);
        // la même racine deux fois, et une racine incluse, ne fabriquent pas de faux doublons
        let r = find(&[d.to_path_buf(), d.join("a"), d.to_path_buf()], &no, &|_, _, _| {});
        assert_eq!(r.groups.len(), 1, "{r:?}");
        let g = &r.groups[0];
        assert_eq!(g.copies.len(), 2);
        assert_eq!(r.wasted, data.len() as u64);
        assert!(g.copies.iter().all(|c| !c.path.contains("node_modules") && !c.path.contains("autre")));

        assert!(same_content(&d.join("a/film.bin"), &d.join("b/film (copie).bin")));
        assert!(!same_content(&d.join("a/film.bin"), &d.join("c/autre.bin")));
        assert!(!same_content(&d.join("a/film.bin"), &d.join("a/film.bin")), "un fichier n'est pas son propre doublon");
        assert!(!same_content(&d.join("a/film.bin"), &d.join("b/../a/./film.bin")), "ni sous une autre écriture");

        assert!(excluded(&d.join("projet").join("node_modules").join("x")) && excluded(&d.join(".cache")));
        assert!(!excluded(Path::new("/Users/jean.dupont/Documents/films")), "un point dans le nom n'est pas un paquet ici");
    }
}
