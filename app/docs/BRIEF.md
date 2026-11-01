# KubeClean v2 — brief front-end

KubeClean est un nettoyeur de disque Windows. Moteur Rust (`core/`), interface
Electron + **Svelte 5 (runes)** + Vite dans `app/`, habillée avec le kit de design
**Kube** (`app/public/kube/kube.css`, `kube.js`, sprite d'icônes). Référence
complète du kit : `app/docs/kube.md`. Lis-la avant d'écrire une ligne de balisage.

La v1 de l'interface fonctionne mais est minimaliste. L'objectif est une
application **premium** : dense mais aérée, calme, précise, vivante (chiffres qui
roulent, résultats qui se révèlent pendant l'analyse, transitions courtes), au
niveau de Linear, Raycast ou Arc. Tout en français (tutoiement, comme le reste).

## Direction de design (commune à tous)

- **Uniquement les tokens Kube.** Aucune couleur en dur : `var(--surface)`,
  `--surface-under`, `--ink`, `--ink-secondary`, `--ink-tertiary`, `--fill-*`,
  `--border*`, `--accent`, `--success`, `--warning`, `--danger` et leurs `-subtle`,
  radii `--radius-*`, espacements `--space-*`, ombres, durées (voir kube.md §1).
  Les deux thèmes (clair/sombre) doivent être impeccables ; le thème est posé par
  `data-theme="light|dark"` sur `<html>` (absent = système).
- **Composants Kube d'abord.** Avant d'inventer un style, cherche le composant du
  kit (kube.md §3) : Card, StatusPill, Badge, PulseDot, Shimmer, Skeleton,
  Timeline, WorkflowSteps, HoverReveal, PressFeedback, Tooltip, Kbd, Glass,
  AmbientGlow, SegmentedControl, Tabs, Menu, Popover, Sheet, Banner, EmptyState,
  Table, List, FileIcon, FileName, Progress, Spinner, Toast, Dialog, Typography…
  Les classes `kc-*` servent pour la mise en page spécifique à l'app, pas pour
  redéfinir ce que le kit fait déjà. Les comportements `data-kube="…"` sont
  initialisés automatiquement par `kube.js` (MutationObserver) : pose l'attribut
  et le balisage exact, le runtime fait le reste.
- **Icônes : uniquement le sprite** via le composant `src/lib/Icon.svelte`
  (`<Icon name="hard-drive" />`). Ids disponibles : kube.md §4. Jamais de SVG
  inline inventé, jamais d'emoji.
- **Chiffres :** tous les chiffres importants passent par
  `src/lib/ui/Num.svelte` (`<Num value={bytes} kind="bytes|int|percent" />`),
  qui tween vers la nouvelle valeur. Chiffres tabulaires partout
  (`font-variant-numeric: tabular-nums`). Formats via `src/lib/fmt.js` :
  `fmt(bytes)` → « 1,4 Go », `int(n)`, `plural(n, 'un', 'des')`, `date(ms)`,
  `idle(days)`, `drive(root)` → « C: ».
- **Mouvement :** court et utile. Entrées de listes en cascade
  (`transition:fly={{ y: 6, duration: 220, delay: i * 25 }}` ou les classes
  Transitions du kit), jamais plus de 300 ms, jamais de rebond gratuit.
  Respecter `prefers-reduced-motion` (le kit le fait pour ses composants ; pour
  tes transitions Svelte, mets la durée à 0 si `matchMedia('(prefers-reduced-motion: reduce)').matches`).
- **Typographie française :** espace insécable avant « : », « ? », « ! », « ; »
  (`&nbsp;` ou `\u00a0`), guillemets « », apostrophes typographiques ’ dans les
  textes affichés, « Go/Mo/Ko », « 1,4 » avec virgule (fmt le fait).
- **Accessibilité :** chaque bouton icône a `aria-label`, focus visible (le kit le
  gère), états `aria-pressed`/`aria-current`, `role="progressbar"` avec valeurs,
  dialogues avec `aria-labelledby`. Navigation clavier complète.
- **Fenêtre :** min 880 × 560, cible 1200 × 800 et 1600 × 1000. Rien ne doit
  déborder horizontalement ; les chemins longs se coupent avec
  `overflow-wrap: anywhere` ou le composant FileName du kit.

## Architecture et contrat d'état

Tout passe par `S` dans `src/lib/state.svelte.js` (classe avec runes). Les vues ne
touchent jamais `window.kc`. API :

```
S.view               'dashboard'|'clean'|'projects'|'files'|'history'|'settings'|'result'
S.sidebarOpen        bool
S.theme / S.setTheme('system'|'light'|'dark')
S.scan               dernier scan complet {rules, drives, at, settings} | null
S.scanMs             durée du dernier scan (ms)
S.live               RuleSummary[] révélées au fil de l'analyse en cours (vidé au départ d'un scan)
S.drives             [{root:'C:\\', total, free}]      S.systemDrive
S.busy               '' | 'scan' | 'clean'
S.progress           {phase:'scan'|'clean', done, total, label, freed?} | null
S.rules              RuleSummary[]      S.rulesOf(cat)      S.rule(id)
S.found              octets trouvés (toutes règles)
S.catTotal(cat) / S.catSelected(cat)
S.projects           [{project, name, idleDays, size, items:[{...Item, index}]}] (groupés par projet, triés par taille)
S.items(ruleId, offset, limit) → Promise<{total, items:[{...Item, index}]}>
S.sel                sélection ; S.state(rule) → 'on'|'off'|'mixed' ; S.selSize(rule)
S.toggleRule(rule) ; S.itemOn(rule, index) ; S.toggleItem(rule, index, size)
S.selectDefaults() ; S.selectNone()
S.picked             règles sélectionnées ; S.total octets sélectionnés ; S.pickedGroups {permanent, recycle, admin}
S.panel              id de règle ouverte dans le panneau latéral | null
S.confirm            bool : le dialogue de confirmation est ouvert (rendu par App.svelte)
S.runScan() ; S.cancel() ; S.quickClean() (= selectDefaults + confirm) ; S.clean()
S.lastReport         {rep: CleanReport, at, before: drives, after: drives, picked:[{id,title,cat,size,toRecycle,needsAdmin}]}
S.history            HistoryEntry[] (chronologique) ; S.settings ; S.saveSettings(s) ; S.ignore(path) ; S.unignore(path)
S.reveal(path) (ouvre l'Explorateur) ; S.pickFolder() → Promise<string|null>
toast({title, description?, tone?: 'success'|'warning'|'danger', duration?})   (export de state.svelte.js)
describeReport(rep) → string[] phrases d'explication
CATS  [{id, label, icon, blurb}] ordre d'affichage   pickable(rule)
```

Formes de données (JSON du moteur, camelCase) :

```
RuleSummary { id, cat, title, hint, kind: 'files'|'children'|'recycleBin'|'projects'|'largeFiles'|'oldDownloads'|'elevated',
              perItem, toRecycle, needsAdmin, default, size, count, sizeKnown, blockedBy: string[] (process ouverts, ex. 'chrome'),
              items: Item[] (TOUS les items pour perItem, sinon les 5 plus gros) }
Item        { path, size, newest (ms), isDir, label (ex. 'Node', 'Rust / Maven', ou nb d'éléments pour la Corbeille), idleDays|null, default }
CleanReport { freed, deleted, skipped, recycled, diskGain, byRule: {id: {freed, deleted, skipped}}, tasks: [{task, ok, error, stats}], elevation: null|'refused'|string }
HistoryEntry{ at, freed, diskGain, deleted, skipped, recycled, byCat: {cat: bytes} }
Settings    { projectRoots: string[], projectIdleDays, largeFileMinMb, downloadsOlderThanDays, ignore: string[] }
```

Sémantique à respecter dans les textes : l'analyse ne modifie rien ; chaque
élément est **revérifié juste avant** d'être touché ; les fichiers personnels
(`toRecycle`) ne sont jamais cochés d'office et partent à la **Corbeille** ; les
règles `needsAdmin` déclenchent l'invite UAC de Windows ; `blockedBy` signifie que
les fichiers que l'application ouverte utilise seront laissés en place ;
`sizeKnown:false` = taille inconnue avant élévation ; `idleDays:null` = activité
inconnue (jamais coché d'office).

## Attributs obligatoires (le harnais de captures en dépend)

- Racine `.k-app` : `data-view={S.view} data-busy={S.busy} data-scanned={!!S.scan}`.
- Chaque entrée de navigation vers une vue : `data-view="dashboard"` etc.
- Le bouton principal « Nettoyer » (celui de l'en-tête de la vue Nettoyage **et**
  celui du tableau de bord) : `data-action="clean"`.
- Le bouton de validation du dialogue de confirmation : `data-action="confirm"`.

## Outils

- `npm run build` (vite) et `npx svelte-check` : **0 erreur, 0 avertissement**
  exigés. Le build est rapide (< 1 s) : lance-le souvent.
- **Moteur factice** : `KC_MOCK=1` fait tourner l'app sur `scripts/mock-core.mjs`
  (mêmes formes, données fictives plausibles, progression simulée). Il ne touche
  à aucun fichier : tu peux dérouler un nettoyage complet.
- **Captures** : `node scripts/shot.mjs <dossier-sortie> <étapes…>` lance l'app sur
  le moteur factice et enregistre des PNG. Étapes : `wait:scan`, un nom de vue
  (`dashboard`, `clean`, `projects`, `files`, `history`, `settings`),
  `click:<sélecteur>`, `theme:light|dark`, `size:WxH`, `sleep:<ms>`,
  `shot:<nom>`, `clean` (ouvre la confirmation, valide, attend l'écran de
  résultat ; factice uniquement). Exemple :
  `node scripts/shot.mjs C:\Users\nicos\AppData\Local\Temp\claude\C--Users-nicos-Desktop\0fbbb020-b648-4a57-9599-23a1dc07027d\scratchpad\shots-<ton-nom> wait:scan dashboard theme:light dashboard size:900x600 dashboard`
  **Regarde ensuite tes PNG** (outil Read) et corrige ce qui est faux : c'est ta
  seule preuve. Écris tes captures dans un dossier à ton nom sous le scratchpad
  ci-dessus, pas dans le dépôt.
- **Interdit** : lancer l'app sans `KC_MOCK` (le harnais le pose tout seul), tout
  nettoyage réel, toute modification hors de tes fichiers (voir répartition),
  `git` (l'orchestrateur commite).
- Si tu as besoin d'une donnée que `S` n'expose pas, **n'édite pas
  state.svelte.js** : note le besoin dans ton rapport final, l'orchestrateur
  l'ajoutera. Calcule ce que tu peux côté vue avec `$derived`.

## Répartition des fichiers (propriété exclusive)

| Agent | Fichiers |
|---|---|
| **shell** | `src/App.svelte`, `src/app.css`, `src/Dashboard.svelte`, `src/Palette.svelte` (Ctrl+K), `src/lib/ui/*` sauf `Num.svelte` |
| **clean** | `src/CleanView.svelte`, `src/RulePanel.svelte`, `src/Confirm.svelte`, `src/Running.svelte`, `src/Result.svelte` |
| **projects-files** | `src/Projects.svelte`, `src/Files.svelte` |
| **history-settings** | `src/History.svelte`, `src/Settings.svelte` |

`App.svelte` importe et rend : `Dashboard`, `CleanView`, `Projects`, `Files`,
`History`, `Settings`, `Result` selon `S.view` ; `RulePanel` dans le panneau
latéral (`k-side-panel`, ouvert si `S.panel`) ; `Confirm` (ouvert si `S.confirm`) ;
`Running` en superposition quand `S.busy === 'clean'` ; `Palette`.
Chaque vue est un composant **sans props** qui lit `S`. `RulePanel` prend
`{ id }`. Ces noms et chemins sont le contrat : ne les change pas.
