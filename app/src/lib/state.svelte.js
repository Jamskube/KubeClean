// App state. The Rust core owns the truth (scans, settings, history); this only
// mirrors it and keeps the user's selection.
import { fmt, plural } from './fmt.js';

const kc = window.kc;
const toast = (o) => window.Kube?.toast?.(o);

export const CATS = [
  { id: 'system', label: 'Windows', icon: 'monitor' },
  { id: 'browsers', label: 'Navigateurs', icon: 'globe' },
  { id: 'apps', label: 'Applications', icon: 'app-window' },
  { id: 'dev', label: 'Outils de dev', icon: 'code-xml' },
  { id: 'projects', label: 'Projets', icon: 'folder-code' },
  { id: 'files', label: 'Fichiers personnels', icon: 'file-archive' },
  { id: 'admin', label: 'Système (admin)', icon: 'shield' },
];

/** rules whose items can be ticked one by one */
export const pickable = (r) => r.kind !== 'elevated' && r.kind !== 'recycleBin';

class App {
  view = $state('clean'); // clean | history | settings
  scan = $state.raw(null); // last scan result
  drives = $state.raw([]);
  busy = $state(''); // '' | scan | clean
  progress = $state.raw(null);
  /** rule id -> { all, set: {index: size} }: all=true means "everything except set" */
  sel = $state({});
  panel = $state(null); // rule id shown in the side panel
  settings = $state.raw(null);
  history = $state.raw([]);
  version = $state('');

  constructor() {
    kc.onEvent((m) => {
      if (m.event === 'progress') this.progress = m.data;
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
      this.drives = h.drives;
      this.settings = await kc.call('settings.get');
      this.history = await kc.call('history');
    } catch (e) {
      toast({ title: 'Le moteur ne répond pas', description: e.message, tone: 'danger' });
    }
    this.runScan();
  }

  rules(cat) {
    return (this.scan?.rules ?? []).filter((r) => r.cat === cat);
  }
  rule(id) {
    return this.scan?.rules.find((r) => r.id === id);
  }

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
  get picked() {
    return (this.scan?.rules ?? []).filter((r) => this.state(r) !== 'off');
  }
  get picks() {
    return this.picked.map((r) => {
      const s = this.sel[r.id];
      const idx = Object.keys(s.set).map(Number);
      return s.all ? { rule: r.id, all: true, except: idx } : { rule: r.id, all: false, only: idx };
    });
  }
  get total() {
    return this.picked.reduce((a, r) => a + this.selSize(r), 0);
  }
  catTotal(cat) {
    return this.rules(cat).reduce((a, r) => a + r.size, 0);
  }

  // ---------- actions ----------
  async runScan() {
    if (this.busy) return;
    this.busy = 'scan';
    this.progress = null;
    try {
      const r = await kc.call('scan');
      this.#reset(r.rules);
      this.scan = r;
      this.drives = r.drives;
      this.settings = r.settings;
      if (this.panel && !this.rule(this.panel)) this.panel = null;
    } catch (e) {
      toast({ title: e.message === 'analyse annulée' ? 'Analyse annulée' : "L'analyse a échoué", description: e.message === 'analyse annulée' ? '' : e.message, tone: e.message === 'analyse annulée' ? undefined : 'danger' });
    } finally {
      this.busy = '';
      this.progress = null;
    }
  }

  cancel() {
    kc.call('cancel').catch(() => {});
  }

  async clean() {
    const picks = this.picks;
    if (!picks.length || this.busy) return;
    this.busy = 'clean';
    this.progress = null;
    this.panel = null;
    kc.setCleaning(true);
    try {
      const rep = await kc.call('clean', { picks });
      report(rep);
      this.history = await kc.call('history');
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

  async saveSettings(s) {
    this.settings = await kc.call('settings.set', s);
  }
}

function report(rep) {
  const parts = [];
  if (rep.diskGain > 0) parts.push(`Espace libre gagné : ${fmt(rep.diskGain)}.`);
  if (rep.recycled) parts.push(`${plural(rep.recycled, 'élément envoyé', 'éléments envoyés')} à la Corbeille.`);
  if (rep.skipped) parts.push(`${plural(rep.skipped, 'élément laissé', 'éléments laissés')} en place (ouverts, protégés ou modifiés depuis l'analyse).`);
  if (rep.elevation === 'refused') parts.push("Les tâches administrateur n'ont pas été lancées : autorisation refusée.");
  else if (rep.elevation) parts.push(`Tâches administrateur : ${rep.elevation}.`);
  for (const t of rep.tasks ?? []) if (!t.ok) parts.push(`${t.task} : ${t.error}`);
  toast({ title: `${fmt(rep.freed)} libérés`, description: parts.join(' '), tone: 'success', duration: 12000 });
}

export const S = new App();
