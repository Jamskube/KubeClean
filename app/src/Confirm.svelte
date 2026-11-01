<script>
  import { S } from './lib/state.svelte.js';
  import { fmt, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';

  let dlg;
  export function open() {
    dlg.showModal();
  }
  const picked = $derived(S.picked);
  const groups = $derived([
    { key: 'delete', title: 'Supprimés définitivement', icon: 'trash',
      note: "Caches, fichiers temporaires et dossiers de compilation : les applications les recréent. Les fichiers ouverts et ce qui a changé depuis l'analyse sont laissés.",
      rules: picked.filter((r) => !r.toRecycle && !r.needsAdmin) },
    { key: 'recycle', title: 'Envoyés à la Corbeille', icon: 'archive',
      note: "Tes fichiers : récupérables depuis la Corbeille. Si l'un est trop gros pour elle, Windows te demandera avant de le supprimer.",
      rules: picked.filter((r) => r.toRecycle) },
    { key: 'admin', title: 'Tâches administrateur', icon: 'shield',
      note: "Windows va afficher une demande d'autorisation. Si tu refuses, seules ces tâches sont sautées.",
      rules: picked.filter((r) => r.needsAdmin) },
  ].filter((g) => g.rules.length));

  /** the chosen items worth naming one by one: user files and project folders */
  const named = (r) => (r.perItem ? r.items.filter((_, i) => S.itemOn(r, i)) : []);

  function go() {
    dlg.close();
    S.clean();
  }
</script>

<dialog class="k-dialog kc-confirm" bind:this={dlg} aria-labelledby="confirm-title">
  <div class="k-dialog__body">
    <div class="k-dialog__header">
      <span class="k-dialog__icon"><Icon name="trash" /></span>
      <div class="k-dialog__heading">
        <h2 class="k-dialog__title" id="confirm-title">Nettoyer {fmt(S.total)} ?</h2>
        <p class="k-dialog__description">{plural(picked.length, 'règle', 'règles')} sélectionnées. Chaque élément est revérifié juste avant d'être touché.</p>
      </div>
    </div>
    <div class="k-dialog__section kc-groups">
      {#each groups as g (g.key)}
        <section>
          <h3 class="kc-group__title"><Icon name={g.icon} />{g.title}</h3>
          <p class="kc-muted">{g.note}</p>
          <ul class="kc-list">
            {#each g.rules as r (r.id)}
              <li>
                <span>{r.title}</span>
                <span class="kc-num kc-muted">{r.sizeKnown ? fmt(S.selSize(r)) : 'taille inconnue'}</span>
                {#if named(r).length}
                  <ul class="kc-sub">
                    {#each named(r) as it (it.path)}<li><span class="kc-path">{it.path}</span><span class="kc-num kc-muted">{fmt(it.size)}</span></li>{/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    <div class="k-dialog__actions">
      <!-- svelte-ignore a11y_autofocus (destructive dialog: focus starts on Annuler) -->
      <button class="k-btn" type="button" autofocus onclick={() => dlg.close()}>Annuler</button>
      <button class="k-btn k-btn--danger-solid" type="button" onclick={go}>Nettoyer {fmt(S.total)}</button>
    </div>
  </div>
</dialog>

<style>
  .kc-confirm { width: min(40rem, calc(100vw - 32px)); }
  .kc-groups { display: flex; flex-direction: column; gap: 18px; max-height: 50vh; overflow: auto; }
  .kc-groups p { margin: 2px 0 6px; }
  .kc-group__title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); }
  .kc-list, .kc-sub { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .kc-list > li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 4px 0; color: var(--ink); }
  .kc-sub { flex-basis: 100%; padding-left: 12px; border-left: 2px solid var(--border); }
  .kc-sub li { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
</style>
