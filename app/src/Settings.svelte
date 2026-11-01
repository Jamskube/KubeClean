<script>
  // Réglages : brouillon local qui suit S.settings, enregistré tout seul 400 ms après une modification valide.
  import { S, toast } from './lib/state.svelte.js';
  import { int } from './lib/fmt.js';
  import Icon from './lib/Icon.svelte';
  import { untrack } from 'svelte';

  const LIMITS = { projectIdleDays: [1, 3650], largeFileMinMb: [50, 1_000_000], downloadsOlderThanDays: [7, 3650] };
  const THEMES = [
    { id: 'light', label: 'Clair', icon: 'sun' },
    { id: 'dark', label: 'Sombre', icon: 'moon' },
    { id: 'system', label: 'Système', icon: 'monitor' },
  ];

  // the ignore list is not part of the draft: it is edited live through S.unignore
  const pick = (s) => ({ projectRoots: [...s.projectRoots], projectIdleDays: s.projectIdleDays, largeFileMinMb: s.largeFileMinMb, downloadsOlderThanDays: s.downloadsOlderThanDays });
  let d = $state(null);
  const dirty = $derived(!!d && !!S.settings && JSON.stringify(d) !== JSON.stringify(pick(S.settings)));
  $effect(() => {
    const s = S.settings;
    if (s && !untrack(() => dirty)) d = pick(s);
  });

  const err = (k) => {
    const v = d?.[k], [min, max] = LIMITS[k];
    if (v == null || v === '' || Number.isNaN(v)) return 'Indique un nombre.';
    if (!Number.isInteger(v) || v < min || v > max) return `Entre ${int(min)} et ${int(max)}.`;
    return '';
  };
  const errors = $derived(d ? Object.fromEntries(Object.keys(LIMITS).map((k) => [k, err(k)])) : {});
  const invalid = $derived(Object.values(errors).some(Boolean));

  // autosave: any change of the draft re-arms a 400 ms timer; nothing leaves while a value is invalid
  $effect(() => {
    JSON.stringify(d);
    if (!untrack(() => dirty) || untrack(() => invalid)) return;
    const t = setTimeout(save, 400);
    return () => clearTimeout(t);
  });
  async function save() {
    const sent = $state.snapshot(d);
    try {
      const saved = await S.saveSettings({ ...sent, ignore: S.settings.ignore });
      // reflect what the engine kept, unless the user kept typing meanwhile
      if (JSON.stringify(sent) === JSON.stringify($state.snapshot(d))) d = pick(saved);
      const dropped = sent.projectRoots.filter((p) => !saved.projectRoots.includes(p));
      toast(dropped.length
        ? { id: 'kc-settings', title: 'Enregistré, sauf un chemin', description: `Chemin relatif écarté : ${dropped.join(', ')}`, tone: 'warning' }
        : { id: 'kc-settings', title: 'Enregistré', description: 'Compte dès la prochaine analyse.', tone: 'success' });
    } catch (e) {
      toast({ id: 'kc-settings', title: 'Réglages non enregistrés', description: e.message, tone: 'danger' });
    }
  }

  // Windows display of a root: backslashes, and the resolved folder when it starts with %USERPROFILE%
  const win = (p) => p.replaceAll('/', '\\');
  const home = $derived.by(() => {
    for (const p of [...(S.settings?.ignore ?? []), ...S.rules.flatMap((r) => r.items.map((i) => i.path))]) {
      const m = /^[A-Za-z]:\\Users\\[^\\]+/.exec(p);
      if (m) return m[0];
    }
    return null;
  });
  const resolved = (p) => (home && /^%USERPROFILE%/i.test(p) ? win(p).replace(/^%USERPROFILE%/i, home) : '');

  async function addRoot() {
    const p = await S.pickFolder();
    if (!p) return;
    if (d.projectRoots.some((x) => win(x).toLowerCase() === win(p).toLowerCase())) return toast({ title: 'Déjà dans la liste', description: p });
    d.projectRoots.push(p);
  }
  async function unignore(p) {
    try {
      await S.unignore(p);
      toast({ title: 'Sera proposé à nouveau', description: p, tone: 'success' });
    } catch (e) {
      toast({ title: 'Impossible de retirer ce chemin', description: e.message, tone: 'danger' });
    }
  }
</script>

{#snippet number(key, id, label, desc, unit)}
  <div class="k-settings-row">
    <div class="k-settings-row__text">
      <label class="k-settings-row__label" for={id}>{label}</label>
      {#if desc}<span class="k-settings-row__desc">{desc}</span>{/if}
    </div>
    <div class="k-settings-row__control kc-ctl">
      <div class="k-input k-number-field kc-n" data-kube="number-field">
        <input {id} type="number" inputmode="numeric" min={LIMITS[key][0]} max={LIMITS[key][1]} step="1" bind:value={d[key]} aria-invalid={errors[key] ? 'true' : undefined} aria-describedby={errors[key] ? `${id}-err` : undefined} />
        <span class="k-input__affix">{unit}</span>
        <span class="k-number-field__stepper">
          <button class="k-number-field__step" type="button" aria-label="Diminuer" tabindex="-1"><Icon name="minus" /></button>
          <button class="k-number-field__step" type="button" aria-label="Augmenter" tabindex="-1"><Icon name="plus" /></button>
        </span>
      </div>
      {#if errors[key]}<p class="k-field__error" id="{id}-err"><Icon name="circle-alert" />{errors[key]}</p>{/if}
    </div>
  </div>
{/snippet}

<header class="k-page-header">
  <div class="k-page-header__content">
    <div class="k-page-header__heading">
      <h1 class="k-page-header__title">Réglages</h1>
      <p class="k-page-header__subtitle">Où chercher, à partir de quand proposer, et ce qui ne doit jamais l’être. Chaque changement est enregistré aussitôt.</p>
    </div>
  </div>
</header>

<div class="k-settings kc-settings">
  <section class="k-settings-section" id="apparence">
    <div class="k-settings-section__header"><div class="k-settings-section__text"><h2 class="k-settings-section__title">Apparence</h2></div></div>
    <div class="k-settings-section__content">
      <div class="k-settings-group">
        <div class="k-settings-row">
          <div class="k-settings-row__text">
            <span class="k-settings-row__label" id="theme-label">Thème</span>
            <span class="k-settings-row__desc">« Système » suit le réglage de Windows.</span>
          </div>
          <div class="k-settings-row__control">
            <div class="k-seg" role="radiogroup" data-kube="segmented" aria-labelledby="theme-label">
              <span class="k-seg__thumb" aria-hidden="true"></span>
              {#each THEMES as t (t.id)}
                <button class="k-seg__item" type="button" role="radio" aria-checked={S.theme === t.id} data-value={t.id} onclick={() => S.setTheme(t.id)}><Icon name={t.icon} />{t.label}</button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  {#if d}
    <section class="k-settings-section" id="projets">
      <div class="k-settings-section__header"><div class="k-settings-section__text">
        <h2 class="k-settings-section__title">Projets de développement</h2>
        <p class="k-settings-section__subtitle">Dossiers parcourus pour trouver node_modules, target, .venv, build, obj…</p>
      </div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          {#each d.projectRoots as root, i (root)}
            <div class="k-settings-row k-settings-row--compact">
              <div class="k-settings-row__text">
                <span class="k-settings-row__label kc-mono">{win(root)}</span>
                {#if resolved(root)}<span class="kc-path kc-mono">{resolved(root)}</span>{/if}
              </div>
              <div class="k-settings-row__control">
                <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Retirer {win(root)}" data-kube="tooltip" data-kube-tooltip="Retirer" onclick={() => d.projectRoots.splice(i, 1)}><Icon name="x" /></button>
              </div>
            </div>
          {:else}
            <div class="k-settings-row k-settings-row--empty">Aucun dossier&nbsp;: la catégorie « Projets » restera vide.</div>
          {/each}
          <div class="k-settings-row k-settings-row--compact">
            <div class="k-settings-row__text"><span class="k-settings-row__desc">Les chemins avec <code class="kc-code">%VARIABLE%</code> sont résolus au moment de l’analyse.</span></div>
            <div class="k-settings-row__control"><button class="k-btn k-btn--sm" type="button" onclick={addRoot}><Icon name="folder-plus" />Ajouter un dossier</button></div>
          </div>
        </div>
        <div class="k-settings-group">
          {@render number('projectIdleDays', 'idle', 'Cocher d’office après N jours sans modification', 'Un projet touché plus récemment est listé, mais laissé décoché.', 'jours')}
        </div>
      </div>
    </section>

    <section class="k-settings-section" id="fichiers">
      <div class="k-settings-section__header"><div class="k-settings-section__text">
        <h2 class="k-settings-section__title">Fichiers personnels</h2>
        <p class="k-settings-section__subtitle">Jamais cochés d’office, toujours envoyés à la Corbeille.</p>
      </div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          {@render number('largeFileMinMb', 'big', 'Gros fichiers à partir de N Mo', 'Cherchés dans ton dossier utilisateur. AppData, OneDrive et un téléphone connecté ne sont jamais parcourus.', 'Mo')}
          {@render number('downloadsOlderThanDays', 'dl', 'Téléchargements plus vieux que N jours', 'D’après la date du fichier dans le dossier Téléchargements.', 'jours')}
        </div>
      </div>
    </section>
  {/if}

  <section class="k-settings-section" id="ignores">
    <div class="k-settings-section__header"><div class="k-settings-section__text">
      <h2 class="k-settings-section__title">Jamais proposés</h2>
      <p class="k-settings-section__subtitle">Ces chemins et tout ce qu’ils contiennent ne sont ni listés ni touchés.</p>
    </div></div>
    <div class="k-settings-section__content">
      <div class="k-settings-group">
        {#each S.settings?.ignore ?? [] as p (p)}
          <div class="k-settings-row k-settings-row--compact">
            <div class="k-settings-row__text"><span class="k-settings-row__label kc-mono">{p}</span></div>
            <div class="k-settings-row__control">
              <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Afficher {p} dans l’Explorateur" data-kube="tooltip" data-kube-tooltip="Afficher dans l’Explorateur" onclick={() => S.reveal(p)}><Icon name="folder-open" /></button>
              <button class="k-btn k-btn--sm" type="button" onclick={() => unignore(p)}><Icon name="undo-2" />Proposer à nouveau</button>
            </div>
          </div>
        {:else}
          <div class="k-settings-row k-settings-row--empty">Aucun chemin ignoré. Ajoute-en depuis le panneau de détails d’une règle.</div>
        {/each}
      </div>
    </div>
  </section>

  <section class="k-settings-section" id="apropos">
    <div class="k-settings-section__header"><div class="k-settings-section__text"><h2 class="k-settings-section__title">À propos</h2></div></div>
    <div class="k-settings-section__content">
      <div class="k-settings-group">
        <div class="k-settings-row k-settings-row--compact">
          <div class="k-settings-row__text">
            <span class="k-settings-row__label">KubeClean {S.appVersion}{S.version ? ` · moteur Rust ${S.version}` : ''}</span>
            <span class="k-settings-row__desc">Nettoyeur de disque pour Windows. Interface Electron + Svelte, kit Kube.</span>
          </div>
          <div class="k-settings-row__control kc-about"><Icon name="broom-sparkles" /></div>
        </div>
      </div>
      <p class="k-settings-section__footer">L’analyse ne modifie rien&nbsp;; chaque élément est revérifié avant d’être touché.</p>
    </div>
  </section>
</div>

<style>
  .kc-settings { --k-settings-gap: 32px; max-width: none; padding: var(--space-5) 0 0; }
  .kc-mono { font-family: var(--font-mono); font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
  .kc-code { font-family: var(--font-mono); font-size: 11px; padding: 1px 4px; border-radius: var(--radius-xs); background: var(--fill-secondary); }
  .kc-n { width: 148px; }
  .kc-n .k-input__affix { color: var(--ink-secondary); }
  .kc-ctl { flex-direction: column; align-items: flex-end; gap: 4px; }
  .kc-ctl .k-field__error { margin: 0; }
  .kc-about { color: var(--ink-tertiary); }
</style>
