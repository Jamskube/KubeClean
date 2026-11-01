<script>
  import { S, pickable } from './lib/state.svelte.js';
  import { fmt, plural, idle } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';

  let { id } = $props();
  const r = $derived(S.rule(id));
  let limit = $state(200);
  const page = $derived(r ? window.kc.call('items', { rule: id, offset: 0, limit }) : null);
  const name = (p) => p.split('\\').pop();
  const dir = (p) => p.slice(0, p.length - name(p).length - 1);
</script>

{#if r}
  <div class="k-toolbar k-toolbar--pane">
    <span class="k-toolbar__title">{r.title}</span>
    <span class="k-toolbar__spacer"></span>
    <button class="k-toolbar__btn" type="button" aria-label="Fermer" onclick={() => (S.panel = null)}><Icon name="x" /></button>
  </div>
  <div class="k-side-panel__body kc-body">
    <p class="kc-muted">{r.hint}</p>
    {#if r.needsAdmin}
      <p class="kc-note"><Icon name="shield" />Tâche Windows lancée avec les droits administrateur : Windows te demandera l'autorisation au moment du nettoyage. Elle traite tout le dossier d'un bloc.</p>
    {:else if r.toRecycle}
      <p class="kc-note"><Icon name="info" />Ce sont tes fichiers : rien n'est coché d'office, et ce que tu coches part à la Corbeille.</p>
    {:else if r.kind === 'projects'}
      <p class="kc-note"><Icon name="info" />Dossiers de compilation, recréés par npm install, cargo build, pip install… Cochés d'office : projets inactifs depuis {S.settings?.projectIdleDays ?? 14} jours.</p>
    {/if}

    {#await page}
      <p class="kc-muted">Chargement…</p>
    {:then res}
      {#if res}
        <p class="kc-muted">{plural(res.total, 'élément', 'éléments')}{res.total > res.items.length ? `, les ${res.items.length} plus gros affichés` : ''}</p>
        <ul class="kc-items">
          {#each res.items as it (it.index)}
            <li class="kc-item">
              {#if pickable(r)}
                <input type="checkbox" class="k-checkbox" aria-label={it.path} checked={S.itemOn(r, it.index)}
                  onchange={() => S.toggleItem(r, it.index, it.size)} />
              {/if}
              <div class="kc-item__text">
                <span class="kc-item__name">{r.kind === 'projects' ? `${name(dir(it.path))} / ${name(it.path)}` : name(it.path)}</span>
                <span class="kc-path">{dir(it.path)}</span>
                {#if it.label || it.idleDays != null}
                  <span class="kc-muted">{[r.kind === 'recycleBin' ? null : it.label, it.idleDays != null || r.kind === 'projects' ? idle(it.idleDays) : null].filter(Boolean).join(' · ')}</span>
                {/if}
              </div>
              <span class="kc-num kc-item__size">{fmt(it.size)}</span>
              {#if r.kind !== 'recycleBin'}
                <span class="kc-item__actions">
                  <button class="k-toolbar__btn" type="button" title="Afficher dans l'Explorateur" aria-label="Afficher dans l'Explorateur" onclick={() => window.kc.reveal(it.path)}><Icon name="folder-open" /></button>
                  <button class="k-toolbar__btn" type="button" title="Ne plus jamais proposer" aria-label="Ne plus jamais proposer" onclick={() => S.ignore(it.path)}><Icon name="eye-off" /></button>
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if res.total > res.items.length}
          <button class="k-btn k-btn--sm" type="button" onclick={() => (limit += 200)}>Afficher 200 de plus</button>
        {/if}
      {/if}
    {:catch e}
      <p class="kc-muted">{e.message}</p>
    {/await}
  </div>
{/if}

<style>
  .kc-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow: auto; }
  .kc-body p { margin: 0; }
  .kc-note { display: flex; gap: 8px; font-size: 13px; color: var(--ink-secondary); padding: 10px 12px; border-radius: var(--radius-lg); background: var(--fill-subtle); }
  .kc-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .kc-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-light, var(--border)); }
  .kc-item .k-checkbox { margin-top: 2px; flex: none; }
  .kc-item__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .kc-item__name { color: var(--ink); font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .kc-item__size { font-size: 13px; color: var(--ink-secondary); }
  .kc-item__actions { display: flex; gap: 2px; flex: none; }
</style>
