<script>
  // Historique : chaque nettoyage, avec l’espace réellement regagné sur le disque.
  import { S, CATS, catColor } from './lib/state.svelte.js';
  import { fmt, date, int, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';
  import { fly } from 'svelte/transition';

  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
  const short = new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const gain = (v) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0 o');
  const cat = (id) => CATS.find((c) => c.id === id) ?? { id, label: id, icon: 'folder' };
  const byCat = (h) => Object.entries(h.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const GAP = 'L’écart entre « supprimé » et « disque » vient des liens physiques, de la compression NTFS ou d’autres programmes qui écrivent en même temps.';

  const rows = $derived([...S.history].reverse());
  const n = $derived(S.history.length);
  const total = $derived(S.history.reduce((a, h) => a + Math.max(h.diskGain, 0), 0));
  const deleted = $derived(S.history.reduce((a, h) => a + h.deleted, 0));
  const last = $derived(S.history.at(-1));
  /** per-category totals across all entries, largest first */
  const cats = $derived.by(() => {
    const m = {};
    for (const h of S.history) for (const [c, v] of Object.entries(h.byCat)) m[c] = (m[c] ?? 0) + v;
    return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  });
  const catSum = $derived(cats.reduce((a, [, v]) => a + v, 0));

  // bar chart: 1 unit = 1 px, the viewBox follows the measured width so text keeps its size
  let w = $state(600);
  const H = 170, PAD = { t: 10, r: 8, b: 26, l: 52 };
  const plotW = $derived(Math.max(60, w - PAD.l - PAD.r));
  const plotH = H - PAD.t - PAD.b;
  const max = $derived(Math.max(1, ...S.history.map((h) => h.diskGain)));
  const slot = $derived(plotW / Math.max(1, n));
  const bw = $derived(Math.min(48, Math.max(6, slot * 0.6)));
  const every = $derived(Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 72)))));
  const bars = $derived.by(() => {
    const days = S.history.map((h) => short.format(new Date(h.at)));
    return S.history.map((h, i) => {
      const hh = Math.max(0, h.diskGain) / max * plotH;
      const dup = days.indexOf(days[i]) !== days.lastIndexOf(days[i]);
      return { h, x: PAD.l + i * slot, cx: PAD.l + i * slot + slot / 2, bx: PAD.l + i * slot + (slot - bw) / 2, y: PAD.t + plotH - hh, hh,
        label: (n - 1 - i) % every === 0 ? (dup ? `${days[i]} ${time.format(new Date(h.at))}` : days[i]) : '' };
    });
  });
  const ticks = $derived([0, 0.5, 1].map((f) => ({ y: PAD.t + plotH - f * plotH, v: f * max })));
</script>

<header class="k-page-header">
  <div class="k-page-header__content">
    <div class="k-page-header__heading">
      <h1 class="k-page-header__title">Historique</h1>
      <p class="k-page-header__subtitle">Chaque nettoyage, avec l’espace réellement regagné sur le disque.</p>
    </div>
  </div>
</header>

{#if n}
  <div class="kc-tiles">
    {#each [
      { label: 'Espace regagné au total', value: total, kind: 'bytes', sub: `depuis le ${short.format(new Date(S.history[0].at))}` },
      { label: 'Nettoyages', value: n, kind: 'int', sub: `${int(deleted)} fichiers supprimés` },
      { label: 'Moyenne par nettoyage', value: total / n, kind: 'bytes', sub: 'regagné sur le disque' },
      { label: 'Dernier nettoyage', value: Math.max(last.diskGain, 0), kind: 'bytes', sub: date(last.at) },
    ] as t, i (t.label)}
      <article class="k-card k-card--full kc-tile" in:fly|global={{ y: 6, duration: dur, delay: i * 40 }}>
        <div class="k-card__body">
          <span class="kc-stat__label">{t.label}</span>
          <span class="kc-stat__num"><Num value={t.value} kind={t.kind} /></span>
          <span class="kc-stat__label kc-tile__sub">{t.sub}</span>
        </div>
      </article>
    {/each}
  </div>

  <article class="k-card k-card--full kc-chart-card" in:fly|global={{ y: 6, duration: dur, delay: 160 }}>
    <div class="k-card__body">
      <h2 class="kc-card__title"><Icon name="chart-column" />Espace regagné par nettoyage</h2>
      <div class="k-chart k-chart--grow kc-chart" data-kube="chart" bind:clientWidth={w}>
        <svg class="k-chart__plot" viewBox="0 0 {w} {H}" height={H} role="img" aria-label="Espace regagné sur le disque, par nettoyage">
          <g class="k-chart__grid">
            {#each ticks as t (t.y)}<line x1={PAD.l} x2={w - PAD.r} y1={t.y} y2={t.y} />{/each}
          </g>
          <g class="k-chart__axis">
            {#each ticks as t (t.y)}<text class="k-chart__tick" x={PAD.l - 8} y={t.y + 4} text-anchor="end">{t.v ? fmt(t.v) : '0'}</text>{/each}
            {#each bars as b (b.h.at)}
              {#if b.label}<text class="k-chart__tick" x={b.cx} y={H - 8} text-anchor="middle">{b.label}</text>{/if}
            {/each}
          </g>
          {#each bars as b, i (b.h.at)}
            <g class="k-chart__col" data-x={date(b.h.at)}>
              <rect class="k-chart__band" x={b.x} y={PAD.t} width={slot} height={plotH} rx="4" />
              <rect class="k-chart__hit" x={b.x} y={PAD.t} width={slot} height={plotH} />
              <rect class="k-chart__bar kc-bar" class:kc-bar--last={i === n - 1} data-label="Disque" data-value={gain(b.h.diskGain)} x={b.bx} y={b.y} width={bw} height={Math.max(b.hh, b.h.diskGain > 0 ? 2 : 0)} />
            </g>
          {/each}
        </svg>
      </div>

      <hr class="k-divider" />

      <h2 class="kc-card__title"><Icon name="chart-bar" />Par catégorie<span class="kc-card__meta">{fmt(catSum)} supprimés sur {plural(n, 'nettoyage', 'nettoyages')}</span></h2>
      <div class="kc-stack" role="img" aria-label="Répartition par catégorie">
        {#each cats as [c, v] (c)}
          <span style:flex={v} style:background={catColor(c)} data-kube="tooltip" data-kube-tooltip="{cat(c).label} · {fmt(v)}"></span>
        {/each}
      </div>
      <ul class="kc-legend">
        {#each cats as [c, v] (c)}
          <li class="kc-legend__row">
            <span class="kc-dot" style:background={catColor(c)}></span>
            <Icon name={cat(c).icon} />
            <span class="kc-legend__label">{cat(c).label}</span>
            <span class="kc-legend__value">{fmt(v)}</span>
          </li>
        {/each}
      </ul>
    </div>
  </article>

  <ol class="k-timeline kc-timeline">
    {#each rows as h, i (h.at)}
      <li class="k-timeline__item" in:fly|global={{ y: 6, duration: dur, delay: 200 + Math.min(i, 8) * 25 }}>
        <time class="k-timeline__time" datetime={new Date(h.at).toISOString()}>{date(h.at)}</time>
        <span class="k-timeline__rail" aria-hidden="true"><span class="k-timeline__dot"></span></span>
        <div class="k-timeline__content">
          <div class="k-timeline__title kc-entry__title">
            <span>{h.diskGain > 0 ? `${gain(h.diskGain)} sur le disque` : 'Aucun gain mesuré sur le disque'}</span>
            <span class="kc-entry__freed" data-kube="tooltip" data-kube-tooltip={GAP} data-kube-size="lg">{fmt(h.freed)} supprimés</span>
          </div>
          <div class="kc-chips">
            {#each byCat(h) as [c, v] (c)}
              <span class="k-badge"><span class="kc-dot" style:background={catColor(c)}></span>{cat(c).label}<span class="kc-chip__size">{fmt(v)}</span></span>
            {/each}
          </div>
          <div class="k-timeline__desc">{int(h.deleted)} supprimés{h.skipped ? ` · ${int(h.skipped)} ${h.skipped > 1 ? 'laissés' : 'laissé'}` : ''}{h.recycled ? ` · ${int(h.recycled)} à la Corbeille` : ''}</div>
        </div>
      </li>
    {/each}
  </ol>

  <p class="kc-foot">« Supprimé » est la taille des fichiers effacés ; « Disque » est l’espace libre mesuré avant et après. Ils peuvent différer : liens physiques, compression NTFS, ou d’autres programmes qui écrivent en même temps.</p>
{:else}
  <div class="k-empty k-empty--page">
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="clock-arrow-left" /></div>
      <div class="k-empty__text">
        <h2 class="k-empty__title">Aucun nettoyage pour le moment</h2>
        <p class="k-empty__desc">Chaque nettoyage sera noté ici avec l’espace réellement regagné sur le disque.</p>
      </div>
      <div class="k-empty__actions"><button class="k-btn" type="button" onclick={() => (S.view = 'clean')}><Icon name="broom-sparkles" />Voir ce qui peut partir</button></div>
    </div>
  </div>
{/if}

<style>
  .kc-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-5); }
  @media (max-width: 1050px) { .kc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .kc-tile .k-card__body { gap: 2px; }
  .kc-tile .kc-stat__label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-tile .kc-stat__num { margin-block: 2px; }

  .kc-chart-card { margin-top: var(--space-3); }
  .kc-chart-card .k-card__body { gap: var(--space-3); }
  .kc-chart-card .k-divider { margin-block: var(--space-1); }
  /* neutral series: only the latest cleanup is drawn in ink */
  .kc-bar { fill: var(--ink-tertiary); rx: var(--radius-xs); }
  .kc-bar--last { fill: var(--ink); }
  .kc-chart :global(.k-chart__marker) { background: var(--ink); }

  .kc-stack { display: flex; gap: 2px; height: 10px; border-radius: var(--radius-full); overflow: hidden; }
  .kc-stack > span { display: block; min-width: 3px; }
  .kc-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .kc-legend__row { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 0 var(--space-1); border-radius: var(--radius-md); font-size: 13px; }
  .kc-legend__row:hover { background: var(--fill-subtle); }
  .kc-legend__row > :global(.k-icon) { color: var(--ink-tertiary); flex: none; }
  .kc-legend__label { flex: 1; min-width: 0; color: var(--ink); }
  .kc-legend__value { min-width: 4.5rem; text-align: right; color: var(--ink-secondary); white-space: nowrap; }
  .kc-dot { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 50%; }

  .kc-timeline { --k-timeline-time: 128px; margin: var(--space-6) 0 0; padding: 0; }
  .kc-entry__title { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); }
  .kc-entry__freed { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--ink-secondary); white-space: nowrap; cursor: help; }
  .kc-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 4px; }
  .kc-chips .k-badge { gap: 5px; font-weight: 500; }
  .kc-chips .kc-dot { width: 8px; height: 8px; }
  .kc-chip__size { color: var(--ink-secondary); font-weight: 400; }

  .kc-foot { margin: var(--space-2) 0 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); text-wrap: pretty; }
</style>
