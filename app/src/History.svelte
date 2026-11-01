<script>
  import { S, CATS } from './lib/state.svelte.js';
  import { fmt, date, int } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';

  const rows = $derived([...S.history].reverse());
  const total = $derived(S.history.reduce((a, h) => a + Math.max(h.diskGain, 0), 0));
  const label = (c) => CATS.find((x) => x.id === c)?.label ?? c;
  const cats = (h) => Object.entries(h.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${label(c)} ${fmt(v)}`).join(' · ');
</script>

<header class="k-page-header">
  <div class="k-page-header__content">
    <div class="k-page-header__heading">
      <h1 class="k-page-header__title">Historique</h1>
      <p class="k-page-header__subtitle">{S.history.length ? `${fmt(total)} d'espace libre regagné en ${S.history.length} nettoyages` : 'Aucun nettoyage pour le moment.'}</p>
    </div>
  </div>
</header>

{#if rows.length}
  <div class="k-table-scroll">
    <table class="k-table">
      <thead><tr><th>Date</th><th>Détail</th><th class="k-table__num">Supprimé</th><th class="k-table__num">Disque</th></tr></thead>
      <tbody>
        {#each rows as h (h.at)}
          <tr>
            <td class="kc-num">{date(h.at)}</td>
            <td>
              <div>{cats(h) || '—'}</div>
              <div class="kc-muted">{int(h.deleted)} supprimés{h.recycled ? ` · ${int(h.recycled)} à la Corbeille` : ''}{h.skipped ? ` · ${int(h.skipped)} laissés` : ''}</div>
            </td>
            <td class="k-table__num kc-num">{fmt(h.freed)}</td>
            <td class="k-table__num kc-num">{h.diskGain > 0 ? `+${fmt(h.diskGain)}` : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="kc-muted kc-foot">« Disque » est l'espace libre mesuré avant et après : il peut différer de « Supprimé » (liens physiques, compression, autres programmes qui écrivent en même temps).</p>
{:else}
  <div class="k-empty k-empty--page">
    <div class="k-empty__body">
      <div class="k-empty__art k-empty__art--tile"><Icon name="clock" /></div>
      <div class="k-empty__text"><h2 class="k-empty__title">Rien encore</h2><p class="k-empty__desc">Chaque nettoyage sera noté ici avec l'espace réellement regagné.</p></div>
    </div>
  </div>
{/if}

<style>
  .kc-foot { margin-top: 12px; }
</style>
