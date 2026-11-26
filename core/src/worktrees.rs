//! Copies de travail git (`git worktree`) : trouvées en lisant les dossiers `.git`, jugées par git.
//! Lecture seule, sauf `remove`, qui passe par `git worktree remove` SANS --force : git refuse
//! lui-même une copie qui a encore du travail. Les commits ne se perdent pas : la branche reste.

use crate::fsutil::{is_reparse, read_dir_md, same_path, tree_stat, is_under};
use crate::scan::ARTIFACTS;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub repo: String,
    #[serde(skip)]
    meta: PathBuf, // .git/worktrees/<nom> : la référence que git garde de cette copie
    pub branch: Option<String>,
    pub size: u64,
    /// fichiers modifiés ou non suivis
    pub changes: usize,
    /// fichiers ignorés par git qui ne se régénèrent pas (.env, données…) : `worktree remove` les effacerait
    pub local: Vec<String>,
    /// le commit de la copie est déjà dans la branche principale du dépôt
    pub merged: bool,
    /// le commit est sur une branche distante
    pub pushed: bool,
    /// dernier commit (ms), 0 si inconnu
    pub last: i64,
    /// dossier disparu : seule la référence reste dans le dépôt
    pub missing: bool,
    pub locked: bool,
    /// une autre copie de travail vit dans ce dossier : la retirer l'effacerait aussi
    pub nests: bool,
    pub removable: bool,
}

/// Fichiers ignorés qui se recréent seuls, ou réglages locaux d'outils (agent, éditeur) sans valeur
/// hors de cette copie : ils ne bloquent pas le retrait. Un `.env` ou des données, si.
const REGEN: &[&str] = &["build", "dist", "out", ".dart_tool", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".cache", "coverage", ".svelte-kit", "graft", ".tox", "Pods", ".expo", ".terraform", ".claude", ".playwright-mcp", ".idea", "next-env.d.ts"];
const SKIP: &[&str] = &[".git", "appdata", "library", "$recycle.bin", "program files", "program files (x86)", "windows"];

/// Le nom de l'entrée ignorée elle-même, jamais un dossier parent : un `build/` suivi par git
/// peut contenir un `build/cert.p12` ignoré, qui partirait avec la copie.
fn regenerable(entry: &str) -> bool {
    let name = entry.trim_end_matches('/').rsplit('/').next().unwrap_or_default();
    name.ends_with(".tsbuildinfo") || REGEN.iter().chain(ARTIFACTS.iter().map(|a| &a.name)).any(|n| n.eq_ignore_ascii_case(name))
}

fn git(dir: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let mut c = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // GIT_OPTIONAL_LOCKS=0 : `status` ne réécrit pas l'index, la lecture reste une lecture
    // status.showUntrackedFiles=no (réglage courant des gros dépôts) viderait `status`, et la
    // vérification de `git worktree remove` avec : forcé ici, transmis aux sous-commandes de git
    c.arg("-C").arg(dir).args(["-c", "core.quotepath=off", "-c", "status.showUntrackedFiles=normal"]).args(args).env("GIT_OPTIONAL_LOCKS", "0").stdin(Stdio::null()).stderr(Stdio::null());
    let o = c.output().map_err(|_| "git introuvable : installe Git pour gérer les copies de travail".to_string())?;
    Ok((o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned()))
}

fn shown(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    if cfg!(windows) { s.replace('/', "\\") } else { s }
}

/// Dépôts principaux qui ont des copies de travail (`.git/worktrees/`), jusqu'à `depth` niveaux.
fn find_repos(dir: &Path, depth: u32) -> Vec<PathBuf> {
    let mut out = vec![];
    if fs::symlink_metadata(dir.join(".git").join("worktrees")).is_ok_and(|m| m.is_dir()) {
        out.push(dir.to_path_buf());
    }
    if depth == 0 {
        return out;
    }
    let sub: Vec<PathBuf> = read_dir_md(dir)
        .into_par_iter()
        .filter(|(p, md)| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            md.is_dir() && !is_reparse(md) && !name.starts_with('.') && !SKIP.contains(&name.as_str()) && !ARTIFACTS.iter().any(|a| a.name.eq_ignore_ascii_case(&name))
        })
        .flat_map(|(p, _)| find_repos(&p, depth - 1))
        .collect();
    out.extend(sub);
    out
}

/// Branches principales du dépôt : celle où il est, main, master, et leurs versions distantes.
fn main_refs(repo: &Path) -> Result<Vec<String>, String> {
    let (_, cur) = git(repo, &["symbolic-ref", "--short", "-q", "HEAD"])?;
    let mut refs: Vec<String> = ["main", "master", "origin/main", "origin/master", "origin/HEAD"].iter().map(|s| s.to_string()).collect();
    if !cur.trim().is_empty() {
        refs.push(cur.trim().to_string());
    }
    Ok(refs)
}

/// Le dossier de la copie a-t-il vraiment disparu ? Seulement si sa lecture répond « introuvable »
/// ET que son parent se lit : un disque débranché, un volume verrouillé ou un partage hors ligne
/// répondent aussi par une erreur, et leur copie n'a rien perdu.
fn gone(wt: &Path) -> bool {
    matches!(fs::symlink_metadata(wt), Err(e) if e.kind() == std::io::ErrorKind::NotFound) && wt.parent().is_some_and(|p| fs::read_dir(p).is_ok())
}

/// (fichiers modifiés ou non suivis, fichiers ignorés à garder), ou None si ce n'est plus une copie valide
fn blockers(wt: &Path) -> Result<Option<(usize, Vec<String>)>, String> {
    let (ok, status) = git(wt, &["status", "--porcelain", "--ignored", "--untracked-files=normal"])?;
    if !ok {
        return Ok(None);
    }
    let (mut changes, mut local) = (0, vec![]);
    for line in status.lines() {
        match line.split_at_checked(3) {
            Some(("!! ", entry)) => if !regenerable(entry) { local.push(entry.to_string()) },
            Some(_) => changes += 1,
            None => {}
        }
    }
    Ok(Some((changes, local)))
}

fn inspect(repo: &Path, meta: &Path, refs: &[String], measure: bool, cancel: &AtomicBool) -> Result<Option<Worktree>, String> {
    let Ok(gitdir) = fs::read_to_string(meta.join("gitdir")) else { return Ok(None) };
    // relatif avec worktree.useRelativePaths (git 2.48+) : relatif au dossier de métadonnées
    let Some(wt) = meta.join(gitdir.trim()).parent().map(Path::to_path_buf) else { return Ok(None) };
    let branch = fs::read_to_string(meta.join("HEAD")).ok().and_then(|h| h.trim().strip_prefix("ref: refs/heads/").map(str::to_string));
    let locked = meta.join("locked").exists();
    let mut w = Worktree { path: shown(&wt), repo: shown(repo), meta: meta.to_path_buf(), branch, size: 0, changes: 0, local: vec![], merged: false, pushed: false, last: 0, missing: false, locked, nests: false, removable: false };
    if gone(&wt) {
        w.missing = true;
        w.removable = !locked;
        return Ok(Some(w));
    }
    if !fs::symlink_metadata(&wt).is_ok_and(|m| m.is_dir() && !is_reparse(&m)) {
        return Ok(None); // illisible, ou un lien : on ne le juge pas
    }
    let Some((changes, local)) = blockers(&wt)? else { return Ok(None) }; // plus une copie de travail valide
    (w.changes, w.local) = (changes, local);
    if let (true, log) = git(&wt, &["log", "-1", "--format=%H %ct"])? {
        let mut it = log.split_whitespace();
        let head = it.next().unwrap_or_default().to_string();
        w.last = it.next().and_then(|t| t.parse::<i64>().ok()).unwrap_or(0) * 1000;
        if let (true, contains) = git(repo, &["branch", "-a", "--contains", &head, "--format=%(refname:short)"])? {
            let names: Vec<&str> = contains.lines().map(str::trim).collect();
            w.merged = refs.iter().any(|r| names.contains(&r.as_str()) && w.branch.as_deref() != Some(r.as_str()));
            w.pushed = names.iter().any(|n| n.starts_with("origin/"));
        }
    }
    if measure {
        w.size = tree_stat(&wt, cancel).size;
    }
    Ok(Some(w))
}

/// Copies de travail des dépôts trouvés sous `roots`.
pub fn list(roots: &[PathBuf], cancel: &AtomicBool) -> Result<Vec<Worktree>, String> {
    collect(roots, true, cancel)
}

fn collect(roots: &[PathBuf], measure: bool, cancel: &AtomicBool) -> Result<Vec<Worktree>, String> {
    let mut repos: Vec<PathBuf> = vec![];
    for r in roots {
        for repo in find_repos(r, 4) {
            if !repos.iter().any(|x| same_path(x, &repo)) {
                repos.push(repo);
            }
        }
    }
    let mut all = vec![];
    for repo in &repos {
        let metas: Vec<PathBuf> = read_dir_md(&repo.join(".git").join("worktrees")).into_iter().filter(|(_, m)| m.is_dir()).map(|(p, _)| p).collect();
        if metas.is_empty() {
            continue;
        }
        let refs = main_refs(repo)?;
        let found: Result<Vec<Option<Worktree>>, String> = metas.par_iter().map(|m| inspect(repo, m, &refs, measure, cancel)).collect();
        all.extend(found?.into_iter().flatten());
    }
    // une copie qui en contient une autre ne se retire pas : le dossier imbriqué partirait avec
    let paths: Vec<PathBuf> = all.iter().map(|w| PathBuf::from(&w.path)).collect();
    for w in &mut all {
        let me = PathBuf::from(&w.path);
        w.nests = paths.iter().any(|p| !same_path(p, &me) && is_under(p, &me));
        if !w.missing {
            w.removable = !w.locked && !w.nests && w.changes == 0 && w.local.is_empty();
        }
    }
    all.sort_by(|a, b| b.removable.cmp(&a.removable).then(b.size.cmp(&a.size)));
    Ok(all)
}

#[derive(Serialize)]
pub struct Refused {
    pub path: String,
    pub reason: String,
}

/// Retire les copies demandées, après les avoir rejugées à l'instant.
pub fn remove(roots: &[PathBuf], paths: &[String], cancel: &AtomicBool) -> Result<(Vec<String>, Vec<Refused>), String> {
    let fresh = collect(roots, false, cancel)?;
    let (mut removed, mut refused) = (vec![], vec![]);
    for p in paths {
        let Some(w) = fresh.iter().find(|w| same_path(Path::new(&w.path), Path::new(p))) else {
            refused.push(Refused { path: p.clone(), reason: "introuvable : actualise la liste".into() });
            continue;
        };
        if !w.removable {
            let reason = if w.changes > 0 { format!("{} fichier(s) modifié(s)", w.changes) } else if !w.local.is_empty() { "fichiers locaux ignorés par git".into() } else { "copie verrouillée ou contenant une autre copie".into() };
            refused.push(Refused { path: p.clone(), reason });
            continue;
        }
        let ok = if w.missing {
            // seulement CETTE référence : `git worktree prune` effacerait aussi celles d'un disque débranché
            gone(Path::new(&w.path)) && fs::remove_dir_all(&w.meta).is_ok()
        } else {
            // rejugée juste avant, une par une : un .env apparu depuis la liste n'est pas vu par git
            if blockers(Path::new(&w.path))?.is_none_or(|(c, l)| c > 0 || !l.is_empty()) {
                refused.push(Refused { path: p.clone(), reason: "du travail est apparu dans la copie : actualise la liste".into() });
                continue;
            }
            git(Path::new(&w.repo), &["worktree", "remove", &w.path])?.0
        };
        if ok { removed.push(p.clone()) } else { refused.push(Refused { path: p.clone(), reason: "git a refusé le retrait".into() }) }
    }
    Ok((removed, refused))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(dir).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn finished_copies_are_removable_and_work_in_progress_is_kept() {
        if Command::new("git").arg("--version").output().is_err() {
            return; // pas de git sur cette machine
        }
        let t = tempfile::tempdir().unwrap();
        let repo = t.path().join("repo");
        fs::create_dir(&repo).unwrap();
        run(&repo, &["init", "-q", "-b", "main"]);
        run(&repo, &["config", "user.email", "t@t"]);
        run(&repo, &["config", "user.name", "t"]);
        fs::write(repo.join(".gitignore"), "node_modules/\n.env\nbuild/*.p12\n").unwrap();
        fs::write(repo.join("a.txt"), "a").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-q", "-m", "a"]);
        // réglage des gros dépôts qui vide `git status` des fichiers non suivis et ignorés
        run(&repo, &["config", "status.showUntrackedFiles", "no"]);
        let wt = |n: &str| t.path().join(n);
        for n in ["done", "wip", "secret", "deps", "notes", "signed", "gone"] {
            run(&repo, &["worktree", "add", "-q", "-b", n, wt(n).to_str().unwrap()]);
        }
        fs::write(wt("wip").join("a.txt"), "changé").unwrap();
        fs::write(wt("secret").join(".env"), "KEY=1").unwrap();
        fs::write(wt("notes").join("notes.txt"), "à garder").unwrap();
        // un dossier `build` suivi par git, avec un certificat ignoré dedans
        fs::create_dir(wt("signed").join("build")).unwrap();
        fs::write(wt("signed").join("build").join("icon.txt"), "i").unwrap();
        run(&wt("signed"), &["add", "build/icon.txt"]);
        run(&wt("signed"), &["commit", "-q", "-m", "icon"]);
        fs::write(wt("signed").join("build").join("cert.p12"), "secret").unwrap();
        fs::remove_dir_all(wt("gone")).unwrap();
        fs::create_dir_all(wt("deps").join("node_modules").join("x")).unwrap();
        fs::write(wt("deps").join("node_modules").join("x").join("i.js"), "1").unwrap();
        fs::write(wt("deps").join("package.json"), "{}").unwrap();
        fs::write(wt("deps").join(".gitignore"), "node_modules/
.env
.claude/
").unwrap();
        fs::create_dir_all(wt("deps").join(".claude")).unwrap();
        fs::write(wt("deps").join(".claude").join("settings.local.json"), "{}").unwrap();
        run(&wt("deps"), &["add", "package.json", ".gitignore"]);
        run(&wt("deps"), &["commit", "-q", "-m", "deps"]);

        let roots = vec![t.path().to_path_buf()];
        let no = AtomicBool::new(false);
        let l = list(&roots, &no).unwrap();
        let get = |n: &str| l.iter().find(|w| Path::new(&w.path).file_name().unwrap() == n).unwrap().clone();
        assert_eq!(l.len(), 7);
        let notes = get("notes");
        assert!(!notes.removable && notes.changes == 1, "fichier non suivi malgré showUntrackedFiles=no : {notes:?}");
        let signed = get("signed");
        assert!(!signed.removable && signed.local == vec!["build/cert.p12".to_string()], "ignoré sous un build/ suivi : {signed:?}");
        let gone = get("gone");
        assert!(gone.missing && gone.removable, "{gone:?}");
        let done = get("done");
        assert!(done.removable && done.merged && done.changes == 0, "{done:?}");
        let wip = get("wip");
        assert!(!wip.removable && wip.changes == 1, "{wip:?}");
        let secret = get("secret");
        assert!(!secret.removable && secret.local == vec![".env".to_string()], "{secret:?}");
        let deps = get("deps");
        assert!(deps.removable && !deps.merged, "dépendances régénérables, commit hors de main : {deps:?}");

        let (removed, refused) = remove(&roots, &[done.path.clone(), wip.path.clone(), gone.path.clone(), signed.path.clone()], &no).unwrap();
        assert_eq!(removed, vec![done.path.clone(), gone.path.clone()]);
        assert_eq!(refused.len(), 2);
        assert!(wt("signed").join("build").join("cert.p12").exists());
        assert!(!list(&roots, &no).unwrap().iter().any(|w| w.missing), "la référence disparue est effacée");
        assert!(!wt("done").exists() && wt("wip").join("a.txt").exists());
        run(&repo, &["rev-parse", "--verify", "done"]); // la branche reste
    }
}
