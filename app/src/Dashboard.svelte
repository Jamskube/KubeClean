<script>
  import { tick } from 'svelte';
  import { S, CATS, catColor, appName, MAC } from './lib/state.svelte.js';
  import { fmt, date, drive, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const scanning = $derived(S.busy === 'scan');
  const rules = $derived(scanning ? S.live : S.rules);
  const found = $derived(rules.reduce((sum, r) => sum + r.size, 0));
  // Le raccourci rétablit les recommandations : le montant décrit cette action.
  const recommended = $derived(S.defaultSize);
  const review = $derived(Math.max(0, found - recommended));
  const cats = $derived(CATS.map((c) => ({ ...c, size: rules.filter((r) => r.cat === c.id).reduce((sum, r) => sum + r.size, 0) })));
  const top = $derived([...rules].filter((r) => r.size > 0).sort((a, b) => b.size - a.size).slice(0, 4));
  const openApps = $derived([...new Set(rules.filter((r) => r.size > 0).flatMap((r) => r.blockedBy ?? []))]);
  const pct = $derived(S.progress?.total ? S.progress.done / S.progress.total : 0);
  const d = $derived(S.systemDrive);
  const usedPct = $derived(d?.total ? Math.max(0, Math.min(100, (1 - d.free / d.total) * 100)) : 0);

  async function toCat(id) {
    S.cleanFilter = 'all'; S.view = 'clean';
    await tick();
    document.getElementById(`cat-${id}`)?.scrollIntoView({ block: 'start' });
  }
  function inspect(id) { S.cleanFilter = 'all'; S.view = 'clean'; S.panel = id; }
</script>

<header class="kc-overview-head">
  <div><h1>Vue d’ensemble</h1><p>{scanning ? 'Analyse en cours. Aucun fichier n’est modifié.' : S.scan ? `Dernière analyse · ${date(S.scan.at)}` : 'Un état des lieux, avant de faire de la place.'}</p></div>
  <button class="k-btn k-btn--outline" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="refresh-cw" />Actualiser</button>
</header>

{#if !S.scan && !scanning}
  <div class="k-empty k-empty--page"><div class="k-empty__body">
    <img src="icon.png" width="80" height="80" alt="" />
    <div class="k-empty__text"><h2 class="k-empty__title">Fais le point sur ton espace</h2><p class="k-empty__desc">Repère les caches, les fichiers temporaires et les dossiers volumineux. Tu choisis ensuite ce qui peut partir.</p></div>
    <button class="k-btn k-btn--primary" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="scan-search" />Analyser mon ordinateur</button>
  </div></div>
{:else}
  <div class="kc-overview">
    <section class="k-card k-card--full kc-recommended" aria-labelledby="recommended-title">
      <div class="kc-recommended__heading"><span class="kc-feature-icon"><Icon name="sparkles" /></span><h2 id="recommended-title">Nettoyage recommandé</h2></div>
      <div class="kc-recommended__amount"><Num value={recommended} /><span>{scanning ? 'repérés pour l’instant' : 'à nettoyer'}</span></div>
      <p class="kc-recommended__desc">Caches, temporaires et fichiers générés.<br />Tes fichiers personnels restent à ta main.</p>
      {#if scanning}
        <div class="kc-scan" aria-live="polite">
          <div class="kc-scan__label"><span>{S.progress?.label ?? 'Préparation…'}</span><span>{Math.round(pct * 100)} %</span></div>
          <div class="k-progress" role="progressbar" aria-label="Analyse" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(pct * 100)} style:--k-progress={pct}><div class="k-progress__bar"></div></div>
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" onclick={() => S.cancel()}>Annuler l’analyse</button>
        </div>
      {:else}
        <div class="kc-recommended__actions">
          <button class="k-btn k-btn--primary k-btn--lg" type="button" data-action="clean" data-kube="press" disabled={!!S.busy || !recommended} onclick={() => S.quickClean()}><Icon name="sparkles" />Nettoyer {fmt(recommended)}</button>
          <button class="k-btn k-btn--ghost k-btn--lg" type="button" onclick={() => { S.cleanFilter = 'all'; S.view = 'clean'; }}>Personnaliser<Icon name="arrow-right" /></button>
        </div>
        <span class="kc-confirm-note"><Icon name="shield-check" />Tu vérifies et confirmes avant toute suppression.</span>
      {/if}
    </section>

    <section class="k-card k-card--full kc-storage" aria-labelledby="storage-title">
      <div class="kc-section-heading"><h2 id="storage-title">Espace disque</h2><Icon name="hard-drive" /></div>
      {#if d}
        <div class="kc-storage__summary">
          <div class="kc-ring">
            <svg class="k-donut" viewBox="0 0 24 24" style:--k-progress={usedPct} role="img" aria-label="Disque {drive(d.root)} : {Math.round(usedPct)} % utilisés">
              <circle class="k-donut__track" cx="12" cy="12" r="11" /><circle class="k-donut__arc" cx="12" cy="12" r="11" pathLength="100" />
            </svg><span>{#if d.root === '/'}<Icon name="hard-drive" />{:else}{drive(d.root)}{/if}</span>
          </div>
          <div class="kc-storage__free"><Num value={d.free} /><span>libres sur {fmt(d.total)}</span><span class:kc-storage__warning={d.free / d.total < 0.1}>{d.free / d.total < 0.1 ? 'Espace bientôt saturé' : `${Math.round(usedPct)} % utilisés`}</span></div>
        </div>
      {/if}
      <div class="kc-storage__drives">
        {#each S.drives.filter((disk) => disk !== d) as disk (disk.root)}
          <div class="kc-storage__drive"><Icon name="hard-drive" /><strong>{drive(disk.root)}</strong><span>{fmt(disk.free)} libres</span></div>
        {/each}
      </div>
      <p class="kc-storage__note">Mesure actuelle. L’espace réellement récupéré sera mesuré après le nettoyage.</p>
    </section>

    <button class="kc-review" type="button" disabled={!!S.busy} onclick={() => { S.cleanFilter = 'review'; S.view = 'clean'; }}>
      <Icon name="scan-eye" /><span class="kc-review__copy"><strong>À examiner avec toi</strong><span>{MAC ? 'Gros fichiers et vieux téléchargements à choisir.' : 'Fichiers personnels, projets et opérations à choisir.'}</span></span>
      <span class="kc-review__amount"><Num value={review} /><Icon name="arrow-right" /></span>
    </button>

    <section class="kc-breakdown" aria-labelledby="breakdown-title">
      <div class="kc-section-heading"><h2 id="breakdown-title">Où se trouve l’espace à nettoyer</h2><span>{fmt(found)} repérés</span></div>
      <div class="kc-stack" role="img" aria-label="Répartition des fichiers repérés par catégorie">
        {#each cats as c (c.id)}{#if c.size}<span style:flex={c.size} style:background={catColor(c.id)} title="{c.label} : {fmt(c.size)}"></span>{/if}{/each}
      </div>
      {#each cats as c (c.id)}
        <button class="kc-category" type="button" disabled={scanning} onclick={() => toCat(c.id)}>
          <span class="kc-category__dot" style:background={catColor(c.id)}></span><Icon name={c.icon} />
          <span class="kc-row-copy"><strong>{c.label}</strong><span>{c.blurb}</span></span><span class="kc-row-size">{c.size ? fmt(c.size) : '—'}</span><Icon name="chevron-right" />
        </button>
      {/each}
    </section>

    <section class="kc-priorities" aria-labelledby="priorities-title">
      <div class="kc-section-heading"><h2 id="priorities-title">Les plus gros postes</h2></div>
      {#each top as r (r.id)}
        <button class="kc-priority" type="button" disabled={scanning} onclick={() => inspect(r.id)}>
          <span class="kc-row-copy"><strong>{r.title}</strong><span>{r.needsAdmin ? 'Autorisation Windows requise' : r.toRecycle ? 'À choisir · vers la Corbeille' : r.perItem ? 'À examiner élément par élément' : r.default ? 'Inclus dans les recommandations' : 'À choisir manuellement'}</span></span>
          <span class="kc-row-size">{fmt(r.size)}</span><Icon name="chevron-right" />
        </button>
      {/each}
      {#if !top.length}<p class="kc-storage__note">{scanning ? 'Les résultats arrivent au fil de l’analyse…' : 'Rien à nettoyer dans les règles analysées.'}</p>{/if}
      {#if openApps.length}
        <div class="kc-apps-note"><Icon name="info" /><p><strong>{plural(openApps.length, 'application ouverte', 'applications ouvertes')}</strong><span>{openApps.map(appName).join(', ')}. Ferme-les puis actualise pour réévaluer leurs caches. Les fichiers verrouillés restent en place.</span></p></div>
      {/if}
    </section>
    <div class="kc-trust"><Icon name="shield-check" /><p>Analyse en lecture seule · Éléments revérifiés avant suppression · Fichiers personnels vers la Corbeille</p></div>
  </div>
{/if}

<style>
  .kc-overview-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin: var(--space-2) 0 var(--space-6); }
  .kc-overview-head h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; }
  .kc-overview-head p { margin: 6px 0 0; font-size: 13px; color: var(--ink-secondary); }
  .kc-overview-head > button { flex: none; }
  .kc-overview { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: var(--space-6); }
  .kc-overview > * { min-width: 0; }
  h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.015em; }
  .kc-recommended, .kc-storage { padding: var(--space-6); }
  .kc-recommended { display: flex; flex-direction: column; align-items: flex-start; }
  .kc-recommended__heading { display: flex; align-items: center; gap: var(--space-3); }
  .kc-feature-icon { width: 32px; height: 32px; border-radius: var(--radius-lg); display: grid; place-items: center; color: var(--link); background: var(--accent-subtle); }
  .kc-recommended__amount { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-top: var(--space-5); }
  .kc-recommended__amount :global(.num) { font-size: 48px; font-weight: 600; letter-spacing: -.035em; line-height: 1.15; }
  .kc-recommended__amount > span { font-size: 15px; color: var(--ink-secondary); }
  .kc-recommended__desc { margin: var(--space-3) 0 var(--space-5); font-size: 13px; line-height: 1.65; color: var(--ink-secondary); }
  .kc-recommended__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: auto; }
  .kc-confirm-note { display: flex; align-items: center; gap: 6px; margin-top: var(--space-3); font-size: 12px; color: var(--ink-secondary); }
  .kc-confirm-note :global(.k-icon) { flex: none; width: 14px; }
  .kc-section-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
  .kc-section-heading > span, .kc-section-heading > :global(.k-icon) { color: var(--ink-secondary); font-size: 12px; flex: none; }
  .kc-storage { display: flex; flex-direction: column; }
  .kc-storage__summary { display: flex; align-items: center; gap: var(--space-4); margin: var(--space-3) 0 var(--space-5); }
  .kc-ring { position: relative; width: 94px; height: 94px; flex: none; display: grid; place-items: center; }
  .kc-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; stroke-width: 1.6; color: var(--ink-secondary); }
  .kc-ring > span { font-size: 18px; font-weight: 600; }
  .kc-storage__free { min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-secondary); }
  .kc-storage__free :global(.num) { font-size: 25px; font-weight: 600; color: var(--ink); letter-spacing: -.025em; }
  .kc-storage__warning { color: var(--warning); }
  .kc-storage__drives { display: flex; flex-direction: column; gap: var(--space-2); }
  .kc-storage__drive { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; }
  .kc-storage__drive > span { margin-inline-start: auto; color: var(--ink-secondary); }
  .kc-storage__drive > :global(.k-icon) { color: var(--ink-secondary); }
  .kc-storage__note { font-size: 12px; line-height: 1.6; color: var(--ink-secondary); margin: auto 0 0; padding-top: var(--space-4); }
  .kc-review { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--space-4); text-align: left; padding: var(--space-4) var(--space-5); border: 1px solid var(--border); background: var(--fill-subtle); border-radius: var(--radius-xl); color: var(--ink); transition: background var(--duration-basic); }
  .kc-review:hover:not(:disabled) { background: var(--fill-secondary); }
  .kc-review:disabled { cursor: default; }
  .kc-review > :global(.k-icon) { color: var(--ink-secondary); flex: none; }
  .kc-review__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .kc-review__copy strong { font-size: 13px; font-weight: 600; }
  .kc-review__copy > span { font-size: 12px; color: var(--ink-secondary); }
  .kc-review__amount { display: flex; gap: var(--space-4); align-items: center; font-size: 18px; font-weight: 600; white-space: nowrap; }
  .kc-review__amount > :global(.k-icon) { color: var(--ink-secondary); }
  .kc-breakdown, .kc-priorities { padding-block: var(--space-2); }
  .kc-stack { height: 6px; border-radius: var(--radius-full); display: flex; gap: 3px; overflow: hidden; background: var(--fill-secondary); margin-bottom: var(--space-3); }
  .kc-stack > span { min-width: 2px; }
  .kc-category, .kc-priority { width: 100%; display: flex; align-items: center; gap: var(--space-3); background: transparent; border: 0; border-radius: var(--radius-md); padding: 11px 4px; text-align: left; color: var(--ink); transition: background var(--duration-basic); }
  .kc-category:hover:not(:disabled), .kc-priority:hover:not(:disabled) { background: var(--fill-secondary); }
  .kc-category:disabled, .kc-priority:disabled { cursor: default; }
  .kc-category + .kc-category, .kc-priority + .kc-priority { border-top: 1px solid var(--border-light); }
  .kc-category > :global(.k-icon), .kc-priority > :global(.k-icon) { color: var(--ink-secondary); flex: none; width: 14px; }
  .kc-category__dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
  .kc-row-copy { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .kc-row-copy strong { font-size: 13px; font-weight: 510; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-row-copy > span { font-size: 12px; color: var(--ink-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-row-size { font-size: 13px; white-space: nowrap; font-weight: 510; }
  .kc-apps-note { display: flex; align-items: flex-start; gap: var(--space-2); padding-top: var(--space-4); margin-top: var(--space-3); border-top: 1px solid var(--border); color: var(--ink-secondary); }
  .kc-apps-note > :global(.k-icon) { margin-top: 2px; flex: none; }
  .kc-apps-note p { margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 1.6; }
  .kc-apps-note strong { font-weight: 510; color: var(--ink); }
  .kc-trust { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--space-2); border-top: 1px solid var(--border); padding-top: var(--space-4); color: var(--ink-secondary); }
  .kc-trust p { margin: 0; font-size: 12px; }
  .kc-trust :global(.k-icon) { flex: none; }
  .kc-scan { width: 100%; margin-top: auto; }
  .kc-scan__label { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--ink-secondary); margin-bottom: 8px; }
  .kc-scan__label span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-scan > button { margin-top: 8px; }
  @container kc-col (max-width: 690px) {
    .kc-overview { grid-template-columns: minmax(0, 1fr); gap: var(--space-5); }
    .kc-storage__summary { margin-block: 0 var(--space-3); }
    .kc-ring { width: 72px; height: 72px; }
    .kc-storage__drives { flex-direction: row; flex-wrap: wrap; gap: 8px 24px; }
    .kc-storage__drive { gap: 8px; }
    .kc-storage__drive > span { margin-left: 8px; }
    .kc-overview-head h1 { font-size: 24px; }
    .kc-review__copy > span { line-height: 1.5; }
  }
</style>
