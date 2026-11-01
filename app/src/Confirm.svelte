<script>
  // Dialogue de confirmation du nettoyage, piloté par S.confirm.
  import { S } from './lib/state.svelte.js';
  import { fmt, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  let dlg;
  $effect(() => {
    if (S.confirm) { if (!dlg.open) dlg.showModal(); }
    else if (dlg.open) dlg.close();
  });

  const GROUPS = [
    { key: 'permanent', title: 'Supprimés définitivement', icon: 'trash', tone: 'danger', note: 'Caches, temporaires et dossiers de compilation : les applications les recréent. Ce qui est ouvert ou a changé depuis l’analyse est laissé en place.' },
    { key: 'recycle', title: 'Envoyés à la Corbeille', icon: 'recycle', note: 'Tes fichiers : récupérables depuis la Corbeille. Trop gros pour elle ? Windows te demandera avant de supprimer.' },
    { key: 'admin', title: 'Tâches administrateur', icon: 'shield', note: 'Windows affichera sa demande d’autorisation. Si tu refuses, seules ces tâches sont sautées.' },
  ];
  const groups = $derived(GROUPS.map((g) => ({ ...g, rules: S.pickedGroups[g.key] })).filter((g) => g.rules.length));
  const sum = (rules) => rules.reduce((a, r) => a + S.selSize(r), 0);
  /** items named one by one: project folders and personal files the user ticked */
  const named = (r) => (r.perItem ? r.items.filter((_, i) => S.itemOn(r, i)) : []);
  const short = (p) => { const parts = p.split('\\'); return parts.length > 3 ? `${parts[0]}\\…\\${parts.slice(-2).join('\\')}` : p; };
</script>

<dialog class="k-dialog k-dialog--form k-dialog--wide kc-confirm" bind:this={dlg} data-kube="dialog" aria-labelledby="confirm-title" onclose={() => (S.confirm = false)}>
  <form method="dialog" class="k-dialog__body" onsubmit={(e) => e.preventDefault()}>
    <div class="k-dialog__header">
      <span class="k-dialog__icon"><Icon name="broom-sparkles" /></span>
      <div class="k-dialog__heading">
        <h2 class="k-dialog__title" id="confirm-title">Nettoyer <Num value={S.total} />&nbsp;?</h2>
        <p class="k-dialog__description">{plural(S.picked.length, 'règle', 'règles')}. Chaque élément est revérifié juste avant d’être touché.</p>
      </div>
    </div>
    <div class="k-dialog__section kc-groups">
      {#each groups as g (g.key)}
        <details class="k-disclosure kc-group" data-kube="disclosure">
          <summary class="kc-group__sum">
            <span class="kc-group__icon" class:kc-group__icon--danger={g.tone === 'danger'}><Icon name={g.icon} /></span>
            <span class="kc-group__title">{g.title}</span>
            <span class="kc-group__count">{plural(g.rules.length, 'règle', 'règles')}</span>
            <span class="kc-group__size"><Num value={sum(g.rules)} /></span>
            <Icon name="chevron-right" />
          </summary>
          <div class="kc-group__body">
            <p class="kc-group__note">{g.note}</p>
            <ul class="kc-list">
              {#each g.rules as r (r.id)}
                <li class="kc-rule">
                  <span>{r.title}</span>
                  <span class="kc-rule__size">{r.sizeKnown ? fmt(S.selSize(r)) : 'taille inconnue'}</span>
                  {#if named(r).length}
                    <ul class="kc-sub">
                      {#each named(r) as it (it.path)}<li><span class="kc-path" title={it.path}>{short(it.path)}</span><span class="kc-rule__size">{fmt(it.size)}</span></li>{/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        </details>
      {/each}
    </div>
    <div class="k-dialog__actions">
      <!-- svelte-ignore a11y_autofocus (dialogue destructif : le focus démarre sur Annuler) -->
      <button class="k-btn" type="button" autofocus onclick={() => dlg.close()}>Annuler</button>
      <button class="k-btn k-btn--primary" type="button" data-action="confirm" disabled={!S.picked.length} onclick={() => S.clean()}><Icon name="broom-sparkles" />Nettoyer {fmt(S.total)}</button>
    </div>
  </form>
</dialog>

<style>
  .kc-confirm { width: min(36rem, 92vw); }
  .kc-groups { display: flex; flex-direction: column; max-height: 60vh; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid var(--border-light); }
  .kc-group { border-bottom: 1px solid var(--border-light); }
  .kc-group__sum { display: flex; align-items: center; gap: var(--space-3); padding: 10px 0; cursor: pointer; list-style: none; user-select: none; font-size: 14px; line-height: 20px; color: var(--ink); }
  .kc-group__sum::-webkit-details-marker { display: none; }
  .kc-group__sum > :global(.k-icon) { color: var(--ink-tertiary); transition: transform var(--duration-moderate) var(--ease-enter); }
  .kc-group[open] .kc-group__sum > :global(.k-icon) { transform: rotate(90deg); }
  .kc-group__icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-md); background: var(--fill-secondary); color: var(--ink-secondary); flex: none; }
  .kc-group__icon--danger { background: var(--danger-subtle); color: var(--danger); }
  .kc-group__title { font-weight: 500; flex: 1; min-width: 0; }
  .kc-group__count { font-size: 12px; color: var(--ink-secondary); white-space: nowrap; }
  .kc-group__size { font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; min-width: 5rem; text-align: end; }
  .kc-group__body { padding: 0 0 var(--space-3) calc(28px + var(--space-3)); }
  .kc-group__note { margin: 0 0 var(--space-2); font-size: 12px; line-height: 16px; color: var(--ink-secondary); }
  .kc-list, .kc-sub { list-style: none; margin: 0; padding: 0; }
  .kc-rule { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px var(--space-3); padding: 4px 0; font-size: 13px; line-height: 18px; color: var(--ink); }
  .kc-rule + .kc-rule { border-top: 1px solid var(--border-light); }
  .kc-rule__size { color: var(--ink-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .kc-sub { flex-basis: 100%; display: flex; flex-direction: column; gap: 2px; margin-top: 2px; padding-left: var(--space-3); border-left: 2px solid var(--border); font-size: 12px; line-height: 16px; }
  .kc-sub li { display: flex; justify-content: space-between; gap: var(--space-3); }
</style>
