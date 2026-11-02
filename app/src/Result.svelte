<script>
  // Écran de résultat après un nettoyage : espace libéré, disque avant/après, détail par catégorie.
  import { fly } from 'svelte/transition';
  import { S, CATS, catColor, describeReport } from './lib/state.svelte.js';
  import { fmt, plural, drive } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (ms) => (rm ? 0 : ms);
  // figures start at 0 and count up once mounted
  let ready = $state(false);
  $effect(() => { ready = true; });
  const up = (v) => (ready ? v : 0);

  const R = $derived(S.lastReport);
  const rep = $derived(R?.rep);
  const sysOf = (drives) => drives?.find((d) => d.root.toUpperCase().startsWith('C:')) ?? drives?.[0];
  const before = $derived(sysOf(R?.before));
  const after = $derived(sysOf(R?.after));
  const lossy = $derived(rep && rep.freed > 0 && rep.diskGain < rep.freed * 0.9);
  /** bytes freed per category: picked rules' cats, admin tasks under 'admin' */
  const byCat = $derived.by(() => {
    if (!rep) return [];
    const m = {};
    for (const p of R.picked) { const st = rep.byRule[p.id]; if (st?.freed) m[p.cat] = (m[p.cat] ?? 0) + st.freed; }
    for (const t of rep.tasks ?? []) if (t.ok && t.stats?.freed) m.admin = (m.admin ?? 0) + t.stats.freed;
    return CATS.filter((c) => m[c.id]).map((c) => ({ ...c, freed: m[c.id] }));
  });
  const maxCat = $derived(Math.max(1, ...byCat.map((c) => c.freed)));
  // sentences already shown elsewhere on this screen (gain, counts, admin) are dropped
  const shown = /^(Espace libre gagné|[0-9][0-9\u202f\u00a0 ]* élément|Les tâches administrateur|Tâches administrateur)/;
  const notes = $derived(rep ? describeReport(rep).filter((n) => !shown.test(n) && !(rep.tasks ?? []).some((t) => !t.ok && n.startsWith(t.task))) : []);
  const failed = $derived((rep?.tasks ?? []).filter((t) => !t.ok));
  const taskTitle = (id) => R.picked.find((p) => p.id === id)?.title ?? id;
  const stats = $derived(rep ? [
    { label: 'supprimés', value: rep.deleted },
    { label: 'envoyés à la Corbeille', value: rep.recycled },
    { label: 'laissés en place', value: rep.skipped, tip: 'Ouverts, protégés ou modifiés depuis l’analyse : revérifiés juste avant, donc laissés.' },
  ].filter((t) => t.value > 0) : []);
</script>

{#if R}
  <div class="kc-result">
    <section class="kc-hero" in:fly={{ y: 8, duration: dur(300) }}>
      <span class="kc-hero__icon"><Icon name="sparkles" /></span>
      <h1 class="kc-num-hero"><Num value={up(rep.freed)} duration={1200} /><span class="kc-num-hero__unit">libérés</span></h1>
      <p class="kc-hero__sub">
        espace libre gagné&nbsp;: <strong><Num value={up(rep.diskGain)} duration={1200} /></strong>
        {#if lossy}<br /><span class="kc-hero__why">Moins que la somme des fichiers : certains étaient compressés ou partagés entre plusieurs emplacements (liens physiques).</span>{/if}
      </p>
      {#if stats.length}
        <p class="kc-hero__stats">
          {#each stats as t, i (t.label)}
            {#if i}<span class="kc-hero__dot" aria-hidden="true">·</span>{/if}
            <span class="kc-hero__stat" data-kube={t.tip ? 'tooltip' : undefined} data-kube-tooltip={t.tip}><strong><Num value={up(t.value)} kind="int" duration={1000} /></strong> {t.label}{#if t.tip}<Icon name="circle-question-mark" />{/if}</span>
          {/each}
        </p>
      {/if}
    </section>

    {#if rep.elevation || failed.length}
      <div class="k-banner k-banner--warning k-banner--compact" role="status" in:fly={{ y: 8, duration: dur(260), delay: dur(60) }}>
        <span class="k-banner__icon"><Icon name="shield-alert" /></span>
        <div class="k-banner__content">
          <p class="k-banner__title">{rep.elevation === 'refused' ? 'Tâches administrateur non lancées : autorisation refusée' : rep.elevation ? `Tâches administrateur : ${rep.elevation}` : 'Certaines tâches administrateur ont échoué'}</p>
          {#if failed.length}<p class="k-banner__description">{failed.map((t) => `${taskTitle(t.task)} : ${t.error}`).join(' · ')}</p>{/if}
        </div>
      </div>
    {/if}

    {#if before && after}
      <section class="k-card k-card--full kc-block" in:fly={{ y: 8, duration: dur(260), delay: dur(80) }}>
        <h2 class="kc-card__title"><Icon name="hard-drive" />Disque {drive(after.root)}<span class="kc-card__meta">espace libre</span></h2>
        {#each [['Avant', before], ['Après', after]] as [label, d] (label)}
          <div class="kc-drive">
            <span class="kc-drive__label">{label}</span>
            <div class="k-progress k-progress--sm" role="progressbar" aria-label="Espace libre {label.toLowerCase()}" aria-valuemin="0" aria-valuemax="100"
              aria-valuenow={Math.round((d.free / d.total) * 100)} style:--k-progress={ready ? d.free / d.total : before.free / before.total}
              style:--k-progress-color={label === 'Après' ? 'var(--success)' : 'var(--ink-tertiary)'}><div class="k-progress__bar"></div></div>
            <span class="kc-drive__free"><Num value={ready ? d.free : before.free} duration={1200} /> libres</span>
          </div>
        {/each}
      </section>
    {/if}

    {#if byCat.length}
      <section class="k-card k-card--full kc-block" in:fly={{ y: 8, duration: dur(260), delay: dur(300) }}>
        <h2 class="kc-card__title"><Icon name="chart-bar" />Par catégorie</h2>
        <ul class="kc-cats">
          {#each byCat as c, i (c.id)}
            <li class="kc-cat" in:fly={{ y: 6, duration: dur(220), delay: dur(340 + i * 40) }}>
              <span class="kc-cat__icon" style:color={catColor(c.id)}><Icon name={c.icon} /></span>
              <span class="kc-cat__label">{c.label}</span>
              <div class="k-progress k-progress--sm kc-cat__bar" role="progressbar" aria-label="{c.label} : {fmt(c.freed)}" aria-valuemin="0" aria-valuemax="100"
                aria-valuenow={Math.round((c.freed / maxCat) * 100)} style:--k-progress={ready ? c.freed / maxCat : 0} style:--k-progress-color={catColor(c.id)}><div class="k-progress__bar"></div></div>
              <span class="kc-cat__size"><Num value={up(c.freed)} duration={1000} /></span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if notes.length}
      <ul class="kc-notes" in:fly={{ y: 8, duration: dur(260), delay: dur(400) }}>
        {#each notes as n (n)}<li><Icon name="info" />{n}</li>{/each}
      </ul>
    {/if}

    <div class="kc-actions" in:fly={{ y: 8, duration: dur(260), delay: dur(440) }}>
      <button class="k-btn k-btn--primary" type="button" onclick={() => (S.view = 'dashboard')}><Icon name="layout-dashboard" />Tableau de bord</button>
      <button class="k-btn" type="button" onclick={() => (S.view = 'history')}><Icon name="clock-arrow-left" />Historique</button>
      <button class="k-btn" type="button" onclick={() => (S.view = 'clean')}><Icon name="scan-search" />Analyser à nouveau</button>
    </div>
  </div>
{:else}
  <div class="k-empty k-empty--page">
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="broom-sparkles" /></div>
      <div class="k-empty__text">
        <h2 class="k-empty__title">Aucun nettoyage récent</h2>
        <p class="k-empty__desc">Le résultat du dernier nettoyage s’affiche ici.</p>
      </div>
      <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" onclick={() => (S.view = 'dashboard')}>Tableau de bord</button></div>
    </div>
  </div>
{/if}

<style>
  .kc-result { display: flex; flex-direction: column; gap: var(--space-4); }
  .kc-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-2); padding: var(--space-6) 0 var(--space-4); }
  .kc-hero__icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-xl); background: var(--success-subtle); color: var(--success); }
  .kc-hero__icon :global(.k-icon) { --k-icon-size: 24px; }
  .kc-hero :global(.kc-num-hero) { margin: 0; }
  .kc-hero__sub { margin: 0; font-size: 14px; line-height: 20px; color: var(--ink-secondary); max-width: 36rem; }
  .kc-hero__sub strong { font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-hero__why { display: inline-block; margin-top: var(--space-1); font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-hero__stats { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin: var(--space-1) 0 0; font-size: 13px; line-height: 20px; color: var(--ink-secondary); }
  .kc-hero__stats strong { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-hero__stat { display: inline-flex; align-items: center; gap: 4px; }
  .kc-hero__stat :global(.k-icon) { --k-icon-size: 14px; color: var(--ink-tertiary); }
  .kc-hero__dot { color: var(--ink-tertiary); }
  .kc-block { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
  .kc-drive { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); font-size: 13px; }
  .kc-drive__label { color: var(--ink-secondary); }
  .kc-drive__free { color: var(--ink); font-variant-numeric: tabular-nums; min-width: 8rem; text-align: end; }
  .kc-cats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .kc-cat { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; grid-template-areas: 'icon label size' 'icon bar bar'; align-items: center; gap: var(--space-1) var(--space-3); font-size: 13px; }
  .kc-cat__icon { grid-area: icon; display: flex; }
  .kc-cat__label { grid-area: label; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-cat__bar { grid-area: bar; }
  .kc-cat__size { grid-area: size; }
  .kc-cat__size { color: var(--ink-secondary); font-variant-numeric: tabular-nums; min-width: 5rem; text-align: end; }
  .kc-notes { list-style: none; margin: 0; padding: 0 var(--space-1); display: flex; flex-direction: column; gap: var(--space-2); font-size: 13px; line-height: 18px; color: var(--ink-secondary); }
  .kc-notes li { display: flex; gap: var(--space-2); align-items: flex-start; }
  .kc-notes :global(.k-icon) { flex: none; margin-top: 1px; color: var(--ink-tertiary); }
  .kc-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: center; padding-top: var(--space-2); }
</style>
