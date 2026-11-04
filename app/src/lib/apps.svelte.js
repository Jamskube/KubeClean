// Applications installées, éléments d'ouverture et mises à jour : chargés à la demande, gardés
// entre deux visites de la page. Désinstaller, réinitialiser, mettre à jour : toujours après confirmation.
import { MAC, toast } from './state.svelte.js';

export const DAY = 86_400_000;
/** une appli dont la dernière ouverture connue dépasse ce délai est « inutilisée » */
export const UNUSED_DAYS = 90;

const days = (ms) => Math.floor((Date.now() - ms) / DAY);
export const ago = (ms) => {
  const d = days(ms);
  if (d <= 0) return 'aujourd’hui';
  if (d === 1) return 'hier';
  if (d < 60) return `il y a ${d} jours`;
  if (d < 730) return `il y a ${Math.round(d / 30.4)} mois`;
  return `il y a ${Math.floor(d / 365)} ans`;
};
export const isUnused = (a) => !a.system && a.lastUsed != null && days(a.lastUsed) >= UNUSED_DAYS;
export const isUnstable = (a) => a.crashes + a.hangs > 0;

class Apps {
  list = $state.raw(null); // App[] | null
  tracking = $state(true);
  loading = $state(false);
  startup = $state.raw(null);
  updates = $state.raw(null);
  updatesError = $state('');
  updatesLoading = $state(false);
  leftovers = $state.raw(null); // Mac : [{ id, size, paths }]
  leftoversError = $state('');
  picked = $state({}); // id -> true, jamais rempli d'office
  working = $state({}); // id -> libellé de l'action en cours
  icons = $state({}); // chemin -> data URL | null
  /** un désinstalleur Windows tourne hors de nous : relire la liste quand la fenêtre revient */
  stale = false;

  unused = $derived((this.list ?? []).filter(isUnused).sort((a, b) => b.size + b.data - (a.size + a.data)));
  unstable = $derived((this.list ?? []).filter(isUnstable).sort((a, b) => b.crashes + b.hangs - (a.crashes + a.hangs)));

  constructor() {
    window.addEventListener('focus', () => { if (this.stale) { this.stale = false; this.load(true); } });
  }

  async load(force = false) {
    if (this.loading || (this.list && !force)) return;
    this.loading = true;
    try {
      const r = await kc.call('apps');
      this.list = r.apps;
      this.tracking = r.tracking;
      for (const a of r.apps) this.icon(a.icon);
    } catch (e) {
      toast({ title: 'Impossible de lister les applications', description: e.message, tone: 'danger' });
    } finally {
      this.loading = false;
    }
  }
  icon(path) {
    if (!path || path in this.icons) return;
    this.icons[path] = null;
    kc.fileIcon(path).then((url) => { if (url) this.icons[path] = url; });
  }

  async loadStartup(force = false) {
    if (this.startup && !force) return;
    try {
      this.startup = await kc.call('startup');
      for (const s of this.startup) this.icon(s.icon);
    } catch (e) {
      this.startup = [];
      toast({ title: 'Impossible de lire le démarrage', description: e.message, tone: 'danger' });
    }
  }
  async setStartup(s, enabled) {
    const before = this.startup;
    this.startup = before.map((x) => (x.id === s.id ? { ...x, enabled } : x)); // la bascule suit le doigt
    try {
      await kc.call('startup.set', { id: s.id, enabled });
    } catch (e) {
      this.startup = before;
      toast({ title: 'Réglage refusé', description: e.message, tone: 'danger' });
    }
  }

  async loadUpdates(force = false) {
    if (this.updatesLoading || (this.updates && !force)) return;
    this.updatesLoading = true;
    this.updatesError = '';
    try { this.updates = await kc.call('updates'); } catch (e) { this.updates = []; this.updatesError = e.message; } finally { this.updatesLoading = false; }
  }

  async loadLeftovers(force = false) {
    if (this.leftovers && !force) return;
    this.leftoversError = '';
    this.picked = {};
    try { this.leftovers = await kc.call('apps.leftovers'); } catch (e) { this.leftovers = []; this.leftoversError = e.message; }
  }
  async trashLeftovers() {
    const ids = Object.keys(this.picked);
    try {
      const r = await this.run('leftovers', 'Envoi à la Corbeille…', () => kc.call('apps.trashLeftovers', { ids }));
      this.leftovers = this.leftovers.filter((g) => !ids.includes(g.id));
      this.picked = {};
      toast({ title: 'Restes envoyés à la Corbeille', description: r.left?.length ? `${r.left.length} élément(s) refusé(s) par macOS, laissés en place.` : '« Remettre » dans le Finder les restaure tant que tu ne la vides pas.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Rien n’a été déplacé', description: e.message, tone: 'danger' });
    }
  }

  async run(id, label, fn) {
    this.working = { ...this.working, [id]: label };
    try { return await fn(); } finally { const { [id]: _, ...rest } = this.working; this.working = rest; }
  }

  async uninstall(a) {
    try {
      const r = await this.run(a.id, 'Désinstallation…', () => kc.call('apps.uninstall', { id: a.id }));
      if (r.launched) {
        this.stale = true;
        toast({ title: `Désinstalleur de ${a.name} ouvert`, description: 'Suis ses étapes. La liste se met à jour quand tu reviens ici.' });
        return;
      }
      this.list = this.list.filter((x) => x.id !== a.id);
      toast({ title: `${a.name} désinstallée`, description: MAC ? (r.left?.length ? `${r.left.length} élément(s) refusé(s) par macOS, laissés en place.` : 'Envoyée à la Corbeille avec ses données : « Remettre » la restaure.') : 'Réinstallable depuis le Microsoft Store.', tone: 'success' });
    } catch (e) {
      toast({ title: `${a.name} n’a pas été désinstallée`, description: e.message, tone: 'danger' });
    }
  }
  async reset(a) {
    try {
      const r = await this.run(a.id, 'Réinitialisation…', () => kc.call('apps.reset', { id: a.id }));
      this.list = this.list.map((x) => (x.id === a.id ? { ...x, data: 0 } : x));
      toast({ title: `${a.name} réinitialisée`, description: r.left?.length ? `${r.left.length} élément(s) refusé(s), laissés en place.` : 'Ses données sont dans la Corbeille. Elle repart comme au premier lancement.', tone: 'success' });
    } catch (e) {
      toast({ title: `${a.name} n’a pas été réinitialisée`, description: e.message, tone: 'danger' });
    }
  }
  async upgrade(u) {
    try {
      await this.run(u.id, 'Mise à jour…', () => kc.call('updates.install', { id: u.id }));
      this.updates = this.updates.filter((x) => x.id !== u.id);
      toast({ title: `${u.name} est à jour`, description: `Version ${u.available}`, tone: 'success' });
      return true;
    } catch (e) {
      toast({ title: `${u.name} n’a pas été mise à jour`, description: e.message, tone: 'danger' });
      return false;
    }
  }
  async upgradeAll() {
    for (const u of [...(this.updates ?? [])]) await this.upgrade(u);
  }
}

export const A = new Apps();
