<script module>
  import sprite from '../../public/kube/icons/kube-icons.svg?raw';
  // Icône dessinée en ligne : un <use href="kube-icons.svg#…"> vers le fichier externe faisait
  // instancier par Chromium le sprite entier (6 529 tracés) — ~450 Mo de mémoire pour la page.
  const ICONS = new Map();
  for (const m of sprite.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) ICONS.set(m[1], [m[2], m[3]]);
</script>

<script>
  let { name, class: cls = '' } = $props();
  const icon = $derived(ICONS.get(name));
</script>

<svg class="k-icon {cls}" aria-hidden="true" viewBox={icon?.[0] ?? '0 0 24 24'}>{@html icon?.[1] ?? ''}</svg>
