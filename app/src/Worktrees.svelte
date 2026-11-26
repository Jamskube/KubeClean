<script>
  // Copies de travail git (git worktree) ouvertes à côté de leur dépôt. Seules celles sans travail
  // en cours se cochent ; rien d'office. Retirer = `git worktree remove` : la branche reste.
  import { untrack } from 'svelte';
  import { X } from './lib/extras.svelte.js';
  import { S, OS } from './lib/state.svelte.js';
  import { fmt, plural } from './lib/fmt.js';
  import { ago } from './lib/apps.svelte.js';
  import Icon from './lib/Icon.svelte';

  $effect(() => { untrack(() => X.loadWorktrees()); });

  const list = $derived(X.worktrees ?? []);
  const ready = $derived(list.filter((w) => w.removable));
  const wip = $derived(list.filter((w) => !w.removable));
  const picked = $derived(ready.filter((w) => X.wtPicked[w.path]));
  let dlg = $state();
  let ask = $state(false);
  $effect(() => { if (ask && dlg && !dlg.open) dlg.showModal(); });

  const name = (p) => p.split(/[\\/]/).pop();
  const repo = (p) => p.split(/[\\/]/).pop();
  // copie créée par un agent (Claude Code…) : il travaille peut-être encore dedans
  const agent = (p) => /[\\/](temp[\\/]claude|\.claude[\\/]worktrees)[\\/]/i.test(p);
  const status = (w) => (w.missing ? 'Dossier déjà supprimé : seule la référence reste dans git' : w.merged ? 'Fusionnée · rien en cours' : 'Branche non fusionnée, gardée dans git · rien en cours');
  const why = (w) => (w.changes ? plural(w.changes, 'fichier modifié', 'fichiers modifiés') : w.local.length ? `Fichiers locaux : ${w.local.slice(0, 3).join(', ')}${w.local.length > 3 ? '…' : ''}` : w.nests ? 'Contient une autre copie de travail' : 'Verrouillée par git');
  const toggle = (w) => { if (X.wtPicked[w.path]) delete X.wtPicked[w.path]; else X.wtPicked[w.path] = true; };
  async function go() { dlg.close(); await X.removeWorktrees(); }
</script>

<section class="kc-wt" aria-labelledby="wt-title">
  <header class="kc-wt__head">
    <div>
      <h2 id="wt-title"><Icon name="git-branch" />Copies de travail git</h2>
      <p>Des branches ouvertes dans leur propre dossier (git worktree). Retirer une copie supprime ce dossier ; la branche et ses commits restent dans git.</p>
    </div>
    <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={X.wtLoading || X.wtWorking} onclick={() => X.loadWorktrees(true)}><Icon name="refresh-cw" />Actualiser</button>
  </header>

  {#if X.wtLoading && !X.worktrees}
    <p class="kc-wt__note" role="status">Recherche des copies de travail dans les racines de projets…</p>
  {:else if X.wtError}
    <div class="k-alert k-alert--block" role="alert"><div class="k-alert__row"><span class="k-alert__icon"><Icon name="circle-alert" /></span><div class="k-alert__content"><div class="k-alert__description">{X.wtError}</div></div></div></div>
  {:else if X.worktrees && !list.length}
    <p class="kc-wt__note">Aucune copie de travail dans les racines de projets. Tes dépôts sont ailleurs ? <button class="k-btn k-btn--ghost k-btn--xs" type="button" onclick={() => (S.view = 'settings')}>Ajouter leur dossier</button></p>
  {:else if X.worktrees}
    {#if ready.length}
      <h3 class="kc-wt__sub">Prêtes à retirer · {ready.length}</h3>
      <ul class="kc-wt__rows">
        {#each ready as w (w.path)}
          <li class="k-reveal kc-wt__row">
            <input type="checkbox" class="k-checkbox" aria-label="Retirer {w.path}" checked={!!X.wtPicked[w.path]} disabled={X.wtWorking} onchange={() => toggle(w)} />
            <div class="kc-wt__text">
              <span class="kc-wt__name">{name(w.path)}{#if w.branch}<span class="k-badge">{w.branch}</span>{/if}{#if agent(w.path)}<span class="k-badge k-badge--outline" data-kube="tooltip" data-kube-tooltip="Créée par un agent : vérifie qu’il a fini">Agent</span>{/if}</span>
              <span class="kc-wt__meta">{status(w)} · dépôt {repo(w.repo)}{w.last ? ` · dernier commit ${ago(w.last)}` : ''}</span>
            </div>
            <span class="k-reveal__item"><button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher {OS.inFinder}" data-kube="tooltip" disabled={w.missing} onclick={() => S.reveal(w.path)}><Icon name="folder-open" /></button></span>
            <span class="kc-wt__size">{w.missing ? '—' : fmt(w.size)}</span>
          </li>
        {/each}
      </ul>
      <div class="kc-wt__actions">
        <button class="k-btn k-btn--primary k-btn--sm" type="button" data-action="remove-worktrees" disabled={!picked.length || X.wtWorking} onclick={() => (ask = true)}><Icon name="trash" />{X.wtWorking ? 'Retrait…' : picked.length ? `Retirer ${plural(picked.length, 'copie', 'copies')} · ${fmt(picked.reduce((a, w) => a + w.size, 0))}` : 'Coche les copies à retirer'}</button>
      </div>
    {/if}
    {#if wip.length}
      <details class="kc-wt__wip">
        <summary>Avec du travail en cours · {wip.length} <span>gardées telles quelles</span></summary>
        <ul class="kc-wt__rows">
          {#each wip as w (w.path)}
            <li class="k-reveal kc-wt__row">
              <span class="kc-wt__dot"><Icon name="git-fork" /></span>
              <div class="kc-wt__text">
                <span class="kc-wt__name">{name(w.path)}{#if w.branch}<span class="k-badge">{w.branch}</span>{/if}</span>
                <span class="kc-wt__meta">{why(w)} · dépôt {repo(w.repo)}</span>
              </div>
              <span class="k-reveal__item"><button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher {OS.inFinder}" data-kube="tooltip" onclick={() => S.reveal(w.path)}><Icon name="folder-open" /></button></span>
              <span class="kc-wt__size">{fmt(w.size)}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}
</section>

{#if ask}
  <dialog class="k-dialog k-dialog--form kc-ask" bind:this={dlg} data-kube="dialog" aria-labelledby="wt-ask-title" onclose={() => (ask = false)}>
    <form method="dialog" class="k-dialog__body" onsubmit={(e) => e.preventDefault()}>
      <div class="k-dialog__header">
        <span class="k-dialog__icon"><Icon name="git-branch" /></span>
        <div class="k-dialog__heading">
          <h2 class="k-dialog__title" id="wt-ask-title">Retirer {plural(picked.length, 'copie de travail', 'copies de travail')}&nbsp;?</h2>
          <p class="k-dialog__description">Leurs dossiers sont supprimés par git, qui revérifie juste avant qu’il n’y reste aucun travail. Les branches et leurs commits restent dans le dépôt : <code>git worktree add</code> les rouvre.</p>
        </div>
      </div>
      <ul class="kc-ask__paths">{#each picked as w (w.path)}<li title={w.path}>{w.path}</li>{/each}</ul>
      <div class="k-dialog__actions">
        <!-- svelte-ignore a11y_autofocus (action destructive : le focus démarre sur Annuler) -->
        <button class="k-btn" type="button" autofocus onclick={() => dlg.close()}>Annuler</button>
        <button class="k-btn k-btn--primary" type="button" data-action="confirm-worktrees" onclick={go}><Icon name="trash" />Retirer</button>
      </div>
    </form>
  </dialog>
{/if}

<style>
  .kc-wt { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-5); border-top: 1px solid var(--border); }
  .kc-wt__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
  .kc-wt__head h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 15px; font-weight: 600; }
  .kc-wt__head p { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--ink-secondary); }
  .kc-wt__head > button { flex: none; }
  .kc-wt__note { margin: 0; font-size: 13px; color: var(--ink-secondary); }
  .kc-wt__sub { margin: 0; font-size: 12px; font-weight: 600; color: var(--ink-secondary); }
  .kc-wt__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .kc-wt__row { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; padding: 4px var(--space-2); border-radius: var(--radius-md); }
  .kc-wt__row:hover { background: var(--fill-subtle); }
  .kc-wt__row .k-checkbox, .kc-wt__dot { flex: none; }
  .kc-wt__dot { display: grid; place-items: center; width: 16px; color: var(--ink-tertiary); }
  .kc-wt__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-wt__name { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 510; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-wt__name .k-badge { flex: none; max-width: 16em; overflow: hidden; text-overflow: ellipsis; }
  .kc-wt__meta { font-size: 12px; color: var(--ink-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-wt__size { flex: none; min-width: 4.5em; text-align: end; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-wt__actions { display: flex; justify-content: flex-end; }
  .kc-wt__wip summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--ink-secondary); padding: 4px 0; }
  .kc-wt__wip summary span { font-weight: 400; color: var(--ink-tertiary); margin-inline-start: 6px; }
  .kc-ask { width: min(32rem, 92vw); }
  .kc-ask__paths { margin: 0; padding: var(--space-2) var(--space-3); list-style: none; max-height: 9.5em; overflow: auto; border-radius: 8px; background: var(--surface-sunken, rgba(127, 127, 127, 0.08)); font: 12px/1.6 var(--font-mono, ui-monospace, monospace); color: var(--ink-secondary); }
  .kc-ask__paths li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
