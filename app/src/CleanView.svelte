<script>
  // Nettoyage : règles par catégorie, révélées pendant l'analyse, cochées puis nettoyées.
  import { fly } from 'svelte/transition';
  import { S, CATS, appName } from './lib/state.svelte.js';
  import { fmt, plural, drive } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (ms) => (rm ? 0 : ms);

  let q = $state('');
  const FILTERS = [['all', 'Tout'], ['checked', 'Cochés'], ['review', 'À vérifier'], ['empty', 'Vides']];

  const scanning = $derived(S.busy === 'scan');
  /** what the page shows: the live reveal during a scan, the finished scan otherwise (same ids → no relayout) */
  const rules = $derived(scanning ? S.live : S.rules);
  const sys = $derived(S.systemDrive);
  const found = $derived(rules.reduce((a, r) => a + r.size, 0));
  /** what will be pre-ticked once the scan lands (the selection itself still belongs to the previous scan) */
  const defaultSize = (r) => (r.perItem ? r.items.reduce((a, it) => a + (it.default ? it.size : 0), 0) : r.default ? r.size : 0);
  const selected = $derived(scanning ? rules.reduce((a, r) => a + defaultSize(r), 0) : S.total);
  const pct = $derived(S.progress?.total ? S.progress.done / S.progress.total : 0);

  const isEmpty = (r) => r.size === 0 && r.sizeKnown;
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const matches = (r) => !q.trim() || fold(`${r.title} ${r.hint}`).includes(fold(q.trim()));
  const passes = (r) => {
    if (S.cleanFilter === 'empty') return isEmpty(r);
    if (isEmpty(r)) return false;
    if (S.cleanFilter === 'checked') return S.state(r) !== 'off';
    if (S.cleanFilter === 'review') return !r.default;
    return true;
  };
  const visible = (cat) => rules.filter((r) => r.cat === cat && matches(r) && passes(r));
  const empties = (cat) => (S.cleanFilter === 'all' ? rules.filter((r) => r.cat === cat && isEmpty(r) && matches(r)) : []);
  /** during a scan: is this category still waiting for rules? (previous scan count, else category order) */
  const awaiting = (cat) => {
    if (!scanning) return false;
    const prev = S.rules.filter((r) => r.cat === cat).length;
    if (prev) return rules.filter((r) => r.cat === cat).length < prev;
    const i = CATS.findIndex((c) => c.id === cat);
    return !rules.some((r) => CATS.findIndex((c) => c.id === r.cat) > i);
  };
  const anyVisible = $derived(CATS.some((c) => visible(c.id).length || empties(c.id).length || awaiting(c.id)));

  const catState = (list) => {
    const on = list.filter((r) => S.state(r) === 'on').length;
    const mixed = list.some((r) => S.state(r) === 'mixed');
    return on === list.length && !mixed ? 'on' : on || mixed ? 'mixed' : 'off';
  };
  const toggleCat = (list) => {
    const target = catState(list) === 'on' ? 'off' : 'on';
    for (const r of list) if (S.state(r) !== target) S.toggleRule(r);
  };
  const indeterminate = (v) => (n) => { n.indeterminate = v === 'mixed'; };
  const togglePanel = (id) => (S.panel = S.panel === id ? null : id);
  const openApps = (r) => `${r.blockedBy.map(appName).join(', ')} ${r.blockedBy.length > 1 ? 'ouverts' : 'ouvert'}`;
</script>

<header class="k-page-header k-page-header--sticky kc-head" data-kube="page-header">
  <div class="k-page-header__content">
    <div class="k-page-header__heading">
      <h1 class="k-page-header__title">Nettoyage</h1>
      <p class="k-page-header__subtitle">
        {#if S.scan || scanning}
          <Num value={found} /> trouvés · <Num value={selected} /> cochés{#if sys}{' · '}<Num value={sys.free} /> libres sur {drive(sys.root)}{/if}
        {:else}
          L’analyse ne modifie rien : elle mesure ce qui peut être libéré.
        {/if}
      </p>
    </div>
    <div class="k-page-header__actions">
      {#if scanning}
        <button class="k-btn k-btn--outline" type="button" onclick={() => S.cancel()}><Icon name="circle-stop" />Annuler</button>
      {:else}
        <button class="k-btn" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="scan-search" />Analyser</button>
      {/if}
      <button class="k-btn k-btn--primary" type="button" data-action="clean" disabled={!!S.busy || !S.picked.length} onclick={() => (S.confirm = true)}>
        <Icon name="broom-sparkles" />{S.total ? `Nettoyer ${fmt(S.total)}` : 'Nettoyer'}
      </button>
    </div>
    {#if S.scan || scanning}
      <div class="k-page-header__nav kc-tools">
        <div class="k-seg k-seg--sm" data-kube="segmented" role="radiogroup" aria-label="Filtrer les règles">
          <span class="k-seg__thumb" aria-hidden="true"></span>
          {#each FILTERS as [v, label] (v)}
            <button class="k-seg__item" type="button" role="radio" data-value={v} aria-checked={S.cleanFilter === v} onclick={() => (S.cleanFilter = v)}>{label}</button>
          {/each}
        </div>
        <label class="k-page-search kc-search">
          <Icon name="search" />
          <input class="k-page-search__input" type="search" placeholder="Rechercher une règle" aria-label="Rechercher une règle" autocomplete="off" bind:value={q} />
          <button class="k-page-search__clear" type="button" aria-label="Effacer la recherche" onclick={() => (q = '')}><Icon name="x" /></button>
        </label>
        <span class="kc-tools__acts">
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={!!S.busy} onclick={() => S.selectDefaults()}>Cocher d’office</button>
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={!!S.busy} onclick={() => S.selectNone()}>Tout décocher</button>
        </span>
      </div>
    {/if}
  </div>
</header>

{#if scanning}
  <div class="kc-scan k-progress-row" in:fly={{ y: -4, duration: dur(200) }}>
    <span class="k-progress-row__label k-shimmer k-shimmer--strong" role="status">Analyse{S.progress?.label ? ` : ${S.progress.label}` : '…'}</span>
    <div class="k-progress k-progress--sm" role="progressbar" aria-label="Progression de l’analyse" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow={Math.round(pct * 100)} style:--k-progress={pct}><div class="k-progress__bar"></div></div>
    <span class="k-progress-row__value">{S.progress ? `${S.progress.done}/${S.progress.total}` : ''}</span>
  </div>
{/if}

{#if S.scan || scanning}
  <div class="kc-cats">
    {#each CATS as c (c.id)}
      {@const list = visible(c.id)}
      {@const zero = empties(c.id)}
      {@const wait = awaiting(c.id)}
      {@const cs = catState(list)}
      {#if list.length || zero.length || wait}
        <section class="k-card k-card--full kc-cat" id="cat-{c.id}" aria-labelledby="h-{c.id}" in:fly={{ y: 6, duration: dur(220) }}>
          <header class="kc-cat__head">
            <input type="checkbox" class="k-checkbox" aria-label="Tout cocher dans {c.label}" checked={cs === 'on'} {@attach indeterminate(cs)}
              disabled={!!S.busy || !list.length} onchange={() => toggleCat(list)} />
            <span class="kc-cat__icon"><Icon name={c.icon} /></span>
            <div class="kc-cat__text">
              <h2 class="kc-card__title" id="h-{c.id}">{c.label}</h2>
              <p class="kc-cat__blurb">{c.blurb}</p>
            </div>
            <span class="kc-cat__total"><Num value={rules.filter((r) => r.cat === c.id).reduce((a, r) => a + r.size, 0)} /></span>
          </header>
          {#if list.length || wait}
            <ul class="kc-rules">
              {#each list as r, i (r.id)}
                {@const st = S.state(r)}
                <li class="kc-row" data-active={S.panel === r.id || undefined} in:fly={{ y: 6, duration: dur(220), delay: dur(Math.min(i, 8) * 25) }}>
                  <input type="checkbox" class="k-checkbox kc-row__check" aria-label={r.title} checked={st === 'on'} {@attach indeterminate(st)}
                    disabled={!!S.busy} onchange={() => S.toggleRule(r)} />
                  <button class="k-pressable kc-row__text" type="button" aria-expanded={S.panel === r.id} onclick={() => togglePanel(r.id)}>
                    <span class="kc-row__title" title={r.title}>{r.title}</span>
                    {#if r.hint}<span class="kc-row__hint">{r.hint}</span>{/if}
                  </button>
                  <span class="kc-row__meta">
                  {#if r.blockedBy.length || r.needsAdmin || r.toRecycle || r.perItem || !r.default}
                  <span class="kc-row__pills">
                    {#if r.blockedBy.length}
                      <span class="k-status-pill k-status-pill--warning" data-kube="tooltip" data-kube-tooltip="Les fichiers que l’application utilise seront laissés en place"><span class="k-status-pill__label">{openApps(r)}</span></span>
                    {/if}
                    {#if r.needsAdmin}<span class="k-badge"><Icon name="shield" />Admin</span>{/if}
                    {#if r.toRecycle}<span class="k-badge"><Icon name="recycle" />Corbeille</span>{/if}
                    {#if r.perItem}<span class="k-badge k-badge--outline">au cas par cas</span>{/if}
                    {#if !r.default}<span class="k-badge" data-kube="tooltip" data-kube-tooltip="Jamais coché d’office : à toi de décider">à vérifier</span>{/if}
                  </span>
                  {/if}
                  <span class="kc-row__size">
                    {#if !r.sizeKnown}<span class="kc-row__unknown">taille inconnue</span>
                    {:else if st === 'mixed'}<Num value={S.selSize(r)} /> <span class="kc-row__of">/ {fmt(r.size)}</span>
                    {:else}<Num value={r.size} />{/if}
                    {#if r.count && !r.needsAdmin}<span class="kc-row__count">{plural(r.count, 'élément', 'éléments')}</span>{/if}
                  </span>
                  </span>
                  <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm kc-row__more" type="button" aria-label="Détails : {r.title}" aria-pressed={S.panel === r.id}
                    onclick={() => togglePanel(r.id)}><Icon name="chevron-right" /></button>
                </li>
              {/each}
              {#if wait}
                <li class="kc-row kc-row--skeleton" aria-busy="true" aria-label="Analyse en cours">
                  <span class="k-skeleton kc-skel-box"></span>
                  <span class="k-skeleton-lines kc-skel-lines"><span class="k-skeleton k-skeleton--sm" style="width: 38%"></span><span class="k-skeleton k-skeleton--sm" style="width: 62%"></span></span>
                  <span class="k-skeleton k-skeleton--sm kc-skel-size"></span>
                </li>
              {/if}
            </ul>
          {/if}
          {#if zero.length}
            <details class="k-disclosure kc-zero" data-kube="disclosure">
              <summary class="kc-zero__sum"><Icon name="chevron-right" />{zero.length > 1 ? `${zero.length} règles sans rien à nettoyer` : '1 règle sans rien à nettoyer'}</summary>
              <ul class="kc-zero__list">{#each zero as r (r.id)}<li>{r.title}</li>{/each}</ul>
            </details>
          {/if}
        </section>
      {/if}
    {/each}
    {#if !anyVisible}
      <div class="k-empty">
        <div class="k-empty__body">
          <div class="k-empty__art"><Icon name="search-x" /></div>
          <div class="k-empty__text">
            <h2 class="k-empty__title">Aucune règle ne correspond</h2>
            <p class="k-empty__desc">Change le filtre ou vide la recherche.</p>
          </div>
          <div class="k-empty__actions"><button class="k-btn k-btn--sm" type="button" onclick={() => { q = ''; S.cleanFilter = 'all'; }}>Tout afficher</button></div>
        </div>
      </div>
    {/if}
  </div>
{:else if !S.busy}
  <div class="k-empty k-empty--page kc-welcome">
    <div class="k-ambient-glow" aria-hidden="true"></div>
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="scan-search" /></div>
      <div class="k-empty__text">
        <h2 class="k-empty__title">Aucune analyse</h2>
        <p class="k-empty__desc">L’analyse ne touche à rien : elle mesure ce qui peut être libéré, catégorie par catégorie.</p>
      </div>
      <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" onclick={() => S.runScan()}><Icon name="scan-search" />Analyser</button></div>
    </div>
  </div>
{/if}

<style>
  .kc-head { margin-top: calc(-1 * var(--space-4)); }
  .kc-tools { gap: var(--space-2); flex-wrap: wrap; min-height: 52px; }
  .kc-tools__acts { display: flex; gap: var(--space-1); margin-left: auto; white-space: nowrap; }
  .kc-search { flex: 1 1 150px; min-width: 150px; max-width: 240px; }
  .kc-scan { margin: var(--space-3) 0 var(--space-4); }
  .kc-cats { display: flex; flex-direction: column; gap: var(--space-4); padding-top: var(--space-4); }
  .kc-cat { display: flex; flex-direction: column; scroll-margin-top: 140px; }
  .kc-cat__head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-light); }
  .kc-cat__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--fill-secondary); color: var(--ink-secondary); flex: none; }
  .kc-cat__icon :global(.k-icon) { --k-icon-size: 18px; }
  .kc-cat__text { min-width: 0; flex: 1; }
  .kc-cat__blurb { margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-cat__total { font-size: 14px; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }

  .kc-rules { list-style: none; margin: 0; padding: var(--space-1); display: flex; flex-direction: column; }
  .kc-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 28px; grid-template-areas: 'check text meta more'; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); transition: background var(--duration-basic) ease; }
  .kc-row + .kc-row { box-shadow: inset 0 1px 0 var(--border-light); }
  .kc-row:hover { background: var(--fill-subtle); }
  .kc-row[data-active] { background: var(--fill-secondary); box-shadow: none; }
  .kc-row[data-active] + .kc-row { box-shadow: none; }
  .kc-row__check { grid-area: check; }
  .kc-row__text { grid-area: text; display: flex; flex-direction: column; gap: 1px; min-width: 0; text-align: start; padding: 2px 0; border-radius: var(--radius-xs); }
  .kc-row__title { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-row__hint { font-size: 12px; line-height: 16px; color: var(--ink-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-row__meta { grid-area: meta; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
  .kc-row__pills { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-1); max-width: 11rem; white-space: nowrap; }
  .kc-row__size { display: flex; flex-direction: column; align-items: flex-end; min-width: 5rem; font-size: 14px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-row__of, .kc-row__unknown, .kc-row__count { font-size: 12px; line-height: 16px; color: var(--ink-secondary); white-space: nowrap; }
  .kc-row__more { grid-area: more; color: var(--ink-tertiary); }
  .kc-row__more :global(.k-icon) { transition: transform var(--duration-moderate) var(--ease-enter); }
  .kc-row__more[aria-pressed='true'] :global(.k-icon) { transform: rotate(90deg); }

  .kc-row--skeleton { grid-template-columns: 18px minmax(0, 1fr) 80px; grid-template-areas: 'check text size'; min-height: 52px; }
  .kc-row--skeleton:hover { background: none; }
  .kc-skel-box { grid-area: check; width: 18px; height: 18px; border-radius: var(--radius-xs); }
  .kc-skel-lines { grid-area: text; display: flex; flex-direction: column; gap: 6px; }
  .kc-skel-size { grid-area: size; width: 64px; justify-self: end; }

  .kc-zero { border-top: 1px solid var(--border-light); font-size: 12px; color: var(--ink-secondary); }
  .kc-zero__sum { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-2) var(--space-4); cursor: pointer; list-style: none; user-select: none; }
  .kc-zero__sum::-webkit-details-marker { display: none; }
  .kc-zero__sum :global(.k-icon) { --k-icon-size: 14px; transition: transform var(--duration-moderate) var(--ease-enter); }
  .kc-zero[open] .kc-zero__sum :global(.k-icon) { transform: rotate(90deg); }
  .kc-zero__sum:hover { color: var(--ink); }
  .kc-zero__list { margin: 0; padding: 0 var(--space-4) var(--space-3) calc(var(--space-4) + 18px); columns: 2; column-gap: var(--space-4); list-style: none; line-height: 20px; }

  .kc-welcome { position: relative; isolation: isolate; }
</style>
