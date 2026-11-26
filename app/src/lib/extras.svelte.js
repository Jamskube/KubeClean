// Copies de travail git, dossiers qui grossissent, doublons : chargés à la demande et gardés
// entre deux visites. Rien n'est jamais coché d'office ; tout retrait passe par une confirmation.
import { S, MAC, toast } from './state.svelte.js';
import { fmt, plural } from './fmt.js';

class Extras {
  worktrees = $state.raw(null); // Worktree[] | null
  wtLoading = $state(false);
  wtError = $state('');
  wtPicked = $state({}); // chemin -> true
  wtWorking = $state(false);

  growth = $state.raw(null); // { growers, measuredAt, since }
  growthHidden = $state(false);

  dupes = $state.raw(null); // { label, paths, report }
  dupesLoading = $state(false);
  dupesError = $state('');
  keep = $state({}); // index du groupe -> chemin gardé
  dupesWorking = $state(false);

  async loadWorktrees(force = false) {
    if (this.wtLoading || (this.worktrees && !force)) return;
    this.wtLoading = true;
    this.wtError = '';
    try {
      this.worktrees = await kc.call('worktrees');
      this.wtPicked = {};
    } catch (e) {
      this.wtError = e.message;
    } finally {
      this.wtLoading = false;
    }
  }
  async removeWorktrees() {
    const paths = Object.keys(this.wtPicked);
    this.wtWorking = true;
    try {
      const r = await kc.call('worktrees.remove', { paths });
      this.worktrees = this.worktrees.filter((w) => !r.removed.includes(w.path));
      this.wtPicked = {};
      if (r.refused.length) toast({ title: `${plural(r.removed.length, 'copie retirée', 'copies retirées')}, ${r.refused.length} laissée(s) en place`, description: r.refused.map((x) => `${x.path.split(/[\\/]/).pop()} : ${x.reason}`).join(' · '), tone: 'warning' });
      else toast({ title: plural(r.removed.length, 'copie de travail retirée', 'copies de travail retirées'), description: 'Les branches et leurs commits restent dans git.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Aucune copie retirée', description: e.message, tone: 'danger' });
    } finally {
      this.wtWorking = false;
    }
  }

  /** silencieux : une carte qui n'apparaît pas vaut mieux qu'une alerte sur une alerte */
  async loadGrowth() {
    try { this.growth = await kc.call('growth'); } catch {}
  }

  async findDupes(paths, label) {
    if (this.dupesLoading) return;
    this.dupesLoading = true;
    this.dupesError = '';
    this.keep = {};
    S.dupesProgress = null;
    try {
      this.dupes = { label, paths, report: await kc.call('dupes', { paths }) };
    } catch (e) {
      this.dupesError = e.message === 'analyse annulée' ? '' : e.message;
    } finally {
      this.dupesLoading = false;
    }
  }
  /** paires { remove, keep } des groupes où l'utilisateur a choisi la copie à garder */
  get pairs() {
    const groups = this.dupes?.report.groups ?? [];
    return Object.entries(this.keep).flatMap(([i, keep]) => groups[i].copies.filter((c) => c.path !== keep).map((c) => ({ remove: c.path, keep, size: groups[i].size })));
  }
  async trashDupes() {
    const pairs = this.pairs;
    this.dupesWorking = true;
    try {
      const r = await kc.call('dupes.trash', { pairs: pairs.map(({ remove, keep }) => ({ remove, keep })) });
      const key = (p) => (MAC ? p : p.toLowerCase()); // chemins Windows sans casse
      const gone = new Set(r.trashed.map(key));
      const groups = this.dupes.report.groups.map((g) => ({ ...g, copies: g.copies.filter((c) => !gone.has(key(c.path))) })).filter((g) => g.copies.length > 1);
      this.dupes = { ...this.dupes, report: { ...this.dupes.report, groups, wasted: groups.reduce((a, g) => a + g.size * (g.copies.length - 1), 0) } };
      this.keep = {};
      toast({
        title: `${plural(r.trashed.length, 'copie envoyée', 'copies envoyées')} à la Corbeille`,
        description: (r.left.length ? `${r.left.length} laissée(s) en place : plus identique(s) ou refusée(s). ` : '') + `${fmt(r.size)} libérés une fois la Corbeille vidée.`,
        tone: r.left.length ? 'warning' : 'success',
      });
    } catch (e) {
      toast({ title: 'Rien n’a été déplacé', description: e.message, tone: 'danger' });
    } finally {
      this.dupesWorking = false;
    }
  }
}

export const X = new Extras();
