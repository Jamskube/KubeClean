<script>
  import { tick, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { S, CATS, catColor, MAC, OS } from './lib/state.svelte.js';
  import { fmt, drive } from './lib/fmt.js';
  import { kubeOn, dur } from './lib/ui/kube.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';
  import Dashboard from './Dashboard.svelte';
  import CleanView from './CleanView.svelte';
  import Projects from './Projects.svelte';
  import Files from './Files.svelte';
  import Apps from './Apps.svelte';
  import History from './History.svelte';
  import Settings from './Settings.svelte';
  import Result from './Result.svelte';
  import RulePanel from './RulePanel.svelte';
  import Confirm from './Confirm.svelte';
  import Running from './Running.svelte';
  import Palette from './Palette.svelte';
  import RailPreview from './RailPreview.svelte';
  import SidebarSummary from './SidebarSummary.svelte';

  S.start();

  const NAV = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'layout-dashboard' },
    { id: 'clean', label: 'Nettoyage', icon: 'broom-sparkles' },
    { id: 'projects', label: 'Projets', icon: 'folder-code' },
    { id: 'files', label: 'Fichiers', icon: 'file-archive' },
    { id: 'apps', label: 'Applications', icon: 'app-window' },
    { id: 'history', label: 'Historique', icon: 'clock-arrow-left' },
    { id: 'settings', label: 'Réglages', icon: 'settings' },
  ].filter((n) => !(MAC && n.id === 'projects'));
  const THEMES = [
    { id: 'light', icon: 'sun', label: 'Thème clair' },
    { id: 'dark', icon: 'moon', label: 'Thème sombre' },
    { id: 'system', icon: 'monitor', label: 'Thème du système' },
  ];
  const currentView = $derived(NAV.find((n) => n.id === S.view) ?? { label: 'Résultat du nettoyage', icon: 'circle-check' });
  let returningFocus = false;
  const previewTrigger = (id) => document.querySelector(`[data-rail-view="${id}"]`);
  function closePreviews(except) {
    for (const n of NAV) if (n.id !== except) window.Kube?.get(previewTrigger(n.id), 'hover-card')?.close();
  }
  // Kube restaure aussi l’état mémorisé au démarrage, sans émettre open/close.
  function trackSidebar(node) {
    const sync = () => {
      S.sidebarOpen = node.dataset.state !== 'collapsed';
      if (S.sidebarOpen) closePreviews();
    };
    const observer = new MutationObserver(sync);
    observer.observe(node, { attributes: true, attributeFilter: ['data-state'] });
    sync();
    return () => observer.disconnect();
  }
  function previewOpen(e, id) {
    if (S.sidebarOpen || returningFocus || (S.busy === 'clean' && !S.runMini) || document.querySelector('dialog[open]')) { e.preventDefault(); return; }
    closePreviews(id);
  }
  function closePreview(id, focus = false) {
    returningFocus = true;
    window.Kube?.get(previewTrigger(id), 'hover-card')?.close();
    if (focus) previewTrigger(id)?.focus({ preventScroll: true });
    returningFocus = false;
  }
  function previewKey(e, id) {
    if (S.sidebarOpen) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    window.Kube?.get(e.currentTarget, 'hover-card')?.open();
    document.querySelector(`#preview-${id}:popover-open button:not(:disabled), #preview-${id}:popover-open input:not(:disabled)`)?.focus();
  }

  let scroller = $state();
  // category bars stretch from 0 on the first frame, then follow their value
  let armed = $state(false);
  onMount(() => requestAnimationFrame(() => (armed = true)));

  async function go(view, cat) {
    closePreviews();
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
    return `Analyse terminée · ${sec} s`;
  });

  function onKey(e) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && S.panel && !document.querySelector('dialog[open]')) { S.panel = null; return; }
    // e.code: on a Mac, Option+1 types « ¡ » into e.key
    const n = Number(/^Digit([1-9])$/.exec(e.code)?.[1]);
    if (e.altKey && !e.ctrlKey && !e.metaKey && n <= NAV.length) { e.preventDefault(); go(NAV[n - 1].id); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="k-app" data-view={S.view} data-busy={S.busy} data-scanned={!!S.scan}>
  <header class="k-titlebar kc-titlebar">
    <div class="k-titlebar__group">
      <button class="k-toolbar__btn" type="button" data-kube-toggle="#sidebar" aria-label="Afficher ou masquer la barre latérale" onclick={() => closePreviews()}><Icon name="panel-left" /></button>
    </div>
    <div class="k-titlebar__title"></div>
    <div class="k-titlebar__group">
      <div class="k-seg k-seg--xs kc-theme" data-kube="segmented" data-kube-value={S.theme} aria-label="Thème" use:kubeOn={{ change: (e) => S.setTheme(e.detail.value) }}>
        <span class="k-seg__thumb" aria-hidden="true"></span>
        {#each THEMES as t (t.id)}
          <button class="k-seg__item" type="button" role="radio" data-value={t.id} aria-checked={S.theme === t.id} aria-label={t.label} data-kube="tooltip" data-kube-tooltip={t.label}><Icon name={t.icon} /></button>
        {/each}
      </div>
      <button class="k-btn k-btn--ghost k-btn--sm kc-palette-btn" type="button" data-kube-open="#palette" aria-label="Ouvrir la palette de commandes"><Icon name="search" /><kbd class="k-kbd">{OS.mod} K</kbd></button>
    </div>
  </header>

  <div class="k-app__body">
    <nav class="kc-rail" aria-label="Accès rapide">
      {#each NAV as n (n.id)}
        <button class="k-toolbar__btn kc-rail__button" class:kc-rail__settings={n.id === 'settings'} type="button"
          aria-label={n.label} aria-current={S.view === n.id ? 'page' : undefined}
          data-rail-view={n.id} data-kube="hover-card" data-kube-target="#preview-{n.id}" data-kube-side="right" data-kube-align="start" data-kube-offset="8" data-kube-delay="220" data-kube-close-delay="250"
          aria-controls="preview-{n.id}" aria-haspopup={S.sidebarOpen ? undefined : 'dialog'} aria-expanded="false"
          use:kubeOn={{ open: (e) => previewOpen(e, n.id) }} onkeydown={(e) => previewKey(e, n.id)} onclick={() => go(n.id)}><Icon name={n.icon} /></button>
      {/each}
    </nav>
    <div class="kc-workspace">
    <aside class="k-sidebar" id="sidebar" data-kube="sidebar" data-kube-key="kubeclean:sidebar" data-kube-default="275" data-state="open" aria-label="Mon espace" {@attach trackSidebar}>
      <div class="k-sidebar__inner">
        <div class="k-sidebar__toolbar kc-sidebar-heading">
          <span>Mon espace</span>
        </div>
        <div class="k-sidebar__scroll k-scrollbar">
          <SidebarSummary />
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
          {#if S.drives.length > 3}<button class="k-btn k-btn--ghost k-btn--sm kc-drives__more" type="button" onclick={async () => { await go('dashboard'); document.getElementById('storage-title')?.scrollIntoView({ block: 'start' }); }}>Voir les {S.drives.length} lecteurs<Icon name="arrow-right" /></button>{/if}
          {#if S.appVersion}<span class="kc-version k-micro">KubeClean {S.appVersion}<span>Local · {OS.name}</span></span>{/if}
        </div>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Kube resizer: keyboard-resizable separator) -->
      <div class="k-resizer k-resizer--end" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Redimensionner la barre latérale"></div>
    </aside>

    <main class="k-app__main">
      <div class="k-pane">
        <div class="k-split">
          <div class="k-split__main">
            <header class="kc-pane-header">
              <div class="kc-pane-header__title"><Icon name={currentView.icon} /><span>{currentView.label}</span></div>
              <span class="kc-status__pill" class:kc-status__pill--live={!!S.busy} role="status">
                {#if S.busy}<span class="k-dot-pulse" style:--k-dot-size="6px" style:--k-dot-color="var(--accent)"></span>
                {:else if S.scan}<Icon name="circle-check" />{/if}
                <span class="kc-pane-header__status">{status}</span>
              </span>
            </header>
            <div class="k-pane__fade" aria-hidden="true"></div>
            <div class="k-pane__scroll k-scrollbar k-scrollbar--stable-both" bind:this={scroller}>
              {#key S.view}
                <div class="k-pane__column kc-column" class:kc-column--wide={S.view === 'dashboard' || S.view === 'result'} in:fade={{ duration: dur(120) }}>
                  {#if S.view === 'dashboard'}<Dashboard />
                  {:else if S.view === 'clean'}<CleanView />
                  {:else if S.view === 'projects'}<Projects />
                  {:else if S.view === 'files'}<Files />
                  {:else if S.view === 'apps'}<Apps />
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
  </div>

  {#if S.busy === 'clean'}
    <div class="kc-running" class:kc-running--mini={S.runMini} in:fade={{ duration: dur(200) }} out:fade={{ duration: dur(140) }}><Running /></div>
  {/if}
  <Confirm />
  <Palette />
  {#each NAV as n (n.id)}
    <RailPreview page={n} navigate={() => go(n.id)} close={(focus) => closePreview(n.id, focus)} />
  {/each}
</div>
