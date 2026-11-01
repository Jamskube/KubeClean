# KubeClean

Nettoyeur de disque pour Windows : caches, fichiers temporaires, dossiers de compilation
(`node_modules`, `target`, `.venv`…), gros fichiers et vieux téléchargements.

- `core/` : moteur Rust (`kubeclean-core.exe`), analyse et nettoyage, parle en JSON lines sur stdin/stdout.
- `app/` : interface Electron + Svelte 5, avec le kit Kube.
- `legacy/` : première version (Node.js + page web locale).

## Lancer

Prérequis : Rust (MSVC), Node.js 22.12 ou plus.

```
KubeClean.cmd
```

ou, dans `app/` : `npm install` puis `npm start`. Installeur Windows ARM64 : `npm run dist`.

## Sécurité

- L'analyse ne modifie rien. Chaque élément est revérifié juste avant d'être touché.
- Les liens (jonctions, liens symboliques) ne sont jamais suivis.
- Les fichiers personnels ne sont jamais cochés d'office et partent à la Corbeille.
- Les tâches administrateur passent par l'invite UAC de Windows, avec une liste fermée de tâches.

Tests du moteur : `cargo test` dans `core/`.
