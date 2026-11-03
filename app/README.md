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
| `build/icon-master.png` | Source détourée du modèle 13 choisi : anneau métallique et flèche ; brief dans `build/icon-design.md` |
| `public/icon.png`, `build/icon.png`, `build/icon.ico` | Déclinaisons pour l’interface, la fenêtre et l’installeur Windows |
| `build/icon-mac.png` | Icône macOS à la grille Apple (tuile de 824 px sur 1024), générée par `npm run icon` |
| `docs/` | `BRIEF.md` (design, contrat d'état), `kube.md` (kit), `REVIEW.md` (revue) |
| `public/kube/` | Kit de design Kube |

## Dependencies
- Internal: `../core` (binaire empaqueté en `extraResources`)
- External: electron, electron-builder, svelte, vite

## Interface et vérification

Le kit Kube et les surfaces liquid glass sont conservés. Le tableau de bord sépare
les recommandations, les éléments à examiner et les mesures actuelles des disques.
Le montant recommandé correspond toujours au raccourci de nettoyage, même après
une sélection personnalisée. Aucun gain estimé tous volumes confondus n’est ajouté
au seul disque C:.

La coque partage un fond entre la barre de titre et le rail d’icônes. La barre de
titre conserve les commandes, sans répéter le nom ni l’icône de l’application. Le panneau
central et la barre latérale épinglée forment un cadre arrondi commun. Le seul
bouton de repli est dans la barre de titre. La navigation entre pages appartient
au rail d’icônes ; le panneau « Mon espace » présente la dernière analyse, la
sélection et ses destinations (`SidebarSummary.svelte`), les catégories et les
disques. On peut actualiser l’analyse ou vérifier la sélection depuis ce panneau.
Uniquement lorsque la barre latérale est repliée, chaque icône du rail ouvre au
survol un aperçu propre à sa page
(`RailPreview.svelte`) : analyse, sélection
de nettoyage, projets, fichiers personnels, bilans récents ou apparence.
Ces panneaux occupent toute la hauteur sous la barre de titre, sauf Réglages :
son aperçu compact reste ancré à son icône avec le thème et les critères essentiels.
L’en-tête et les actions des panneaux restent fixes ; seul le contenu
défile. Sans bouton de fermeture, ils restent ouverts au survol de l’icône ou du
panneau et disparaissent à la sortie ; déployer la barre latérale les ferme également.
Nettoyage, projets et fichiers disposent d’une recherche insensible aux accents.
Les projets, fichiers et bilans sont affichés par lots de 24, avec un bouton pour
charger la suite.
Les disques montrent leur occupation ; les projets détaillent les dossiers
générés. La page Réglages conserve le détail des emplacements et exclusions.
Les actions de ces aperçus ne changent pas la page courante ; le nettoyage passe
par le dialogue de confirmation habituel. Un clic sur l’icône ou « Ouvrir la page »
navigue. Flèche droite entre dans l’aperçu au clavier ; Échap le ferme.
L’en-tête de la vue reste fixe et le contenu s’efface progressivement dessous.
Sur Nettoyage, le fond, le flou et le fondu de l’en-tête sticky couvrent toute la
largeur du panneau, tandis que les titres, filtres et actions restent alignés
avec la colonne de contenu.
Les transitions, le redimensionnement et la mémorisation utilisent le runtime Kube.

- `npm run icon` : compose le motif sur une tuile blanche, vérifie l’absence de
  tache au centre et régénère les PNG et l’ICO (16, 24, 32, 48, 64, 128, 256 px).
- `npm run check` puis `npm run build` : vérifie Svelte et compile l’interface.
- `node scripts/shot.mjs <sortie> wait:scan dashboard doclean` : parcours simulé.
- `KC_MOCK_DATA=worst` : noms longs, six lecteurs et volumes en To.
- Le harnais accepte `assert:<expression JS sans espace ni virgule>` et échoue en cas
  d’assertion fausse ou de délai dépassé. Les captures utilisent un facteur 1.
  `hover:<sélecteur>`, `key:Escape` et `scroll:<pixels>` vérifient les interactions.
  `fill:<sélecteur>=<texte>` vérifie la recherche par une saisie réelle.
- Mica reste actif en production ; il est désactivé en mode factice pour rendre
  les captures indépendantes du fond du bureau.

L’icône de fenêtre est chargée depuis `dist/`, également présent dans l’application
empaquetée. `npm run dist` construit l’installeur ARM64 avec `build/icon.ico`.

Sur Mac, la fenêtre porte le matériau macOS « sidebar » (`vibrancy`) : `data-window-backdrop="glass"` rend la coque et la barre latérale translucides sous une teinte dense, le panneau principal reste opaque. Les catégories, textes et raccourcis (⌘, ⌥) suivent `MAC` / `OS` dans `src/lib/state.svelte.js`. Le .dmg est construit sur un vrai Mac par `.github/workflows/macos.yml`.
