<script>
  import { S, CATS, appName, OS } from './lib/state.svelte.js';
  import { fmt, date, drive, idle, plural } from './lib/fmt.js';
  import { norm } from './lib/ui/kube.js';
  import Icon from './lib/Icon.svelte';

  let { page, navigate, close } = $props();
  let query = $state('');
  let limit = $state(24);
  const searchable = $derived(['clean', 'projects', 'files'].includes(page.id));
  const needle = $derived(norm(query.trim()));
  const matches = (text) => !needle || norm(text).includes(needle);
  const recent = $derived([...S.history].reverse().slice(0, limit));
  const cleanRules = $derived(S.rules.filter((r) => r.size > 0 && !r.toRecycle && !r.needsAdmin && !r.perItem && matches(r.title)).sort((a, b) => b.size - a.size));
  const cleanGroups = $derived(CATS.map((cat) => ({ ...cat, rules: cleanRules.filter((r) => r.cat === cat.id) })).filter((cat) => cat.rules.length));
  const projectRule = $derived(S.rule('projects'));
  const projects = $derived(S.projects.filter((p) => matches(p.project)));
  const files = $derived(S.rules.filter((r) => r.toRecycle).flatMap((r) => r.items.map((it, index) => ({ ...it, rule: r, index }))).filter((it) => matches(it.path)).sort((a, b) => b.size - a.size));
  const selectedFiles = $derived(S.rules.filter((r) => r.toRecycle).reduce((sum, r) => sum + S.selSize(r), 0));
  const selectedProjects = $derived(projectRule ? S.selSize(projectRule) : 0);
  const openApps = $derived([...new Set(S.rules.filter((r) => r.size > 0).flatMap((r) => r.blockedBy ?? []))]);
  const moreCount = $derived(page.id === 'projects' ? projects.length : page.id === 'files' ? files.length : page.id === 'history' ? S.history.length : 0);
  const categoryName = (id) => CATS.find((c) => c.id === id)?.label ?? id;
  const used = (disk) => disk.total ? Math.max(0, Math.min(1, 1 - disk.free / disk.total)) : 0;
  const gain = (value) => value < 0 ? `−${fmt(-value)}` : `+${fmt(value)}`;
  const name = (path) => path.split(/[\\/]/).at(-1);
  const parent = (path) => path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
  const checkedProject = (p) => p.items.filter((it) => S.itemOn(projectRule, it.index)).length;
  const indeterminate = (mixed) => (node) => { node.indeterminate = mixed; };
  function toggleProject(p) {
    const want = checkedProject(p) !== p.items.length;
    for (const it of p.items) if (S.itemOn(projectRule, it.index) !== want) S.toggleItem(projectRule, it.index, it.size);
  }
  function confirm() { close(); S.confirm = true; }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  }
</script>

<div id="preview-{page.id}" class="k-popover kc-rail-preview" class:kc-rail-preview--full={page.id !== 'settings'} popover="manual" role="dialog" aria-labelledby="preview-title-{page.id}" tabindex="-1" onkeydown={onKey}>
  <header class="kc-preview-head">
    <Icon name={page.icon} /><h2 id="preview-title-{page.id}">{page.label}</h2>
  </header>
  {#if searchable}
    <div class="kc-preview-search"><Icon name="search" /><input class="k-input" type="search" aria-label="Rechercher dans {page.label}" placeholder={page.id === 'clean' ? 'Rechercher un poste…' : page.id === 'projects' ? 'Rechercher un projet…' : 'Rechercher un fichier…'} bind:value={query} oninput={() => (limit = 24)} /></div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (zone défilante accessible au clavier) -->
  <div class="kc-preview-body k-scrollbar" tabindex="0" role="region" aria-label="Contenu de l’aperçu {page.label}">
    {#if page.id === 'dashboard'}
      <p class="kc-preview-caption">{S.busy === 'scan' ? 'Analyse en cours' : S.scan ? `Analysé le ${date(S.scan.at)}` : 'Aucune analyse pour l’instant'}</p>
      {#if S.scan}
        <dl class="kc-preview-facts"><div><dt>Nettoyage recommandé</dt><dd>{fmt(S.defaultSize)}</dd></div><div><dt>À examiner avec toi</dt><dd>{fmt(Math.max(0, S.found - S.defaultSize))}</dd></div></dl>
      {/if}
      <section class="kc-preview-section"><h3>Espace disque</h3>
        {#each S.drives as disk (disk.root)}
          <div class="kc-preview-disk">
            <div class="kc-preview-drive"><Icon name="hard-drive" /><strong>{drive(disk.root)}</strong><span>{fmt(disk.free)} libres</span></div>
            <div class="k-progress k-progress--sm" role="progressbar" aria-label="Espace utilisé sur {drive(disk.root)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(used(disk) * 100)} style:--k-progress={used(disk)} style:--k-progress-color={used(disk) > .9 ? 'var(--warning)' : 'var(--ink-tertiary)'}><div class="k-progress__bar"></div></div>
            <p class="kc-preview-caption">{Math.round(used(disk) * 100)} % utilisés sur {fmt(disk.total)}</p>
          </div>
        {/each}
      </section>
      {#if S.scan}<section class="kc-preview-section"><h3>Répartition des éléments repérés</h3>
        {#each CATS.filter((cat) => S.catTotal(cat.id) > 0) as cat (cat.id)}
          <div class="kc-preview-category"><Icon name={cat.icon} /><span>{cat.label}</span><strong>{fmt(S.catTotal(cat.id))}</strong></div>
        {/each}
      </section>{/if}
      {#if openApps.length}<section class="kc-preview-section"><h3>Applications ouvertes</h3><p class="kc-preview-caption">{openApps.map(appName).join(' · ')}</p><p class="kc-preview-caption">Ferme-les avant le nettoyage pour libérer leurs caches.</p></section>{/if}
    {:else if page.id === 'clean'}
      <div class="kc-preview-summary"><span>Sélection actuelle</span><strong data-preview-total>{fmt(S.total)}</strong></div>
      <p class="kc-preview-caption">Postes de nettoyage par catégorie. Les plus volumineux sont en tête de chaque groupe.</p>
      <div class="kc-preview-actions"><button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={!!S.busy || !S.scan} onclick={() => S.selectDefaults()}>Recommandations</button><button class="k-btn k-btn--ghost k-btn--sm" type="button" disabled={!!S.busy || !S.picked.length} onclick={() => S.selectNone()}>Tout décocher</button></div>
      {#each cleanGroups as cat (cat.id)}
      <section class="kc-preview-section"><h3><Icon name={cat.icon} /><span>{cat.label}</span><span class="kc-preview-count">{cat.rules.length}</span></h3>
      {#each cat.rules as r (r.id)}
        <label class="kc-preview-choice"><input class="k-checkbox" type="checkbox" checked={S.state(r) === 'on'} {@attach indeterminate(S.state(r) === 'mixed')} disabled={!!S.busy} onchange={() => S.toggleRule(r)} />
          <span class="kc-preview-copy"><strong title={r.title}>{r.title}</strong><span>{fmt(r.size)}{r.kind === 'recycleBin' ? ' · vidage définitif' : r.blockedBy?.length ? ` · ${r.blockedBy.map(appName).join(', ')} ouvert` : ''}</span></span>
        </label>
      {/each}
      </section>{/each}
      {#if !cleanRules.length}<p class="kc-preview-empty">{needle ? 'Aucun poste ne correspond à ta recherche.' : S.scan ? 'Aucun cache à proposer.' : 'Lance une analyse pour préparer ta sélection.'}</p>{/if}
    {:else if page.id === 'projects'}
      <div class="kc-preview-summary"><span>{plural(projects.length, 'projet', 'projets')}</span><strong>{fmt(selectedProjects)} cochés</strong></div>
      <p class="kc-preview-caption">Les plus volumineux d’abord. Seuls les dossiers générés sont sélectionnés ; le code source reste en place.</p>
      {#each projects.slice(0, limit) as p (p.project)}
        {@const selected = checkedProject(p)}
        <div class="kc-preview-row"><label class="kc-preview-choice"><input class="k-checkbox" type="checkbox" checked={selected === p.items.length} {@attach indeterminate(selected > 0 && selected < p.items.length)} disabled={!!S.busy} onchange={() => toggleProject(p)} />
          <span class="kc-preview-copy"><strong title={p.project}>{p.name}</strong><span>{fmt(p.size)} · {idle(p.idleDays)}</span><span class="kc-preview-path" title={p.project}>{p.project}</span><span>{p.items.map((it) => name(it.path)).join(' · ')}</span></span>
        </label><button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Ouvrir le dossier {p.name}" onclick={() => S.reveal(p.project)}><Icon name="folder-open" /></button></div>
      {/each}
      {#if !projects.length}<p class="kc-preview-empty">{needle ? 'Aucun projet ne correspond à ta recherche.' : S.scan ? 'Aucun dossier de compilation repéré dans tes emplacements.' : 'Les projets apparaîtront après l’analyse.'}</p>{/if}
    {:else if page.id === 'files'}
      <div class="kc-preview-summary"><span>Fichiers personnels cochés</span><strong>{fmt(selectedFiles)}</strong></div>
      <p class="kc-preview-caption">{plural(files.length, 'fichier', 'fichiers')}, par taille décroissante. Les fichiers choisis iront à la Corbeille après confirmation.</p>
      {#each files.slice(0, limit) as file (`${file.rule.id}-${file.index}`)}
        <div class="kc-preview-row"><label class="kc-preview-choice"><input class="k-checkbox" type="checkbox" checked={S.itemOn(file.rule, file.index)} disabled={!!S.busy} onchange={() => S.toggleItem(file.rule, file.index, file.size)} />
          <span class="kc-preview-copy"><strong title={file.path}>{name(file.path)}</strong><span>{fmt(file.size)} · {idle(file.idleDays)}</span><span class="kc-preview-path" title={parent(file.path)}>{parent(file.path)}</span></span>
        </label><button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Afficher {name(file.path)} {OS.inFinder}" onclick={() => S.reveal(file.path)}><Icon name="folder-open" /></button></div>
      {/each}
      {#if !files.length}<p class="kc-preview-empty">{needle ? 'Aucun fichier ne correspond à ta recherche.' : S.scan ? 'Aucun fichier personnel ne correspond à tes critères.' : 'Les fichiers apparaîtront après l’analyse.'}</p>{/if}
    {:else if page.id === 'history'}
      <div class="kc-preview-summary"><span>{plural(S.history.length, 'nettoyage', 'nettoyages')}</span><strong>{fmt(S.history.reduce((sum, entry) => sum + Math.max(0, entry.diskGain), 0))} regagnés</strong></div>
      <p class="kc-preview-caption">Les plus récents d’abord. Chaque bilan indique la variation réelle d’espace libre.</p>
      {#each recent as entry (entry.at)}
        <details class="kc-preview-history"><summary><span>{date(entry.at)}</span><strong>{gain(entry.diskGain)}</strong></summary>
          <p>{plural(entry.deleted, 'élément supprimé', 'éléments supprimés')} · {plural(entry.skipped, 'laissé en place', 'laissés en place')} · {plural(entry.recycled, 'envoyé à la Corbeille', 'envoyés à la Corbeille')}</p>
          <dl class="kc-preview-facts"><div><dt>Volume supprimé</dt><dd>{fmt(entry.freed)}</dd></div>
            {#each Object.entries(entry.byCat).filter(([, size]) => size > 0) as [cat, size] (cat)}<div><dt>{categoryName(cat)}</dt><dd>{fmt(size)}</dd></div>{/each}
          </dl>
        </details>
      {/each}
      {#if !recent.length}<p class="kc-preview-empty">Tes bilans apparaîtront ici après le premier nettoyage.</p>{/if}
    {:else if page.id === 'settings'}
      <p class="kc-preview-caption">Apparence</p>
      <div class="kc-preview-themes" role="group" aria-label="Thème de l’application">
        {#each [{ id: 'light', label: 'Clair', icon: 'sun' }, { id: 'dark', label: 'Sombre', icon: 'moon' }, { id: 'system', label: 'Système', icon: 'monitor' }] as theme (theme.id)}
          <button class="k-btn k-btn--sm" type="button" aria-pressed={S.theme === theme.id} data-preview-theme={theme.id} onclick={() => S.setTheme(theme.id)}><Icon name={theme.icon} />{theme.label}</button>
        {/each}
      </div>
      {#if S.settings}
        <section class="kc-preview-section"><h3>Critères de l’analyse</h3><dl class="kc-preview-facts"><div><dt>Projets inactifs</dt><dd>{S.settings.projectIdleDays} jours</dd></div><div><dt>Gros fichiers</dt><dd>À partir de {S.settings.largeFileMinMb} Mo</dd></div><div><dt>Téléchargements anciens</dt><dd>{S.settings.downloadsOlderThanDays} jours</dd></div></dl></section>
        <p class="kc-preview-scope">{plural(S.settings.projectRoots.length, 'emplacement de projets', 'emplacements de projets')} · {plural(S.settings.ignore.length, 'exclusion', 'exclusions')}</p>
      {/if}
    {/if}
    {#if moreCount > limit}<button class="k-btn k-btn--ghost kc-preview-action" type="button" onclick={() => (limit += 24)}>Afficher la suite · {moreCount - limit} restants<Icon name="chevron-down" /></button>{/if}
  </div>
  <footer class="kc-preview-footer">
    {#if page.id === 'dashboard'}
      {#if S.busy === 'scan'}
        <p class="kc-preview-caption" role="status">{S.progress?.label ?? 'Préparation…'}</p>
        <button class="k-btn k-btn--outline kc-preview-action" type="button" onclick={() => S.cancel()}>Annuler l’analyse</button>
      {:else}<button class="k-btn k-btn--primary kc-preview-action" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="refresh-cw" />Analyser maintenant</button>{/if}
    {:else if searchable}
      <div class="kc-preview-summary"><span>Sélection globale</span><strong>{fmt(S.total)}</strong></div>
      <button class="k-btn k-btn--primary kc-preview-action" type="button" disabled={!!S.busy || !S.picked.length} onclick={confirm}><Icon name="list-checks" />Vérifier avant de nettoyer</button>
    {:else if page.id === 'history' && recent.length}
      {@const last = recent[0]}
      <button class="k-btn k-btn--outline kc-preview-action" type="button" data-kube="copy" data-kube-copy="KubeClean · {date(last.at)} — Variation d’espace libre : {gain(last.diskGain)}. {last.deleted} éléments supprimés, {last.recycled} à la Corbeille, {last.skipped} laissés en place."><Icon name="copy" />Copier le dernier bilan</button>
    {/if}
    <button class="k-btn k-btn--ghost k-btn--sm kc-preview-open" type="button" onclick={navigate}>Ouvrir la page<Icon name="arrow-right" /></button>
  </footer>
</div>

<style>
  .kc-rail-preview {
    width: 350px; min-width: 0; max-width: calc(100vw - var(--kc-rail-width) - 16px);
    max-height: min(420px, calc(100dvh - var(--kc-titlebar-height) - 20px));
    padding: 0; overflow: hidden; border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--surface-elevated) 94%, transparent); backdrop-filter: blur(24px);
  }
  /* Les grands aperçus suivent la coque ; Réglages reste ancré à son icône par Kube. */
  .kc-rail-preview--full {
    top: calc(var(--kc-titlebar-height) + 4px) !important;
    left: calc(var(--kc-rail-width) + 6px) !important;
    width: 360px; height: calc(100dvh - var(--kc-titlebar-height) - 12px); max-height: none;
  }
  .kc-rail-preview[popover] { transform: none; transition-duration: 160ms; }
  .kc-rail-preview:popover-open { display: flex; flex-direction: column; }
  .kc-rail-preview[popover]:not(:popover-open) { transform: translateX(-4px); }
  @starting-style { .kc-rail-preview[popover]:popover-open { opacity: 0; transform: translateX(-4px); } }
  .kc-preview-head { display: flex; flex: none; align-items: center; gap: var(--space-2); min-height: 52px; padding: var(--space-3) var(--space-4); box-sizing: border-box; border-bottom: 1px solid var(--border-light); }
  .kc-preview-head h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
  .kc-preview-head > :global(.k-icon) { color: var(--ink-secondary); }
  .kc-preview-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-4); }
  .kc-preview-search { position: relative; flex: none; padding: var(--space-3) var(--space-4) 0; }
  .kc-preview-search input { width: 100%; padding-left: 32px; font-size: 13px; }
  .kc-preview-search > :global(.k-icon) { position: absolute; left: 26px; top: 22px; width: 16px; height: 16px; color: var(--ink-secondary); pointer-events: none; }
  .kc-preview-caption, .kc-preview-empty { font-size: 12px; line-height: 1.6; color: var(--ink-secondary); margin: 0 0 var(--space-3); }
  .kc-preview-empty { padding-block: var(--space-3); }
  .kc-preview-summary { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3); font-size: 12px; color: var(--ink-secondary); }
  .kc-preview-summary strong { font-size: 15px; font-weight: 600; color: var(--ink); }
  .kc-preview-row, .kc-preview-choice { display: flex; align-items: center; min-width: 0; gap: var(--space-2); }
  .kc-preview-choice { flex: 1; padding-block: 10px; cursor: pointer; }
  .kc-preview-choice > input { flex: none; }
  .kc-preview-choice:has(input:disabled) { cursor: default; opacity: .65; }
  .kc-preview-row + .kc-preview-row, .kc-preview-choice + .kc-preview-choice { border-top: 1px solid var(--border-light); }
  .kc-preview-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .kc-preview-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 510; }
  .kc-preview-copy > span { font-size: 12px; color: var(--ink-secondary); overflow-wrap: anywhere; }
  .kc-preview-copy > .kc-preview-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kc-preview-section { margin-top: var(--space-5); }
  .kc-preview-section h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-2); font-size: 12px; font-weight: 600; color: var(--ink-secondary); }
  .kc-preview-section h3 > :global(.k-icon) { width: 15px; height: 15px; }
  .kc-preview-count { margin-left: auto; font-weight: 400; }
  .kc-preview-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
  .kc-preview-action { width: 100%; margin-top: var(--space-3); }
  .kc-preview-drive { display: flex; align-items: center; gap: var(--space-2); padding-block: 8px; font-size: 13px; }
  .kc-preview-drive > span { margin-left: auto; color: var(--ink-secondary); }
  .kc-preview-drive > :global(.k-icon) { color: var(--ink-secondary); }
  .kc-preview-disk { margin-bottom: var(--space-3); }
  .kc-preview-disk .kc-preview-caption { margin: 5px 0 0; font-size: 11px; }
  .kc-preview-category { display: flex; align-items: center; gap: var(--space-2); padding-block: 7px; font-size: 12px; }
  .kc-preview-category > :global(.k-icon) { width: 15px; height: 15px; color: var(--ink-secondary); }
  .kc-preview-category strong { margin-left: auto; font-weight: 500; }
  .kc-preview-history { border-bottom: 1px solid var(--border-light); font-size: 12px; }
  .kc-preview-history summary { display: flex; justify-content: space-between; gap: var(--space-2); padding-block: var(--space-3); cursor: pointer; }
  .kc-preview-history summary::before { content: '›'; color: var(--ink-secondary); }
  .kc-preview-history[open] summary::before { content: '⌄'; }
  .kc-preview-history summary > span { flex: 1; }
  .kc-preview-history summary > strong { white-space: nowrap; font-weight: 510; }
  .kc-preview-history p { margin: 0 0 var(--space-3); line-height: 1.6; color: var(--ink-secondary); }
  .kc-preview-themes { display: flex; gap: var(--space-2); }
  .kc-preview-themes button { flex: 1; }
  .kc-preview-themes button[aria-pressed='true'] { background: var(--fill-hover); box-shadow: inset 0 0 0 1px var(--border-heavy); }
  .kc-preview-facts { margin: 0; font-size: 12px; }
  .kc-preview-facts > div { display: flex; justify-content: space-between; gap: var(--space-3); padding-block: 8px; }
  .kc-preview-facts dt { color: var(--ink-secondary); }
  .kc-preview-facts dd { margin: 0; text-align: right; }
  .kc-preview-scope { margin: var(--space-3) 0 0; color: var(--ink-secondary); font-size: 12px; }
  .kc-preview-footer { display: flex; flex: none; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--border-light); padding: var(--space-3) var(--space-4); }
  .kc-preview-footer .kc-preview-action, .kc-preview-footer .kc-preview-summary, .kc-preview-footer .kc-preview-caption { margin: 0; }
  .kc-preview-open { width: 100%; justify-content: space-between; }
  @media (prefers-reduced-motion: reduce) { .kc-rail-preview[popover] { transition: none; } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .kc-rail-preview { background: var(--surface-elevated); backdrop-filter: none; } }
</style>
