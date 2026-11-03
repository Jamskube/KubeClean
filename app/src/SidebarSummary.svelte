<script>
  import { S } from './lib/state.svelte.js';
  import { date, fmt, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';

  const destinations = [
    { id: 'permanent', label: 'Suppression définitive' },
    { id: 'recycle', label: 'Vers la Corbeille' },
    { id: 'admin', label: 'Avec autorisation Windows' },
  ];
  const progress = $derived(S.progress?.total ? S.progress.done / S.progress.total : 0);
  const sum = (rules) => rules.some((r) => !r.sizeKnown) ? 'Taille inconnue' : fmt(rules.reduce((n, r) => n + S.selSize(r), 0));
</script>

<section class="kc-sidebar-summary" aria-label="Analyse et sélection">
  <div class="kc-summary-scan">
    <div><span>Dernière analyse</span><p>{S.busy === 'scan' ? 'Analyse en cours…' : S.scan ? date(S.scan.at) : 'Pas encore d’analyse'}</p></div>
    <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Actualiser l’analyse" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="refresh-cw" /></button>
  </div>
  {#if S.busy === 'scan'}
    <div class="k-progress k-progress--sm" role="progressbar" aria-label="Progression de l’analyse" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)} style:--k-progress={progress}><div class="k-progress__bar"></div></div>
    <p class="kc-summary-progress" role="status">{S.progress?.label ?? 'Préparation…'}</p>
    <button class="k-btn k-btn--ghost k-btn--sm" type="button" onclick={() => S.cancel()}>Annuler l’analyse</button>
  {:else if S.scan}
    <div class="kc-summary-total"><span>Sélection actuelle</span><strong>{fmt(S.total)}</strong><span>{plural(S.picked.length, 'poste coché', 'postes cochés')}</span></div>
    <dl>
      {#each destinations as group (group.id)}
        {@const rules = S.pickedGroups[group.id]}
        {#if group.id !== 'admin' || rules.length}<div><dt>{group.label}</dt><dd>{sum(rules)}</dd></div>{/if}
      {/each}
    </dl>
    <button class="k-btn k-btn--outline k-btn--sm kc-summary-review" type="button" disabled={!!S.busy || !S.picked.length} onclick={() => (S.confirm = true)}><Icon name="list-checks" />Vérifier la sélection</button>
  {:else}
    <p class="kc-summary-progress">L’analyse repère ce qui peut être nettoyé. Tu choisis ensuite les éléments à retirer.</p>
  {/if}
</section>

<style>
  .kc-sidebar-summary { padding: var(--space-2) var(--space-3) var(--space-5); margin-bottom: var(--space-3); border-bottom: 1px solid var(--border-light); }
  .kc-summary-scan { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-4); }
  .kc-summary-scan > div { min-width: 0; }
  .kc-summary-scan span, .kc-summary-total > span, dt, .kc-summary-progress { color: var(--ink-secondary); font-size: 12px; }
  .kc-summary-scan p { margin: 3px 0 0; font-size: 12px; }
  .kc-summary-total { display: flex; flex-direction: column; gap: 4px; }
  .kc-summary-total strong { font-size: 28px; line-height: 1.2; letter-spacing: -.025em; font-weight: 600; }
  dl { margin: var(--space-3) 0; font-size: 12px; }
  dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); padding-block: 5px; }
  dd { margin: 0; text-align: right; white-space: nowrap; }
  .kc-summary-review { width: 100%; }
  .kc-summary-progress { line-height: 1.5; overflow-wrap: anywhere; }
</style>
