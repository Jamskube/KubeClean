<script>
  // « Applications » : celles qu'on n'ouvre plus, celles qui plantent, le démarrage, les mises à jour.
  // Rien n'est jamais coché ni lancé d'office : chaque action passe par une confirmation.
  import { fly } from 'svelte/transition';
  import { MAC } from './lib/state.svelte.js';
  import { A, UNUSED_DAYS, ago, isUnstable } from './lib/apps.svelte.js';
  import { fmt, plural } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = reduced ? 0 : 200;

  const TABS = [
    { id: 'unused', label: 'Inutilisées', icon: 'clock', hint: `Applis que tu n’as pas ouvertes depuis plus de ${UNUSED_DAYS} jours` },
    { id: 'unstable', label: 'Plantages', icon: 'triangle-alert', hint: 'Applis qui ont planté ou cessé de répondre ces 30 derniers jours' },
    { id: 'all', label: 'Toutes', icon: 'layout-grid', hint: 'Toutes les applications installées' },
    { id: 'startup', label: 'Démarrage', icon: 'power', hint: MAC ? 'Agents lancés à l’ouverture de ta session' : 'Programmes lancés à l’ouverture de ta session' },
    ...(MAC ? [] : [{ id: 'updates', label: 'Mises à jour', icon: 'circle-arrow-up', hint: 'Nouvelles versions disponibles via winget' }]),
  ];
  let tab = $state('unused');
  let sort = $state('size'); // size | used | name
  let q = $state('');
  let ask = $state(null); // { kind: 'uninstall' | 'reset', app }
  let dlg = $state();

  A.load();
  $effect(() => { if (tab === 'startup') A.loadStartup(); if (tab === 'updates') A.loadUpdates(); });
  $effect(() => { if (ask && dlg && !dlg.open) dlg.showModal(); });

  const total = (a) => a.size + (MAC ? a.data : 0);
  const base = $derived(tab === 'unused' ? A.unused : tab === 'unstable' ? A.unstable : (A.list ?? []));
  const shown = $derived.by(() => {
    const n = q.trim().toLowerCase();
    const list = base.filter((a) => !n || a.name.toLowerCase().includes(n) || a.publisher?.toLowerCase().includes(n));
    if (tab === 'all') {
      if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      else if (sort === 'used') list.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0));
      else list.sort((a, b) => total(b) - total(a));
    }
    return list;
  });
  const count = (id) => (id === 'unused' ? A.unused.length : id === 'unstable' ? A.unstable.length : id === 'all' ? (A.list?.length ?? 0) : id === 'startup' ? (A.startup?.filter((s) => s.enabled).length ?? null) : (A.updates?.length ?? null));
  const unusedSize = $derived(A.unused.reduce((n, a) => n + total(a), 0));

  function seen(a) {
    if (a.lastUsed != null) return `Ouverte ${ago(a.lastUsed)}`;
    return A.tracking ? 'Aucune ouverture notée' : 'Ouvertures non suivies';
  }
  function trouble(a) {
    const p = [];
    if (a.crashes) p.push(plural(a.crashes, 'plantage', 'plantages'));
    if (a.hangs) p.push(plural(a.hangs, 'blocage', 'blocages'));
    return p.join(' · ');
  }
  const short = (cmd) => cmd.replace(/^"([^"]+)".*$/, '$1');

  function confirmText(k, a) {
    if (k === 'reset') return `Les réglages et données de ${a.name} (${fmt(a.data)}) partent à la Corbeille. L’appli reste installée et repart comme au premier lancement.`;
    if (MAC) return `${a.name} et ses données (${fmt(a.size + a.data)} au total) partent à la Corbeille. « Remettre » dans le Finder les restaure tant que tu ne la vides pas.`;
    if (a.kind === 'store') return `${a.name} sera supprimée avec ses données. Tu pourras la réinstaller depuis le Microsoft Store.`;
    return `Le programme de désinstallation officiel de ${a.name} va s’ouvrir : suis ses étapes. KubeClean ne supprime rien lui-même.`;
  }
  async function go() {
    const { kind, app } = ask;
    dlg.close();
    if (kind === 'reset') await A.reset(app);
    else await A.uninstall(app);
  }
</script>

<div class="kc-view">
  <header class="k-page-header" data-kube="page-header">
    <div class="k-page-header__content">
      <div class="k-page-header__heading">
        <h1 class="k-page-header__title">Applications</h1>
        <p class="k-page-header__subtitle">Celles que tu n’ouvres plus, celles qui plantent, ce qui se lance au démarrage. Rien n’est fait sans ton accord.</p>
        {#if A.list}
          <p class="kc-summary"><Num value={A.list.length} kind="int" /> applis · {#if A.unused.length}<Num value={A.unused.length} kind="int" /> inutilisées depuis {UNUSED_DAYS} jours ({fmt(unusedSize)}){:else}aucune inutilisée{/if}{#if A.unstable.length}{' · '}{plural(A.unstable.length, 'instable', 'instables')}{/if}</p>
        {/if}
      </div>
      <div class="k-page-header__actions">
        <button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={A.loading} onclick={() => { A.load(true); if (A.startup) A.loadStartup(true); if (A.updates) A.loadUpdates(true); }}><Icon name="refresh-cw" />Actualiser</button>
      </div>
    </div>
  </header>

  <div class="k-tabs k-tabs--flush kc-tabs" role="tablist" aria-label="Applications" data-kube="tabs" data-kube-reorder="false">
    {#each TABS as t (t.id)}
      {@const n = count(t.id)}
      <div class="k-tab">
        <button class="k-tab__btn" role="tab" aria-selected={tab === t.id} aria-controls="apps-panel" data-tab={t.id} data-kube="tooltip" data-kube-tooltip={t.hint} data-kube-side="bottom" onclick={() => { tab = t.id; q = ''; }}>
          <span class="k-tab__icon"><Icon name={t.icon} /></span>
          <span class="k-tab__label">{t.label}</span>
          {#if n != null && (A.list || t.id === 'startup' || t.id === 'updates')}<span class="k-badge kc-tab-badge" class:k-badge--warning={t.id === 'unstable' && n > 0}>{n}</span>{/if}
        </button>
      </div>
    {/each}
  </div>

  <section id="apps-panel" role="tabpanel" class="kc-panel">
    {#if tab === 'startup'}
      <p class="kc-note">{MAC ? 'Désactiver un agent l’empêche de se lancer à ta prochaine session ; l’appli reste installée. Les éléments ajoutés par les applis récentes se règlent dans Réglages Système.' : 'Désactiver un programme l’empêche de se lancer à ta prochaine session, comme dans le Gestionnaire des tâches. Rien n’est supprimé.'}</p>
      {#if !A.startup}
        {@render skeleton(4)}
      {:else if !A.startup.length}
        {@render empty('power-off', 'Rien ne se lance au démarrage', MAC ? 'Aucun agent de lancement tiers.' : 'Aucun programme inscrit au démarrage de ta session.')}
      {:else}
        <ul class="kc-rows" aria-label="Éléments de démarrage">
          {#each A.startup as s, i (s.id)}
            <li class="kc-row" in:fly={{ y: 6, duration: dur, delay: Math.min(i, 8) * 25 }}>
              {@render appIcon(s.icon)}
              <div class="kc-row__text">
                <span class="kc-row__name" title={s.name}>{s.name}</span>
                <span class="kc-row__sub"><span class="kc-row__cmd" title={s.command}>{short(s.command)}</span>{#if s.scope === 'machine'}<span class="k-badge kc-scope">Tous les utilisateurs</span>{/if}</span>
              </div>
              <span class="kc-row__state">{s.enabled ? 'Activé' : 'Désactivé'}</span>
              <input type="checkbox" role="switch" class="k-switch" aria-label="Lancer {s.name} au démarrage" checked={s.enabled} disabled={!s.editable}
                title={s.editable ? undefined : MAC ? 'Service système : réservé à l’administrateur' : 'Commun à tous les utilisateurs : réglable dans le Gestionnaire des tâches'}
                onchange={(e) => A.setStartup(s, e.currentTarget.checked)} />
            </li>
          {/each}
        </ul>
      {/if}
      <div class="kc-more"><button class="k-btn k-btn--sm" type="button" onclick={() => kc.openStartupSettings()}><Icon name="settings" />{MAC ? 'Ouvrir « Ouverture » dans Réglages Système' : 'Ouvrir les applis de démarrage de Windows'}</button></div>

    {:else if tab === 'updates'}
      {#if A.updatesLoading && !A.updates}
        <p class="kc-note">Recherche des nouvelles versions…</p>
        {@render skeleton(4)}
      {:else if A.updatesError}
        {@render empty('circle-alert', 'Recherche impossible', A.updatesError)}
      {:else if !A.updates?.length}
        {@render empty('circle-check', 'Tout est à jour', 'Aucune nouvelle version connue de winget pour tes applications.')}
      {:else}
        <div class="kc-toolbar">
          <p class="kc-note">{plural(A.updates.length, 'mise à jour disponible', 'mises à jour disponibles')}. L’installeur de chaque appli peut s’afficher ou demander l’autorisation de Windows.</p>
          <button class="k-btn k-btn--sm k-btn--primary" type="button" disabled={Object.keys(A.working).length > 0} onclick={() => A.upgradeAll()}><Icon name="circle-arrow-up" />Tout mettre à jour</button>
        </div>
        <ul class="kc-rows" aria-label="Mises à jour">
          {#each A.updates as u, i (u.id)}
            <li class="kc-row" in:fly={{ y: 6, duration: dur, delay: Math.min(i, 8) * 25 }}>
              <span class="kc-app-icon"><Icon name="package" /></span>
              <div class="kc-row__text">
                <span class="kc-row__name" title={u.name}>{u.name}</span>
                <span class="kc-row__sub"><span class="kc-version">{u.version}</span><Icon name="arrow-right" /><span class="kc-version kc-version--new">{u.available}</span></span>
              </div>
              {#if A.working[u.id]}<span class="kc-working"><span class="k-dot-pulse" style:--k-dot-size="6px" style:--k-dot-color="var(--accent)" aria-hidden="true"></span>{A.working[u.id]}</span>
              {:else}<button class="k-btn k-btn--sm" type="button" disabled={Object.keys(A.working).length > 0} onclick={() => A.upgrade(u)}>Mettre à jour</button>{/if}
            </li>
          {/each}
        </ul>
      {/if}

    {:else if !A.list}
      {@render skeleton(6)}
    {:else}
      {#if tab === 'unused' && !A.tracking}
        <div class="k-alert k-alert--block" role="note"><div class="k-alert__row"><span class="k-alert__icon"><Icon name="info" /></span><div class="k-alert__content"><div class="k-alert__description">{MAC ? 'Spotlight est désactivé : macOS ne note pas quand tu ouvres une appli, aucune ne peut être dite inutilisée.' : 'Windows ne note pas les ouvertures d’applis (Paramètres › Confidentialité et sécurité › Général › « Autoriser Windows à suivre les lancements d’applications »).'}</div></div></div></div>
      {/if}
      {#if tab === 'unused'}<p class="kc-note">Seules les applis dont une ouverture est notée sont classées ici. Les outils en ligne de commande et les composants système n’y figurent jamais.</p>{/if}
      {#if tab === 'all'}
        <div class="kc-toolbar">
          <div role="search" class="kc-search"><div class="k-input k-input--sm" data-kube="input-clear">
            <span class="k-input__icon"><Icon name="search" /></span>
            <input type="search" placeholder="Filtrer par nom" aria-label="Filtrer par nom" autocomplete="off" bind:value={q} />
            <button class="k-input__clear" type="button" aria-label="Effacer" onclick={() => (q = '')}><Icon name="x" /></button>
          </div></div>
          <div class="k-seg k-seg--sm" role="radiogroup" data-kube="segmented" aria-label="Trier">
            <span class="k-seg__thumb" aria-hidden="true"></span>
            <button class="k-seg__item" type="button" role="radio" data-value="size" aria-checked={sort === 'size'} onclick={() => (sort = 'size')}>Taille</button>
            <button class="k-seg__item" type="button" role="radio" data-value="used" aria-checked={sort === 'used'} onclick={() => (sort = 'used')}>Dernière ouverture</button>
            <button class="k-seg__item" type="button" role="radio" data-value="name" aria-checked={sort === 'name'} onclick={() => (sort = 'name')}>Nom</button>
          </div>
        </div>
      {/if}
      {#if !shown.length}
        {#if tab === 'unused'}{@render empty('circle-check', 'Aucune appli oubliée', `Toutes les applis suivies ont été ouvertes ces ${UNUSED_DAYS} derniers jours.`)}
        {:else if tab === 'unstable'}{@render empty('circle-check', 'Aucun plantage récent', 'Aucune appli n’a planté ni cessé de répondre ces 30 derniers jours.')}
        {:else}{@render empty('search-x', 'Aucune appli ne correspond', '')}{/if}
      {:else}
        <ul class="kc-rows" aria-label="Applications">
          {#each shown as a, i (a.id)}
            <li class="k-reveal kc-row" in:fly={{ y: 6, duration: dur, delay: Math.min(i, 8) * 25 }}>
              {@render appIcon(a.icon)}
              <div class="kc-row__text">
                <span class="kc-row__name" title={a.name}>{a.name}{#if a.running}<span class="k-badge k-badge--success kc-open">Ouverte</span>{/if}</span>
                <span class="kc-row__sub">
                  <span class="kc-row__seen">{seen(a)}</span>
                  {#if isUnstable(a)}<span class="kc-row__trouble"><Icon name="triangle-alert" />{trouble(a)}</span>{/if}
                  {#if a.publisher || a.version}<span class="kc-row__pub" title="{a.publisher ?? ''} {a.version ?? ''}">{[a.publisher, a.version].filter(Boolean).join(' · ')}</span>{/if}
                </span>
              </div>
              <span class="kc-row__meta">
                {#if A.working[a.id]}<span class="kc-working"><span class="k-dot-pulse" style:--k-dot-size="6px" style:--k-dot-color="var(--accent)" aria-hidden="true"></span>{A.working[a.id]}</span>
                {:else}
                  <span class="k-reveal__item kc-row__actions">
                    {#if MAC && a.data > 0}<button class="k-btn k-btn--ghost k-btn--xs" type="button" disabled={a.running} title={a.running ? 'Quitte-la d’abord' : undefined} onclick={() => (ask = { kind: 'reset', app: a })}><Icon name="rotate-ccw" />Réinitialiser</button>{/if}
                    <button class="k-btn k-btn--ghost k-btn--xs kc-danger" type="button" disabled={MAC && a.running} title={MAC && a.running ? 'Quitte-la d’abord' : undefined} onclick={() => (ask = { kind: 'uninstall', app: a })}><Icon name="package-x" />Désinstaller</button>
                  </span>
                {/if}
                <span class="kc-row__size kc-num" title={MAC && a.data ? `${fmt(a.size)} d’appli + ${fmt(a.data)} de données` : undefined}>{total(a) ? fmt(total(a)) : '—'}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
</div>

{#if ask}
  <dialog class="k-dialog k-dialog--form kc-ask" bind:this={dlg} data-kube="dialog" aria-labelledby="ask-title" onclose={() => (ask = null)}>
    <form method="dialog" class="k-dialog__body" onsubmit={(e) => e.preventDefault()}>
      <div class="k-dialog__header">
        <span class="k-dialog__icon"><Icon name={ask.kind === 'reset' ? 'rotate-ccw' : 'package-x'} /></span>
        <div class="k-dialog__heading">
          <h2 class="k-dialog__title" id="ask-title">{ask.kind === 'reset' ? 'Réinitialiser' : 'Désinstaller'} {ask.app.name}&nbsp;?</h2>
          <p class="k-dialog__description">{confirmText(ask.kind, ask.app)}</p>
        </div>
      </div>
      <div class="k-dialog__actions">
        <!-- svelte-ignore a11y_autofocus (action destructive : le focus démarre sur Annuler) -->
        <button class="k-btn" type="button" autofocus onclick={() => dlg.close()}>Annuler</button>
        <button class="k-btn k-btn--primary" type="button" data-action="confirm-app" onclick={go}><Icon name={ask.kind === 'reset' ? 'rotate-ccw' : 'package-x'} />{ask.kind === 'reset' ? 'Réinitialiser' : MAC || ask.app.kind === 'store' ? 'Désinstaller' : 'Ouvrir le désinstalleur'}</button>
      </div>
    </form>
  </dialog>
{/if}

{#snippet appIcon(path)}
  <span class="kc-app-icon">{#if path && A.icons[path]}<img src={A.icons[path]} alt="" width="24" height="24" />{:else}<Icon name="app-window" />{/if}</span>
{/snippet}
{#snippet skeleton(n)}
  <ul class="kc-rows" aria-busy="true" aria-label="Chargement">
    {#each Array(n) as _, i (i)}<li class="kc-row"><span class="k-skeleton kc-skel-icon"></span><span class="k-skeleton-lines kc-skel"><span class="k-skeleton k-skeleton--sm" style:width="{30 + ((i * 17) % 30)}%"></span><span class="k-skeleton k-skeleton--sm" style:width="{45 + ((i * 11) % 25)}%"></span></span></li>{/each}
  </ul>
{/snippet}
{#snippet empty(icon, title, desc)}
  <div class="k-empty">
    <div class="k-empty__body">
      <div class="k-empty__art"><Icon name={icon} /></div>
      <div class="k-empty__text"><h2 class="k-empty__title">{title}</h2>{#if desc}<p class="k-empty__desc">{desc}</p>{/if}</div>
    </div>
  </div>
{/snippet}


<style>
  .kc-view { display: flex; flex-direction: column; gap: var(--space-4); min-height: 100%; }
  .kc-summary { margin: 0; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-note { margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-secondary); }

  .kc-tabs { -webkit-app-region: no-drag; height: auto; padding-block: 2px; border-bottom: 1px solid var(--border-light); }
  .kc-tabs .k-tab { flex: none; max-width: none; height: var(--control-md); container-type: normal; white-space: nowrap; }
  .kc-tabs .k-tab__btn { padding-inline: var(--space-3); }
  .kc-tabs .k-tab__btn[aria-selected="true"] { font-weight: 510; }
  .kc-tabs .k-tab__label { flex: none; -webkit-mask-image: none; mask-image: none; }
  .kc-tab-badge { margin-inline-start: var(--space-2); font-variant-numeric: tabular-nums; }

  .kc-panel { display: flex; flex-direction: column; gap: var(--space-3); flex: 1; }
  .kc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); justify-content: space-between; }
  .kc-toolbar .kc-note { flex: 1 1 18rem; }
  .kc-search { width: 220px; }
  .kc-search .k-input { width: 100%; }

  .kc-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-row { display: flex; align-items: center; gap: var(--space-3); padding: 6px var(--space-2); border-radius: var(--radius-lg); transition: background-color var(--duration-basic); }
  .kc-row:hover { background: var(--fill-subtle); }
  .kc-row:has(:focus-visible) { background: var(--accent-subtle); }
  .kc-app-icon { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--fill-secondary); color: var(--ink-secondary); }
  .kc-app-icon:has(img) { background: none; }
  .kc-app-icon img { width: 24px; height: 24px; object-fit: contain; }
  .kc-row__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-row__name { display: flex; align-items: center; gap: var(--space-2); font-size: 14px; font-weight: 510; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-open { flex: none; }
  .kc-row__sub { display: flex; align-items: center; gap: var(--space-3); min-width: 0; font-size: 12px; color: var(--ink-secondary); }
  .kc-row__sub > :global(.k-icon) { flex: none; width: 12px; height: 12px; }
  .kc-row__seen { flex: none; white-space: nowrap; }
  .kc-row__trouble { flex: none; display: inline-flex; align-items: center; gap: 4px; color: var(--warning); white-space: nowrap; }
  .kc-row__trouble :global(.k-icon) { width: 12px; height: 12px; }
  .kc-row__pub, .kc-row__cmd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-tertiary); }
  .kc-scope { flex: none; }
  .kc-row__meta { display: flex; align-items: center; gap: var(--space-2); flex: none; }
  .kc-row__actions { display: flex; gap: 2px; }
  .kc-row__size { font-size: 14px; font-weight: 510; color: var(--ink); min-width: 4.5em; text-align: end; font-variant-numeric: tabular-nums; }
  .kc-row__state { flex: none; font-size: 12px; color: var(--ink-secondary); }
  .kc-working { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 12px; color: var(--ink-secondary); white-space: nowrap; }
  .kc-version { font-variant-numeric: tabular-nums; }
  .kc-version--new { color: var(--ink); font-weight: 510; }
  .kc-more { display: flex; justify-content: flex-start; padding-top: var(--space-2); }
  .kc-skel-icon { width: 32px; height: 32px; border-radius: var(--radius-md); flex: none; }
  .kc-skel { flex: 1; }
  .kc-ask { width: min(30rem, 92vw); }
</style>
