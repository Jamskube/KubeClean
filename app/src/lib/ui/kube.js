// Small bridges between Svelte and the Kube runtime.

/** `use:kubeOn={{ open: fn, change: fn }}` listens to the bubbling `kube:<name>` events. */
export function kubeOn(node, map) {
  const offs = Object.entries(map).map(([k, fn]) => {
    const h = (e) => fn(e);
    node.addEventListener('kube:' + k, h);
    return () => node.removeEventListener('kube:' + k, h);
  });
  return { destroy() { offs.forEach((f) => f()); } };
}

export const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** duration for Svelte transitions: 0 under prefers-reduced-motion */
export const dur = (ms) => (reduced ? 0 : ms);

/** case- and accent-insensitive haystack for filters */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
