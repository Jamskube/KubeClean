<script>
  // « Fichiers personnels » : gros fichiers, installeurs et vieux téléchargements, jamais cochés d'office, Corbeille uniquement.
  import { fly } from 'svelte/transition';
  import { S, MAC, OS, SEP } from './lib/state.svelte.js';
  import { fmt, plural, idle } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import Num from './lib/ui/Num.svelte';

  const INTRO_KEY = 'kubeclean:files-intro';
  const read = (k) => { try { return sessionStorage.getItem(k) === '1'; } catch { return false; } };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = reduced ? 0 : 220;

  // type -> label, extensions, FileIcon data-type (kit) and glyph
  const TYPES = [
    { id: 'archive', label: 'Archives', ext: ['zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz', 'zst'], icon: 'file-archive' },
    { id: 'video', label: 'Vidéos', ext: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv'], kind: 'video', icon: 'file-play' },
    { id: 'image', label: 'Images', ext: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'tif', 'tiff', 'raw', 'dng', 'psd'], kind: 'image', icon: 'file-image' },
    { id: 'disk', label: 'Disques', ext: ['iso', 'img', 'vhd', 'vhdx', 'vmdk', 'qcow2', 'wim'], icon: 'disc' },
    { id: 'data', label: 'Modèles & données', ext: ['bin', 'pmtiles', 'gguf', 'onnx', 'safetensors', 'pt', 'pth', 'ckpt', 'csv', 'parquet', 'sql', 'sql.gz', 'db', 'sqlite', 'json', 'jsonl'], icon: 'database' },
    { id: 'setup', label: 'Installeurs', ext: ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'dmg', 'pkg', 'mpkg'], icon: 'package' },
    { id: 'doc', label: 'Documents', ext: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'txt', 'md', 'odt', 'rtf', 'epub'], kind: 'document', icon: 'file-text' },
    { id: 'other', label: 'Autres', ext: [], icon: 'file' },
  ];
  const GLYPH = { pdf: ['pdf', 'file-type'], pptx: ['presentation', 'presentation'], ppt: ['presentation', 'presentation'], xlsx: ['spreadsheet', 'file-spreadsheet'], xls: ['spreadsheet', 'file-spreadsheet'], csv: ['spreadsheet', 'file-spreadsheet'], mp3: ['audio', 'file-music'], wav: ['audio', 'file-music'], flac: ['audio', 'file-music'], m4a: ['audio', 'file-music'] };
  const name = (p) => p.slice(p.lastIndexOf(SEP) + 1);
  const dir = (p) => p.slice(0, p.lastIndexOf(SEP));
  const ext = (p) => { const n = name(p).toLowerCase(); if (n.endsWith('.sql.gz')) return 'sql.gz'; const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1) : ''; };
  const typeOf = (p) => { const e = ext(p); return TYPES.find((t) => t.ext.includes(e)) ?? TYPES[7]; };
  const glyph = (p) => { const e = ext(p); const t = typeOf(p); return GLYPH[e] ?? [t.kind ?? null, t.icon]; };

  const TABS = [
    { id: 'largeFiles', label: 'Gros fichiers', empty: 'Aucun gros fichier', icon: 'file-box', hint: () => `Fichiers de plus de ${S.settings?.largeFileMinMb ?? 500} Mo dans ton dossier personnel` },
    { id: 'oldDownloads', label: 'Téléchargements anciens', empty: 'Aucun vieux téléchargement', icon: 'download', hint: () => `Éléments du dossier Téléchargements plus vieux que ${S.settings?.downloadsOlderThanDays ?? 90} jours, hors installeurs` },
    { id: 'installers', label: 'Installeurs', empty: 'Aucun installeur', icon: 'package', fixed: true, hint: () => `Fichiers ${MAC ? '.dmg et .pkg' : '.exe, .msi et .msix'} du dossier Téléchargements, quel que soit leur âge` },
  ];
  let tab = $state('largeFiles');
  let types = $state(new Set());
  let sort = $state('size'); // size | age | name
  let q = $state('');
  let introOff = $state(read(INTRO_KEY));

  const tabDef = $derived(TABS.find((t) => t.id === tab));
  const rule = $derived(S.rule(tab));
  const items = $derived((rule?.items ?? []).map((it, index) => ({ ...it, index })));
  const counts = $derived.by(() => { const c = {}; for (const it of items) { const t = typeOf(it.path).id; c[t] = (c[t] ?? 0) + 1; } return c; });
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = items.filter((it) => (!types.size || types.has(typeOf(it.path).id)) && (!needle || name(it.path).toLowerCase().includes(needle)));
    if (sort === 'age') list.sort((a, b) => (b.idleDays ?? -1) - (a.idleDays ?? -1));
    else if (sort === 'name') list.sort((a, b) => name(a.path).localeCompare(name(b.path), 'fr'));
    else list.sort((a, b) => b.size - a.size);
    return list;
  });
  const pickedN = $derived(S.rules.filter((r) => r.toRecycle).reduce((n, r) => n + Object.keys(S.sel[r.id]?.set ?? {}).length, 0));
  const pickedSize = $derived(S.rules.filter((r) => r.toRecycle).reduce((n, r) => n + S.selSize(r), 0));
  const filtered = $derived(types.size > 0 || q.trim().length > 0);

  const toggleType = (id) => { const s = new Set(types); s.has(id) ? s.delete(id) : s.add(id); types = s; };
  const reset = () => { types = new Set(); q = ''; };
  const ruleTotal = (id) => S.rule(id)?.size ?? 0;
  const ruleCount = (id) => S.rule(id)?.items?.length ?? 0;
  const dismiss = () => { try { sessionStorage.setItem(INTRO_KEY, '1'); } catch {} setTimeout(() => (introOff = true), 300); };
</script>

<div class="kc-view">
  <header class="k-page-header" data-kube="page-header">
    <div class="k-page-header__content">
      <div class="k-page-header__heading">
        <h1 class="k-page-header__title">Fichiers personnels</h1>
        <p class="k-page-header__subtitle">Jamais cochés d’office. Ce que tu coches part à la Corbeille, pas en suppression définitive.</p>
        {#if S.scan}
          <p class="kc-summary"><Num value={TABS.reduce((n, t) => n + ruleCount(t.id), 0)} kind="int" /> fichiers · <Num value={TABS.reduce((n, t) => n + ruleTotal(t.id), 0)} /> trouvés · {#if pickedN}<Num value={pickedSize} /> cochés{:else}rien de coché{/if}</p>
        {/if}
      </div>
    </div>
  </header>

  {#if !introOff}
    <div class="k-alert k-alert--block" role="note" data-kube="alert">
      <div class="k-alert__row">
        <span class="k-alert__icon"><Icon name="recycle" /></span>
        <div class="k-alert__content"><div class="k-alert__description">{#if MAC}Tout part à la Corbeille, d’où le Finder peut tout remettre en place. La Bibliothèque, les apps, la photothèque et Dropbox ne sont jamais parcourues.{:else}Tout part à la Corbeille. Un fichier trop gros pour elle&nbsp;: Windows te demande confirmation avant de le détruire. OneDrive et le téléphone connecté ne sont jamais listés.{/if}</div></div>
        <button class="k-alert__close" type="button" aria-label="Fermer" onclick={dismiss}><Icon name="x" /></button>
      </div>
    </div>
  {/if}

  {#if !S.scan}
    <div class="k-empty k-empty--page">
      <div class="k-empty__body">
        <div class="k-empty__art k-empty__art--tile"><Icon name="file-search" /></div>
        <div class="k-empty__text">
          <h2 class="k-empty__title">{S.busy === 'scan' ? 'Analyse en cours…' : 'Aucune analyse pour l’instant'}</h2>
          <p class="k-empty__desc">Les gros fichiers de ton dossier personnel, les installeurs et les vieux téléchargements apparaîtront ici.</p>
        </div>
        <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button" disabled={!!S.busy} onclick={() => S.runScan()}><Icon name="scan-search" />Analyser</button></div>
      </div>
    </div>
  {:else}
    <div class="k-tabs k-tabs--flush kc-tabs" role="tablist" aria-label="Fichiers personnels" data-kube="tabs" data-kube-reorder="false">
      {#each TABS as t (t.id)}
        <div class="k-tab">
          <button class="k-tab__btn" role="tab" aria-selected={tab === t.id} aria-controls="files-panel-{t.id}" data-kube="tooltip" data-kube-tooltip={t.hint()} data-kube-side="bottom" onclick={() => { tab = t.id; reset(); }}>
            <span class="k-tab__icon"><Icon name={t.icon} /></span>
            <span class="k-tab__label">{t.label}</span>
            <span class="k-badge kc-tab-badge">{ruleCount(t.id)} · {fmt(ruleTotal(t.id))}</span>
          </button>
        </div>
      {/each}
    </div>

    <section id="files-panel-{tab}" role="tabpanel" class="kc-panel">
      {#if !items.length}
        <div class="k-empty">
          <div class="k-empty__body">
            <div class="k-empty__art"><Icon name="circle-check" /></div>
            <div class="k-empty__text">
              <h2 class="k-empty__title">{tabDef?.empty}</h2>
              <p class="k-empty__desc">{tabDef?.hint()}.{#if !tabDef?.fixed} Le seuil se règle dans les Réglages.{/if}</p>
            </div>
            {#if !tabDef?.fixed}<div class="k-empty__actions"><button class="k-btn k-btn--sm" type="button" onclick={() => (S.view = 'settings')}><Icon name="settings" />Ouvrir les Réglages</button></div>{/if}
          </div>
        </div>
      {:else}
        <div class="kc-toolbar">
          <div class="kc-chips" role="group" aria-label="Filtrer par type">
            {#each TYPES.filter((t) => counts[t.id]) as t (t.id)}
              <button class="k-btn k-btn--2xs k-btn--pill {types.has(t.id) ? 'k-btn--accent-subtle' : ''}" type="button" aria-pressed={types.has(t.id)} onclick={() => toggleType(t.id)}>{t.label}<span class="kc-chip__n">{counts[t.id]}</span></button>
            {/each}
          </div>
          <div class="kc-tools">
            <div class="k-seg k-seg--sm" role="radiogroup" data-kube="segmented" aria-label="Trier">
              <span class="k-seg__thumb" aria-hidden="true"></span>
              <button class="k-seg__item" type="button" role="radio" data-value="size" aria-checked={sort === 'size'} onclick={() => (sort = 'size')}>Taille</button>
              <button class="k-seg__item" type="button" role="radio" data-value="age" aria-checked={sort === 'age'} onclick={() => (sort = 'age')}>Ancienneté</button>
              <button class="k-seg__item" type="button" role="radio" data-value="name" aria-checked={sort === 'name'} onclick={() => (sort = 'name')}>Nom</button>
            </div>
            <div role="search" class="kc-search"><div class="k-input k-input--sm" data-kube="input-clear">
              <span class="k-input__icon"><Icon name="search" /></span>
              <input type="search" placeholder="Filtrer par nom" aria-label="Filtrer par nom" autocomplete="off" bind:value={q} />
              <button class="k-input__clear" type="button" aria-label="Effacer" onclick={() => (q = '')}><Icon name="x" /></button>
            </div></div>
          </div>
        </div>

        {#if !shown.length}
          <div class="k-empty k-empty--faded">
            <div class="k-empty__body">
              <div class="k-empty__art"><Icon name="search-x" /></div>
              <div class="k-empty__text"><h2 class="k-empty__title">Aucun fichier ne correspond</h2></div>
              <div class="k-empty__actions"><button class="k-btn k-btn--sm" type="button" onclick={reset}>Effacer les filtres</button></div>
            </div>
          </div>
        {:else}
          <ul class="kc-rows" aria-label="Fichiers">
            {#each shown as it, i (it.path)}
              {@const [kind, icon] = glyph(it.path)}
              <li class="k-reveal kc-row" in:fly={{ y: 6, duration: dur, delay: Math.min(i, 8) * 25 }}>
                <input type="checkbox" class="k-checkbox" aria-label={name(it.path)} checked={S.itemOn(rule, it.index)} onchange={() => S.toggleItem(rule, it.index, it.size)} />
                <span class="k-file-icon" data-type={kind} data-kube="tooltip" data-kube-tooltip={typeOf(it.path).label}><Icon name={icon} /></span>
                <div class="kc-row__text">
                  <span class="kc-row__name" title={it.path}>{name(it.path)}</span>
                  <span class="kc-row__sub">
                    <span class="k-filename kc-row__dir" data-kube="truncate-middle" data-kube-name={dir(it.path)}></span>
                    <span class="kc-row__age">{idle(it.idleDays)}</span>
                  </span>
                </div>
                <span class="kc-row__meta">
                  <span class="k-reveal__item kc-row__actions">
                    <button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Afficher {OS.inFinder}" data-kube="tooltip" onclick={() => S.reveal(it.path)}><Icon name="folder-open" /></button>
                    <button class="k-btn k-btn--ghost k-btn--icon k-btn--xs" type="button" aria-label="Ne plus jamais proposer" data-kube="tooltip" onclick={() => S.ignore(it.path)}><Icon name="eye-off" /></button>
                  </span>
                  <span class="kc-row__size kc-num">{fmt(it.size)}</span>
                </span>
              </li>
            {/each}
          </ul>
          {#if filtered}<p class="kc-filtered">{plural(shown.length, 'fichier affiché', 'fichiers affichés')} sur {items.length}</p>{/if}
        {/if}
      {/if}
    </section>

    <div class="k-glass kc-footer" class:kc-footer--empty={!pickedN}>
      <span class="kc-footer__text">
        {#if pickedN}<Num value={pickedN} kind="int" /> {pickedN > 1 ? 'fichiers cochés' : 'fichier coché'} · <Num value={pickedSize} />
        {:else}Rien de coché. Coche ce que tu veux envoyer à la Corbeille.{/if}
      </span>
      <button class="k-btn k-btn--primary k-btn--sm" type="button" data-action="clean" disabled={!pickedN || !!S.busy} onclick={() => (S.confirm = true)}><Icon name="recycle" />{pickedN ? `Envoyer ${fmt(pickedSize)} à la Corbeille` : 'Envoyer à la Corbeille'}</button>
    </div>
  {/if}
</div>

<style>
  .kc-view { display: flex; flex-direction: column; gap: var(--space-4); min-height: 100%; }
  .kc-summary { margin: 0; font-size: 13px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; }

  .kc-tabs { -webkit-app-region: no-drag; height: auto; padding-block: 2px; border-bottom: 1px solid var(--border-light); }
  .kc-tabs .k-tab { flex: none; max-width: none; height: var(--control-md); container-type: normal; white-space: nowrap; }
  .kc-tabs .k-tab__btn { padding-inline: var(--space-3); }
  .kc-tabs .k-tab__btn[aria-selected="true"] { font-weight: 510; }
  .kc-tabs .k-tab__label { flex: none; -webkit-mask-image: none; mask-image: none; }
  .kc-tab-badge { margin-inline-start: var(--space-2); font-variant-numeric: tabular-nums; }

  .kc-panel { display: flex; flex-direction: column; gap: var(--space-3); flex: 1; }

  .kc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-3); }
  .kc-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 auto; }
  .kc-chip__n { margin-inline-start: 6px; opacity: .6; font-variant-numeric: tabular-nums; }
  .kc-tools { display: flex; align-items: center; gap: var(--space-2); flex: none; margin-inline-start: auto; }
  .kc-search { width: 200px; }
  .kc-search .k-input { width: 100%; }

  .kc-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-row { display: flex; align-items: center; gap: var(--space-3); padding: 6px var(--space-2); border-radius: var(--radius-lg); transition: background-color var(--duration-basic); }
  .kc-row:hover { background: var(--fill-subtle); }
  .kc-row:has(:focus-visible) { background: var(--accent-subtle); }
  .kc-row .k-checkbox { flex: none; }
  .kc-row__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .kc-row__name { font-size: 14px; font-weight: 510; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kc-row__sub { display: flex; align-items: center; gap: var(--space-3); min-width: 0; font-size: 12px; color: var(--ink-secondary); }
  .kc-row__dir { flex: 1 1 auto; min-width: 0; display: block; }
  .kc-row__age { flex: none; white-space: nowrap; }
  .kc-row__meta { display: flex; align-items: center; gap: var(--space-2); flex: none; }
  .kc-row__actions { display: flex; gap: 2px; }
  .kc-row__size { font-size: 14px; font-weight: 510; color: var(--ink); min-width: 4.5em; text-align: end; }
  .kc-filtered { margin: 0; font-size: 12px; color: var(--ink-secondary); text-align: end; }

  .kc-footer { position: sticky; bottom: var(--space-2); display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); box-shadow: var(--shadow-lg); }
  .kc-footer__text { font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .kc-footer--empty .kc-footer__text { color: var(--ink-secondary); }
</style>
