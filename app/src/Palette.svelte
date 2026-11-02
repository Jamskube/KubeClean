<script>
  // Ctrl+K palette on the kit's CommandPalette (dialog + listbox runtime). Filtering is ours
  // (accent-insensitive), so the runtime's `kube:filter` is cancelled and re-run after render.
  import { tick } from 'svelte';
  import { S, CATS } from './lib/state.svelte.js';
  import { kubeOn, norm } from './lib/ui/kube.js';
  import Icon from './lib/Icon.svelte';

  let dlg = $state();
  let q = $state('');
  let syncing = false;

  const VIEWS = [
    ['dashboard', 'Tableau de bord', 'layout-dashboard'], ['clean', 'Nettoyage', 'broom-sparkles'], ['projects', 'Projets', 'folder-code'],
    ['files', 'Fichiers', 'file-archive'], ['history', 'Historique', 'clock-arrow-left'], ['settings', 'Réglages', 'settings'],
  ];
  const cat = (id) => CATS.find((c) => c.id === id)?.label ?? id;

  const groups = $derived.by(() => {
    const g = [
      { id: 'nav', label: 'Aller à', items: VIEWS.map(([v, label, icon]) => ({ id: `view:${v}`, label: `Aller à ${label}`, icon, kbd: `Alt ${VIEWS.findIndex((x) => x[0] === v) + 1}`, run: () => { S.view = v; if (v !== 'clean') S.panel = null; } })) },
      { id: 'act', label: 'Actions', items: [
        S.busy === 'scan'
          ? { id: 'cancel', label: 'Annuler l’analyse', icon: 'square-x', run: () => S.cancel() }
          : { id: 'scan', label: 'Analyser', icon: 'scan-search', off: !!S.busy, run: () => S.runScan() },
        { id: 'quick', label: 'Nettoyage rapide', icon: 'sparkles', off: !!S.busy || !S.scan, run: () => S.quickClean() },
        { id: 'defaults', label: 'Tout cocher d’office', icon: 'list-checks', off: !S.scan, run: () => S.selectDefaults() },
        { id: 'none', label: 'Tout décocher', icon: 'square', off: !S.scan, run: () => S.selectNone() },
      ] },
      { id: 'theme', label: 'Thème', items: [
        { id: 'theme:light', label: 'Thème clair', icon: 'sun', run: () => S.setTheme('light') },
        { id: 'theme:dark', label: 'Thème sombre', icon: 'moon', run: () => S.setTheme('dark') },
        { id: 'theme:system', label: 'Thème du système', icon: 'monitor', run: () => S.setTheme('system') },
      ] },
      { id: 'rules', label: 'Règles', items: S.rules.map((r) => ({ id: `rule:${r.id}`, label: r.title, meta: cat(r.cat), icon: CATS.find((c) => c.id === r.cat)?.icon ?? 'file', run: () => { S.view = 'clean'; S.panel = r.id; } })) },
    ];
    const n = norm(q).trim();
    if (!n) return g;
    return g.map((x) => ({ ...x, items: x.items.filter((it) => norm(`${it.label} ${it.meta ?? ''}`).includes(n)) })).filter((x) => x.items.length);
  });
  const all = $derived(groups.flatMap((g) => g.items));

  function onFilter(e) {
    e.preventDefault();
    q = e.detail.query;
    if (syncing) return;
    syncing = true;
    tick().then(() => { window.Kube?.get(dlg, 'command-palette')?.refresh(); syncing = false; });
  }
  function onSelect(e) {
    const it = all.find((x) => x.id === e.detail.value);
    if (!it || it.off) { e.preventDefault(); return; }
    it.run();
  }
</script>

<dialog class="k-command kc-cmd" id="palette" bind:this={dlg} data-kube="dialog command-palette" aria-label="Palette de commandes" use:kubeOn={{ filter: onFilter, select: onSelect }}>
  <div class="k-menu__search k-command__search"><Icon name="search" /><input type="text" placeholder="Une vue, une action, une règle…" aria-label="Commande" autocomplete="off" /></div>
  <div class="k-command__list" role="listbox" aria-label="Commandes">
    {#each groups as g (g.id)}
      <div class="k-command__group" id="kc-cg-{g.id}" role="presentation">{g.label}</div>
      <div role="group" aria-labelledby="kc-cg-{g.id}">
        {#each g.items as it (it.id)}
          <div class="k-command__item" role="option" aria-selected="false" data-value={it.id} aria-disabled={it.off ? 'true' : undefined}>
            <span class="k-menu__icon"><Icon name={it.icon} /></span>
            <span class="k-menu__label">{it.label}</span>
            {#if it.meta}<span class="kc-cmd__meta">{it.meta}</span>{/if}
            {#if it.kbd}<kbd class="k-menu__shortcut">{it.kbd}</kbd>{/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
  <div class="k-command__empty" hidden={all.length > 0}>Rien ne correspond à «&nbsp;{q}&nbsp;»</div>
  <div class="k-menu__footer kc-cmd__footer">
    <span><kbd class="k-kbd">↑</kbd><kbd class="k-kbd">↓</kbd> naviguer</span>
    <span><kbd class="k-kbd">↵</kbd> ouvrir</span>
    <span><kbd class="k-kbd">Échap</kbd> fermer</span>
  </div>
</dialog>

<style>
  .kc-cmd__meta { flex: none; font-size: 12px; color: var(--ink-tertiary); }
  .kc-cmd__footer { display: flex; gap: var(--space-4); font-size: 12px; color: var(--ink-tertiary); border-top: 1px solid var(--border-light); }
  .kc-cmd__footer span { display: inline-flex; align-items: center; gap: 4px; }
  .kc-cmd__footer .k-kbd { font-size: 11px; }
</style>
