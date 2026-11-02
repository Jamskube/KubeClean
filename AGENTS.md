# AGENTS.md

Context for AI coding assistants. Read at the start of every session.

## Stack
- Moteur : Rust 2024 (`core/`, binaire `kubeclean-core.exe`) — rayon, serde_json, windows-sys
- Interface : Electron + Svelte 5 + Vite (`app/`), kit de design Kube
- Protocole : JSON lines sur stdin/stdout entre Electron et le moteur (événements `progress`, `rule`)
- Gestionnaires : cargo, npm (Node 22.12+) · Cible : Windows ARM64 (NSIS via electron-builder)

## Setup commands
- `cd app; npm install`
- `npm start` (dans `app/` : build du moteur + vite build + electron) — ou `KubeClean.cmd` à la racine
- `KC_MOCK=1 npx electron .` : moteur factice, aucun accès disque
- `npm run dist` : installeur `app/release/KubeClean Setup <version>.exe`
- `cargo test` (dans `core/`)
- `npm run check` (svelte-check, dans `app/`)
- `node scripts/shot.mjs <dossier> <étapes…>` : captures sur moteur factice (`KC_REAL=1` = moteur réel, analyse seule)

## Conventions
- Code, commentaires, docs et UI en français
- Commentaires sur le code non évident uniquement
- Un README.md par dossier de premier niveau, tenu à jour
- Svelte 5 runes ; état partagé dans `app/src/lib/state.svelte.js`

## Architecture
| Folder | Purpose |
|---|---|
| `core/` | Moteur Rust : analyse (`scan.rs`), nettoyage (`clean.rs`), règles (`rules.rs`, `rules/default.json`), Windows (`win.rs`) |
| `app/` | Electron (`electron/`), vues Svelte (`src/`), scripts dev (`scripts/`), docs design (`docs/`) |
| `legacy/` | v1 Node.js + page web locale — référence, ne plus faire évoluer |
| `docs/` | Journal de session (`journal/`), pointeur `_next-session.md` |
| `graft/` | Index graft local (non versionné) |

## Patterns
- ALWAYS : l'analyse ne modifie rien ; revérifier chaque élément juste avant de le toucher
- ALWAYS : fichiers personnels jamais cochés d'office, envoyés à la Corbeille
- ALWAYS : tâches administrateur via UAC, liste fermée
- ALWAYS : tester l'UI sur le moteur factice (`KC_MOCK=1`) ; avec le moteur réel, analyse seule
- NEVER : suivre une jonction ou un lien symbolique
- NEVER : lancer un nettoyage réel pour « vérifier » une modification
- NEVER : comparer des chemins Windows en tenant compte de la casse

## Context & compaction
When compacting this session, always preserve: the list of modified files, the exact test/build commands, the current task and its next step.
If `.agent/autopilot/active.json` exists, also preserve its goal ID, status and exact `next_action`; never infer completion from context loss.

## Project knowledge

Detailed records: `docs/agent-knowledge/index.md`. Machine-level lessons: `~/.claude/knowledge/`.
Before non-trivial work, retrieve by task terms and affected paths (`/knowledge search`); load at most 5 records/800 tokens. Pass the capsule to subagents. Subagents never mutate the knowledge store; they return `lesson_candidates` to the coordinator.

### Active critical lessons
<!-- knowledge:generated:start -->
<!-- knowledge:generated:end -->
