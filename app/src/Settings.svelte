<script>
  import { S } from './lib/state.svelte.js';
  import Icon from './lib/Icon.svelte';

  let d = $state(structuredClone($state.snapshot(S.settings) ?? {}));
  let saving = $state(false);
  const dirty = $derived(JSON.stringify(d) !== JSON.stringify(S.settings));

  async function addRoot() {
    const p = await window.kc.pickFolder();
    if (p && !d.projectRoots.some((x) => x.toLowerCase() === p.toLowerCase())) d.projectRoots.push(p);
  }
  async function save() {
    saving = true;
    try {
      await S.saveSettings($state.snapshot(d));
      d = structuredClone(S.settings);
      window.Kube?.toast?.({ title: 'Réglages enregistrés', description: 'Ils comptent dès la prochaine analyse.', tone: 'success' });
    } catch (e) {
      window.Kube?.toast?.({ title: "Réglages non enregistrés", description: e.message, tone: 'danger' });
    } finally {
      saving = false;
    }
  }
</script>

<div class="k-settings kc-settings">
  <header class="k-settings__header">
    <h1 class="k-settings__title">Réglages</h1>
    <p class="k-settings__subtitle">Où chercher, et ce qui ne doit jamais être proposé.</p>
  </header>

  {#if d.projectRoots}
    <section class="k-settings-section">
      <div class="k-settings-section__header"><div class="k-settings-section__text">
        <h2 class="k-settings-section__title">Projets de développement</h2>
        <p class="k-settings-section__subtitle">Dossiers parcourus pour trouver node_modules, target, .venv, build, obj…</p>
      </div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          {#each d.projectRoots as root, i (root)}
            <div class="k-settings-row k-settings-row--compact">
              <div class="k-settings-row__text"><span class="k-settings-row__label kc-mono">{root}</span></div>
              <div class="k-settings-row__control">
                <button class="k-toolbar__btn" type="button" aria-label="Retirer {root}" onclick={() => d.projectRoots.splice(i, 1)}><Icon name="x" /></button>
              </div>
            </div>
          {/each}
          <div class="k-settings-row k-settings-row--compact">
            <div class="k-settings-row__text"><span class="k-settings-row__desc">Les chemins avec %VARIABLE% sont résolus au moment de l'analyse.</span></div>
            <div class="k-settings-row__control"><button class="k-btn k-btn--sm" type="button" onclick={addRoot}><Icon name="folder-plus" />Ajouter un dossier</button></div>
          </div>
        </div>
        <div class="k-settings-group">
          <div class="k-settings-row">
            <div class="k-settings-row__text">
              <label class="k-settings-row__label" for="idle">Cocher d'office après</label>
              <span class="k-settings-row__desc">Jours sans modification d'un projet avant que ses dossiers de compilation soient cochés.</span>
            </div>
            <div class="k-settings-row__control"><input class="k-input kc-n" id="idle" type="number" min="1" max="3650" bind:value={d.projectIdleDays} /> jours</div>
          </div>
        </div>
      </div>
    </section>

    <section class="k-settings-section">
      <div class="k-settings-section__header"><div class="k-settings-section__text"><h2 class="k-settings-section__title">Fichiers personnels</h2>
        <p class="k-settings-section__subtitle">Jamais cochés d'office, toujours envoyés à la Corbeille.</p></div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          <div class="k-settings-row">
            <div class="k-settings-row__text"><label class="k-settings-row__label" for="big">Gros fichiers à partir de</label>
              <span class="k-settings-row__desc">Cherchés dans ton dossier utilisateur, hors AppData, OneDrive et téléphone connecté.</span></div>
            <div class="k-settings-row__control"><input class="k-input kc-n" id="big" type="number" min="50" max="1000000" bind:value={d.largeFileMinMb} /> Mo</div>
          </div>
          <div class="k-settings-row">
            <div class="k-settings-row__text"><label class="k-settings-row__label" for="dl">Téléchargements plus vieux que</label></div>
            <div class="k-settings-row__control"><input class="k-input kc-n" id="dl" type="number" min="7" max="3650" bind:value={d.downloadsOlderThanDays} /> jours</div>
          </div>
        </div>
      </div>
    </section>

    <section class="k-settings-section">
      <div class="k-settings-section__header"><div class="k-settings-section__text"><h2 class="k-settings-section__title">Jamais proposés</h2>
        <p class="k-settings-section__subtitle">Ces chemins et tout ce qu'ils contiennent ne sont ni listés ni touchés. Ajoute-en depuis le panneau de détails.</p></div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          {#each d.ignore as p, i (p)}
            <div class="k-settings-row k-settings-row--compact">
              <div class="k-settings-row__text"><span class="k-settings-row__label kc-mono">{p}</span></div>
              <div class="k-settings-row__control"><button class="k-toolbar__btn" type="button" aria-label="Proposer à nouveau {p}" onclick={() => d.ignore.splice(i, 1)}><Icon name="x" /></button></div>
            </div>
          {:else}
            <div class="k-settings-row k-settings-row--empty">Aucun chemin ignoré.</div>
          {/each}
        </div>
      </div>
    </section>

    <div class="k-settings__bar">
      <button class="k-btn" type="button" disabled={!dirty || saving} onclick={() => (d = structuredClone(S.settings))}>Annuler</button>
      <button class="k-btn k-btn--primary" type="button" disabled={!dirty || saving} onclick={save}>Enregistrer</button>
    </div>
  {/if}
</div>

<style>
  .kc-settings { padding: 0; }
  .kc-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
  .kc-n { width: 96px; }
</style>
