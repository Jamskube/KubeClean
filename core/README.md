# core

## Purpose
Moteur Rust `kubeclean-core.exe` : analyse et nettoyage du disque, piloté en JSON lines sur stdin/stdout.

## Files
| File | Purpose |
|---|---|
| `src/main.rs` | Boucle de commandes JSON lines |
| `src/scan.rs` | Analyse (lecture seule), événements `progress` / `rule` |
| `src/clean.rs` | Nettoyage, revérification avant suppression |
| `src/rules.rs` | Chargement des règles |
| `src/fsutil.rs` | Utilitaires fichiers : détection des liens (reparse), dates, variables d’environnement |
| `src/store.rs` | Persistance (historique, réglages) |
| `src/win.rs` | API Windows (Corbeille, UAC, processus, registre) |
| `rules/default.json` | Règles de nettoyage par défaut |

## Dependencies
- External: rayon, serde, serde_json, windows-sys ; tests : tempfile
- Tests : `cargo test`
