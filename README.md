# KubeClean

Nettoyeur de disque pour Windows : caches, fichiers temporaires, dossiers de compilation
(`node_modules`, `target`, `.venv`…), gros fichiers et vieux téléchargements.

- `core/` : moteur Rust (`kubeclean-core.exe`). Analyse et nettoyage, JSON lines sur
  stdin/stdout, événements en direct (`progress`, `rule`).
- `app/` : interface Electron + Svelte 5, kit de design Kube. Tableau de bord, nettoyage
  par catégories avec révélation en direct pendant l'analyse, panneau de détails par règle,
  vues Projets et Fichiers personnels, écran de progression et de résultat, historique,
  réglages, palette de commandes (Ctrl K), thèmes clair et sombre.
- `legacy/` : première version (Node.js + page web locale).

## Lancer

Prérequis : Rust (MSVC), Node.js 22.12 ou plus.

```
KubeClean.cmd
```

ou, dans `app/` : `npm install` puis `npm start`. Installeur Windows ARM64 : `npm run dist`.

## Développer l'interface

- `KC_MOCK=1 npx electron .` : moteur factice (`app/scripts/mock-core.mjs`), mêmes formes de
  données, aucun accès au disque. Un « nettoyage » n'y supprime rien.
- `node scripts/shot.mjs <dossier> <étapes…>` : lance l'app sur le moteur factice et enregistre
  des captures (vues, thèmes, taille de fenêtre, `doclean` pour dérouler un nettoyage factice).
  `KC_REAL=1` utilise le moteur réel en analyse seule ; `doclean` y est refusé.
- `npm run check` : svelte-check. `npm run icon` : régénère l'icône depuis le sprite du kit.
- Références : `app/docs/BRIEF.md` (direction de design, contrat d'état), `app/docs/kube.md`
  (inventaire du kit), `app/docs/REVIEW.md` (revue design).

## Sécurité

- L'analyse ne modifie rien. Chaque élément est revérifié juste avant d'être touché.
- Les liens (jonctions, liens symboliques) ne sont jamais suivis.
- Les fichiers personnels ne sont jamais cochés d'office et partent à la Corbeille.
- Les tâches administrateur passent par l'invite UAC de Windows, avec une liste fermée de tâches.

Tests du moteur : `cargo test` dans `core/`.
