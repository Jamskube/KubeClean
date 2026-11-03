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

## Revérification avant nettoyage

Le moteur compare aussi le type, la taille et la date la plus récente de chaque
élément à son état analysé, y compris pour les règles sans limite d’âge et les
fichiers personnels. Un changement entraîne un abandon de cet élément.
Il refuse un chemin dont un ancêtre est devenu une jonction ; l’élagage des
dossiers vides applique la même protection.

Ces contrôles restent conservateurs et fondés sur les métadonnées, sans calcul
d’empreinte du contenu ni garantie atomique contre une modification concurrente.
Les tests travaillent dans des dossiers temporaires. Le test de Corbeille réelle
reste ignoré par défaut.
