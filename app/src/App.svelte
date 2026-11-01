<script>
  import { S, CATS } from './lib/state.svelte.js';
  import { fmt, drive } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import CleanView from './CleanView.svelte';
  import RulePanel from './RulePanel.svelte';
  import History from './History.svelte';
  import Settings from './Settings.svelte';

  S.start();

  function go(view, cat) {
    S.view = view;
    if (view !== 'clean') S.panel = null;
    if (cat) queueMicrotask(() => document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
</script>

<div class="k-app">
  <header class="k-titlebar kc-titlebar">
    <span class="kc-brand"><Icon name="broom-sparkles" /> KubeClean</span>
    <div class="k-titlebar__title"></div>
  </header>
  <div class="k-app__body">
    <nav class="k-sidebar" id="sidebar" data-kube="sidebar" data-kube-key="kubeclean:sidebar-width" data-state="open" aria-label="Navigation">
      <div class="k-sidebar__inner">
        <div class="k-sidebar__header">
          <button class="k-nav-row" type="button" aria-current={S.view === 'clean' ? 'page' : undefined} onclick={() => go('clean')}>
            <span class="k-nav-row__icon"><Icon name="broom-sparkles" /></span>
            <span class="k-nav-row__label">Nettoyage</span>
          </button>
          <button class="k-nav-row" type="button" aria-current={S.view === 'history' ? 'page' : undefined} onclick={() => go('history')}>
            <span class="k-nav-row__icon"><Icon name="clock" /></span>
            <span class="k-nav-row__label">Historique</span>
          </button>
          <button class="k-nav-row" type="button" aria-current={S.view === 'settings' ? 'page' : undefined} onclick={() => go('settings')}>
            <span class="k-nav-row__icon"><Icon name="settings" /></span>
            <span class="k-nav-row__label">Réglages</span>
          </button>
        </div>
        <div class="k-sidebar__scroll">
          <section class="k-nav-section">
            <div class="k-nav-section__title"><span class="k-nav-section__label">Catégories</span></div>
            <div class="k-nav-section__body">
              <div class="k-nav-list">
                {#each CATS as c (c.id)}
                  <button class="k-nav-row k-nav-row--sm" type="button" onclick={() => go('clean', c.id)}>
                    <span class="k-nav-row__icon"><Icon name={c.icon} /></span>
                    <span class="k-nav-row__label">{c.label}</span>
                    <span class="k-nav-row__meta">{S.scan ? (S.catTotal(c.id) ? fmt(S.catTotal(c.id)) : '—') : ''}</span>
                  </button>
                {/each}
              </div>
            </div>
          </section>
        </div>
        <div class="k-sidebar__footer kc-drives">
          {#each S.drives as d (d.root)}
            <div class="kc-drive" title="{fmt(d.free)} libres sur {fmt(d.total)}">
              <div class="kc-drive__line">
                <Icon name="hard-drive" />
                <span class="kc-drive__name">{drive(d.root)}</span>
                <span class="kc-drive__free">{fmt(d.free)} libres</span>
              </div>
              <div class="k-progress k-progress--sm" role="progressbar" aria-label="Espace utilisé sur {drive(d.root)}"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((1 - d.free / d.total) * 100)}
                style:--k-progress={1 - d.free / d.total}
                style:--k-progress-color={d.free / d.total < 0.1 ? 'var(--danger)' : undefined}><div class="k-progress__bar"></div></div>
            </div>
          {/each}
          {#if S.version}<span class="kc-version">moteur Rust {S.version}</span>{/if}
        </div>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Kube resizer: keyboard-resizable separator) -->
      <div class="k-resizer k-resizer--end" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Redimensionner la barre latérale"></div>
    </nav>

    <main class="k-app__main">
      <div class="k-pane">
        <div class="k-split">
          <div class="k-split__main">
            <div class="k-pane__scroll">
              <div class="k-pane__column kc-column">
                {#if S.view === 'clean'}<CleanView />
                {:else if S.view === 'history'}<History />
                {:else}<Settings />{/if}
              </div>
            </div>
          </div>
          <aside class="k-side-panel kc-panel" data-state={S.panel ? 'open' : 'closed'} inert={!S.panel} aria-label="Détails">
            <div class="k-side-panel__frame">
              {#key S.panel}{#if S.panel}<RulePanel id={S.panel} />{/if}{/key}
            </div>
          </aside>
        </div>
      </div>
    </main>
  </div>
</div>
