//! Les appels macOS dont le moteur a besoin : le pendant de win.rs, même interface.
//! Pas de tâche administrateur ni de vidage de Corbeille sur Mac : leurs règles n'existent pas.

use serde::Serialize;
use std::ffi::{CStr, CString, c_char, c_void};
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::process::Command;

const NO_ADMIN: &str = "pas de tâche administrateur sur macOS";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub root: String,
    pub total: u64,
    pub free: u64,
}

pub fn disk(root: &str) -> Option<Drive> {
    let c = CString::new(root).ok()?;
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    let b = s.f_bsize as u64;
    Some(Drive { root: root.to_string(), total: s.f_blocks * b, free: s.f_bavail * b })
}

/// Le volume de démarrage seul : sous APFS, système et données partagent le même conteneur.
pub fn fixed_drives() -> Vec<Drive> {
    disk("/").into_iter().collect()
}

#[cfg(test)]
pub fn system_drive() -> String {
    "/".into()
}

/// Noms d'exécutables en minuscules (« google chrome », « safari »).
pub fn running_processes() -> Vec<String> {
    let Ok(out) = Command::new("/bin/ps").args(["-axo", "comm="]).output() else { return vec![] };
    let mut v: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().rsplit('/').next())
        .filter(|n| !n.is_empty())
        .map(str::to_lowercase)
        .collect();
    v.sort();
    v.dedup();
    v
}

pub fn recycle_bin_info() -> (u64, u64) {
    (0, 0)
}

pub fn empty_recycle_bin() -> bool {
    false
}

type Id = *mut c_void;

/// Runtime Objective-C résolu à l'exécution : rien de Foundation n'est lié à la compilation,
/// le moteur se construit sans SDK Apple.
struct Objc {
    class: unsafe extern "C" fn(*const c_char) -> Id,
    sel: unsafe extern "C" fn(*const c_char) -> Id,
    send: *mut c_void, // objc_msgSend, converti vers la signature exacte de chaque appel
    pool_push: unsafe extern "C" fn() -> *mut c_void,
    pool_pop: unsafe extern "C" fn(*mut c_void),
}

fn objc() -> Option<Objc> {
    unsafe {
        let foundation = libc::dlopen(c"/System/Library/Frameworks/Foundation.framework/Foundation".as_ptr(), libc::RTLD_LAZY);
        let lib = libc::dlopen(c"/usr/lib/libobjc.A.dylib".as_ptr(), libc::RTLD_LAZY);
        if foundation.is_null() || lib.is_null() {
            return None;
        }
        let sym = |n: &CStr| {
            let p = libc::dlsym(lib, n.as_ptr());
            (!p.is_null()).then_some(p)
        };
        Some(Objc {
            class: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*const c_char) -> Id>(sym(c"objc_getClass")?),
            sel: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*const c_char) -> Id>(sym(c"sel_registerName")?),
            send: sym(c"objc_msgSend")?,
            pool_push: std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> *mut c_void>(sym(c"objc_autoreleasePoolPush")?),
            pool_pop: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*mut c_void)>(sym(c"objc_autoreleasePoolPop")?),
        })
    }
}

/// Envoie à la Corbeille par NSFileManager (comme le Finder : « Remettre » marche).
/// Rien n'est supprimé pour de bon : un élément refusé reste en place.
/// Rend les chemins qui ne sont plus là.
pub fn recycle(paths: &[PathBuf]) -> Vec<PathBuf> {
    if paths.is_empty() {
        return vec![];
    }
    if let Some(o) = objc() {
        unsafe {
            let msg0 = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id, Id) -> Id>(o.send);
            let msg_str = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id, Id, *const c_char) -> Id>(o.send);
            let msg_id = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id, Id, Id) -> Id>(o.send);
            let msg_trash = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id, Id, Id, *mut Id, *mut Id) -> i8>(o.send);
            let pool = (o.pool_push)();
            let manager = msg0((o.class)(c"NSFileManager".as_ptr()), (o.sel)(c"defaultManager".as_ptr()));
            let (ns_string, ns_url) = ((o.class)(c"NSString".as_ptr()), (o.class)(c"NSURL".as_ptr()));
            let (utf8, file_url, trash) =
                ((o.sel)(c"stringWithUTF8String:".as_ptr()), (o.sel)(c"fileURLWithPath:".as_ptr()), (o.sel)(c"trashItemAtURL:resultingItemURL:error:".as_ptr()));
            if !manager.is_null() && !ns_string.is_null() && !ns_url.is_null() {
                for p in paths {
                    let Ok(c) = CString::new(p.as_os_str().as_bytes()) else { continue };
                    let s = msg_str(ns_string, utf8, c.as_ptr());
                    let url = if s.is_null() { s } else { msg_id(ns_url, file_url, s) };
                    if !url.is_null() {
                        let mut err: Id = std::ptr::null_mut();
                        msg_trash(manager, trash, url, std::ptr::null_mut(), &mut err);
                    }
                }
            }
            (o.pool_pop)(pool);
        }
    }
    paths.iter().filter(|p| std::fs::symlink_metadata(p).is_err()).cloned().collect()
}

#[allow(dead_code)] // même forme que win.rs ; seul Failed existe ici
pub enum ElevatedRun {
    Done(u32),
    Refused,
    Failed(String),
}

pub fn run_self_elevated(_args: &str) -> ElevatedRun {
    ElevatedRun::Failed(NO_ADMIN.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_queries_work() {
        let d = disk(&system_drive()).expect("boot volume readable");
        assert!(d.total > 0 && d.free <= d.total);
        assert_eq!(fixed_drives().len(), 1);
        assert!(running_processes().iter().any(|p| p == "launchd"));
    }
    #[test]
    #[ignore = "puts a 1-byte file in the real Trash; run with --ignored"]
    fn recycle_sends_to_trash_and_reports() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("kubeclean-trash-test.txt");
        std::fs::write(&f, "x").unwrap();
        let gone = recycle(&[f.clone()]);
        assert_eq!(gone, vec![f.clone()]);
        assert!(!f.exists());
    }
}
