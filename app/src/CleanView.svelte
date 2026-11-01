<script>
  import { S, CATS } from './lib/state.svelte.js';
  import { fmt, plural, drive } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Confirm from './Confirm.svelte';

  let confirm;
  const sys = $derived(S.drives.find((d) => d.root.toUpperCase().startsWith('C:')) ?? S.drives[0]);
  const found = $derived((S.scan?.rules ?? []).reduce((a, r) => a + r.size, 0));
  const pct = $derived(S.progress?.total ? S.progress.done / S.progress.total : null);
  const shown = (r) => r.size > 0 || !r.sizeKnown;
  const mixed = (r) => (n) => { n.indeterminate = S.state(r) === 'mixed'; };
</script>

<header class="k-page-header">
  <div class="k-page-header__content">
    <div class="k-page-header__heading">
      <h1 class="k-page-header__title">Nettoyage</h1>
      <p class="k-page-header__subtitle">
        {#if S.scan}{fmt(found)} trouvés · {fmt(S.total)} sélectionnés{#if sys}{' · '}{fmt(sys.free)} libres sur {drive(sys.root)}{/if}
        {:else if S.busy === 'scan'}Analyse du disque…
        {:else}Lance une analyse pour voir ce qui peut partir.{/if}
      </p>
    </div>
    <div class="k-page-header__actions">
      {#if S.busy === 'scan'}
        <button class="k-btn k-btn--outline" type="button" onclick={() => S.cancel()}><Icon name="circle-stop" />Annuler</button>
      {:else}
        <button class="k-btn k-btn--outline" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="scan-search" />Analyser</button>
      {/if}
      <button class="k-btn k-btn--primary" type="button" disabled={!!S.busy || !S.picked.length} onclick={() => confirm.open()}>
        <Icon name="trash" />{S.total ? `Nettoyer ${fmt(S.total)}` : 'Nettoyer'}
      </button>
    </div>
  </div>
</header>

{#if S.busy}
  <div class="kc-status k-progress-row">
    <span class="k-progress-row__label">{S.busy === 'scan' ? 'Analyse' : 'Nettoyage'}{S.progress?.label ? ` : ${S.progress.label}` : '…'}</span>
    <div class={['k-progress', pct == null && 'k-progress--indeterminate']} role="progressbar" aria-label="Progression"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct == null ? undefined : Math.round(pct * 100)} style:--k-progress={pct ?? 0}>
      <div class="k-progress__bar"></div>
    </div>
    <span class="k-progress-row__value">{S.progress ? `${S.progress.done}/${S.progress.total}` : ''}</span>
  </div>
{/if}

{#if S.scan}
  {#each CATS as c (c.id)}
    {@const rules = S.rules(c.id)}
    {@const list = rules.filter(shown)}
    <section class="kc-section" id="cat-{c.id}" aria-labelledby="h-{c.id}">
      <div class="kc-section__head">
        <Icon name={c.icon} />
        <h2 class="kc-section__title" id="h-{c.id}">{c.label}</h2>
        <span class="kc-section__total kc-num">{fmt(S.catTotal(c.id))}</span>
      </div>
      {#if list.length}
        <div class="k-table-scroll">
          <table class="k-table kc-table">
            <tbody>
              {#each list as r (r.id)}
                <tr class={[S.panel === r.id && 'kc-row--open']}>
                  <td class="kc-check">
                    <input type="checkbox" class="k-checkbox" aria-label={r.title} checked={S.state(r) === 'on'}
                      {@attach mixed(r)} disabled={!!S.busy} onchange={() => S.toggleRule(r)} />
                  </td>
                  <td>
                    <button class="kc-rule" type="button" onclick={() => (S.panel = S.panel === r.id ? null : r.id)}>
                      <span class="kc-rule__title">{r.title}</span>
                      <span class="kc-rule__hint">
                        {r.hint}{#if r.count}{' · '}{plural(r.count, 'élément', 'éléments')}{/if}
                      </span>
                      <span class="kc-badges">
                        {#if r.blockedBy.length}<span class="k-badge k-badge--warning" title="Les fichiers que l'application utilise seront laissés en place">{r.blockedBy.join(', ')} ouvert</span>{/if}
                        {#if r.needsAdmin}<span class="k-badge"><Icon name="shield" />Admin</span>{/if}
                        {#if r.toRecycle}<span class="k-badge">Corbeille</span>{/if}
                        {#if r.perItem}<span class="k-badge k-badge--outline">au cas par cas</span>
                        {:else if !r.default}<span class="k-badge k-badge--warning">À vérifier</span>{/if}
                      </span>
                    </button>
                  </td>
                  <td class="k-table__num kc-num kc-size">
                    {#if !r.sizeKnown}<span class="kc-muted">taille inconnue</span>
                    {:else if S.state(r) === 'mixed'}{fmt(S.selSize(r))} <span class="kc-muted">/ {fmt(r.size)}</span>
                    {:else}{fmt(r.size)}{/if}
                  </td>
                  <td class="kc-open">
                    <button class="k-toolbar__btn" type="button" aria-label="Détails : {r.title}" aria-pressed={S.panel === r.id}
                      onclick={() => (S.panel = S.panel === r.id ? null : r.id)}><Icon name="chevron-right" /></button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if rules.length > list.length}
        <p class="kc-empty">{rules.length - list.length > 1 ? `${rules.length - list.length} autres règles` : '1 autre règle'} sans rien à nettoyer.</p>
      {/if}
    </section>
  {/each}
{:else if !S.busy}
  <div class="k-empty k-empty--page">
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="scan-search" /></div>
      <div class="k-empty__text">
        <h2 class="k-empty__title">Aucune analyse</h2>
        <p class="k-empty__desc">L'analyse ne touche à rien : elle mesure ce qui peut être libéré.</p>
      </div>
      <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" onclick={() => S.runScan()}>Analyser</button></div>
    </div>
  </div>
{/if}

<Confirm bind:this={confirm} />

<style>
  .kc-status { margin: 0 0 24px; }
  .kc-section { margin: 0 0 36px; scroll-margin-top: 16px; }
  .kc-section__head { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; color: var(--ink-secondary); }
  .kc-section__title { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink); }
  .kc-section__total { margin-left: auto; color: var(--ink-secondary); font-size: 14px; }
  .kc-table { table-layout: fixed; width: 100%; }
  .kc-table td { vertical-align: top; }
  .kc-size { width: 6.5rem; }
  .kc-check { width: 34px; padding-top: 12px; }
  .kc-open { width: 44px; }
  .kc-row--open td { background: var(--fill-subtle); }
  .kc-rule { all: unset; display: flex; flex-direction: column; gap: 3px; cursor: pointer; min-width: 0; }
  .kc-rule:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; border-radius: 4px; }
  .kc-rule__title { color: var(--ink); font-weight: 500; }
  .kc-rule__hint { color: var(--ink-secondary); font-size: 13px; }
  .kc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .kc-badges:empty { display: none; }
  .kc-empty { color: var(--ink-tertiary); font-size: 13px; margin: 8px 0 0; }
</style>
