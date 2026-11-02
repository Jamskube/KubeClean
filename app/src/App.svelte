<script>
  import { tick, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { S, CATS, catColor } from './lib/state.svelte.js';
  import { fmt, drive } from './lib/fmt.js';
  import { kubeOn, dur } from './lib/ui/kube.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';
  import Dashboard from './Dashboard.svelte';
  import CleanView from './CleanView.svelte';
  import Projects from './Projects.svelte';
  import Files from './Files.svelte';
  import History from './History.svelte';
  import Settings from './Settings.svelte';
  import Result from './Result.svelte';
  import RulePanel from './RulePanel.svelte';
  import Confirm from './Confirm.svelte';
  import Running from './Running.svelte';
  import Palette from './Palette.svelte';

  S.start();

  const NAV = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'layout-dashboard' },
    { id: 'clean', label: 'Nettoyage', icon: 'broom-sparkles' },
    { id: 'projects', label: 'Projets', icon: 'folder-code' },
    { id: 'files', label: 'Fichiers', icon: 'file-archive' },
    { id: 'history', label: 'Historique', icon: 'clock-arrow-left' },
    { id: 'settings', label: 'Réglages', icon: 'settings' },
  ];
  const THEMES = [
    { id: 'light', icon: 'sun', label: 'Thème clair' },
    { id: 'dark', icon: 'moon', label: 'Thème sombre' },
    { id: 'system', icon: 'monitor', label: 'Thème du système' },
  ];

  let scroller = $state();
  // category bars stretch from 0 on the first frame, then follow their value
  let armed = $state(false);
  onMount(() => requestAnimationFrame(() => (armed = true)));

  async function go(view, cat) {
    S.view = view;
    if (view !== 'clean') S.panel = null;
    await tick();
    if (cat) document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else scroller?.scrollTo({ top: 0 });
  }

  // status pill text
  const sec = $derived(Math.max(1, Math.round(S.scanMs / 1000)));
  const status = $derived.by(() => {
    if (S.busy === 'scan') {
      const p = S.progress;
      return p ? `Analyse… ${p.done}/${p.total} · ${p.label}` : 'Analyse…';
    }
    if (S.busy === 'clean') return S.progress?.label ? `Nettoyage… ${S.progress.label}` : 'Nettoyage…';
    if (!S.scan) return 'En attente du moteur';
    return S.total > 0
      ? `Prêt · ${fmt(S.total)} prêts à partir · analysé en ${sec} s`
      : `Prêt · ${fmt(S.found)} trouvés · analysé en ${sec} s`;
  });

  function onKey(e) {
    if (e.key === 'Escape' && S.panel && !document.querySelector('dialog[open]')) { S.panel = null; return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '6') { e.preventDefault(); go(NAV[Number(e.key) - 1].id); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="k-app" data-view={S.view} data-busy={S.busy} data-scanned={!!S.scan}>
  <header class="k-titlebar kc-titlebar">
    <div class="k-titlebar__group">
      <button class="k-toolbar__btn" type="button" data-kube-toggle="#sidebar" data-kube-peek="#sidebar" aria-label="Afficher ou masquer la barre latérale"><Icon name="panel-left" /></button>
      <span class="kc-brand"><Icon name="broom-sparkles" /><span>KubeClean</span></span>
    </div>
    <div class="k-titlebar__title kc-status">
      {#key S.busy}
        <span class="k-status-pill kc-status__pill" class:kc-status__pill--live={!!S.busy} role="status" in:fade={{ duration: dur(200) }}>
          {#if S.busy}<span class="k-dot-pulse" style:--k-dot-size="6px" style:--k-dot-color="var(--accent)"></span>
          {:else if S.scan}<span class="k-pop kc-status__check"><Icon name="circle-check" /></span>{/if}
          <span class="k-status-pill__label">{status}</span>
        </span>
      {/key}
    </div>
    <div class="k-titlebar__group">
      <div class="k-seg k-seg--xs kc-theme" data-kube="segmented" data-kube-value={S.theme} aria-label="Thème" use:kubeOn={{ change: (e) => S.setTheme(e.detail.value) }}>
        <span class="k-seg__thumb" aria-hidden="true"></span>
        {#each THEMES as t (t.id)}
          <button class="k-seg__item" type="button" role="radio" data-value={t.id} aria-checked={S.theme === t.id} aria-label={t.label} data-kube="tooltip" data-kube-tooltip={t.label}><Icon name={t.icon} /></button>
        {/each}
      </div>
      <button class="k-btn k-btn--ghost k-btn--sm kc-palette-btn" type="button" data-kube-open="#palette" aria-label="Ouvrir la palette de commandes"><Icon name="search" /><kbd class="k-kbd">Ctrl K</kbd></button>
    </div>
  </header>

  <div class="k-app__body">
    <nav class="k-sidebar" id="sidebar" data-kube="sidebar" data-kube-key="kubeclean:sidebar" data-kube-default="275" data-state={S.sidebarOpen ? 'open' : 'collapsed'} aria-label="Navigation"
      use:kubeOn={{ open: () => (S.sidebarOpen = true), close: () => (S.sidebarOpen = false) }}>
      <div class="k-sidebar__inner">
        <div class="k-sidebar__header kc-nav">
          {#each NAV as n (n.id)}
            <button class="k-nav-row" type="button" data-view={n.id} aria-current={S.view === n.id ? 'page' : undefined} onclick={() => go(n.id)}>
              <span class="k-nav-row__icon"><Icon name={n.icon} /></span>
              <span class="k-nav-row__label">{n.label}</span>
              {#if n.id === 'history' && S.history.length}<span class="k-nav-row__meta">{S.history.length}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="k-sidebar__scroll k-scrollbar">
          <section class="k-nav-section" data-kube="nav-section" data-kube-key="kubeclean:cats">
            <div class="k-nav-section__title">
              <button class="k-nav-section__toggle" type="button" aria-expanded="true"><span class="k-nav-section__label">Catégories</span><svg class="k-icon k-nav-section__chevron" aria-hidden="true"><use href="kube/icons/kube-icons.svg#chevron-down"></use></svg></button>
            </div>
            <div class="k-nav-section__body">
              <div class="k-nav-list">
                {#each CATS as c (c.id)}
                  {@const total = S.catTotal(c.id)}
                  {@const sel = S.catSelected(c.id)}
                  <button class="k-nav-row k-nav-row--sm kc-cat" type="button" onclick={() => go('clean', c.id)} aria-label="{c.label}, {total ? fmt(total) : 'rien trouvé'}"
                    data-kube={total ? 'tooltip' : undefined} data-kube-tooltip="{fmt(sel)} cochés sur {fmt(total)}" data-kube-side="right">
                    <span class="k-nav-row__icon"><Icon name={c.icon} /></span>
                    <span class="k-nav-row__label">{c.label}</span>
                    <span class="k-nav-row__meta">{#if S.scan}{#if total}<Num value={total} />{:else}—{/if}{/if}</span>
                    <span class="kc-cat__bar" aria-hidden="true"><span style:background={catColor(c.id)} style:transform="scaleX({armed && total ? sel / total : 0})"></span></span>
                  </button>
                {/each}
              </div>
            </div>
          </section>
        </div>
        <div class="k-sidebar__footer kc-drives" class:kc-drives--many={S.drives.length > 3}>
          {#each S.drives as d (d.root)}
            {@const ratio = 1 - d.free / d.total}
            <div class="k-sidebar__card kc-drive" title="{fmt(d.free)} libres sur {fmt(d.total)}">
              <div class="kc-drive__line">
                <Icon name="hard-drive" />
                <span class="kc-drive__name">{drive(d.root)}</span>
                <span class="kc-drive__free"><Num value={d.free} /> libres</span>
              </div>
              <div class="k-progress k-progress--sm" role="progressbar" aria-label="Espace utilisé sur {drive(d.root)}"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(ratio * 100)}
                style:--k-progress={ratio}
                style:--k-progress-color={d.free / d.total < 0.1 ? 'var(--danger)' : 'var(--ink-tertiary)'}><div class="k-progress__bar"></div></div>
            </div>
          {/each}
          {#if S.version}<span class="kc-version k-micro">moteur {S.version}</span>{/if}
        </div>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Kube resizer: keyboard-resizable separator) -->
      <div class="k-resizer k-resizer--end" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Redimensionner la barre latérale"></div>
    </nav>

    <main class="k-app__main">
      <div class="k-pane">
        <div class="k-split">
          <div class="k-split__main">
            <div class="k-pane__fade" aria-hidden="true"></div>
            <div class="k-pane__scroll k-scrollbar k-scrollbar--stable-both" bind:this={scroller}>
              {#key S.view}
                <div class="k-pane__column kc-column" class:kc-column--wide={S.view === 'dashboard' || S.view === 'result'} in:fade={{ duration: dur(120) }}>
                  {#if S.view === 'dashboard'}<Dashboard />
                  {:else if S.view === 'clean'}<CleanView />
                  {:else if S.view === 'projects'}<Projects />
                  {:else if S.view === 'files'}<Files />
                  {:else if S.view === 'history'}<History />
                  {:else if S.view === 'settings'}<Settings />
                  {:else if S.view === 'result'}<Result />{/if}
                </div>
              {/key}
            </div>
          </div>
          <aside class="k-side-panel kc-panel" data-state={S.panel ? 'open' : 'closed'} inert={!S.panel} aria-label="Détails de la règle">
            <div class="k-side-panel__frame">
              {#key S.panel}{#if S.panel}<RulePanel id={S.panel} />{/if}{/key}
            </div>
          </aside>
        </div>
      </div>
    </main>
  </div>

  {#if S.busy === 'clean'}
    <div class="kc-running" in:fade={{ duration: dur(200) }} out:fade={{ duration: dur(140) }}><Running /></div>
  {/if}
  <Confirm />
  <Palette />
</div>
