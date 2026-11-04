// App state. The Rust core owns the truth (scans, settings, history); this mirrors
// it and keeps the user's selection. Views read `S`, never window.kc directly.
import { fmt, plural } from './fmt.js';

const kc = window.kc;
/** macOS: its own categories, words and window chrome */
export const MAC = kc.platform === 'darwin';
export const OS = MAC
  ? { name: 'macOS', inFinder: 'dans le Finder', mod: '⌘', alt: '⌥' }
  : { name: 'Windows', inFinder: 'dans l’Explorateur', mod: 'Ctrl', alt: 'Alt' };
export const SEP = MAC ? '/' : '\\';
export const toast = (o) => window.Kube?.toast?.(o);

// `series` = kit chart series (--k-chart-N), the ONE color of a category everywhere
// (sidebar bars, breakdowns, history, result). 6 = yellow is kept for the tiny admin
// slice because it turns ochre in the light theme.
const WIN_CATS = [
  { id: 'system', label: 'Windows', icon: 'monitor', blurb: 'Temporaires, rapports, caches système', series: 1 },
  { id: 'browsers', label: 'Navigateurs', icon: 'globe', blurb: 'Caches de Chrome, Edge, Brave, Firefox', series: 2 },
  { id: 'apps', label: 'Applications', icon: 'app-window', blurb: 'Teams, VS Code, WhatsApp, Spotify…', series: 3 },
  { id: 'dev', label: 'Outils de dev', icon: 'code-xml', blurb: 'npm, Cargo, Gradle, pip, Claude…', series: 4 },
  { id: 'projects', label: 'Projets', icon: 'folder-code', blurb: 'node_modules, target, .venv…', series: 5 },
  { id: 'files', label: 'Fichiers personnels', icon: 'file-archive', blurb: 'Gros fichiers, installeurs, vieux téléchargements', series: 7 },
  { id: 'admin', label: 'Système (admin)', icon: 'shield', blurb: 'Tâches Windows avec élévation', series: 6 },
];
// no developer tools, projects or admin tasks on the Mac: its rules (core/rules/macos.json) have none
const MAC_CATS = [
  { id: 'system', label: 'macOS', icon: 'laptop', blurb: 'Caches, journaux, mises à jour d’iPhone', series: 1 },
  { id: 'browsers', label: 'Navigateurs', icon: 'globe', blurb: 'Caches de Chrome, Edge, Brave, Firefox', series: 2 },
  { id: 'apps', label: 'Applications', icon: 'app-window', blurb: 'Slack, Discord, Spotify, Telegram…', series: 3 },
  { id: 'files', label: 'Fichiers personnels', icon: 'file-archive', blurb: 'Gros fichiers, installeurs, vieux téléchargements', series: 7 },
];
export const CATS = MAC ? MAC_CATS : WIN_CATS;
/** CSS color of a category, same in every view */
export const catColor = (id) => `var(--k-chart-${CATS.find((c) => c.id === id)?.series ?? 1})`;
/** display names of processes reported in `blockedBy` */
export const APP_NAMES = { 'google chrome': 'Chrome', 'microsoft edge': 'Edge', 'brave browser': 'Brave', explorer: 'Explorateur', chrome: 'Chrome', msedge: 'Edge', brave: 'Brave', firefox: 'Firefox', 'ms-teams': 'Teams', teams: 'Teams', code: 'VS Code', telegram: 'Telegram', spotify: 'Spotify', steam: 'Steam', onedrive: 'OneDrive' };
export const appName = (p) => APP_NAMES[p.toLowerCase()] ?? p;
export const VIEWS = ['dashboard', 'clean', 'projects', 'files', 'apps', 'space', 'history', 'settings', 'result'];

/** rules whose items can be ticked one by one */
export const pickable = (r) => r.kind !== 'elevated' && r.kind !== 'recycleBin';

const THEME_KEY = 'kubeclean:theme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } };

class App {
  view = $state('dashboard');
  sidebarOpen = $state(true);
  theme = $state(readTheme()); // system | light | dark
  scan = $state.raw(null); // last complete scan result {rules, drives, at, settings}
  scanMs = $state(0); // how long the last scan took
  live = $state.raw([]); // RuleSummary[] revealed during the running scan
  drives = $state.raw([]);
  busy = $state(''); // '' | scan | clean
  progress = $state.raw(null); // {phase, done, total, label, freed?}
  progressAt = 0; // time of the last progress event, for the stalled-scan hint (not reactive)
  runMini = $state(false); // clean progress reduced to a corner card: the app stays navigable
  /** rule id -> { all, set: {index: size} }: all=true means "everything except set" */
  sel = $state({});
  panel = $state(null); // rule id shown in the side panel
  cleanFilter = $state('all'); // CleanView filter: all | checked | review | empty (other views may preset it)
  confirm = $state(false); // confirm dialog open
  lastReport = $state.raw(null); // {rep, at, before, after, picked:[{id,title,cat,size}]}
  settings = $state.raw(null);
  history = $state.raw([]);
  version = $state(''); // engine
  appVersion = $state('');

  constructor() {
    this.applyTheme();
    document.documentElement.dataset.platform = MAC ? 'mac' : 'win';
    kc.onBackdrop((b) => { document.documentElement.dataset.windowBackdrop = b; });
    kc.onEvent((m) => {
      if (m.event === 'progress') { this.progress = m.data; this.progressAt = Date.now(); }
      else if (m.event === 'rule') this.live = [...this.live, m.data];
      else if (m.event === 'core-exit') {
        this.busy = '';
        toast({ title: "Le moteur s'est arrêté", description: `Il redémarre à la prochaine action (${m.data}).`, tone: 'danger' });
      }
    });
  }

  async start() {
    try {
      const h = await kc.call('hello');
      this.version = h.version;
      this.appVersion = await kc.appVersion();
      this.drives = h.drives;
      this.settings = await kc.call('settings.get');
      this.history = await kc.call('history');
    } catch (e) {
      toast({ title: 'Le moteur ne répond pas', description: e.message, tone: 'danger' });
    }
    this.runScan();
  }

  // ---------- theme ----------
  setTheme(t) {
    this.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    // cross-fade the switch instead of a hard brightness jump (no-op where unsupported)
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => this.applyTheme());
    else this.applyTheme();
  }
  applyTheme() {
    const root = document.documentElement;
    if (this.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.theme);
    kc.setTheme(this.theme);
  }

  // ---------- reading the scan ----------
  get rules() { return this.scan?.rules ?? []; }
  rulesOf(cat) { return this.rules.filter((r) => r.cat === cat); }
  rule(id) { return this.rules.find((r) => r.id === id); }
  /** bytes found per category, for the breakdown */
  catTotal(cat) { return this.rulesOf(cat).reduce((a, r) => a + r.size, 0); }
  catSelected(cat) { return this.rulesOf(cat).reduce((a, r) => a + this.selSize(r), 0); }
  get found() { return this.rules.reduce((a, r) => a + r.size, 0); }
  /** bytes the app would tick by itself (safe defaults), for a list of summaries (final or live) */
  static defaultSize(rules) {
    return rules.reduce((a, r) => a + (r.perItem ? r.items.reduce((s, i) => s + (i.default ? i.size : 0), 0) : r.default ? r.size : 0), 0);
  }
  get defaultSize() { return App.defaultSize(this.busy === 'scan' ? this.live : this.rules); }
  get systemDrive() { return this.drives.find((d) => d.root.toUpperCase().startsWith('C:')) ?? this.drives[0]; }
  /** project artifacts grouped by project folder: [{project, name, idleDays, items:[{...item,index}], size}] */
  get projects() {
    const r = this.rule('projects');
    if (!r) return [];
    const map = new Map();
    r.items.forEach((it, index) => {
      const project = it.path.slice(0, it.path.lastIndexOf('\\'));
      const g = map.get(project) ?? { project, name: project.split('\\').pop(), idleDays: it.idleDays, items: [], size: 0 };
      g.items.push({ ...it, index });
      g.size += it.size;
      if (it.idleDays != null && (g.idleDays == null || it.idleDays < g.idleDays)) g.idleDays = it.idleDays;
      map.set(project, g);
    });
    return [...map.values()].sort((a, b) => b.size - a.size);
  }
  /** full item list of a rule, paged from the core (per-item rules already carry all items in `rule.items`) */
  items(ruleId, offset = 0, limit = 200) { return kc.call('items', { rule: ruleId, offset, limit }); }

  // ---------- selection ----------
  #reset(rules) {
    const sel = {};
    for (const r of rules) {
      if (r.perItem) {
        const set = {};
        r.items.forEach((it, i) => { if (it.default) set[i] = it.size; });
        sel[r.id] = { all: false, set };
      } else sel[r.id] = { all: r.default && (r.size > 0 || !r.sizeKnown), set: {} };
    }
    this.sel = sel;
  }
  /** back to what the app pre-ticks (safe defaults) */
  selectDefaults() { this.#reset(this.rules); }
  selectNone() { for (const r of this.rules) this.sel[r.id] = { all: false, set: {} }; }
  state(r) {
    const s = this.sel[r.id];
    if (!s) return 'off';
    const n = Object.keys(s.set).length;
    if (s.all) return n === 0 ? 'on' : n >= r.count ? 'off' : 'mixed';
    return n === 0 ? 'off' : n >= r.count ? 'on' : 'mixed';
  }
  selSize(r) {
    const s = this.sel[r.id];
    if (!s) return 0;
    let sum = 0;
    for (const v of Object.values(s.set)) sum += v;
    return s.all ? Math.max(0, r.size - sum) : sum;
  }
  toggleRule(r) {
    this.sel[r.id] = this.state(r) === 'on' ? { all: false, set: {} } : { all: true, set: {} };
  }
  itemOn(r, i) {
    const s = this.sel[r.id];
    return !!s && (s.all ? !(i in s.set) : i in s.set);
  }
  toggleItem(r, i, size) {
    const s = this.sel[r.id];
    if (i in s.set) delete s.set[i];
    else s.set[i] = size;
  }
  get picked() { return this.rules.filter((r) => this.state(r) !== 'off'); }
  get picks() {
    return this.picked.map((r) => {
      const s = this.sel[r.id];
      const idx = Object.keys(s.set).map(Number);
      return s.all ? { rule: r.id, all: true, except: idx } : { rule: r.id, all: false, only: idx };
    });
  }
  get total() { return this.picked.reduce((a, r) => a + this.selSize(r), 0); }
  /** what the user picked, split the way the confirm dialog and the result screen explain it */
  get pickedGroups() {
    const p = this.picked;
    return {
      permanent: p.filter((r) => !r.toRecycle && !r.needsAdmin),
      recycle: p.filter((r) => r.toRecycle),
      admin: p.filter((r) => r.needsAdmin),
    };
  }

  // ---------- actions ----------
  async runScan() {
    if (this.busy) return;
    this.busy = 'scan';
    this.progress = null;
    this.live = [];
    const t0 = performance.now();
    // macOS suspend la lecture de Bureau, Documents ou Téléchargements tant que sa demande d'accès attend une réponse
    this.progressAt = Date.now();
    const stall = MAC && setInterval(() => {
      if (Date.now() - this.progressAt < 10_000) return;
      clearInterval(stall);
      toast({ title: 'L’analyse attend peut-être ta permission', description: 'Si macOS demande l’accès à Bureau, Documents ou Téléchargements, réponds à sa fenêtre : l’analyse reprend aussitôt. Tu peux aussi l’annuler.' });
    }, 1000);
    try {
      const r = await kc.call('scan');
      this.scanMs = performance.now() - t0;
      this.#reset(r.rules);
      this.scan = r;
      this.drives = r.drives;
      this.settings = r.settings;
      if (this.panel && !this.rule(this.panel)) this.panel = null;
    } catch (e) {
      if (e.message === 'analyse annulée') toast({ title: 'Analyse annulée' });
      else toast({ title: "L'analyse a échoué", description: e.message, tone: 'danger' });
    } finally {
      clearInterval(stall);
      this.busy = '';
      this.progress = null;
    }
  }

  cancel() { kc.call('cancel').catch(() => {}); }

  /** dashboard shortcut: safe defaults, then the usual confirmation */
  quickClean() {
    this.selectDefaults();
    this.confirm = true;
  }

  async clean() {
    const picks = this.picks;
    if (!picks.length || this.busy) return;
    const picked = this.picked.map((r) => ({ id: r.id, title: r.title, cat: r.cat, size: this.selSize(r), toRecycle: r.toRecycle, needsAdmin: r.needsAdmin }));
    const before = this.drives;
    this.busy = 'clean';
    this.runMini = false;
    this.progress = null;
    this.panel = null;
    this.confirm = false;
    kc.setCleaning(true);
    try {
      const rep = await kc.call('clean', { picks });
      this.history = await kc.call('history');
      this.drives = await kc.call('drives');
      this.lastReport = { rep, at: Date.now(), before, after: this.drives, picked };
      this.view = 'result';
    } catch (e) {
      toast({ title: 'Le nettoyage a échoué', description: e.message, tone: 'danger' });
    } finally {
      kc.setCleaning(false);
      this.busy = '';
      this.progress = null;
    }
    this.runScan(); // a clean always ends on a fresh measurement
  }

  async ignore(path) {
    try {
      this.settings = await kc.call('ignore.add', { path });
      toast({ title: 'Ne sera plus proposé', description: path, tone: 'success' });
    } catch (e) {
      toast({ title: "Impossible d'ignorer ce chemin", description: e.message, tone: 'danger' });
    }
  }
  async unignore(path) {
    this.settings = await kc.call('ignore.remove', { path });
  }
  async saveSettings(s) {
    this.settings = await kc.call('settings.set', s);
    return this.settings;
  }
  reveal(path) { kc.reveal(path); }
  pickFolder() { return kc.pickFolder(); }
}

/** human summary of a CleanReport, shared by the toast and the result screen */
export function describeReport(rep) {
  const parts = [];
  if (rep.diskGain > 0) parts.push(`Espace libre gagné : ${fmt(rep.diskGain)}.`);
  if (rep.recycled) parts.push(`${plural(rep.recycled, 'élément envoyé', 'éléments envoyés')} à la Corbeille.`);
  if (rep.skipped) parts.push(`${plural(rep.skipped, 'élément laissé', 'éléments laissés')} en place (ouverts, protégés ou modifiés depuis l’analyse).`);
  if (rep.elevation === 'refused') parts.push("Les tâches administrateur n'ont pas été lancées : autorisation refusée.");
  else if (rep.elevation) parts.push(`Tâches administrateur : ${rep.elevation}.`);
  for (const t of rep.tasks ?? []) if (!t.ok) parts.push(`${t.task} : ${t.error}`);
  return parts;
}

export const S = new App();
