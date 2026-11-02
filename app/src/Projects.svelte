<script>
  // « Projets » : artefacts de compilation groupés par dossier de projet.
  import { fly } from 'svelte/transition';
  import { S } from './lib/state.svelte.js';
  import { fmt, plural, idle } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const INTRO_KEY = 'kubeclean:projects-intro';
  const read = (k) => { try { return sessionStorage.getItem(k) === '1'; } catch { return false; } };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = reduced ? 0 : 220;

  const rule = $derived(S.rule('projects'));
  const N = $derived(S.settings?.projectIdleDays ?? 14);
  let sort = $state('size'); // size | idle | name
  let introOff = $state(read(INTRO_KEY));

  const projects = $derived.by(() => {
    const list = [...S.projects];
    if (sort === 'idle') list.sort((a, b) => (b.idleDays ?? -1) - (a.idleDays ?? -1));
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return list;
  });
  const checked = $derived(rule ? S.selSize(rule) : 0);

  const onCount = (p) => p.items.filter((it) => S.itemOn(rule, it.index)).length;
  const set = (items, want) => { for (const it of items) if (S.itemOn(rule, it.index) !== want) S.toggleItem(rule, it.index, it.size); };
  const toggleProject = (p) => set(p.items, onCount(p) !== p.items.length);
  const tickIdle = () => { for (const p of S.projects) set(p.items, p.idleDays != null && p.idleDays >= N); };
  const untickAll = () => { for (const p of S.projects) set(p.items, false); };

  // activity badge: today / unknown = outline (don't touch), ≥ délai = success (safe to delete), else neutral
  const tone = (d) => (d == null || d <= 0 ? 'k-badge--outline' : d >= N ? 'k-badge--success' : '');
  const tip = (d) => (d == null ? 'Aucune date fiable : jamais coché d’office' : d <= 0 ? 'Projet en cours : jamais coché d’office' : d >= N ? `Inactif depuis ${N} jours ou plus : sûr à supprimer, tout se réinstalle` : `Inactif depuis moins de ${N} jours : non coché d’office`);
  const dismiss = () => { try { sessionStorage.setItem(INTRO_KEY, '1'); } catch {} setTimeout(() => (introOff = true), 300); };
</script>

<div class="kc-view">
  <header class="k-page-header" data-kube="page-header">
    <div class="k-page-header__content">
      <div class="k-page-header__heading">
        <h1 class="k-page-header__title">Projets</h1>
        <p class="k-page-header__subtitle">Dossiers de compilation et dépendances, recréés par npm install, cargo build, pip install…</p>
        {#if rule}
          <p class="kc-summary"><Num value={projects.length} kind="int" /> {projects.length > 1 ? 'projets' : 'projet'} · <Num value={rule.size} /> trouvés · {#if checked}<Num value={checked} /> cochés{:else}rien de coché{/if}</p>
        {/if}
      </div>
      {#if rule && projects.length}
        <div class="k-page-header__actions kc-actions">
          <div class="k-seg k-seg--sm" role="radiogroup" data-kube="segmented" aria-label="Trier les projets">
            <span class="k-seg__thumb" aria-hidden="true"></span>
            <button class="k-seg__item" type="button" role="radio" data-value="size" aria-checked={sort === 'size'} onclick={() => (sort = 'size')}>Taille</button>
            <button class="k-seg__item" type="button" role="radio" data-value="idle" aria-checked={sort === 'idle'} onclick={() => (sort = 'idle')}>Inactivité</button>
            <button class="k-seg__item" type="button" role="radio" data-value="name" aria-checked={sort === 'name'} onclick={() => (sort = 'name')}>Nom</button>
          </div>
          <button class="k-btn k-btn--sm" type="button" onclick={tickIdle}><Icon name="list-checks" />Cocher les inactifs ({N} jours et plus)</button>
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" onclick={untickAll}>Tout décocher</button>
          <button class="k-btn k-btn--ghost k-btn--sm" type="button" onclick={() => (S.view = 'settings')}><Icon name="settings" />Régler le délai</button>
        </div>
      {/if}
    </div>
  </header>

  {#if !S.scan}
    <div class="k-empty k-empty--page">
      <div class="k-empty__body">
        <div class="k-empty__art k-empty__art--tile"><Icon name="folder-code" /></div>
        <div class="k-empty__text">
          <h2 class="k-empty__title">{S.busy === 'scan' ? 'Analyse en cours…' : 'Aucune analyse pour l’instant'}</h2>
          <p class="k-empty__desc">Les dossiers node_modules, target, .venv… de tes projets apparaîtront ici, groupés par projet.</p>
        </div>
        <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="scan-search" />Analyser</button></div>
      </div>
    </div>
  {:else if !projects.length}
    <div class="k-empty k-empty--page">
      <div class="k-empty__body">
        <div class="k-empty__art k-empty__art--tile"><Icon name="folder-check" /></div>
        <div class="k-empty__text">
          <h2 class="k-empty__title">Aucun dossier de compilation trouvé</h2>
          <p class="k-empty__desc">KubeClean cherche dans les racines de projets définies dans les Réglages. Ajoute un dossier si tes projets vivent ailleurs.</p>
        </div>
        <div class="k-empty__actions"><button class="k-btn" type="button" onclick={() => (S.view = 'settings')}><Icon name="settings" />Ouvrir les Réglages</button></div>
      </div>
    </div>
  {:else}
    {#if !introOff}
      <div class="k-alert k-alert--block" role="note" data-kube="alert">
        <div class="k-alert__row">
          <span class="k-alert__icon"><Icon name="info" /></span>
          <div class="k-alert__content"><div class="k-alert__description">Cochés d’office&nbsp;: les projets inactifs depuis {N} jours. Activité inconnue&nbsp;: jamais coché. Tout se réinstalle à la prochaine compilation.</div></div>
          <button class="k-alert__close" type="button" aria-label="Fermer" onclick={dismiss}><Icon name="x" /></button>
        </div>
      </div>
    {/if}

    <div class="kc-projects">
      {#each projects as p, i (p.project)}
        {@const on = onCount(p)}
        <article class="k-card k-card--full kc-project" in:fly={{ y: 6, duration: dur, delay: Math.min(i, 8) * 25 }}>
          <header class="kc-project__head">
            <input type="checkbox" class="k-checkbox" aria-label="Cocher tout le projet {p.name}" checked={on === p.items.length} indeterminate={on > 0 && on < p.items.length} onchange={() => toggleProject(p)} />
            <span class="k-file-icon k-file-icon--sm kc-project__icon"><Icon name="folder-code" /></span>
            <div class="kc-project__text">
              <h2 class="kc-card__title">{p.name}</h2>
              <button class="k-pressable kc-path-btn" type="button" title="Afficher dans l’Explorateur" onclick={() => S.reveal(p.project)}>
                <span class="k-filename" data-kube="truncate-middle" data-kube-name={p.project}></span>
              </button>
            </div>
            <span class="k-badge {tone(p.idleDays)}" data-kube="tooltip" data-kube-tooltip={tip(p.idleDays)}>{idle(p.idleDays)}</span>
            <Num value={p.size} class="kc-card__meta kc-project__size" />
          </header>
          <ul class="kc-rows">
            {#each p.items as it (it.index)}
              <li class="k-reveal kc-row">
                <input type="checkbox" class="k-checkbox" aria-label={it.path} checked={S.itemOn(rule, it.index)} onchange={() => S.toggleItem(rule, it.index, it.size)} />
                <span class="k-file-icon k-file-icon--sm"><Icon name="folder" /></span>
                <span class="kc-row__name">{it.path.split('\\').pop()}</span>
                {#if it.label}<span class="k-badge">{it.label}</span>{/if}
                <span class="kc-row__size kc-num">{fmt(it.size)}</span>
                <span class="k-reveal__item kc-row__actions">
                  <button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher dans l’Explorateur" data-kube="tooltip" onclick={() => S.reveal(it.path)}><Icon name="folder-open" /></button>
                  <button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Ne plus jamais proposer" data-kube="tooltip" onclick={() => S.ignore(it.path)}><Icon name="eye-off" /></button>
                </span>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </div>

    <p class="kc-foot">{#if checked}<Num value={checked} /> cochés sur <Num value={rule.size} />{:else}rien de coché sur <Num value={rule.size} />{/if} · {plural(projects.length, 'projet', 'projets')}</p>
  {/if}
</div>

<style>
  .kc-view { display: flex; flex-direction: column; gap: var(--space-4); }
  .kc-summary { margin: 0; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .kc-actions { flex-wrap: wrap; justify-content: flex-start; row-gap: var(--space-2); }

  .kc-projects { display: flex; flex-direction: column; gap: var(--space-3); }
  .kc-project__head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-light); }
  .kc-project__head .k-checkbox, .kc-project__head .k-badge { flex: none; }
  .kc-project__icon { --k-file-color: var(--accent); }
  .kc-project__text { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 1px; }
  .kc-project__text :global(.kc-card__title) { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-path-btn { display: block; max-width: 100%; text-align: start; font-size: 12px; color: var(--ink-secondary); cursor: pointer; border-radius: var(--radius-xs); }
  .kc-path-btn:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
  .kc-path-btn .k-filename { display: block; }
  :global(.kc-project__size) { margin-inline-start: 0; min-width: 4.5em; text-align: end; }

  .kc-rows { list-style: none; margin: 0; padding: var(--space-1) var(--space-2); display: flex; flex-direction: column; }
  .kc-row { display: flex; align-items: center; gap: var(--space-3); min-height: 36px; padding: 2px var(--space-2); border-radius: var(--radius-md); transition: background-color var(--duration-basic); }
  .kc-row:hover { background: var(--fill-subtle); }
  .kc-row:has(:focus-visible) { background: var(--accent-subtle); }
  .kc-row .k-checkbox { flex: none; }
  .kc-row__name { flex: 1; min-width: 0; font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-row__size { font-size: 13px; color: var(--ink-secondary); min-width: 4.5em; text-align: end; }
  .kc-row__actions { display: flex; gap: 2px; flex: none; }

  .kc-foot { margin: 0; font-size: 13px; color: var(--ink-secondary); text-align: end; font-variant-numeric: tabular-nums; }
</style>
