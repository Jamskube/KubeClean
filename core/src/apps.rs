//! Applications installées : liste (dernière ouverture, taille, plantages), désinstallation,
//! éléments d'ouverture de session, mises à jour. Rien ici ne s'exécute pendant une analyse.

use serde::Serialize;

#[cfg_attr(windows, path = "apps/win.rs")]
#[cfg_attr(target_os = "macos", path = "apps/mac.rs")]
mod sys;
pub use sys::{leftovers, list, set_startup, startup, trash_leftovers, uninstall, updates, upgrade};
#[cfg(target_os = "macos")]
pub use sys::reset;

/// Fenêtre de comptage des plantages et blocages.
pub const CRASH_DAYS: i64 = 30;
pub const DAY: i64 = 86_400_000;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub id: String,
    pub name: String,
    pub publisher: Option<String>,
    pub version: Option<String>,
    pub size: u64,
    /// Données de l'appli hors de son dossier (Mac : ce que « Réinitialiser » enverrait à la Corbeille).
    pub data: u64,
    pub installed: Option<i64>,
    /// Dernière ouverture connue ; None = aucune trace (ce qui n'est pas « jamais »).
    pub last_used: Option<i64>,
    pub crashes: u32,
    pub hangs: u32,
    pub kind: &'static str, // "app" | "store" | "mac"
    /// Fichier dont l'interface tire l'icône (exe, .app).
    pub icon: Option<String>,
    pub running: bool,
    /// Pilote, environnement d'exécution… : listé, jamais proposé comme inutilisé.
    pub system: bool,
}

#[derive(Serialize)]
pub struct Listing {
    pub apps: Vec<App>,
    /// false : le système ne note pas les ouvertures, aucune appli ne peut être dite inutilisée.
    pub tracking: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    pub id: String,
    pub name: String,
    pub command: String,
    pub enabled: bool,
    /// false : réservé à l'administrateur, montré seulement.
    pub editable: bool,
    pub scope: &'static str, // "user" | "machine"
    pub icon: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub id: String,
    pub name: String,
    pub version: String,
    pub available: String,
}

/// Jours depuis 1970 d'une date civile (algorithme de H. Hinnant).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// « 20240131 » ou « 2024-01-31 12:00:00 +0000 » -> ms (heure ignorée : un jour suffit ici).
pub fn date_ms(s: &str) -> Option<i64> {
    let d: String = s.chars().filter(char::is_ascii_digit).take(8).collect();
    if d.len() != 8 {
        return None;
    }
    let (y, m, day) = (d[..4].parse().ok()?, d[4..6].parse().ok()?, d[6..8].parse().ok()?);
    ((1990..=2100).contains(&y) && (1..=12).contains(&m) && (1..=31).contains(&day)).then(|| days_from_civil(y, m, day) * DAY)
}

/// Mots d'un nom qui désignent un composant plutôt qu'une appli qu'on ouvre.
pub fn is_system_name(name: &str) -> bool {
    const W: &[&str] = &[
        "redistributable", "runtime", "driver", "pilote", "sdk", "webview2", "update health", ".net", "visual c++", "directx", "chipset", "firmware",
        "framework", "windows app", "microsoft edge", "bonjour", "vcredist", "language pack", "module de langue",
    ];
    let n = name.to_lowercase();
    W.iter().any(|w| n.contains(w))
}

/// Identifiant winget : rien qui puisse devenir une option ou un chemin.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn valid_package_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && !id.starts_with('-') && id.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_and_names() {
        assert_eq!(date_ms("20000301"), Some(11_017 * DAY));
        assert_eq!(date_ms("20240131"), Some(days_from_civil(2024, 1, 31) * DAY));
        assert_eq!(date_ms("2024-01-31 12:00:00 +0000"), date_ms("20240131"));
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(date_ms("2024"), None);
        assert_eq!(date_ms("20241340"), None);
        assert!(is_system_name("Microsoft Visual C++ 2015-2022 Redistributable (x64)"));
        assert!(!is_system_name("Spotify"));
        assert!(valid_package_id("Spotify.Spotify"));
        assert!(valid_package_id("Microsoft.VisualStudioCode"));
        assert!(!valid_package_id("--force"));
        assert!(!valid_package_id("a b"));
        assert!(!valid_package_id(r"..\x"));
    }
}
