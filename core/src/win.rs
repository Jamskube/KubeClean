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
