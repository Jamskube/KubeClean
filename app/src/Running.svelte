<script>
  // Superposition pendant le nettoyage : octets libérés, progression, règles traitées une à une.
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { S } from './lib/state.svelte.js';
  import { fmt } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (ms) => (rm ? 0 : ms);
  // snapshot: the selection stays valid during the clean, but a fresh scan follows right after
  const steps = untrack(() => S.picked.map((r) => ({ id: r.id, title: r.title, size: S.selSize(r), sizeKnown: r.sizeKnown, needsAdmin: r.needsAdmin })));
  const done = $derived(S.progress?.phase === 'clean' ? S.progress.done : 0);
  const total = $derived(S.progress?.total ?? steps.length);
  const measuring = $derived(done >= total && total > 0);
  const status = (i) => (i < done ? 'done' : i === done ? 'current' : 'pending');
  /** keeps the active row in view (re-runs when `done` moves) */
  const follow = (i) => (el) => { if (status(i) === 'current') el.scrollIntoView({ block: 'nearest', behavior: rm ? 'auto' : 'smooth' }); };
  const label = $derived(measuring ? 'Mesure du disque' : S.progress?.label ?? 'Préparation');
  // le focus suit la bascule seulement, jamais la première apparition
  let toggled = false;
  const reduce = (on) => { toggled = true; S.runMini = on; };
  const focusIfToggled = (el) => { if (toggled) el.focus({ preventScroll: true }); };
  function onKey(e) {
    if (e.key === 'Escape' && !S.runMini && !e.defaultPrevented && !document.querySelector('dialog[open]')) { e.preventDefault(); reduce(true); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if S.runMini}
<div class="kc-mini k-card k-card--shadow" role="status" aria-live="polite" transition:fly={{ y: 12, duration: dur(220) }}>
  <div class="kc-mini__head">
    <span class="kc-mini__icon"><Icon name="broom-sparkles" /></span>
    <div class="kc-mini__text">
      <strong><Num value={S.progress?.freed ?? 0} duration={900} /> libérés</strong>
      <span class="k-shimmer k-shimmer--strong">{label}…</span>
    </div>
    <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Agrandir la progression du nettoyage" data-kube="tooltip" data-kube-tooltip="Agrandir" onclick={() => reduce(false)} {@attach focusIfToggled}><Icon name="maximize-2" /></button>
  </div>
  <div class="kc-mini__bar">
    <div class="k-progress k-progress--sm" role="progressbar" aria-label="Progression du nettoyage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={total ? Math.round((done / total) * 100) : 0}
      style:--k-progress={total ? done / total : 0}><div class="k-progress__bar"></div></div>
    <span>{Math.min(done, total)}/{total}</span>
  </div>
</div>
{:else}

<div class="kc-run" transition:fade={{ duration: dur(200) }}>
  <div class="kc-run__card k-card k-card--shadow" role="status" aria-live="polite" in:fly={{ y: 12, duration: dur(300) }}>
    <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm kc-run__reduce" type="button" aria-label="Réduire la progression dans un coin (Échap)" data-kube="tooltip" data-kube-tooltip="Réduire · Échap" onclick={() => reduce(true)} {@attach focusIfToggled}><Icon name="minimize-2" /></button>
    <div class="kc-run__hero">
      <span class="kc-run__icon"><Icon name="broom-sparkles" /></span>
      <p class="kc-num-hero"><Num value={S.progress?.freed ?? 0} duration={900} /><span class="kc-num-hero__unit">libérés</span></p>
    </div>
    <div class="k-progress-row kc-run__bar">
      <span class="k-progress-row__label k-shimmer k-shimmer--strong">{label}…</span>
      <div class="k-progress" role="progressbar" aria-label="Progression du nettoyage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={total ? Math.round((done / total) * 100) : 0}
        style:--k-progress={total ? done / total : 0}><div class="k-progress__bar"></div></div>
      <span class="k-progress-row__value">{Math.min(done, total)}/{total}</span>
    </div>
    <ol class="k-timeline kc-run__steps">
      {#each steps as s, i (s.id)}
        <li class="k-timeline__item" class:k-timeline__item--current={status(i) === 'current'} data-status={status(i)} {@attach follow(i)}>
          <span class="k-timeline__time kc-run__size">{s.sizeKnown ? fmt(s.size) : '—'}</span>
          <span class="k-timeline__rail" aria-hidden="true"><span class="k-timeline__dot"></span></span>
          <div class="k-timeline__content">
            <div class="kc-run__title">
              {#if status(i) === 'done'}<Icon name="check" />{:else if status(i) === 'current'}<span class="k-dot-pulse" style="--k-dot-size: 6px; --k-dot-color: var(--accent)"></span>{/if}
              <span class={status(i) === 'current' ? 'k-shimmer k-shimmer--strong' : ''}>{s.title}</span>
              {#if s.needsAdmin}<span class="k-badge"><Icon name="shield" />Admin</span>{/if}
            </div>
          </div>
        </li>
      {/each}
      <li class="k-timeline__item" class:k-timeline__item--current={measuring} data-status={measuring ? 'current' : 'pending'} {@attach follow(steps.length)}>
        <span class="k-timeline__time kc-run__size"></span>
        <span class="k-timeline__rail" aria-hidden="true"><span class="k-timeline__dot"></span></span>
        <div class="k-timeline__content"><div class="kc-run__title">{#if measuring}<span class="k-dot-pulse" style="--k-dot-size: 6px; --k-dot-color: var(--accent)"></span>{/if}<span class={measuring ? 'k-shimmer k-shimmer--strong' : ''}>Mesure du disque</span></div></div>
      </li>
    </ol>
    <p class="kc-run__note"><Icon name="info" />Les fichiers ouverts ou modifiés depuis l’analyse sont laissés en place.</p>
    <p class="kc-run__note kc-run__note--strong"><Icon name="triangle-alert" />Ne ferme pas l’application pendant le nettoyage.</p>
  </div>
</div>
{/if}

<style>
  .kc-run { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: var(--space-6); background: var(--scrim-dim); -webkit-backdrop-filter: blur(var(--blur-xs)); backdrop-filter: blur(var(--blur-xs)); }
  .kc-run__card { position: relative; width: min(30rem, 100%); max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6) var(--space-6) var(--space-5); }
  .kc-run__hero { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center; }
  .kc-run__hero .kc-num-hero { margin: 0; }
  .kc-run__icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-xl); background: var(--accent-subtle); color: var(--accent); }
  .kc-run__icon :global(.k-icon) { --k-icon-size: 24px; }
  .kc-run__steps { --k-timeline-time: 56px; margin: 0; padding: 0; list-style: none; max-height: 36vh; overflow-y: auto; overscroll-behavior: contain; }
  .kc-run__steps .k-timeline__content { padding-top: 9px; padding-bottom: 9px; }
  .kc-run__size { padding-top: 11px; text-align: end; }
  .kc-run__title { display: flex; align-items: center; gap: var(--space-2); min-height: 20px; font-size: 13px; line-height: 20px; color: var(--ink-secondary); }
  .kc-run__title :global(.k-icon) { --k-icon-size: 14px; color: var(--success); }
  .kc-run__title :global(.k-badge .k-icon) { color: inherit; }
  [data-status='current'] .kc-run__title { color: var(--ink); font-weight: 500; }
  [data-status='pending'] .kc-run__title { color: var(--ink-tertiary); }
  [data-status='pending'] .k-timeline__dot { background: none; box-shadow: inset 0 0 0 1px var(--ink-tertiary); }
  .kc-run__note { display: flex; align-items: flex-start; gap: var(--space-2); margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-run__note :global(.k-icon) { --k-icon-size: 14px; flex: none; margin-top: 1px; color: var(--ink-tertiary); }
  .kc-run__note--strong { color: var(--ink); }
  .kc-run__note--strong :global(.k-icon) { color: var(--warning); }
  .kc-run__note + .kc-run__note { margin-top: calc(-1 * var(--space-2)); }
  .kc-run__reduce { position: absolute; top: var(--space-3); right: var(--space-3); }
  .kc-mini { width: min(19rem, calc(100vw - 2 * var(--space-4))); display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-3) var(--space-4) var(--space-4); }
  .kc-mini__head { display: flex; align-items: center; gap: var(--space-3); }
  .kc-mini__icon { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-lg); background: var(--accent-subtle); color: var(--accent); }
  .kc-mini__icon :global(.k-icon) { --k-icon-size: 16px; }
  .kc-mini__text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-mini__text strong { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-mini__text span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .kc-mini__bar { display: flex; align-items: center; gap: var(--space-3); padding-right: var(--space-1); font-size: 12px; color: var(--ink-tertiary); font-variant-numeric: tabular-nums; }
  .kc-mini__bar .k-progress { flex: 1; }
</style>
