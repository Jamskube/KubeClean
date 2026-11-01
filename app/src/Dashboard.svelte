<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { tick, onMount } from 'svelte';
  import { S, CATS, catColor } from './lib/state.svelte.js';
  import { fmt, date, drive } from './lib/fmt.js';
  import { dur } from './lib/ui/kube.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const scanning = $derived(S.busy === 'scan');
  /** rules shown: the live ones while scanning, the last scan otherwise */
  const rules = $derived(scanning ? S.live : S.rules);
  const found = $derived(rules.reduce((a, r) => a + r.size, 0));
  /** what the primary button cleans: the safe defaults (live during the scan, the current selection after) */
  const safe = $derived(scanning || !S.scan ? S.defaultSize : S.total);
  const toReview = $derived(Math.max(0, found - safe));
  const canClean = $derived(!S.busy && !!S.scan && S.defaultSize > 0);

  const cat = (id) => CATS.find((c) => c.id === id) ?? CATS[0];
  const catRows = $derived(CATS.map((c) => {
    const rs = rules.filter((r) => r.cat === c.id);
    return { ...c, total: rs.reduce((a, r) => a + r.size, 0), sel: scanning ? 0 : rs.reduce((a, r) => a + S.selSize(r), 0) };
  }));
  const top = $derived([...rules].filter((r) => r.size > 0).sort((a, b) => b.size - a.size).slice(0, 5));
  const badge = (r) => (r.needsAdmin ? ['k-badge--warning', 'admin', null] : S.state(r) === 'on' ? ['k-badge--success', 'coché', null] : ['', 'non coché', 'Jamais coché d’office : à toi de décider']);

  const d = $derived(S.systemDrive);
  const usedPct = $derived(d ? (1 - d.free / d.total) * 100 : 0);
  const freedPct = $derived(d && !scanning ? Math.min(usedPct, (S.total / d.total) * 100) : 0);
  const afterPct = $derived(usedPct - freedPct);
  const afterFree = $derived(d ? d.free + S.total : 0);

  const hist = $derived(S.history);
  const gained = $derived(hist.reduce((a, h) => a + Math.max(h.diskGain, 0), 0));
  const spark = $derived.by(() => {
    const v = hist.map((h) => Math.max(h.diskGain, 0));
    const max = Math.max(1, ...v);
    if (v.length === 1) v.push(v[0]);
    return v.map((x, i) => `${((i / (v.length - 1)) * 120).toFixed(1)},${(30 - (x / max) * 28).toFixed(1)}`).join(' ');
  });

  const pct = $derived(S.progress?.total ? S.progress.done / S.progress.total : 0);

  // bars start at 0 and stretch to their value on the first frame (and again whenever the value changes)
  let armed = $state(false);
  onMount(() => requestAnimationFrame(() => (armed = true)));

  async function toCat(id) {
    S.view = 'clean';
    await tick();
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openRule(id) { S.view = 'clean'; S.panel = id; }

  const SAFETY = [
    { icon: 'shield-check', title: 'Revérifié avant d’y toucher', text: 'Chaque élément est recontrôlé juste avant la suppression ; ce qui a changé depuis l’analyse reste en place.' },
    { icon: 'archive', title: 'Tes fichiers vont à la Corbeille', text: 'Gros fichiers et vieux téléchargements ne sont jamais cochés d’office et restent récupérables.' },
    { icon: 'lock', title: 'Admin via l’UAC de Windows', text: 'Les tâches système passent par l’invite d’autorisation habituelle, jamais en silence.' },
  ];
</script>

{#if !S.scan && !scanning}
  <div class="k-empty k-empty--page">
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="scan-search" /></div>
      <div class="k-empty__text">
        <h2 class="k-empty__title">Aucune analyse pour l’instant</h2>
        <p class="k-empty__desc">L’analyse ne modifie rien : elle mesure ce qui peut être récupéré sur ton disque.</p>
      </div>
      <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" onclick={() => S.runScan()} disabled={!!S.busy}><Icon name="scan-search" />Analyser</button></div>
    </div>
  </div>
{:else}
  <div class="kc-dash">
    <!-- hero -->
    <section class="k-card k-card--full kc-card kc-hero" aria-labelledby="kc-hero-title">
      <div class="k-ambient-glow" aria-hidden="true" data-state={scanning ? 'off' : undefined}></div>
      <div class="kc-hero__body">
        <h1 id="kc-hero-title" class="kc-hero__headline">
          <Num value={safe} class="kc-num-hero" />
          <span class="kc-num-hero__unit">{scanning ? 'trouvés jusqu’ici, prêts à partir' : 'prêts à partir'}</span>
        </h1>
        <p class="kc-hero__sub">
          {#if scanning}
            <span class="k-shimmer k-shimmer--strong" role="status">Analyse en cours</span> · <Num value={found} /> trouvés jusqu’ici
          {:else}
            sur <Num value={found} /> trouvés
            {#if toReview > 0}
              <span class="kc-hero__dot">·</span>
              <button class="k-btn k-btn--ghost k-btn--xs kc-hero__review" type="button" onclick={() => { S.cleanFilter = 'review'; S.view = 'clean'; }}><span><Num value={toReview} /> à vérifier</span><Icon name="arrow-right" /></button>
            {/if}
          {/if}
        </p>
        {#if scanning}
          <div class="kc-hero__scan">
            <div class="k-progress-row kc-hero__progress">
              <span class="k-progress-row__label">{S.progress?.label ?? 'Préparation'}</span>
              <div class="k-progress" role="progressbar" aria-label="Analyse" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(pct * 100)} style:--k-progress={pct}><div class="k-progress__bar"></div></div>
              <span class="k-progress-row__value">{S.progress ? `${S.progress.done}/${S.progress.total}` : '…'}</span>
            </div>
            <button class="k-btn k-btn--ghost k-btn--sm" type="button" onclick={() => S.cancel()}>Annuler</button>
          </div>
        {:else}
          <div class="kc-hero__actions">
            <button class="k-btn k-btn--primary k-btn--lg" type="button" data-action="clean" data-kube="press" disabled={!canClean} onclick={() => S.quickClean()}><Icon name="sparkles" />Nettoyer {fmt(S.defaultSize)}</button>
            <button class="k-btn k-btn--lg" type="button" data-kube="press" onclick={() => { S.cleanFilter = 'all'; S.view = 'clean'; }}>Passer en revue<Icon name="arrow-right" /></button>
            <button class="k-btn k-btn--ghost k-btn--icon k-btn--lg" type="button" aria-label="Analyser à nouveau" data-kube="tooltip press" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="refresh-cw" /></button>
          </div>
          <p class="kc-hero__caption">Caches et temporaires que les applications recréent · tu confirmes avant</p>
        {/if}
      </div>
    </section>

    <!-- safety band -->
    <ul class="kc-safety" aria-label="Ce que KubeClean garantit">
      {#each SAFETY as s (s.icon)}
        <li data-kube="tooltip" data-kube-tooltip={s.text} data-kube-size="lg"><Icon name={s.icon} /><strong>{s.title}</strong></li>
      {/each}
    </ul>

    <!-- system drive -->
    {#if d}
      <section class="k-card k-card--full kc-card kc-drivecard" aria-labelledby="kc-drive-title">
        <header class="kc-card__head"><h2 id="kc-drive-title" class="kc-card__title"><Icon name="hard-drive" />Disque {drive(d.root)}</h2></header>
        <div class="kc-drivecard__body">
          <div class="kc-ring">
            <svg class="k-donut kc-ring__svg" viewBox="0 0 24 24" style:--k-progress={usedPct} style:--kc-seg={freedPct} style:--kc-seg-start={afterPct} role="img" aria-label="{Math.round(usedPct)} % utilisés{freedPct ? `, ${Math.round(afterPct)} % après nettoyage` : ''}">
              <circle class="k-donut__track" cx="12" cy="12" r="11" />
              <circle class="k-donut__arc" cx="12" cy="12" r="11" pathLength="100" />
              <circle class="kc-ring__freed" cx="12" cy="12" r="11" pathLength="100" />
            </svg>
            <div class="kc-ring__center">
              <span class="kc-ring__pct"><Num value={usedPct} kind="percent" />{#if freedPct}<span class="kc-ring__arrow" aria-hidden="true">→</span><Num value={afterPct} kind="percent" class="kc-ring__after" />{/if}</span>
              <span class="kc-stat__label">utilisés</span>
            </div>
          </div>
          <dl class="kc-facts">
            <div><dt class="kc-stat__label">Libre aujourd’hui</dt><dd><Num value={d.free} class="kc-stat__num" /> <span class="kc-dim">sur {fmt(d.total)}</span></dd></div>
            <div><dt class="kc-stat__label"><span class="kc-swatch"></span>Après nettoyage</dt><dd>{#if scanning}<span class="kc-stat__num">—</span>{:else}<Num value={afterFree} class="kc-stat__num" /> <span class="kc-dim">libres</span>{/if}</dd></div>
          </dl>
        </div>
      </section>
    {/if}

    <!-- breakdown -->
    <section class="k-card k-card--full kc-card kc-breakdown" aria-labelledby="kc-bd-title">
      <header class="kc-card__head"><h2 id="kc-bd-title" class="kc-card__title"><Icon name="chart-bar" />Répartition<span class="kc-card__meta"><Num value={found} /></span></h2></header>
      <div class="kc-stack" role="img" aria-label="Octets trouvés par catégorie">
        {#each catRows as c (c.id)}<span style:flex={armed ? c.total : 0} style:background={catColor(c.id)} title="{c.label} : {fmt(c.total)}"></span>{/each}
        {#if !found}<span class="kc-stack__empty"></span>{/if}
      </div>
      <div class="kc-legend__head k-micro" aria-hidden="true"><span>cochés</span><span>trouvés</span></div>
      <ul class="kc-legend">
        {#each catRows as c, i (c.id)}
          <li class="k-reveal kc-legend__row" in:fly={{ y: 6, duration: dur(220), delay: i * 25 }}>
            <span class="k-chart__marker" style:background={catColor(c.id)}></span>
            <Icon name={c.icon} />
            <span class="kc-legend__label k-reveal__label">{c.label}</span>
            <span class="kc-legend__sel">{#if scanning}{:else if c.sel}<Num value={c.sel} />{:else if c.total}à vérifier{/if}</span>
            <span class="kc-legend__found">{#if c.total}<Num value={c.total} />{:else}—{/if}</span>
            <span class="k-reveal__item"><button class="k-btn k-btn--ghost k-btn--xs" type="button" onclick={() => toCat(c.id)}>voir<Icon name="chevron-right" /></button></span>
          </li>
        {/each}
      </ul>
    </section>

    <!-- top 5 -->
    <section class="k-card k-card--full kc-card kc-top" aria-labelledby="kc-top-title">
      <header class="kc-card__head"><h2 id="kc-top-title" class="kc-card__title"><Icon name="trending-up" />Les plus gros postes</h2></header>
      {#if top.length}
        <ul class="k-list k-list--bleed">
          {#each top as r (r.id)}
            {@const [tone, label, tip] = badge(r)}
            <li animate:flip={{ duration: dur(250) }} in:fly={{ y: 6, duration: dur(220) }}>
              <button class="k-list__item" type="button" onclick={() => openRule(r.id)} disabled={scanning}>
                <span class="k-list__media kc-tile" style:color={catColor(r.cat)}><Icon name={cat(r.cat).icon} /></span>
                <span class="k-list__content"><span class="k-list__title">{r.title}</span><span class="k-list__desc">{r.hint || cat(r.cat).label}</span></span>
                {#if !scanning}<span class="k-badge {tone}" data-kube={tip ? 'tooltip' : undefined} data-kube-tooltip={tip}>{label}</span>{/if}
                <span class="k-list__meta kc-top__size"><Num value={r.size} /></span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="kc-dim kc-top__empty">{scanning ? 'Les résultats apparaissent au fil de l’analyse…' : 'Rien à signaler.'}</p>
      {/if}
    </section>

    <!-- history glance -->
    {#if hist.length}
      <section class="k-card k-card--full k-card--interactive kc-card kc-hist">
        <button class="k-pressable kc-hist__btn" type="button" onclick={() => (S.view = 'history')} aria-label="Ouvrir l’historique">
          <span class="kc-card__head"><span class="kc-card__title"><Icon name="clock-arrow-left" />Historique<span class="kc-card__meta kc-hist__more">voir tout<Icon name="chevron-right" /></span></span></span>
          <span class="kc-hist__grid">
            <span class="kc-stat"><Num value={gained} class="kc-stat__num" /><span class="kc-stat__label">récupérés au total</span></span>
            <span class="kc-stat"><Num value={hist.length} kind="int" class="kc-stat__num" /><span class="kc-stat__label">{hist.length > 1 ? 'nettoyages' : 'nettoyage'}</span></span>
            <span class="kc-stat"><span class="kc-stat__num kc-stat__num--text">{date(hist.at(-1).at)}</span><span class="kc-stat__label">dernier nettoyage</span></span>
            <svg class="kc-spark" viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label="Espace gagné à chaque nettoyage"><polyline points={spark} fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" /></svg>
          </span>
        </button>
      </section>
    {/if}
  </div>
{/if}

<style>
  .kc-dash { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--space-4); }
  .kc-dash > * { grid-column: span 6; min-width: 0; }
  @container kc-col (min-width: 760px) {
    .kc-drivecard { grid-column: span 2; }
    .kc-breakdown { grid-column: span 4; }
    .kc-top { grid-column: span 3; }
    .kc-hist { grid-column: span 3; }
  }

  .kc-card { padding: var(--space-5); border-radius: var(--radius-2xl); }
  .kc-card__head { display: flex; align-items: center; margin-bottom: var(--space-4); }
  .kc-card__head .kc-card__title { flex: 1; }
  .kc-dim { color: var(--ink-secondary); font-size: 13px; font-weight: 400; }
  .kc-tile { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border-radius: var(--radius-lg); background: var(--fill-secondary); }

  /* hero */
  .kc-hero { position: relative; isolation: isolate; overflow: hidden; padding: var(--space-8) var(--space-6) var(--space-6); }
  .kc-hero .k-ambient-glow { --k-ambient-glow-color: rgb(from var(--accent) r g b / 14%); --k-ambient-glow-bloom: rgb(from var(--accent) r g b / 20%); }
  :global([data-theme='light']) .kc-hero .k-ambient-glow { --k-ambient-glow-color: rgb(from var(--accent) r g b / 7%); --k-ambient-glow-bloom: rgb(from var(--accent) r g b / 8%); }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme='dark'])) .kc-hero .k-ambient-glow { --k-ambient-glow-color: rgb(from var(--accent) r g b / 7%); --k-ambient-glow-bloom: rgb(from var(--accent) r g b / 8%); }
  }
  .kc-hero__body { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); max-width: 44rem; }
  .kc-hero__headline { display: flex; flex-wrap: wrap; align-items: baseline; margin: 0; }
  .kc-hero__sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-1); margin: 0; font-size: 14px; color: var(--ink-secondary); }
  .kc-hero__sub :global(.num) { color: var(--ink); font-weight: 510; }
  .kc-hero__dot { color: var(--ink-tertiary); }
  .kc-hero__review { color: var(--link); }
  .kc-hero__review :global(.num) { color: inherit; font-weight: inherit; }
  .kc-hero__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .kc-hero__caption { margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-hero__scan { display: flex; align-items: center; gap: var(--space-3); width: 100%; max-width: 36rem; margin-top: var(--space-3); }
  .kc-hero__progress { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr auto; grid-template-areas: 'label value' 'bar bar'; gap: 6px var(--space-2); }
  .kc-hero__progress .k-progress { grid-area: bar; }
  .kc-hero__progress .k-progress-row__value { grid-area: value; }
  .kc-hero__progress .k-progress-row__label { grid-area: label; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* safety band */
  .kc-safety { list-style: none; margin: 0; padding: 0 var(--space-2); display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-6); font-size: 13px; line-height: 20px; color: var(--ink-secondary); }
  .kc-safety li { display: inline-flex; align-items: center; gap: var(--space-2); cursor: default; }
  .kc-safety li :global(.k-icon) { color: var(--success); flex: none; }
  .kc-safety strong { font-weight: 510; color: var(--ink); }

  /* drive: one ring, used in ink-secondary, freed segment in success at the end */
  .kc-drivecard__body { display: flex; align-items: center; gap: var(--space-5); flex-wrap: wrap; }
  .kc-ring { position: relative; flex: none; width: 128px; height: 128px; display: grid; place-items: center; }
  .kc-ring__svg { position: absolute; inset: 0; width: 128px; height: 128px; color: var(--ink-secondary); stroke-width: 1.6; }
  .kc-ring__freed { stroke: var(--success); stroke-linecap: round; stroke-dasharray: var(--kc-seg) calc(100 - var(--kc-seg)); stroke-dashoffset: calc(-1 * var(--kc-seg-start)); opacity: clamp(0, var(--kc-seg) * 1000, 1); transform: rotate(-90deg); transform-origin: center; transform-box: fill-box; transition: stroke-dasharray var(--duration-relaxed) var(--ease-enter-snappy), stroke-dashoffset var(--duration-relaxed) var(--ease-enter-snappy), opacity var(--duration-basic); }
  .kc-ring__center { position: relative; display: flex; flex-direction: column; align-items: center; }
  .kc-ring__pct { display: inline-flex; align-items: baseline; gap: 4px; font-size: 17px; line-height: 1.2; font-weight: 600; letter-spacing: -.02em; color: var(--ink); }
  .kc-ring__arrow { color: var(--ink-tertiary); font-weight: 400; }
  .kc-ring__pct :global(.kc-ring__after) { color: var(--success); }
  .kc-facts { display: flex; flex-direction: column; gap: var(--space-3); flex: 1; min-width: 9rem; margin: 0; }
  .kc-facts dt { display: flex; align-items: center; gap: 6px; }
  .kc-facts dd { margin: 2px 0 0; display: flex; align-items: baseline; gap: 6px; }
  .kc-swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--success); }

  /* breakdown */
  .kc-stack { display: flex; gap: 2px; height: 10px; border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--space-3); }
  .kc-stack > span { display: block; min-width: 0; transition: flex var(--duration-relaxed) var(--ease-enter-snappy); }
  .kc-stack__empty { flex: 1; background: var(--k-chart-empty, var(--fill-hover)) !important; }
  .kc-legend__head { display: flex; justify-content: flex-end; gap: var(--space-2); padding: 0 calc(56px + var(--space-3)) 4px 0; color: var(--ink-tertiary); text-transform: uppercase; }
  .kc-legend__head span { width: 5.5rem; text-align: right; }
  .kc-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .kc-legend__row { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 0 var(--space-1); border-radius: var(--radius-md); font-size: 13px; }
  .kc-legend__row:hover { background: var(--fill-subtle); }
  .kc-legend__row > :global(.k-icon) { color: var(--ink-secondary); flex: none; }
  .kc-legend__label { flex: 1; min-width: 0; color: var(--ink); }
  .kc-legend__sel { width: 5.5rem; text-align: right; color: var(--ink-tertiary); white-space: nowrap; }
  .kc-legend__found { width: 5.5rem; text-align: right; color: var(--ink); white-space: nowrap; }
  .kc-legend .k-reveal__item { width: 56px; display: flex; justify-content: flex-end; }

  /* top 5 */
  .kc-top .k-list__item { width: 100%; text-align: left; }
  .kc-top .k-list__content { flex: 1; min-width: 0; }
  .kc-top .k-list__title, .kc-top .k-list__desc { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-top__size { font-size: 13px; color: var(--ink); min-width: 4rem; text-align: right; }
  .kc-top__empty { margin: 0; }

  /* history */
  .kc-hist { padding: 0; }
  .kc-hist__btn { display: block; width: 100%; padding: var(--space-5); text-align: left; border-radius: inherit; color: inherit; }
  .kc-hist__more { display: inline-flex; align-items: center; gap: 2px; font-weight: 400; }
  .kc-hist__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); align-items: end; }
  .kc-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .kc-stat__num--text { font-size: 15px !important; line-height: 1.5 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-spark { width: 100%; height: 40px; overflow: visible; }
</style>
