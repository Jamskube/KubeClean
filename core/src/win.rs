//! Thin wrappers over the Win32 calls the core needs.

use serde::Serialize;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives};
use windows_sys::Win32::System::Com::CoInitializeEx;
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY, REG_DWORD, REG_EXPAND_SZ, REG_SZ, RegCloseKey, RegCreateKeyExW, RegEnumKeyExW,
    RegEnumValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
use windows_sys::Win32::UI::Shell::{
    FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHFILEOPSTRUCTW, SHFileOperationW, SHQUERYRBINFO, SHQueryRecycleBinW,
    ShellExecuteExW,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DRIVE_FIXED: u32 = 3;

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub root: String,
    pub total: u64,
    pub free: u64,
}

pub fn disk(root: &str) -> Option<Drive> {
    let w = wide(OsStr::new(root));
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, &mut total, &mut free) };
    (ok != 0).then(|| Drive { root: root.to_string(), total, free: avail })
}

pub fn fixed_drives() -> Vec<Drive> {
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .filter(|r| unsafe { GetDriveTypeW(wide(OsStr::new(r)).as_ptr()) } == DRIVE_FIXED)
        .filter_map(|r| disk(&r))
        .collect()
}

#[cfg(test)]
pub fn system_drive() -> String {
    format!("{}\\", std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()))
}

/// Lower-case executable names of running processes.
pub fn running_processes() -> Vec<String> {
    let mut out = vec![];
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE || snap.is_null() {
            return out;
        }
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            out.push(String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase());
            ok = Process32NextW(snap, &mut e);
        }
        CloseHandle(snap);
    }
    out.sort();
    out.dedup();
    out
}

/// Size and item count of the Recycle Bin on every drive.
pub fn recycle_bin_info() -> (u64, u64) {
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    let hr = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    if hr < 0 { (0, 0) } else { (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64) }
}

pub fn empty_recycle_bin() -> bool {
    let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) };
    hr >= 0
}

/// Send paths to the Recycle Bin. FOF_WANTNUKEWARNING makes Windows ask the user
/// before destroying anything that cannot be recycled (too large, network drive):
/// nothing is ever deleted for good silently. Returns the paths that are gone.
pub fn recycle(paths: &[PathBuf]) -> Vec<PathBuf> {
    if paths.is_empty() {
        return vec![];
    }
    unsafe { CoInitializeEx(std::ptr::null(), 0x2 /* COINIT_APARTMENTTHREADED */) };
    for chunk in paths.chunks(64) {
        let mut from: Vec<u16> = vec![];
        for p in chunk {
            from.extend(p.as_os_str().encode_wide());
            from.push(0);
        }
        from.push(0); // double-null terminated list
        let mut op: SHFILEOPSTRUCTW = Default::default();
        op.wFunc = FO_DELETE;
        op.pFrom = from.as_ptr();
        op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING) as u16;
        unsafe { SHFileOperationW(&mut op) };
    }
    paths.iter().filter(|p| std::fs::symlink_metadata(p).is_err()).cloned().collect()
}

pub enum ElevatedRun {
    Done(u32),
    Refused,
    Failed(String),
}

/// Run this executable elevated (UAC prompt) with a fixed argument line, wait for it.
pub fn run_self_elevated(args: &str) -> ElevatedRun {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return ElevatedRun::Failed(e.to_string()),
    };
    let verb = wide(OsStr::new("runas"));
    let file = wide(exe.as_os_str());
    let params = wide(OsStr::new(args));
    let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    sei.lpVerb = verb.as_ptr();
    sei.lpFile = file.as_ptr();
    sei.lpParameters = params.as_ptr();
    sei.nShow = 0; // SW_HIDE
    unsafe {
        if ShellExecuteExW(&mut sei) == 0 {
            let err = std::io::Error::last_os_error();
            return if err.raw_os_error() == Some(1223) { ElevatedRun::Refused } else { ElevatedRun::Failed(err.to_string()) };
        }
        if sei.hProcess.is_null() {
            return ElevatedRun::Failed("aucun processus".into());
        }
        WaitForSingleObject(sei.hProcess, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(sei.hProcess, &mut code);
        CloseHandle(sei.hProcess);
        ElevatedRun::Done(code)
    }
}

// ---------- registre ----------

#[derive(Clone, Copy)]
pub enum Hive {
    User,
    Machine,
}

/// Clé de registre ouverte, refermée en sortie de portée.
pub struct RegKey(HKEY);
impl Drop for RegKey {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

fn reg_text(data: &[u8]) -> String {
    let w: Vec<u16> = data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

impl RegKey {
    fn root(h: Hive) -> HKEY {
        match h {
            Hive::User => HKEY_CURRENT_USER,
            Hive::Machine => HKEY_LOCAL_MACHINE,
        }
    }
    pub fn open(hive: Hive, path: &str) -> Option<RegKey> {
        let mut h: HKEY = std::ptr::null_mut();
        let ok = unsafe { RegOpenKeyExW(Self::root(hive), wide(OsStr::new(path)).as_ptr(), 0, KEY_READ, &mut h) } == 0;
        ok.then_some(RegKey(h))
    }
    /// Ouverte en écriture, créée si absente (HKCU seulement : jamais de droits administrateur).
    pub fn create_user(path: &str) -> Option<RegKey> {
        let mut h: HKEY = std::ptr::null_mut();
        let ok = unsafe {
            RegCreateKeyExW(HKEY_CURRENT_USER, wide(OsStr::new(path)).as_ptr(), 0, std::ptr::null(), 0, KEY_READ | KEY_SET_VALUE, std::ptr::null(), &mut h, std::ptr::null_mut())
        } == 0;
        ok.then_some(RegKey(h))
    }
    pub fn subkeys(&self) -> Vec<String> {
        let mut out = vec![];
        let mut buf = [0u16; 512];
        for i in 0..100_000 {
            let mut len = buf.len() as u32;
            let r = unsafe { RegEnumKeyExW(self.0, i, buf.as_mut_ptr(), &mut len, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
            match r {
                0 => out.push(String::from_utf16_lossy(&buf[..len as usize])),
                259 => break, // ERROR_NO_MORE_ITEMS
                _ => {}       // nom trop long : on l'ignore
            }
        }
        out
    }
    /// (nom, type, données brutes) de chaque valeur.
    pub fn values(&self) -> Vec<(String, u32, Vec<u8>)> {
        let mut out = vec![];
        let mut name = vec![0u16; 16_384];
        let mut data = vec![0u8; 4096];
        let mut i = 0;
        while i < 100_000 {
            let (mut nl, mut dl, mut ty) = (name.len() as u32, data.len() as u32, 0u32);
            let r = unsafe { RegEnumValueW(self.0, i, name.as_mut_ptr(), &mut nl, std::ptr::null(), &mut ty, data.as_mut_ptr(), &mut dl) };
            if r == 234 && (dl as usize) > data.len() {
                data.resize(dl as usize, 0); // ERROR_MORE_DATA : même valeur, tampon agrandi
                continue;
            }
            if r != 0 {
                break;
            }
            out.push((String::from_utf16_lossy(&name[..nl as usize]), ty, data[..dl as usize].to_vec()));
            i += 1;
        }
        out
    }
    fn raw(&self, name: &str) -> Option<(u32, Vec<u8>)> {
        let n = wide(OsStr::new(name));
        let (mut ty, mut len) = (0u32, 0u32);
        if unsafe { RegQueryValueExW(self.0, n.as_ptr(), std::ptr::null(), &mut ty, std::ptr::null_mut(), &mut len) } != 0 {
            return None;
        }
        let mut data = vec![0u8; len as usize];
        (unsafe { RegQueryValueExW(self.0, n.as_ptr(), std::ptr::null(), &mut ty, data.as_mut_ptr(), &mut len) } == 0).then(|| {
            data.truncate(len as usize);
            (ty, data)
        })
    }
    pub fn string(&self, name: &str) -> Option<String> {
        let (ty, d) = self.raw(name)?;
        matches!(ty, REG_SZ | REG_EXPAND_SZ).then(|| reg_text(&d)).filter(|s| !s.trim().is_empty())
    }
    pub fn dword(&self, name: &str) -> Option<u32> {
        let (ty, d) = self.raw(name)?;
        (ty == REG_DWORD && d.len() >= 4).then(|| u32::from_le_bytes([d[0], d[1], d[2], d[3]]))
    }
    pub fn set_binary(&self, name: &str, data: &[u8]) -> bool {
        unsafe { RegSetValueExW(self.0, wide(OsStr::new(name)).as_ptr(), 0, REG_BINARY, data.as_ptr(), data.len() as u32) == 0 }
    }
}

pub fn reg_value_text(data: &[u8]) -> String {
    reg_text(data)
}

/// « "C:\x\unins000.exe" /SILENT » -> (fichier, paramètres). Une ligne sans guillemets se coupe
/// après le premier « .exe ». MsiExec /I (modifier) devient /X (désinstaller).
pub fn split_command(cmd: &str) -> Option<(String, String)> {
    let c = cmd.trim();
    let (file, params) = if let Some(rest) = c.strip_prefix('"') {
        let end = rest.find('"')?;
        (rest[..end].to_string(), rest[end + 1..].trim().to_string())
    } else {
        let i = c.to_ascii_lowercase().find(".exe")? + 4;
        (c.get(..i)?.to_string(), c.get(i..)?.trim().to_string())
    };
    let msi = file.to_ascii_lowercase().ends_with("msiexec.exe") || file.eq_ignore_ascii_case("msiexec");
    let params = match params.get(..2) {
        Some(p) if msi && p.eq_ignore_ascii_case("/i") => format!("/X{}", &params[2..]),
        _ => params,
    };
    (!file.is_empty()).then_some((file, params))
}

/// Ouvre un programme comme le ferait l'Explorateur (son propre UAC s'il en demande un), sans attendre.
pub fn launch(file: &str, params: &str) -> Result<(), String> {
    let verb = wide(OsStr::new("open"));
    let f = wide(OsStr::new(file));
    let p = wide(OsStr::new(params));
    let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    sei.fMask = SEE_MASK_NOASYNC;
    sei.lpVerb = verb.as_ptr();
    sei.lpFile = f.as_ptr();
    sei.lpParameters = p.as_ptr();
    sei.nShow = 1; // SW_SHOWNORMAL
    if unsafe { ShellExecuteExW(&mut sei) } == 0 {
        let err = std::io::Error::last_os_error();
        return Err(if err.raw_os_error() == Some(1223) { "désinstallation annulée".into() } else { err.to_string() });
    }
    Ok(())
}

/// Script PowerShell FIXE ; les données passent par l'environnement (jamais dans le source).
pub fn powershell(script: &str, env: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = Command::new(system32(r"WindowsPowerShell\v1.0\powershell.exe"));
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8;{script}")])
        .creation_flags(CREATE_NO_WINDOW);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.lines().find(|l| !l.trim().is_empty()).unwrap_or("PowerShell a échoué").trim().to_string())
    }
}

pub fn command_no_window(exe: &str) -> Command {
    let mut c = Command::new(exe);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

fn system32(exe: &str) -> PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    Path::new(&root).join("System32").join(exe)
}

/// Fixed system commands used by the elevated tasks. No caller data in the line.
pub fn run_dism_component_cleanup() -> Result<(), String> {
    let out = Command::new(system32("Dism.exe"))
        .args(["/Online", "/Cleanup-Image", "/StartComponentCleanup"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(format!("DISM a renvoyé le code {}", out.status.code().unwrap_or(-1))) }
}

pub fn run_delivery_optimization_cleanup() -> Result<(), String> {
    let out = Command::new(system32(r"WindowsPowerShell\v1.0\powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-Command", "Delete-DeliveryOptimizationCache -Force"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(format!("PowerShell a renvoyé le code {}", out.status.code().unwrap_or(-1))) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_queries_work() {
        let d = disk(&system_drive()).expect("system drive readable");
        assert!(d.total > 0 && d.free <= d.total);
        assert!(!fixed_drives().is_empty());
        let procs = running_processes();
        assert!(procs.iter().any(|p| p == "explorer.exe" || p.ends_with(".exe")));
    }
    #[test]
    fn uninstall_commands_split() {
        let s = |c: &str| split_command(c).map(|(f, p)| (f, p));
        assert_eq!(s(r#""C:\Program Files\X\unins000.exe" /SILENT"#), Some((r"C:\Program Files\X\unins000.exe".into(), "/SILENT".into())));
        assert_eq!(s(r"C:\Program Files\Y App\uninstall.exe --remove"), Some((r"C:\Program Files\Y App\uninstall.exe".into(), "--remove".into())));
        assert_eq!(s("MsiExec.exe /I{1234-ABCD}"), Some(("MsiExec.exe".into(), "/X{1234-ABCD}".into())));
        assert_eq!(s("MsiExec.exe /X{1234-ABCD}"), Some(("MsiExec.exe".into(), "/X{1234-ABCD}".into())));
        assert_eq!(s(r#""C:\a.exe""#), Some((r"C:\a.exe".into(), "".into())));
        assert_eq!(s("rundll32 something"), None);
    }
    #[test]
    fn registry_reads_and_lists() {
        let k = RegKey::open(Hive::Machine, r"Software\Microsoft\Windows NT\CurrentVersion").expect("clé système lisible");
        assert!(k.string("ProductName").is_some());
        assert!(RegKey::open(Hive::Machine, r"Software\Microsoft").unwrap().subkeys().iter().any(|s| s.eq_ignore_ascii_case("Windows")));
    }
    #[test]
    #[ignore = "puts a 1-byte file in the real Recycle Bin; run with --ignored"]
    fn recycle_sends_to_bin_and_reports() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("kubeclean-recycle-test.txt");
        std::fs::write(&f, "x").unwrap();
        let gone = recycle(&[f.clone()]);
        assert_eq!(gone, vec![f.clone()]);
        assert!(!f.exists());
    }
}
