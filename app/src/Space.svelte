<script module>
  // la carte survit aux changements de page : on revient où on était
  const M = $state({ roots: null, stack: [], listing: null, error: '', loading: false });

  /** treemap « squarified » (Bruls et al.) : des tuiles aussi carrées que possible */
  function squarify(items, W, H) {
    const total = items.reduce((a, b) => a + b.size, 0);
    if (!total || W <= 0 || H <= 0) return [];
    let nodes = items.map((it) => ({ it, a: (it.size / total) * W * H }));
    const worst = (row, side) => { const s = row.reduce((a, b) => a + b.a, 0); const max = Math.max(...row.map((r) => r.a)); const min = Math.min(...row.map((r) => r.a)); return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min)); };
    const out = [];
    let x = 0, y = 0, w = W, h = H;
    while (nodes.length) {
      const side = Math.min(w, h);
      let row = [nodes[0]], i = 1;
      while (i < nodes.length && worst([...row, nodes[i]], side) <= worst(row, side)) row.push(nodes[i++]);
      nodes = nodes.slice(i);
      const thick = row.reduce((a, b) => a + b.a, 0) / side;
      let off = 0;
      for (const n of row) {
        const len = n.a / thick;
        out.push(w >= h ? { it: n.it, x, y: y + off, w: thick, h: len } : { it: n.it, x: x + off, y, w: len, h: thick });
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    }
    return out;
  }
</script>

<script>
  // « Espace » : ce qui occupe un dossier, en tuiles et en liste. Lecture seule : on montre,
  // on ouvre dans l'Explorateur ou le Finder, on ne supprime rien d'ici.
  import { S, OS } from './lib/state.svelte.js';
  import { fmt, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  let mapW = $state(0);
  const MAP_H = 280;
  const current = $derived(M.stack.at(-1));
  const tiles = $derived(M.listing ? squarify(M.listing.entries.filter((e) => e.size > 0).slice(0, 40), mapW, MAP_H) : []);
  const max = $derived(M.listing?.entries[0]?.size || 1);
  const progress = $derived(S.busy === 'space' && S.progress?.phase === 'space' ? S.progress : null);

  async function open(path, label, push = true, refresh = false) {
    if (S.busy) return;
    M.error = '';
    M.loading = true;
    S.busy = 'space';
    S.progress = null;
    try {
      const l = await kc.call('space', { path, refresh });
      M.listing = l;
      if (push) M.stack = [...M.stack, { path, label }];
    } catch (e) {
      M.error = e.message === 'analyse annulée' ? '' : e.message;
    } finally {
      M.loading = false;
      S.busy = '';
    }
  }
  function crumb(i) {
    const target = M.stack[i];
    M.stack = M.stack.slice(0, i + 1);
    open(target.path, target.label, false);
  }
  function root(r) {
    M.stack = [];
    open(r.path, r.label);
  }
  function into(e) {
    if (e.isDir && !e.package) open(e.path, e.name);
    else S.reveal(e.path);
  }

  $effect(() => {
    if (M.roots) return;
    kc.call('space').then((r) => (M.roots = r.roots)).catch((e) => (M.error = e.message));
  });
  const tone = (i, e) => (e.isDir && !e.package ? `var(--k-chart-${(i % 6) + 1})` : 'var(--ink-tertiary)');
</script>

<div class="kc-view">
  <header class="k-page-header" data-kube="page-header">
    <div class="k-page-header__content">
      <div class="k-page-header__heading">
        <h1 class="k-page-header__title">Espace disque</h1>
        <p class="k-page-header__subtitle">Ce qui occupe chaque dossier, du plus lourd au plus léger. Rien n’est supprimé d’ici : ouvre un élément {OS.inFinder} pour décider.</p>
        {#if M.listing && !M.loading}<p class="kc-summary"><Num value={M.listing.size} /> · {plural(M.listing.files, 'fichier', 'fichiers')}</p>{/if}
      </div>
      {#if current}
        <div class="k-page-header__actions">
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={!!S.busy} onclick={() => open(current.path, current.label, false, true)}><Icon name="refresh-cw" />Actualiser</button>
        </div>
      {/if}
    </div>
  </header>

  {#if M.roots}
    <div class="kc-roots" role="group" aria-label="Emplacement à cartographier">
      {#each M.roots as r (r.path)}
        <button class="k-btn k-btn--sm k-btn--pill {M.stack[0]?.path === r.path ? 'k-btn--accent-subtle' : ''}" type="button" data-root={r.path} disabled={!!S.busy} aria-pressed={M.stack[0]?.path === r.path} onclick={() => root(r)}>
          <Icon name={r.label === 'Dossier personnel' ? 'house' : r.label === 'Applications' ? 'app-window' : 'hard-drive'} />{r.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if M.stack.length > 1}
    <nav class="kc-crumbs" aria-label="Chemin">
      {#each M.stack as c, i (c.path)}
        {#if i}<Icon name="chevron-right" />{/if}
        {#if i < M.stack.length - 1}<button class="k-btn k-btn--ghost k-btn--xs" type="button" disabled={!!S.busy} onclick={() => crumb(i)}>{c.label}</button>
        {:else}<span class="kc-crumbs__here" aria-current="location">{c.label}</span>{/if}
      {/each}
    </nav>
  {/if}

  {#if M.loading}
    <div class="kc-measure" role="status">
      <div class="kc-measure__line"><span>{progress ? `Mesure… ${progress.done}/${progress.total} · ${progress.label}` : 'Mesure…'}</span>
        <button class="k-btn k-btn--ghost k-btn--xs" type="button" onclick={() => S.cancel()}>Annuler</button></div>
      <div class="k-progress k-progress--sm" role="progressbar" aria-label="Mesure du dossier" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress ? Math.round((progress.done / progress.total) * 100) : 0} style:--k-progress={progress ? progress.done / progress.total : 0}><div class="k-progress__bar"></div></div>
      <p class="kc-note">La première mesure d’un grand dossier peut prendre une minute ; les sous-dossiers s’ouvrent ensuite aussitôt.</p>
    </div>
  {:else if M.error}
    <div class="k-alert k-alert--block" role="alert"><div class="k-alert__row"><span class="k-alert__icon"><Icon name="circle-alert" /></span><div class="k-alert__content"><div class="k-alert__description">{M.error}</div></div></div></div>
  {:else if !M.listing}
    <div class="k-empty k-empty--page">
      <div class="k-empty__body">
        <div class="k-empty__art k-empty__art--tile"><Icon name="chart-pie" /></div>
        <div class="k-empty__text">
          <h2 class="k-empty__title">Choisis un emplacement</h2>
          <p class="k-empty__desc">Ton dossier personnel ou un disque entier. KubeClean mesure chaque dossier sans rien modifier.</p>
        </div>
        {#if M.roots?.length}<div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" disabled={!!S.busy} onclick={() => root(M.roots[0])}><Icon name="chart-pie" />Cartographier {M.roots[0].label.toLowerCase()}</button></div>{/if}
        {#if S.busy === 'scan'}<p class="kc-note">Disponible dès la fin de l’analyse en cours.</p>{/if}
      </div>
    </div>
  {:else if !M.listing.entries.length}
    <div class="k-empty"><div class="k-empty__body"><div class="k-empty__art"><Icon name="folder" /></div><div class="k-empty__text"><h2 class="k-empty__title">Dossier vide</h2><p class="k-empty__desc">Ou illisible sans autorisation supplémentaire.</p></div></div></div>
  {:else}
    <div class="kc-map" bind:clientWidth={mapW} style:height="{MAP_H}px" role="group" aria-label="Carte de {current?.label}">
      {#each tiles as t, i (t.it.path)}
        {@const share = t.it.size / M.listing.size}
        <button class="kc-tile" class:kc-tile--file={!t.it.isDir || t.it.package} type="button" style:left="{t.x}px" style:top="{t.y}px" style:width="{t.w}px" style:height="{t.h}px" style:--tone={tone(i, t.it)}
          title="{t.it.name} · {fmt(t.it.size)} · {Math.round(share * 100)} %" aria-label="{t.it.name}, {fmt(t.it.size)}" disabled={!!S.busy} onclick={() => into(t.it)}>
          {#if t.w > 70 && t.h > 34}<span class="kc-tile__name">{t.it.name}</span><span class="kc-tile__size">{fmt(t.it.size)}</span>{/if}
        </button>
      {/each}
    </div>

    <ul class="kc-rows" aria-label="Contenu de {current?.label}">
      {#each M.listing.entries as e, i (e.path)}
        <li class="k-reveal kc-row">
          <span class="kc-row__icon" style:color={tone(i, e)}><Icon name={e.package ? 'package' : e.isDir ? 'folder' : 'file'} /></span>
          <button class="kc-row__main" type="button" disabled={!!S.busy || !e.isDir || e.package} onclick={() => into(e)}>
            <span class="kc-row__name" title={e.path}>{e.name}</span>
            <span class="kc-row__bar" aria-hidden="true"><span style:width="{Math.max(0.5, (e.size / max) * 100)}%" style:background={tone(i, e)}></span></span>
          </button>
          <span class="kc-row__files">{e.isDir && !e.package ? plural(e.files, 'fichier', 'fichiers') : ''}</span>
          <span class="k-reveal__item"><button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher {e.name} {OS.inFinder}" data-kube="tooltip" onclick={() => S.reveal(e.path)}><Icon name="folder-open" /></button></span>
          <span class="kc-row__size">{fmt(e.size)}</span>
        </li>
      {/each}
      {#if M.listing.restCount}<li class="kc-row kc-row--rest"><span class="kc-row__icon"><Icon name="ellipsis" /></span><span class="kc-row__main">{plural(M.listing.restCount, 'autre élément', 'autres éléments')}</span><span class="kc-row__size">{fmt(M.listing.rest)}</span></li>{/if}
    </ul>
  {/if}
</div>

<style>
  .kc-view { display: flex; flex-direction: column; gap: var(--space-4); min-height: 100%; }
  .kc-summary { margin: 0; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-note { margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-roots { display: flex; flex-wrap: wrap; gap: 6px; }
  .kc-crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; font-size: 13px; color: var(--ink-secondary); }
  .kc-crumbs :global(.k-icon) { width: 12px; height: 12px; color: var(--ink-tertiary); }
  .kc-crumbs__here { padding-inline: 6px; font-weight: 510; color: var(--ink); }

  .kc-measure { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--fill-subtle); }
  .kc-measure__line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-measure__line span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .kc-map { position: relative; border-radius: var(--radius-lg); overflow: hidden; background: var(--fill-subtle); }
  .kc-tile { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; padding: 6px 8px; margin: 0; border: 1px solid var(--surface, var(--k-shell, transparent)); border-radius: 6px; text-align: start; cursor: pointer; overflow: hidden;
    background: color-mix(in oklab, var(--tone) 30%, var(--fill-subtle)); color: var(--ink); transition: background-color var(--duration-basic); }
  .kc-tile:hover:not(:disabled), .kc-tile:focus-visible { background: color-mix(in oklab, var(--tone) 50%, var(--fill-subtle)); }
  .kc-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .kc-tile--file { background: color-mix(in oklab, var(--tone) 18%, var(--fill-subtle)); cursor: default; }
  .kc-tile__name { font-size: 12px; font-weight: 510; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-tile__size { font-size: 11px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }

  .kc-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-row { display: flex; align-items: center; gap: var(--space-3); padding: 4px var(--space-2); border-radius: var(--radius-lg); }
  .kc-row:hover { background: var(--fill-subtle); }
  .kc-row__icon { flex: none; display: grid; place-items: center; }
  .kc-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 2px 0; border: 0; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
  .kc-row__main:disabled { cursor: default; }
  .kc-row__name { font-size: 13px; font-weight: 510; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-row__bar { display: block; height: 4px; border-radius: 2px; background: var(--fill-secondary); overflow: hidden; }
  .kc-row__bar span { display: block; height: 100%; border-radius: 2px; }
  .kc-row__files { flex: none; font-size: 12px; color: var(--ink-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .kc-row__size { flex: none; min-width: 4.5em; text-align: end; font-size: 13px; font-weight: 510; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-row--rest { color: var(--ink-secondary); font-size: 13px; }
</style>
