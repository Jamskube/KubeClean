<script>
  // Animated figure: tweens towards `value` whenever it changes. Tabular digits.
  // kind: 'bytes' (1,4 Go) | 'int' (12 345) | 'percent' (37 %) | 'raw'
  import { fmt, int } from '../fmt.js';
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { quartOut } from 'svelte/easing';
  import { reduced } from './kube.js';

  let { value = 0, kind = 'bytes', duration = 700, class: cls = '' } = $props();
  // intentionally seeded with the initial props: the tween then follows `value`
  // svelte-ignore state_referenced_locally
  const t = new Tween(untrack(() => value), { duration: reduced ? 0 : untrack(() => duration), easing: quartOut });
  $effect(() => { t.set(value); });
  const shown = $derived(kind === 'bytes' ? fmt(Math.round(t.current)) : kind === 'int' ? int(Math.round(t.current)) : kind === 'percent' ? `${Math.round(t.current)} %` : String(Math.round(t.current)));
</script>

<span class="num {cls}" aria-label={kind === 'bytes' ? fmt(value) : kind === 'int' ? int(value) : kind === 'percent' ? `${Math.round(value)} %` : String(value)}>{shown}</span>

<style>
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
