<script>
  // Doublons d'un dossier : groupes de fichiers au contenu identique. Rien n'est choisi d'office :
  // dans chaque groupe, l'utilisateur désigne la copie à garder ; les autres partent à la Corbeille.
  import { X } from './lib/extras.svelte.js';
  import { S, OS, SEP } from './lib/state.svelte.js';
  import { fmt, plural, date } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  let { onclose } = $props();
  const groups = $derived(X.dupes?.report.groups ?? []);
  const pairs = $derived(X.pairs);
  const chosen = $derived(pairs.reduce((a, p) => a + p.size, 0));
  const progress = $derived(X.dupesLoading ? S.dupesProgress : null);
  let dlg = $state();
  let ask = $state(false);
  $effect(() => { if (ask && dlg && !dlg.open) dlg.showModal(); });

  const base = (p) => p.slice(p.lastIndexOf(SEP) + 1);
  const keepNewest = () => groups.forEach((g, i) => (X.keep[i] = g.copies[0].path));
  const clear = () => (X.keep = {});
  async function go() { dlg.close(); await X.trashDupes(); }
</script>

<div class="kc-dupes">
  <div class="kc-dupes__bar">
    <div class="kc-dupes__title">
      <h2>Doublons · {X.dupes?.label ?? '…'}</h2>
      {#if X.dupes && !X.dupesLoading}<p><Num value={X.dupes.report.wasted} /> en trop · {plural(groups.length, 'groupe', 'groupes')} · {plural(X.dupes.report.files, 'fichier comparé', 'fichiers comparés')}</p>{/if}
    </div>
    <div class="kc-dupes__actions">
      {#if groups.length && !X.dupesLoading}
        <button class="k-btn k-btn--sm" type="button" data-action="keep-newest" disabled={X.dupesWorking} onclick={keepNewest}><Icon name="copy-check" />Garder la plus récente partout</button>
        {#if pairs.length}<button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={X.dupesWorking} onclick={clear}>Tout annuler</button>{/if}
      {/if}
      <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={X.dupesWorking} onclick={onclose}><Icon name="chart-pie" />Retour à la carte</button>
    </div>
  </div>

  {#if X.dupesLoading}
    <div class="kc-dupes__measure" role="status">
      <div class="kc-dupes__line"><span>{progress?.total ? `Comparaison… ${progress.done}/${progress.total} · ${progress.label}` : progress?.label ?? 'Inventaire des fichiers…'}</span>
        <button class="k-btn k-btn--ghost k-btn--xs" type="button" onclick={() => kc.call('cancel', { what: 'dupes' }).catch(() => {})}>Annuler</button></div>
      <div class="k-progress k-progress--sm" role="progressbar" aria-label="Recherche des doublons" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress?.total ? Math.round((progress.done / progress.total) * 100) : 0} style:--k-progress={progress?.total ? progress.done / progress.total : 0}><div class="k-progress__bar"></div></div>
      <p class="kc-dupes__note">Les fichiers de même taille sont relus pour comparer leur contenu : sur un grand disque, compte quelques minutes.</p>
    </div>
  {:else if X.dupesError}
    <div class="k-alert k-alert--block" role="alert"><div class="k-alert__row"><span class="k-alert__icon"><Icon name="circle-alert" /></span><div class="k-alert__content"><div class="k-alert__description">{X.dupesError}</div></div></div></div>
  {:else if X.dupes && !groups.length}
    <div class="k-empty"><div class="k-empty__body"><div class="k-empty__art"><Icon name="copy-check" /></div><div class="k-empty__text"><h2 class="k-empty__title">Aucun doublon</h2><p class="k-empty__desc">Aucun fichier de 1 Mo ou plus n’existe en double ici.</p></div></div></div>
  {:else if X.dupes}
    <p class="kc-dupes__note">Dans chaque groupe, choisis la copie à <strong>garder</strong> : les autres iront à la Corbeille, après une dernière comparaison octet par octet. Non comparés : fichiers de moins de 1 Mo, données d’applis, système, dossiers cachés et dossiers de compilation.{#if X.dupes.report.truncated} Seuls les 300 plus gros groupes sont affichés.{/if}</p>
    <div class="kc-dupes__groups">
      {#each groups as g, i (g.copies[0].path)}
        <article class="k-card k-card--full kc-copyset">
          <header class="kc-copyset__head">
            <span class="k-file-icon k-file-icon--sm"><Icon name="copy" /></span>
            <strong class="kc-copyset__name" title={base(g.copies[0].path)}>{base(g.copies[0].path)}</strong>
            <span class="kc-copyset__meta">{fmt(g.size)} × {g.copies.length}</span>
            {#if X.keep[i]}<button class="k-btn k-btn--ghost k-btn--xs" type="button" onclick={() => delete X.keep[i]}>Ne rien faire</button>{/if}
          </header>
          <ul class="kc-copyset__rows">
            {#each g.copies as c (c.path)}
              {@const kept = X.keep[i] === c.path}
              <li class="k-reveal kc-copyset__row" class:kc-copyset__row--out={X.keep[i] && !kept}>
                <input type="radio" class="k-radio" name="dup-{i}" aria-label="Garder {c.path}" checked={kept} disabled={X.dupesWorking} onchange={() => (X.keep[i] = c.path)} />
                <span class="kc-copyset__path" title={c.path}><span class="k-filename" data-kube="truncate-middle" data-kube-name={c.path}></span></span>
                {#if kept}<span class="k-badge k-badge--success">Gardée</span>{:else if X.keep[i]}<span class="k-badge k-badge--outline">Corbeille</span>{/if}
                <span class="kc-copyset__date">{date(c.modified)}</span>
                <span class="k-reveal__item"><button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher {OS.inFinder}" data-kube="tooltip" onclick={() => S.reveal(c.path)}><Icon name="folder-open" /></button></span>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </div>
    <div class="kc-dupes__foot">
      <button class="k-btn k-btn--primary" type="button" data-action="trash-dupes" disabled={!pairs.length || X.dupesWorking} onclick={() => (ask = true)}><Icon name="trash" />{X.dupesWorking ? 'Envoi…' : pairs.length ? `Mettre ${plural(pairs.length, 'copie', 'copies')} à la Corbeille · ${fmt(chosen)}` : 'Choisis la copie à garder dans un groupe'}</button>
    </div>
  {/if}
</div>

{#if ask}
  <dialog class="k-dialog k-dialog--form kc-ask" bind:this={dlg} data-kube="dialog" aria-labelledby="dup-ask-title" onclose={() => (ask = false)}>
    <form method="dialog" class="k-dialog__body" onsubmit={(e) => e.preventDefault()}>
      <div class="k-dialog__header">
        <span class="k-dialog__icon"><Icon name="trash" /></span>
        <div class="k-dialog__heading">
          <h2 class="k-dialog__title" id="dup-ask-title">Mettre {plural(pairs.length, 'copie', 'copies')} à la Corbeille&nbsp;?</h2>
          <p class="k-dialog__description">Chaque copie est recomparée octet par octet avec celle que tu gardes juste avant de partir ; une copie qui a changé reste en place. Tu les retrouves dans la Corbeille tant que tu ne la vides pas ; la place ({fmt(chosen)}) est libérée quand tu la vides.</p>
        </div>
      </div>
      <ul class="kc-ask__paths">{#each pairs as p (p.remove)}<li title={p.remove}>{p.remove}</li>{/each}</ul>
      <div class="k-dialog__actions">
        <!-- svelte-ignore a11y_autofocus (action destructive : le focus démarre sur Annuler) -->
        <button class="k-btn" type="button" autofocus onclick={() => dlg.close()}>Annuler</button>
        <button class="k-btn k-btn--primary" type="button" data-action="confirm-dupes" onclick={go}><Icon name="trash" />Mettre à la Corbeille</button>
      </div>
    </form>
  </dialog>
{/if}

<style>
  .kc-dupes { display: flex; flex-direction: column; gap: var(--space-3); }
  .kc-dupes__bar { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
  .kc-dupes__title h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .kc-dupes__title p { margin: 4px 0 0; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-dupes__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .kc-dupes__note { margin: 0; font-size: 12px; line-height: 1.55; color: var(--ink-secondary); }
  .kc-dupes__measure { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--fill-subtle); }
  .kc-dupes__line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-size: 13px; font-variant-numeric: tabular-nums; }
  .kc-dupes__line span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-dupes__groups { display: flex; flex-direction: column; gap: var(--space-3); }
  .kc-copyset__head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-light); }
  .kc-copyset__name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-copyset__meta { flex: none; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-copyset__rows { list-style: none; margin: 0; padding: var(--space-1) var(--space-2); display: flex; flex-direction: column; }
  .kc-copyset__row { display: flex; align-items: center; gap: var(--space-3); min-height: 36px; padding: 2px var(--space-2); border-radius: var(--radius-md); }
  .kc-copyset__row:hover { background: var(--fill-subtle); }
  .kc-copyset__row--out .kc-copyset__path { color: var(--ink-tertiary); text-decoration: line-through; text-decoration-color: color-mix(in oklab, currentColor 50%, transparent); }
  .kc-copyset__row .k-radio, .kc-copyset__row .k-badge { flex: none; }
  .kc-copyset__path { flex: 1; min-width: 0; font-size: 12px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-copyset__path .k-filename { display: block; }
  .kc-copyset__date { flex: none; font-size: 12px; color: var(--ink-tertiary); font-variant-numeric: tabular-nums; }
  .kc-dupes__foot { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: var(--space-3) 0; background: linear-gradient(transparent, var(--surface, var(--k-shell, transparent)) 35%); }
  .kc-ask { width: min(34rem, 92vw); }
  .kc-ask__paths { margin: 0; padding: var(--space-2) var(--space-3); list-style: none; max-height: 9.5em; overflow: auto; border-radius: 8px; background: var(--surface-sunken, rgba(127, 127, 127, 0.08)); font: 12px/1.6 var(--font-mono, ui-monospace, monospace); color: var(--ink-secondary); }
  .kc-ask__paths li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
