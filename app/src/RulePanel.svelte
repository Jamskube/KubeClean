<script>
  // Panneau latéral d'une règle : note contextuelle, éléments (cochables ou non), actions par élément.
  import { S, pickable, appName, MAC, OS, SEP } from './lib/state.svelte.js';
  import { fmt, plural, idle } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  let { id } = $props();
  const r = $derived(S.rule(id));

  // paged items for rules that only carry their 5 biggest; perItem rules already have everything
  let limit = $state(200);
  let page = $state(null); // {total, items}
  let loading = $state(false);
  let error = $state('');
  $effect(() => {
    if (!r || r.perItem || r.kind === 'recycleBin') return;
    const want = limit;
    loading = true;
    S.items(id, 0, want).then((res) => { if (want === limit) { page = res; error = ''; } }, (e) => { if (want === limit) error = e.message; }).finally(() => { if (want === limit) loading = false; });
  });

  let sort = $state('size'); // size | name | age
  const SORTS = [['size', 'Taille'], ['name', 'Nom'], ['age', 'Ancienneté']];
  const name = (p) => p.split(SEP).pop();
  const dir = (p) => p.slice(0, Math.max(0, p.length - name(p).length - 1));
  const shownName = (it) => (r.kind === 'projects' ? `${name(dir(it.path))} / ${name(it.path)}` : name(it.path));
  const items = $derived.by(() => {
    if (!r) return [];
    if (!r.perItem) return page?.items ?? r.items.map((it, index) => ({ ...it, index }));
    const list = r.items.map((it, index) => ({ ...it, index }));
    const by = { size: (a, b) => b.size - a.size, name: (a, b) => shownName(a).localeCompare(shownName(b), 'fr'), age: (a, b) => (b.idleDays ?? -1) - (a.idleDays ?? -1) };
    return list.sort(by[sort]);
  });
  const total = $derived(r?.perItem ? r.items.length : page?.total ?? r?.count ?? 0);

  const EXT = { image: 'jpg jpeg png gif webp svg heic bmp', video: 'mp4 mov mkv webm avi', audio: 'mp3 wav flac m4a ogg', pdf: 'pdf', document: 'doc docx txt md rtf odt', spreadsheet: 'xls xlsx csv ods', presentation: 'ppt pptx key odp' };
  const fileType = (p) => { const e = p.split('.').pop().toLowerCase(); return Object.keys(EXT).find((k) => EXT[k].split(' ').includes(e)); };
  const fileGlyph = (it) => { const e = it.path.split('.').pop().toLowerCase(); return it.isDir ? (r.kind === 'projects' ? 'folder-code' : 'folder') : ['zip', 'rar', '7z', 'gz', 'tar', 'iso'].includes(e) ? 'file-archive' : ['exe', 'msi'].includes(e) ? 'package' : fileType(it.path) ? null : 'file'; };
  const age = (it) => (it.idleDays != null || r.kind === 'projects' ? idle(it.idleDays) : '');
  /** directory shared by every listed item, shown once; rows then show the rest */
  const prefix = $derived.by(() => {
    if (items.length < 2) return '';
    const segs = items.map((it) => dir(it.path).split(SEP));
    const first = segs[0]; let n = 0;
    while (n < first.length && segs.every((p) => p[n]?.toLowerCase() === first[n].toLowerCase())) n++;
    return n >= 2 ? first.slice(0, n).join(SEP) : '';
  });
  const rel = (it) => { const d = dir(it.path); return prefix ? d.slice(prefix.length + 1) : d; };
</script>

{#if r}
  <div class="k-toolbar k-toolbar--pane">
    <span class="k-toolbar__title">{r.title}</span>
    <span class="k-toolbar__spacer"></span>
    <span class="kc-size">{#if r.sizeKnown}<Num value={r.size} />{:else}taille inconnue{/if}</span>
    <button class="k-toolbar__btn" type="button" aria-label="Fermer le panneau" data-kube="tooltip" onclick={() => (S.panel = null)}><Icon name="x" /></button>
  </div>
  <div class="k-side-panel__body kc-body">
    <p class="kc-hint">{r.hint}</p>

    {#if r.needsAdmin}
      <div class="kc-note"><Icon name="shield" /><p>Tâche Windows lancée avec les droits administrateur : Windows affichera sa demande d’autorisation (UAC) au moment du nettoyage. Elle traite tout le dossier d’un bloc{#if !r.sizeKnown}, et sa taille n’est connue qu’une fois élevée{/if}.</p></div>
    {:else if r.toRecycle}
      <div class="kc-note"><Icon name="recycle" /><p>Ce sont tes fichiers : rien n’est coché d’office, et ce que tu coches part à la Corbeille, d’où tu peux le récupérer.</p></div>
    {:else if r.kind === 'projects'}
      <div class="kc-note"><Icon name="folder-code" /><p>Dossiers de compilation, régénérés par <code>npm install</code>, <code>cargo build</code>, <code>pip install</code>… Cochés d’office : projets inactifs depuis {S.settings?.projectIdleDays ?? 14} jours.</p></div>
    {:else if r.kind === 'recycleBin'}
      <div class="kc-note"><Icon name="trash" /><p>La Corbeille est vidée d’un coup, pour tous les disques. Jette un œil dedans avant.</p></div>
    {/if}
    {#if r.blockedBy.length}
      <div class="kc-note kc-note--warning"><Icon name="triangle-alert" /><p>{r.blockedBy.map(appName).join(', ')} {r.blockedBy.length > 1 ? 'sont ouverts' : 'est ouvert'} : {MAC ? 'ce poste sera sauté tant qu’elle reste ouverte. Ferme-la avant de nettoyer.' : 'les fichiers que l’application utilise seront laissés en place.'}</p></div>
    {/if}

    {#if r.kind === 'elevated' && !r.sizeKnown}
      <p class="kc-count kc-hint">Le contenu et la taille ne sont connus qu’une fois la tâche élevée.</p>
    {:else if r.kind === 'recycleBin'}
      <p class="kc-count"><Num value={r.count} kind="int" /> {r.count > 1 ? 'éléments' : 'élément'} dans la Corbeille.</p>
    {:else}
      {#if r.perItem && items.length > 1}
        <div class="kc-sort">
          <span class="kc-sort__label">Trier par</span>
          <div class="k-seg k-seg--xs" data-kube="segmented" role="radiogroup" aria-label="Trier les éléments">
            <span class="k-seg__thumb" aria-hidden="true"></span>
            {#each SORTS as [v, label] (v)}
              <button class="k-seg__item" type="button" role="radio" data-value={v} aria-checked={sort === v} onclick={() => (sort = v)}>{label}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if error}
        <div class="k-alert k-alert--danger k-alert--block" role="alert"><div class="k-alert__row"><span class="k-alert__icon"><Icon name="circle-alert" /></span><div class="k-alert__content"><div class="k-alert__title">Impossible de lister les éléments</div><div class="k-alert__description">{error}</div></div></div></div>
      {/if}

      {#if prefix}<p class="kc-prefix"><Icon name="folder" /><span class="kc-path">{prefix}</span></p>{/if}
      <ul class="kc-items" aria-busy={loading}>
        {#each items as it (it.index)}
          <li class="kc-item k-reveal" data-on={pickable(r) && S.itemOn(r, it.index) ? '' : undefined}>
            {#if pickable(r)}
              <input type="checkbox" class="k-checkbox kc-item__check" aria-label={shownName(it)} checked={S.itemOn(r, it.index)} disabled={!!S.busy}
                onchange={() => S.toggleItem(r, it.index, it.size)} />
            {/if}
            <span class="k-file-icon k-file-icon--sm" data-type={fileType(it.path)}>{#if fileGlyph(it)}<Icon name={fileGlyph(it)} />{:else}<Icon name="file" />{/if}</span>
            <div class="kc-item__text">
              <span class="kc-item__name">{shownName(it)}</span>
              {#if rel(it)}<span class="kc-path">{rel(it)}</span>{/if}
              {#if it.label && r.kind !== 'recycleBin'}<span class="kc-item__meta">{it.label}</span>{/if}
            </div>
            <span class="kc-item__right"><span class="kc-item__size">{fmt(it.size)}</span>{#if age(it)}<span class="kc-item__meta">{age(it)}</span>{/if}</span>
            <span class="k-reveal__item kc-item__actions">
              <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Afficher {OS.inFinder}" data-kube="tooltip" onclick={() => S.reveal(it.path)}><Icon name="folder-open" /></button>
              <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Ne plus jamais proposer" data-kube="tooltip" onclick={() => S.ignore(it.path)}><Icon name="eye-off" /></button>
            </span>
          </li>
        {/each}
      </ul>
      {#if !r.perItem && !page && loading}
        <div class="k-skeleton-lines" aria-hidden="true"><span class="k-skeleton" style="width: 90%"></span><span class="k-skeleton" style="width: 70%"></span><span class="k-skeleton" style="width: 80%"></span></div>
      {/if}
      {#if !r.perItem && page && page.total > page.items.length}
        <button class="k-btn k-btn--sm kc-more" type="button" disabled={loading} aria-busy={loading} onclick={() => (limit += 200)}>
          Afficher 200 de plus <span class="kc-more__rest">({plural(page.total - page.items.length, 'restant', 'restants')})</span>
        </button>
      {/if}
    {/if}
  </div>
  {#if r.kind !== 'recycleBin' && total > 0}
    <div class="kc-foot">
      <span>{plural(total, 'élément', 'éléments')}</span>
      <span class="kc-foot__sel">{#if !r.sizeKnown}taille inconnue{:else if S.state(r) === 'off'}rien de coché{:else}<Num value={S.selSize(r)} /> cochés{/if}</span>
    </div>
  {/if}
{/if}

<style>
  .kc-size { font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-body { display: flex; flex-direction: column; gap: var(--space-3); }
  .kc-hint { margin: 0; font-size: 13px; line-height: 18px; color: var(--ink-secondary); }
  .kc-note { display: flex; gap: var(--space-2); padding: 10px 12px; border-radius: var(--radius-lg); background: var(--fill-subtle); border: 1px solid var(--border-light); font-size: 13px; line-height: 18px; color: var(--ink-secondary); }
  .kc-note :global(.k-icon) { flex: none; margin-top: 1px; color: var(--ink-tertiary); }
  .kc-note p { margin: 0; }
  .kc-note code { font-family: var(--font-mono); font-size: 12px; }
  .kc-note--warning { background: var(--warning-subtle); border-color: color-mix(in srgb, var(--warning) 30%, transparent); color: var(--ink); }
  .kc-note--warning :global(.k-icon) { color: var(--warning); }
  .kc-count { margin: 0; font-size: 14px; color: var(--ink); }
  .kc-sort { display: flex; align-items: center; gap: var(--space-2); }
  .kc-sort__label { font-size: 12px; color: var(--ink-secondary); }
  .kc-items { list-style: none; margin: 0 calc(-1 * var(--space-2)); padding: 0; display: flex; flex-direction: column; }
  .kc-item { display: grid; grid-template-columns: auto 20px minmax(0, 1fr) auto auto; align-items: start; gap: var(--space-2); padding: var(--space-2); border-radius: var(--radius-md); }
  .kc-item + .kc-item { box-shadow: inset 0 1px 0 var(--border-light); }
  .kc-item:hover { background: var(--fill-subtle); }
  .kc-item__check { margin-top: 1px; }
  .kc-item :global(.k-file-icon) { margin-top: 0; }
  .kc-item__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .kc-item__name { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--ink); overflow-wrap: anywhere; }
  .kc-item__meta { font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-item__right { display: flex; flex-direction: column; align-items: flex-end; white-space: nowrap; }
  .kc-item__size { font-size: 13px; line-height: 18px; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .kc-prefix { display: flex; align-items: center; gap: var(--space-2); margin: 0; }
  .kc-prefix :global(.k-icon) { flex: none; color: var(--ink-tertiary); }
  .kc-item[data-on] .kc-item__size { font-weight: 500; }
  .kc-item__actions { display: flex; gap: 0; margin: -5px -4px -5px 0; }
  .kc-more { align-self: flex-start; }
  .kc-more__rest { color: var(--ink-secondary); }
  .kc-foot { display: flex; justify-content: space-between; gap: var(--space-3); padding: 10px var(--space-4); border-top: 1px solid var(--border-light); font-size: 12px; color: var(--ink-secondary); background: var(--surface); }
  .kc-foot__sel { color: var(--ink); font-variant-numeric: tabular-nums; }
</style>
