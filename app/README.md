# app

## Purpose
Interface Electron + Svelte 5 qui pilote `kubeclean-core.exe`.

## Files
| File | Purpose |
|---|---|
| `electron/main.mjs` | Processus principal, lance le moteur |
| `electron/preload.cjs` | Pont IPC vers la page |
| `src/` | Vues Svelte (`App`, `Dashboard`, `CleanView`, `Projects`, `Files`, `History`, `Settings`…) et `lib/` |
| `scripts/mock-core.mjs` | Moteur factice (`KC_MOCK=1`) |
| `scripts/shot.mjs` | Captures automatisées |
| `scripts/make-icon.mjs` | Génère l'icône (`npm run icon`) |
| `docs/` | `BRIEF.md` (design, contrat d'état), `kube.md` (kit), `REVIEW.md` (revue) |
| `public/kube/` | Kit de design Kube |

## Dependencies
- Internal: `../core` (binaire empaqueté en `extraResources`)
- External: electron, electron-builder, svelte, vite
