# Kube design kit — condensed reference

Source: `G:\KUBE_style` (project/README.md, project/components/*/README.md, dist/kube.css, dist/kube.js, dist/icons/kube-icons.svg). Kube v2.0.0, 116 component folders (115 READMEs + Cover), 73 runtime behaviors, 1,866 Lucide icons. Everything below is taken from those files.

## 0. Setup (from project/README.md)

- Load `dist/kube.css` (tokens as CSS variables + all `k-*` classes) and `dist/kube.js` (no dependencies, `defer` or end of `<body>`).
- Put `class="k-root"` on `<body>` or the app root: base font 14px/1.5, letter-spacing -.15px, `color: var(--ink)`, `background: var(--surface)`, antialiasing, the `:focus-visible` ring (`2px solid var(--focus-ring)`, offset 2px) and the reduced-motion switch (all transitions/animations 0s under `prefers-reduced-motion`).
- Behaviors mount from markup: `data-kube="menu"` (space-separated list of names). Options are `data-kube-*` attributes on the same element. Events are bubbling, cancelable `CustomEvent`s named `kube:<event>`. `Kube.get(el, "name")` returns the controller. Nodes added later are mounted automatically (MutationObserver); removed nodes are destroyed. Works with any framework that renders the markup (Svelte: render the classes and `data-kube` attributes; the runtime mounts on them).
- Icons: `<svg class="k-icon" aria-hidden="true"><use href="icons/kube-icons.svg#copy"></use></svg>` (same-origin sprite; or inline the needed `<symbol>`s).
- Theme: light is default; dark follows the OS; force with `data-theme="light|dark"` on `<html>`.
- Content rules: sentence case; short verbs ("Send", "Archive"); address the person as "you"; no emoji in chrome; status = word + badge/pill, never color alone; empty states say the next action; confirmations name object and consequence; feedback brief past tense ("Copied"); only success toasts auto-dismiss (5s).
- Color rules: `surface-under` for sidebar/app ground, `surface` main pane, `surface-elevated` floating, `surface-sunken` code/wells, `surface-shell` window chrome. Text `ink` > `ink-secondary` > `ink-tertiary`. Fills: `fill-subtle` groups, `fill-secondary` selected rows/secondary buttons, `fill-hover` pointer, `fill-menu` active menu row. Hairlines: `border`, `border-light` between rows, `border-heavy` outline buttons, `border-hover` hovered inputs. Primary button = `primary`/`on-primary`, one per view. `accent-solid`/`on-accent` rare accent action; `danger-solid` destructive confirm. `link`/`link-hover`; `focus-ring`; `accent`/`accent-subtle` info marks; `success|warning|danger` (+`-subtle`) state only. `scrim` behind sheets/dialogs, `scrim-dim` behind confirm/form dialogs. Tooltip `tooltip-bg`/`on-tooltip`. Segmented/slider `track`/`track-thumb`. Code `syntax-*`.
- Contrast: `ink`, `ink-secondary` pass 4.5:1 everywhere. Light theme: `ink-tertiary` 3.3:1, `accent` as text 2.9:1 → non-essential/16px+ only; use `link` for link text. Borders are soft (<3:1): fields need a visible label.
- Space: 4px unit; rows 8px inner gap (`space-2`), 12px gutter (`space-3`); panels 16px (`space-4`); sections 24px (`space-6`). Controls `control-md` 32px default, `control-lg` 36 forms, `control-sm` 28 toolbars. Shell: title bar 44px, toolbar 46px (36 small, 40 pane), sidebar 275px (240–520 resized), nav rows 30px.
- Radii concentric: `radius-lg` 10 buttons/inputs, `radius-md` 8 rows, `radius-xl` 12 / `radius-2xl` 16 menus/panels, `radius-4xl` 24 / `radius-form-dialog` dialogs, 22px composer, `radius-full` pills. Inner radius = outer − padding. Where `corner-shape` is supported radii become superellipses ×1.25.
- Shadows by role: `shadow-sm` buttons, `shadow-md` raised cards, `shadow-card` floating panes, `shadow-lg` popovers, `shadow-xl` menus, `shadow-2xl` dialogs, `shadow-composer` prompt bar, `shadow-panel-edge` pushed side panel. Prefer a 0.5–1px hairline over a shadow.
- Motion: `--duration-basic` 150ms (color/opacity), `--duration-moderate` 200ms (movement), `--duration-relaxed` 300ms (panels/height). Enter `--ease-enter`, leave `--ease-exit`, slide `--ease-move`, settle `--ease-enter-snappy` / `--ease-spring-snappy`. Exits faster than entrances. Panels push, never cover. Scroll edges fade (20px top / 40px bottom). Tooltips 150–200ms delay then instant for 300ms. Loaders wait 400ms (soft fade after 1s). Copy swaps icon to check 1.3–2s. Dialogs rise 20px / fade 0.6s in, 0.3s out; bottom sheets under 48rem. Toasts stack 3 deep top-center, swipe right to dismiss. Hover-reveal row actions, always visible on touch.

## 1. Tokens (dist/kube.css)

### Theme switching
- Light values: `:root, [data-theme="light"] { … }`.
- Dark via OS: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`.
- Forced dark: `[data-theme="dark"] { … }` (put the attribute on `<html>`).
- `:root[data-vibrancy="on"] .k-glass` — when the OS window already has vibrancy, glass keeps only a 16% `--surface` tint (no blur/shadow/border).
- `html[data-kube-scroll-lock]` is set by the dialog runtime (overflow hidden + scrollbar-width padding).
- Non-color tokens (space, radius, size, shadow geometry, motion, type) are theme-independent, in a plain `:root { }` block.

### Color — semantic (light → dark)
| Token | Light | Dark |
|---|---|---|
| `--surface` | #ffffff | #181818 |
| `--surface-under` | #f9f9f9 | #000000 |
| `--surface-shell` | #f3f3f3 | #131313 |
| `--surface-elevated` | #ffffff | #212121 |
| `--surface-sunken` | #ededed | #212121 |
| `--surface-secondary` | #f9f9f9 | #181818 |
| `--fill-subtle` | #1a1c1f05 | #ffffff08 |
| `--fill-secondary` | #1a1c1f0d | #ffffff0d |
| `--fill-hover` | #1a1c1f1a | #ffffff12 |
| `--fill-menu` | #1a1c1f0d | #ffffff14 |
| `--ink` | #1a1c1f | #dfdfdf |
| `--ink-secondary` | #1a1c1fb3 | #ffffffb3 |
| `--ink-tertiary` | #1a1c1f80 | #ffffff80 |
| `--border` | #1a1c1f14 | #ffffff14 |
| `--border-light` | #1a1c1f0d | #ffffff0a |
| `--border-heavy` | #1a1c1f1f | #ffffff29 |
| `--border-hover` | #1a1c1f40 | #ffffff4d |
| `--border-overlay` | #1a1c1f14 | #ffffff14 |
| `--border-elevated` | #00000000 | #ffffff14 |
| `--primary` / `--on-primary` | #1a1c1f / #ffffff | #dfdfdf / #2d2d2d |
| `--accent` | #339cff | #339cff |
| `--accent-subtle` | #e5f3ff | #00284d |
| `--accent-solid` / `--on-accent` | #0169cc / #ffffff | #0285ff / #ffffff |
| `--focus-ring` | #0169cc | #0285ff |
| `--link` / `--link-hover` | #0169cc / #013566 | #339cff / #0285ff |
| `--success` / `--success-subtle` | #00a240 / #d9f4e4 | #40c977 / #003716 |
| `--warning` / `--warning-subtle` | #e25507 / #ffe7d9 | #ff8549 / #4a2206 |
| `--danger` / `--danger-subtle` | #e02e2a / #ffd9d9 | #ff6764 / #4d100e |
| `--danger-solid` | #e02e2a | #e02e2a |
| `--discovery` / `--discovery-subtle` | #924ff7 / #efe5fe | #ad7bf9 / #2c184a |
| `--scrim` | #00000022 | #00000022 |
| `--scrim-dim` | #e3e3e380 | #00000080 |
| `--scrim-media` | #0d0d0d26 | #0d0d0d26 |
| `--track` / `--track-thumb` | #ededed / #ffffff | #0d0d0d / #303030 |
| `--tooltip-bg` / `--on-tooltip` | #1a1c1f / #ffffff | #181818 / #dfdfdf |
| `--control-opaque` | #ffffff | #2d2d2d |
| `--reaction-pill` | #f1f1f2 | #242424 |
| `--rule-strong` | #1a1c1f24 | #dfdfdf24 |
| `--find-match` | #facc15 | #facc15 |
| `--image-frame` | #1a1c1f0f | #dfdfdf0f |
| `--scrub-rail` / `--scrub-preview` | #1a1c1f1a / #1a1c1f33 | #dfdfdf1a / #dfdfdf33 |
| `--doc-selection` | #339cff47 | #339cff47 |
| `--list-connector` | #1a1c1f1a | #dfdfdf1a |
| `--media-fg` / `--media-bg` / `--media-scrim` | #ffffff / #000000 / #0d0d0d | same |
| `--media-control` / `--media-control-hover` | #626262 / #6e6e6e | same |
| `--activity-control` / `--activity-control-hover` / `--activity-stop-hover` | #e8e8e8 / #afafaf / #8f8f8f | same |
| `--on-activity-control` / `--on-activity-control-active` | #9f9f9f / #ffffff | #afafaf / #ffffff |
| `--on-chat-accent` / `--on-chat-accent-light` | #ffffff / #0d0d0d | same |
| `--on-avatar` | #ffffff | #ffffff |
| `--syntax-comment/keyword/literal/string/variable/attribute/name` | #4f4f4f #ab4f7a #ac4f23 #3a843f #643cae #b8802b #1f4e94 | (dark pair in theme block) |
| `--chart-blue/green/orange/purple/red/yellow` | #339cff #00a240 #e25507 #924ff7 #e02e2a #ffc300 | (theme block) |
| `--chart-sequential-1..4` | #cce6ff #66b5ff #0285ff #004f99 | (theme block) |
| `--chart-empty` | #f3f3f3 | (theme block) |
| `--glass-highlight` | inset 0 1px 1px #ffffff99, inset 0 -1px 2px #ffffff33 | inset 0 1px 1px #ffffff33, inset 0 -1px 2px #ffffff14 |

Ramps also present (not listed individually): `--gray-0…--gray-1000` (25 steps, flip with theme), `--gray-fixed-*` (frozen light), `--alpha-0…--alpha-70` (ink at N%), hue ramps `--blue|green|red|orange|yellow|purple|pink-25…-1000` and `-a25…-a300`, intent matrix `--intent-<primary|secondary|info|success|warning|caution|danger|discovery>-<soft|soft-alpha|soft-alt|surface|solid|outline|ghost>-<bg|text|border|ring>[-hover|-active]`, `--content-<hue>(-300/-400/-500)`, `--chat-accent-*`, `--avatar-*`, `--file-audio|video|image|document|pdf|presentation|spreadsheet|canvas|three-d`, `--slate-100/600/700/950`, `--amber-100/900`.

### Radius
`--radius-2xs` 2px · `--radius-xs` 4 · `--radius-sm` 6 · `--radius-md` 8 · `--radius-lg` 10 · `--radius-xl` 12 · `--radius-2xl` 16 · `--radius-3xl` 20 · `--radius-4xl` 24 · `--radius-form-dialog` 24 · `--radius-full` 9999px · `--corner-radius-scale` 1 · `--control-radius-sm|md|lg|xl` 6/8/10/12 · `--radius-composer` 22 · `--radius-composer-single-line` 22 · `--radius-sidebar-popover` 12.

### Space and layout
`--space-1` 4px · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32.
`--control-gutter-2xs|xs|sm|md|lg|xl` 6/8/10/12/14/16 · `--control-gutter-pill-scale` 1.33 · `--padding-row-x` 8 · `--padding-row-y` 5 · `--padding-panel` 20 · `--padding-toolbar` 16 · `--gap-toolbar-action` 6 · `--gutter-thread` 16 · `--gutter-chat` 20 · `--gutter-composer` 12 · `--space-composer-inset` 13.
Control heights: `--control-4xs` 20 · `-3xs` 22 · `-2xs` 24 · `-xs` 26 · `-sm` 28 · `-md` 32 · `-lg` 36 · `-xl` 40 · `-2xl` 44 · `-3xl` 48. `--control-font-sm|md|lg` 12/13/14 · `--control-icon-xs|sm|md|lg|xl|2xl` 14/16/18/20/22/24 · `--icon-leading` 16 · `--hairline` 0.5px.
Shell: `--toolbar` 46 · `--toolbar-sm` 36 · `--toolbar-pane` 40 · `--sidebar` 275 · `--sidebar-fluid` clamp(240px, 275px, min(520px, 100vw − 320px)) · `--height-titlebar` 44 · `--height-nav-row` 31 · `--height-settings-row` 64 · `--height-message` 36 · `--height-empty-state-page` 420 · `--height-page-search` 32 · `--composer-button` 28 · `--size-composer-button` 28 · `--thread-max` 48rem · `--chat-max` 800px · `--wide-block-max` 56rem.
Containers: `--container-3xs` 16rem, `-xs` 20, `-sm` 24, `-md` 28, `-lg` 32, `-xl` 36, `-2xl` 42, `-3xl` 48, `-4xl` 56, `-5xl` 64, `-6xl` 72, `-7xl` 80. Breakpoints (for media queries): `--breakpoint-xs` 20rem, `-sm` 40, `-md` 48, `-lg` 64, `-xl` 80, `-2xl` 96.

### Shadows and blur
`--shadow-hairline` 0 0 0 .5px #0000001a · `--shadow-sm` 0 1px 2px -1px #00000014 · `--shadow-md` 0 2px 4px -1px #00000014 · `--shadow-lg` 0 4px 8px -2px #0000001a · `--shadow-xl` 0 8px 16px -4px #0000001f · `--shadow-2xl` 0 16px 32px -8px #00000030 · `--shadow-card` 0 4px 16px #0000000d · `--shadow-panel-edge` -8px 0 16px -8px #0000002e · `--shadow-sm-stronger`, `--shadow-lg-stronger` · `--shadow-tooltip` 0 8px 18px #0f172a33 · `--shadow-thumb` 0 1px 2px #00000033 · `--shadow-segment` 0 1px 4px -1px #00000033 · `--drop-shadow-xs|md|lg` (use inside `filter: drop-shadow()`).
Theme-dependent presets: `--shadow-100…400` (+`-strong`, `-stronger`), `--shadow-xl-spread`, `--shadow-stroke`, `--shadow-stroke-subtle`, `--shadow-prominent`, `--shadow-sidebar`, `--shadow-control-surface`, `--shadow-dialog`, `--shadow-sheet`, `--shadow-dim`, `--shadow-viewer`, `--shadow-composer` (0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 80px 8px #00000006).
Blur: `--blur-xs` 4px · `-sm` 8 · `-md` 12 · `-lg` 16 · `-xl` 24 · `-2xl` 40 · `-3xl` 64.

### Motion
`--duration-basic` .15s · `--duration-moderate` .2s · `--duration-relaxed` .3s · `--duration-streaming-text` .7s · `--duration-shimmer` 2s · `--duration-enter` .4s · `--duration-enter-move` .5s · `--duration-settle` .12s · `--loading-blossom-delay` 1s.
`--ease-enter` cubic-bezier(.19,1,.22,1) · `--ease-enter-snappy` cubic-bezier(.23,1,.32,1) · `--ease-exit` cubic-bezier(.8,0,.4,1) · `--ease-move` cubic-bezier(.65,0,.35,1) · `--ease-spring-snappy` linear(0,.086,.2539,…,1).

### Type
`--font-sans` -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif · `--font-mono` ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace.
`--leading-dense` 1.1667 · `-tight` 1.25 · `-snug` 1.375 · `-normal` 1.5 · `-relaxed` 1.625 · `--tracking-tight` -.025em · `-normal` 0 · `-wide` .025em.
Type classes (family/size/line/weight/tracking in one class; set color separately):
- `k-heading-app` 28px/1.25/600/-.025em · `k-heading-lg` 24/1.25/600 · `k-heading-md` 20/1.25/600 · `k-heading-sm` 18/1.33/590 · `k-heading-xl` 32/38 · `-2xl` 36/42 · `-3xl` 48/48 · `-4xl` 60/60 · `-5xl` 72/72 (all 600) · `k-card-title` 22/28/510.
- `k-body-lg` 16/1.55/400 · `k-body` 14/1.5/400/-.15px · `k-control-label` 13/18px/510/-.08px · `k-caption` 12/1.43/400 · `k-micro` 11/1.33/590 · `k-code` mono 13/1.5.
- `k-title-xs` 16/24 · `-sm` 18/26 · `-md` 20/26 · `-lg` 24/28 (600).
- `k-text-3xs` 8/12 · `-2xs` 10/14 · `-xs` 12/18 · `-sm` 14/20 · `-md` 16/24 · `-lg` 18/29 (400; ≤xs tracking .025em).
- `k-text-caption-sm` 10/1.3 · `-md` 12/1.3 · `-lg` 14/1.3 · `k-small-caps-md` 11/15/600/.65px · `k-small-caps-lg` 13/19/600/.6px (add `text-transform: uppercase`).

### Icon classes (CSS)
`.k-icon` 16px (`--k-icon-size`), stroke 2 (`--k-icon-stroke`), `currentColor`, round caps/joins. `k-icon--xs` 12 · `--sm` 14 · `--lg` 20 · `--xl` 24 · `--thin` 1.5 · `--bold` 2.5 · `--muted` ink-tertiary · `--secondary` · `--accent` · `--success` · `--warning` · `--danger` · `--directional` mirrors under `[dir=rtl]`.

## 2. Runtime API (dist/kube.js, `window.Kube`)

### Core
- `Kube.version` = "2.0.0".
- `Kube.register(name, setup(el, util) → instance|undefined)` — registers a behavior (throws if the name exists). `instance.destroy()` runs when `el` leaves the document.
- `Kube.init(root = document)` — scan and mount `[data-kube]` under root (needed only for nodes the observer cannot see; normally automatic).
- `Kube.get(el, name)` → instance or `undefined`.
- `Kube.destroy(el)` — destroys every instance on el.
- `Kube.util` = `{ on(target, type, fn, opts) → off(), emit(el, type, detail) → !defaultPrevented (fires "kube:"+type, bubbles, cancelable), opt(el, key, fallback) (reads data-kube-<key>; number/boolean coercion from the fallback type; boolean: value !== "false"), reducedMotion(), finePointer(), clamp(v,min,max), uid(prefix), focusable(root), store.get(k)/store.set(k,v) (safe localStorage), afterMotion(el, ms, fn) → cancel }`.

### Actions
- `Kube.copy(text, el?) → Promise<boolean>` — Clipboard API, falls back to hidden textarea + execCommand inside el's dialog/popover.
- `Kube.setLoading(btn, on)` — `aria-busy`, disables (or `aria-disabled`), injects `<span class="k-btn__loader"><span class="k-loader"></span></span>` if missing; restores disabled state and focus on off. Declarative: `data-kube-loading` attribute (present and ≠ "false" = loading) on any element, no `data-kube` needed.
- `Kube.pressScale(width) → number` — .96 (≤80px), .97 (≤150), .98 (≤220), .985 (≤600), .995 (>600).

### Overlays
- `Kube.layers` = `{ stack, push({el, anchor, modal?, outside?, kind?, close(reason)}) → layer, remove(layer), top(), closeTop(reason) → bool }`. Escape closes only the top layer; outside press closes non-modal layers top-down until the one it landed in (or its anchor), stopping at a modal.
- `Kube.position(floating, anchor, opts) → { update(), destroy(), side, align }` — anchor: element | DOMRect-like | `{x,y}`. opts: `side` "bottom" | top | right | left, `align` "center" | start | end, `offset` 6, `alignOffset` 0, `padding` 6, `flip` true, `shift` true, `arrow` el, `arrowPadding` 8, `hideWhenDetached` false, `autoUpdate` true, `onPlace(api)`. Writes `position:fixed`, left/top, `data-side`, `data-align`, `data-detached`, `--k-origin`, `--k-available-width/height`.
- `Kube.open(target, trigger?)` / `Kube.openDialog` (alias) — target: element or selector; resolves dialog/sheet/popover (adds the `data-kube` name and mounts if needed) and calls `open(trigger)`. Returns the instance.
- `Kube.close(target, value?)` / `Kube.closeDialog` (alias).
- Declarative triggers (global): `data-kube-open="#id"` on any element opens a dialog/sheet/popover (also `popovertarget`); `data-kube-close[="returnValue"]` closes the nearest open one. `data-kube-toggle="#id"` toggles a side-panel, bottom-panel or sidebar (keeps `aria-expanded`/`aria-controls`). `data-kube-peek="#id"` marks a sidebar peek area. `data-kube-dismiss` inside a banner/alert dismisses it.
- `Kube.openMenu(menu, anchor, opts)` — opts default `{ side: "bottom", align: "start", offset: 1, focus: "content", returnTo: document.activeElement }`; anchor element or `{x,y}`. `Kube.closeMenu(menu, reason = "api")`.
- `Kube.hideTooltip()` — closes the open tooltip.
- `Kube.toast(stringOrOptions) → { id, el, update(opts), dismiss() }` — options `{ title, description, tone: "info"|"success"|"warning"|"danger"|"inverse", action: { label, onClick(e, toast) }, duration (ms; 0 = until closed; default 5000 only for success without action, else 0), id (replace in place), icon: false, dismissible: false }`. Creates `<ol class="k-toaster" data-kube="toaster">` at the end of body if none exists. Region events: `kube:toast {id, el}`; toast: `kube:dismiss {id, reason}`.
- `Kube.dismiss(el, reason?)` — collapses a banner/alert (height/padding/margin → 0 over .3s), stores `kube:dismissed:<key>` when `data-kube-remember`, emits `kube:dismiss` (cancelable) then `kube:dismissed`.
- `Kube.openImage(src, alt?, trigger?)` or `Kube.openImage([{src, alt, caption, transparent}], index, trigger)` — lightbox viewer.
- `Kube.previewBlock(node, { label, closeLabel, opener, className }) → { dialog, close }` — modal `<dialog class="k-block-preview">`, emits `kube:previewclose`.

### Motion
- `Kube.spring(from, to, { duration: s = .5, bounce, velocity }) → { duration: ms, at(ms) → value }`.
- `Kube.enter(elOrList, { delay, stagger }) → Promise` — plays `.k-transition` enter (adds class) or shows `.k-presence`; stagger capped at 5 steps.
- `Kube.exit(elOrList, { remove }) → Promise<el>` — sets `[data-exiting]` / `[data-hidden]`, `inert` at once; resolves after 200/300/150ms.
- `Kube.replay(el)` — restarts CSS animations of el and subtree.
- `Kube.flash(el, ms = 3000) → el` — adds `.k-flash`, sets `data-flash`, `--k-flash-duration`.
- `Kube.loading(el, promise | true | false, { region }) → Promise` — `.k-delay` (shows after 400ms) / `.k-delay--fade` (after `--k-delay`, 1s); `data-delay-state` waiting|visible|done; counts overlapping work; region gets `aria-busy`. Emits `kube:loading {state}`.
- `Kube.setNumber(el, n | string, intlOptions?)` — renders `.k-digits` columns (locale from `data-kube-locale` or nearest `lang`); columns matched from the right so reused ones roll.
- `Kube.setProgress(el, v)` — v 0..1 (bar `.k-progress` → `--k-progress` 0..1; donut `.k-donut` → 0..100), `null` = indeterminate; syncs `aria-valuenow`, "N%" in `aria-label`, `.k-progress-row__value`.
- `Kube.scrollFade(el) → { update, destroy }` — script-path edge fades for elements without `data-kube`.
- `Kube.highlight(root, query, { caseSensitive, current, scroll }) → { query, count, index, ranges, go(i), next(), prev(), clear() }` — CSS Highlight API (`::highlight(k-find)` / `k-find-current`); emits `kube:find` on root.
- `Kube.truncateMiddle(text, fits(candidate) → bool) → string`.
- `Kube.avatarCount(n) → "+1k"`-style text.
- `Kube.ansi` = `{ state(), render(text, state?, {links}) → {fragment, state}, toFragment(text, {state, links}), strip(text) }`.
- Chat helpers: `Kube.stream(turn, text, { mode: "draft"?, interval, end }) → Promise & { cancel() }`, `Kube.sendMorph(from, turn, { squishXPx, squishYPx, overshootPx, durationMs, receiptDelayMs })`, `Kube.react(message, glyph, { label, pending })`, `Kube.highlightMessage(message)`.

### `data-kube` behaviors (73) and their `data-kube-*` options
| Behavior | Mount on | Options (default) | Events / API |
|---|---|---|---|
| `alert`, `banner` | `.k-alert` / `.k-banner` | `remember` (storage key) | `kube:dismiss`, `kube:dismissed`; `Kube.dismiss(el)` |
| `ansi` | `<pre class="k-ansi">` | `escapes` false, `links` false | API `set(text)`, `append(text)` |
| `attachment-chip` | `.k-composer-chip` / `.k-composer-tile` | — | `kube:remove {item}`; API `remove()`, `setProgress(0-100)`, `ready()`, `error(msg)` |
| `audio` / `video` | `.k-audio` / `.k-video` | `duration`, `step` 5, `speeds` "1,1.25,1.5,2,0.75" | `kube:play/pause/seek/error`; API `play() pause() toggle() seek(s) media` |
| `autogrow` | textarea / `.k-textarea` | `native` true | API `fit()` |
| `avatar-group` | `.k-avatar-group` | `max` 0 | `kube:avatarcount {shown, hidden}`; API `setMax(n)`, `update()` |
| `bottom-panel` | `.k-bottom-panel` | `key`, `default` 280 | `kube:open/close/resize`; API `open close toggle isOpen height() setHeight` |
| `carousel` | `.k-carousel` | — | `kube:carouselchange {canPrev, canNext}`; API `prev() next() update()` |
| `chart` | `.k-chart` | — | `kube:series {series, visible}`, `kube:tooltip {target}`; API `hide()` |
| `checkbox` | `input.k-checkbox` | `indeterminate` false, `controls` (selector) | API `set(bool)`, `sync()` |
| `code-input` | `.k-code-input` | `length` (maxlength or 4), `pattern` "[0-9]" | `kube:complete {value}`; API `value`, `clear()` |
| `codeblock` | `.k-codeblock` | `copy-text`, `copied-ms` 2000, `wrap-persist` true, `source-visible` false, `preview-label` | `kube:copy`, `kube:wrap {wrap}`, `kube:sourcetoggle`; API `setWrap(on)`, `showSource(on)` |
| `command-palette` | `<dialog class="k-command">` (with `dialog`) | `shortcut` "k" ("" off) | `kube:filter`, `kube:select {option, value, label, query}`; API `open() close() refresh()` |
| `composer` | `.k-composer` | `layout` "auto", `drop-label`, `stop-label` | `kube:submit {text, files, attachments, html, tokens}`, `kube:stop`, `kube:files`, `kube:layout`, `kube:expand`, `kube:dictation-start/stop`; API `value setValue focus submit clear setBusy isBusy addFiles attach files insertToken setExpanded setDictating sync` |
| `composer-drawer` | `.k-composer-drawer` | — | `kube:drawer-open/close {item}`; API `show hide toggle remove isOpen items` |
| `composer-tray` | tray drawer | `trigger` "/", `input` selector | `kube:command {value, option, query}`, `kube:tray-open/close`; API `open close update isOpen` |
| `context-menu` | the area | `target` (or `aria-controls`), `offset` 2 | menu events; API `open(x, y)`, `close()` |
| `copy` | button | `copy` or `text`, `target` selector, `copied` "Copied", `duration` 1300 | `kube:copy {ok, text}` |
| `copy-inline` | `.k-copy-inline` | `text`, `copied-ms` 1000 | — |
| `datepicker` | `.k-datepicker` | `value`, `min`, `max`, `initial`, `locale`, `week-start` "0"|…|"locale", `placeholder` | `kube:change {value, date}`, `kube:navigate {month}`; API `value setValue next prev open close` |
| `dialog` / `sheet` | `<dialog class="k-dialog|k-sheet">` | `dismissable` true, `outside` true, `modal` true, `auto-height` | `kube:open`, `kube:close {reason, value}`, `kube:closed`; API `open(trigger) close(value) toggle shake isOpen` |
| `diff` | `.k-diff` | `step` 20, `copy` true, `copy-label` | `kube:modechange`, `kube:expand`, `kube:toggle`, `kube:copy`; API `setMode expand toggle` |
| `disclosure` | `<details class="k-disclosure">` | `force` | — |
| `doc` | `.k-doc` | `placeholder`, `block-placeholder`, `heading-placeholder` | `kube:task`; API `html()` |
| `dropzone` | `.k-dropzone` | `accept`, `multiple` true, `max-size`, `click` true | `kube:drop {files, rejected, source}`, `kube:dragstate {active}` |
| `editor` | `.k-editor` | — | `kube:activeline {line, index}` |
| `field` | `.k-field` | `native` true | `kube:validate {valid, message}`; API `setError(msg)`, `clearError()` |
| `find` | `.k-find` | `target` selector, `flash` | API `run()`, `controller` |
| `flash` | any text element | `duration` 3000, `peek` | `kube:flash {value}` |
| `height` | `.k-height` | — | sets `--k-height`, `data-height-ready` |
| `hover-card` | trigger | `target` "#card", `side` top, `align` center, `offset` 5, `delay` 200, `close-delay` 100, `padding` | `kube:open/close` on trigger |
| `image` | `.k-image` | — | `kube:load`, `kube:error` |
| `image-zoom` | `.k-image-zoom` button / frame | `group`, `caption`, `transparent`, `src` | opens lightbox |
| `input-clear` | `.k-input` wrapper | `escape` true | `kube:clear {value}`; API `clear()`, `sync()` |
| `marquee` | `.k-marquee` | `speed` 2 (em/s) | API `pause() play() update()` |
| `menu` | trigger (or inline `[role=menu]`) | `target`/`aria-controls`, `side` bottom, `align` start, `offset` 1, `hover` | `kube:select {item, value, label, checked}`, `kube:open`, `kube:close {reason}`, `kube:filter`; API `open(focus) close(reason) toggle isOpen` |
| `message` | `.k-message` | — | `kube:copy`, `kube:react`, `kube:reply-ref`, `kube:action {action, button}` |
| `nav-list` | list container | — | API `refresh()` |
| `nav-rail` | `.k-rail` | `scroller` selector; marks: `jump`, `preview` | `kube:jump {mark, target}` |
| `nav-section` | `.k-nav-section` | `key` | `kube:toggle {expanded}`; API `expand collapse toggle` |
| `number-field` | `.k-number-field` | — (min/max/step from input) | `kube:change {value}`; API `stepUp(n) stepDown(n) setValue(v) sync()` |
| `number-roll` | `.k-digits` | `value`, `locale` | rolls on `data-kube-value` change |
| `overflow-row` | `.k-overflow-row` | `rows` 1 | `kube:overflow {hidden}`; API `hidden`, `update()` |
| `page-header` | `.k-page-header` | `scroller` | `kube:scrolled {scrolled}` |
| `pager` | `.k-pager` | `total` 1, `page` 1, `siblings` 1 | `kube:page {page, previous, total}`; API `page total go(n) setTotal(n)` |
| `popover` | `.k-popover[popover]` | `side` bottom, `align` start, `offset` 4, `padding` 6, `outside` true, `focus` auto|first|none, `anchor` | `kube:open/close/closed`; API `open(anchor) close toggle update shake isOpen` |
| `press` | any control | `multiplier` 1 | sets `--k-press-scale` on pointerenter |
| `scroll-fade` | `.k-scroll-fade`, `.k-scroll-shade`, `.k-text-fade` | `force`, `peek` (selector) | `kube:overflow {overflow}`; sets `data-has-overflow`, `data-can-scroll-up/down/start/end` |
| `segmented` | `.k-seg` | `value` | `kube:change {value, item}`; API `value`, `select(v)` |
| `select` | `.k-select` wrapping native select | — | `kube:change`, `kube:clear`; API `sync()` |
| `select-menu` | `.k-select-menu` | `trigger` id, `side` bottom, `align` start, `offset` 8 | `kube:select {option, value, label, selected}`, `kube:filter`; API `open close highlight(option)` |
| `shortcut` | `.k-shortcut` button | `value`, `reserved`, `modifier` true, `error` selector, `placeholder`, `empty` "None", `modifier-text`, `reserved-text` | `kube:change {value, previous}`, `kube:invalid`; API `value recording record() cancel() clear()` |
| `side-panel` | `.k-side-panel` | `key`, `default` 600, `reserve` 352, `titlebar-left`, `titlebar-right` | `kube:open/close {source}`, `kube:resize {width, ratio, full, final}`; API `open close toggle isOpen width() setWidth(px)` |
| `sidebar` | `.k-sidebar` | `key`, `default` 340, `breakpoint` 768 | `kube:open/close`, `kube:peek`, `kube:resize`; API `open close toggle isOpen peek unpeek width setWidth` |
| `slider` | range / `.k-slider-field` / `.k-power-slider` | `unit`, `labels`, `reset` | `kube:change {value}`; API `value setValue refresh` |
| `snap-x` | `.k-snap-x--buttons` | `prev-label`, `next-label`, `force` | — |
| `steps` | `.k-steps` | — | `kube:steps-toggle {expanded}`; API `toggle(force) add(text, status) setStatus(entry, status)` |
| `sticky-header` | `.k-sticky-header` | `force` | `kube:scrolled {scrolled}` |
| `suggestion-list` | `.k-suggestion-list` | `remember` | `kube:suggest {text, item}`, `kube:dismiss`; API `reset()` |
| `suggestion-menu` | the input | `trigger` "@" (+ `aria-controls`) | `kube:filter`, `kube:select`; API `refresh() close()` |
| `table` | `.k-table-block` / `.k-table-scroll` | `label`, `preview-label` | `kube:overflow`; API `update() markdown()` |
| `tabs` | `.k-tabs[role=tablist]` | `rename`, `reorder` true; tab: `renamable` | `kube:select`, `kube:close`, `kube:reorder`, `kube:rename`; API `select close add rename tabs` |
| `tag-input` | `.k-tag-input` | `unique` true | `kube:add`, `kube:remove`, `kube:change {values}`; API `values add remove` |
| `terminal` | `.k-terminal` | `scrollback` 5000, `escapes`, `links`, `label`, `jump-label` | `kube:follow`; API `write writeln clear scrollToBottom isFollowing` |
| `thread` | `.k-thread` | — | `kube:follow {following}`; API `scrollToLatest(smooth) isFollowing() setTyping(on)` |
| `toaster` | `<ol class="k-toaster">` | — | `kube:toast` |
| `tooltip` | trigger | `tooltip` (label; falls back to `text`, `aria-label`, moved `title`), `kbd`, `side` top, `align` center, `offset` 5, `delay` 200, `size` sm|lg | API `show() hide()` |
| `transition` | list container | `stagger` 0 | children entering via `Kube.enter` |
| `truncate-middle` | `.k-filename` | `name` | API `set(name)` |
| `waveform` | `<canvas class="k-waveform">` | `source` "demo"|"none", `autostart` | API `start stop connect(analyser) disconnect setLevel setMode` |

## 3. Components (alphabetical, 116)

Conventions: "runtime" = `data-kube` behavior from §2. Icons everywhere are `<svg class="k-icon" aria-hidden="true"><use href="icons/kube-icons.svg#name"></use></svg>`; the READMEs abbreviate them as `<svg>…</svg>`.

### AmbientGlow — soft colored light behind an empty/welcome page
```html
<main style="position: relative; isolation: isolate">
  <div class="k-ambient-glow" aria-hidden="true"></div>
  <h1>Where should we start?</h1>
</main>
```
- `k-ambient-glow`: fills positioned parent (`inset:0`, `z-index:-1`, clipped, no pointer events); parent needs `isolation: isolate`.
- `::before` body: box 202% of parent width (≤1601px, ratio 1.4338), centered 15px below middle, ellipse of `--k-ambient-glow-color`; `::after` bloom: smaller stronger ellipse of `--k-ambient-glow-bloom` at 50%, slightly right. Under 960px rises from the bottom edge.
- Motion: grows from scale 0/opacity 0 over 1s `cubic-bezier(.2,0,0,1)`; `data-state="off"` fades out over 2.5s; remove attribute to return; replace the element to replay. Reduced motion: no growth/fade.
- `--k-ambient-glow-color` (default `--accent` 20%), `--k-ambient-glow-bloom` (`--accent` 35%); set on the element. One glow per page; turn off when work starts.

### AnsiOutput — mono block rendering ANSI-colored command output
```html
<pre class="k-ansi" data-kube="ansi">&#27;[32m✓&#27;[0m compiled in &#27;[1m1.8s&#27;[0m</pre>
<pre class="k-ansi"><span class="ansi-red-fg ansi-bold">error</span> src/retry.ts</pre>
<pre class="k-codeblock__body k-ansi" data-kube="ansi">…</pre>
```
- `.k-ansi`: `--font-mono` 12px/20px, padding 12px 16px, `--surface-sunken`, 1px `--border-light`, `--radius-xl`, `white-space: pre`, tab 4. `--wrap` wraps; `--bare` drops padding/border/ground.
- Global classes: `ansi-{black,red,green,yellow,blue,magenta,cyan,white}-fg`, `ansi-bright-*-fg`, same with `-bg`; `ansi-bold`, `ansi-dim`, `ansi-italic`, `ansi-underline`, `ansi-strike`, `ansi-hidden`, `ansi-inverse`. Read `--k-term-*` palette (see Terminal).
- Runtime `data-kube="ansi"`: options `data-kube-escapes` (literal `\x1b[` etc.), `data-kube-links`; API `set(text)`, `append(text)`; `Kube.ansi.render/toFragment/strip/state`.

### AppShell — window frame: title bar, sidebar on surface-under, rounded main pane
```html
<div class="k-app">
  <header class="k-titlebar">…</header>
  <div class="k-app__body">
    <nav class="k-sidebar" id="sidebar" data-kube="sidebar" data-state="open">…</nav>
    <main class="k-app__main">
      <div class="k-pane">
        <div class="k-split">
          <div class="k-split__main">
            <div class="k-toolbar">…<button class="k-toolbar__btn" data-kube-toggle="#details">…</button></div>
            <div class="k-pane__fade" aria-hidden="true"></div>
            <div class="k-pane__scroll"><div class="k-pane__column">…</div></div>
          </div>
          <aside class="k-side-panel" id="details" data-kube="side-panel" data-state="closed" inert>…</aside>
        </div>
      </div>
    </main>
  </div>
</div>
```
- `k-app`: full-height column on `surface-under`, `container: k-app`; sets `--k-titlebar-h` 44px, `--k-row-h` 30px, `--k-row-x` 8px, `--k-row-y` 4px, `--k-panel-pad` 20px, `--k-shell-spring` (0.5s `--ease-spring-snappy`, CSS-only fallback).
- `k-app__body` row; `k-pane`: `surface`, 0.5px `border` hairline top+start, `--radius-lg` top-start corner, clips. `k-pane__scroll` scroller; `k-pane__column` centered 48rem, 32px top inset, 20px sides. `k-drag`: extra window drag region (controls opt out).
- `k-app--floating`: pane floats with 4px gap end/bottom, `--radius-xl` all corners, `border-light` ring + `--shadow-card`.
- `k-pane__fade` right after the main toolbar: 16px `surface`→transparent fade; hidden with `data-top-fade="hidden"` and while a page header is scrolled (`data-page-scrolled` on `k-app`).
- Runtime: `sidebar`, `side-panel`, `bottom-panel`, `data-kube-toggle="#id"`, `page-header`. Under 768px the sidebar is an overlay drawer. `data-kube-titlebar-left/right` on a panel cuts its top band under window controls.

### AttachmentChip — attachment pill/card/tile with a corner remove button
```html
<span class="k-composer-chip">
  <span class="k-composer-chip__icon"><svg>…</svg></span>
  <span class="k-composer-chip__name">budget-2025.xlsx</span>
  <span class="k-composer-chip__meta">42%</span>
  <button class="k-composer-remove" aria-label="Remove budget-2025.xlsx"><svg>…</svg></button>
</span>
<span class="k-composer-tile">
  <span class="k-composer-tile__surface">
    <span class="k-composer-tile__preview"></span>
    <span class="k-composer-tile__name"><svg>…</svg><span>floor-plan.png</span></span>
  </span>
  <button class="k-composer-tile__open" aria-label="Open floor-plan.png"></button>
  <button class="k-composer-remove" aria-label="Remove floor-plan.png"><svg>…</svg></button>
</span>
```
- Pill: full radius, 6×8px padding, 13px/18px, ≤320px, `fill-subtle` + 1px `border`, name 500, 14px `ink-tertiary` icon; as `<button>`/`<a>` hovers to `fill-secondary`. `k-composer-chip--card`: 12px padding, ≤256px, `shadow-sm`, 40px icon tile; stack name/meta in `k-composer-chip__stack`.
- Tile: 160×122, `radius-2xl`, `fill-secondary`, inset `border` ring, 90px preview over 32px `surface` name strip. `__open` covers the tile.
- `k-composer-remove`: 16px `primary` disc, 12px `on-primary` cross, `shadow-sm`; hidden until hover/focus (always on touch).
- States: `data-state="uploading"` (name dims; progress in `__meta`), `data-state="error"` (danger icon/border).
- Runtime `attachment-chip`: `kube:remove {item}` cancelable; fades/shrinks 96% 150ms; API `remove()`, `setProgress(0-100)`, `ready()`, `error(message)`.

### AudioPlayer — card for one recording: title, seek bar, transport
```html
<div class="k-audio" data-kube="audio">
  <audio src="note.m4a" preload="metadata"></audio>
  <div class="k-audio__header"><span class="k-audio__title">Weekly sync</span><span class="k-audio__meta">Voice note · 4 minutes</span></div>
  <div class="k-audio__time">
    <div class="k-scrubber" aria-label="Seek"><span class="k-scrubber__rail"></span><span class="k-scrubber__preview"></span><span class="k-scrubber__fill"></span></div>
    <div class="k-audio__times"><span class="k-media-time" data-media="current">0:00</span><span class="k-media-time" data-media="remaining">-0:00</span></div>
  </div>
  <div class="k-audio__controls">
    <button class="k-btn k-btn--ghost k-btn--sm k-audio__speed" data-media="speed">1x</button>
    <div class="k-audio__transport">
      <button class="k-btn k-btn--ghost k-btn--icon" data-media="skip" data-media-skip="-10">…</button>
      <button class="k-audio__play" data-media="play" aria-label="Play"><svg data-icon="play">…</svg><svg data-icon="pause">…</svg></button>
      <button class="k-btn k-btn--ghost k-btn--icon" data-media="skip" data-media-skip="10">…</button>
    </div>
    <button class="k-btn k-btn--ghost k-btn--icon" data-media="mute">…</button>
  </div>
</div>
```
- `k-audio`: ≤400px, 16px padding, `radius-3xl`, `surface-elevated`, inset `border` ring. `k-scrubber`: 6px pill on 20px hit area (rail ink 10%, preview 20%, fill `ink`). `k-audio__times`: 12px tabular `ink-tertiary`. Controls grid `1fr|208px|1fr`, 48px; `k-audio__play` 64px `primary` disc. `k-audio--compact`: one row, 32px play disc, `k-audio__row`, `k-media-time--end`.
- Runtime `audio`: `[data-media]` play/current/duration/remaining/skip/speed/mute, root `data-state` idle|playing|paused, `data-muted`; keyboard seek (arrows 5s, PgUp/Dn 10%, Home/End, Space/K); events `kube:play/pause/seek/error`; API `play() pause() toggle() seek(s)`; options `data-kube-duration`, `data-kube-step`, `data-kube-speeds`.

### Avatar — round picture/initials/icon, alone or stacked
```html
<span class="k-avatar" role="img" aria-label="Chloe Park">C</span>
<span class="k-avatar k-avatar--lg"><img alt="Chloe Park" src="…"></span>
<div class="k-avatar-group" data-kube="avatar-group" data-kube-max="3" role="group" aria-label="5 collaborators">
  <span class="k-avatar" aria-hidden="true">A</span>…
</div>
```
- `--k-avatar-size` default 28px; `k-avatar--xs` 20, `--sm` 24, `--lg` 32, `--xl` 40. Initials 600 at half size. `.k-avatar--count` ("+N") scales by `data-letter-count`; `.k-avatar__plus`.
- Default: `--surface-sunken` + `--ink`. Tones `k-avatar--info|success|warning|danger|discovery` (subtle bg, tinted initials); `k-avatar--solid` (`primary`/`on-primary`). `<img>` child covers + 1px `--border` ring; `<svg>` child at 60%.
- `k-avatar-group`: overlap 8px, 3px cutout ring `--k-avatar-cutout` (default `--surface`). Runtime `avatar-group`: `data-kube-max`, `kube:avatarcount`, API `setMax(n)`, `update()`; `Kube.avatarCount(n)`.
- `<button class="k-avatar">`/`<a>` interactive with focus ring.

### Badge — small tinted status/category chip; Pill = rounded live-status sibling
```html
<span class="k-badge k-badge--success"><span class="k-badge__dot"></span>Passed</span>
<span class="k-badge k-badge--outline">v2.4</span>
<span class="k-pill"><span class="k-pill__progress" style="--k-pill-duration: 12s"></span><span class="k-pill__label">Indexing files</span></span>
```
- `k-badge`: 20px, 5px gutter, 12px/600/.025em, `--radius-xs`, `--fill-hover`/`--ink`. Sizes `k-badge--md` (22px, 14px text, 16px icons), `k-badge--lg` (24px, `--radius-sm`). Tones `--info|--success|--warning|--danger|--discovery` (subtle bg + tone/ink mix text). Fills: soft default, `k-badge--solid` (tone bg, `--surface` text), `k-badge--outline` (1px inset line). `k-badge--pill` full radius. `k-badge__dot` 6px tone dot. Inline SVG first/last sizes to badge. Interactive on `<a>`/`<button>`.
- `k-pill`: 13px/16px, padding 2px 10px 2px 8px, `--radius-full`, bg 15% tone, ≤150px truncating. Tones default `--accent`, `k-pill--success|warning|danger|neutral|discovery`. `k-pill__progress`: 25% tone bar shrinking over `--k-pill-duration` (10s).

### Banner — persistent in-flow notice (`k-banner`) or compact inline alert (`k-alert`)
```html
<div class="k-banner k-banner--warning" role="status" data-kube="banner" data-kube-remember="storage-warning">
  <span class="k-banner__icon"><svg>…</svg></span>
  <div class="k-banner__content"><p class="k-banner__title">Storage almost full</p><p class="k-banner__description">Free some space to keep syncing.</p></div>
  <div class="k-banner__actions"><button>Manage</button></div>
  <button class="k-banner__close" type="button" aria-label="Dismiss"><svg>…</svg></button>
</div>
<div class="k-alert k-alert--danger" role="alert" data-kube="alert">
  <div class="k-alert__row">
    <span class="k-alert__icon"><svg>…</svg></span>
    <div class="k-alert__content"><div class="k-alert__title">Payment failed</div><div class="k-alert__description">Update your card.</div></div>
    <button class="k-alert__close" type="button" aria-label="Close"><svg>…</svg></button>
  </div>
  <div class="k-alert__actions">…</div>
</div>
```
- `k-banner`: full width, 24px padding, 28px radius, `surface-elevated`, 0.5px `border`, faint lift, 14px/18px. Levels `k-banner--info|success|warning|danger` tint the 40px round icon (warning/danger also tint border). `k-banner--compact`: one line, 12×16px, `radius-2xl`, bare 24px icon. `k-banner-dock`: pins to the bottom of a positioned stage (z 100), width ≤40rem (48rem on ≥64rem stages).
- `k-alert`: inline-flex (`k-alert--block` full width), 8×12px, `radius-xl`, 1px `border`, 14px/1.4. Levels default / `k-alert--success|warning|danger` (subtle fill, tinted border) / `k-alert--inverse` (`primary` fill) / `k-alert--centered`. Add `k-toast` → toast.
- Runtime `banner`/`alert`: close via `.k-banner__close`, `.k-alert__close`, `[data-kube-dismiss]` or `Kube.dismiss(el)`; collapses over .3s `--ease-exit`; `data-kube-remember="key"` hides on next load; events `kube:dismiss` (cancelable), `kube:dismissed`. Banners don't animate in.

### Breadcrumb — toolbar path of quiet buttons with chevrons
```html
<nav class="k-breadcrumb" aria-label="Breadcrumb">
  <a class="k-breadcrumb__item k-toolbar__btn" href="/projects"><span>Projects</span></a>
  <svg class="k-breadcrumb__sep" aria-hidden="true">…</svg>
  <span class="k-breadcrumb__current" aria-current="page">Launch plan draft</span>
</nav>
```
- `k-breadcrumb`: flex, 4px gap, `ink-secondary`, 14px (`k-breadcrumb--sm` 13px). `k-breadcrumb__item` on a `k-toolbar__btn` (28px ghost, label in `<span>` to truncate). `k-breadcrumb__sep` 16px chevron `ink-tertiary`, RTL-mirrored. `k-breadcrumb__current` 28px, `ink`, truncates. Icon: `chevron-right`.

### Button — text button, 15 colors, 6 sizes, fill painted on a layer behind the label
```html
<button class="k-btn k-btn--primary" type="button">Save</button>
<button class="k-btn" type="button"><svg class="k-icon">…</svg>New</button>
<button class="k-btn k-btn--outline" type="button" aria-expanded="false">Options<svg>…</svg></button>
<button class="k-btn k-btn--primary" type="button" data-kube="press" data-kube-loading="false">Publish</button>
```
- Colors: (none) `fill-secondary`/`ink`, hover `fill-hover` · `k-btn--primary` `primary`/`on-primary` (one per view) · `k-btn--ghost` none/`ink-tertiary`, hover fades `fill-hover` in · `k-btn--outline` `border-heavy` ring/`ink-secondary` · `k-btn--danger` danger 10%/`danger` · `k-btn--danger-solid` `danger-solid`/white · `k-btn--accent` `accent-solid`/white · `k-btn--accent-subtle` `accent-subtle`/`link` · `k-btn--tinted` currentColor 10% · `k-btn--media`, `k-btn--media-subtle`, `k-btn--media-solid`, `k-btn--media-translucent` (over media) · `k-btn--activity`, `k-btn--activity-stop` (running-task controls).
- Sizes: `k-btn--2xs` 24 · `k-btn--xs` 26 · `k-btn--sm` 28 · default 32 (`control-md`) · `k-btn--lg` 36 · `k-btn--xl` 40. Padding 8/8/10/12/12/14, icons 16/16/18/18/18/18, label 13px (md 14px), weight 400 (lg/xl 500). Radius `radius-md` ≤sm, `radius-lg` md/lg, `radius-xl` xl. `k-btn--pill`, `k-btn--block`, `k-btn--icon` (see IconButton), `k-btn--pulse` (4s breath for the one ready action).
- States: hover cross-fade `duration-basic`; press shrinks fill to `--k-press-scale` (1 by default; `data-kube="press"` sets it); focus 2px `focus-ring` on `::after`; `aria-expanded="true"` / `data-state="open"` / `aria-pressed="true"` / `data-state="on"` hold hover look; `disabled`/`aria-disabled` 40%; `aria-busy="true"` with `k-btn__loader` fades label out .3s, loader in; `k-kbd` inside shrinks to 16px chip. Parts: `k-btn__label`, `k-btn__swap`, `k-btn__loader`.
- Runtime: `data-kube="press"` (`data-kube-multiplier`), `data-kube-loading`, `data-kube="copy"`; `Kube.setLoading(btn, on)`, `Kube.pressScale(w)`.

### ButtonGroup — floating capsule of pill buttons over content
```html
<div class="k-btn-group" role="group" aria-label="View">
  <button class="k-btn" type="button" aria-pressed="true" data-kube="press">Preview</button>
  <button class="k-btn" type="button" aria-pressed="false" data-kube="press">Source</button>
  <span class="k-btn-group__divider" aria-hidden="true"></span>
  <button class="k-btn k-btn--icon" type="button" aria-label="Zoom in" data-kube="tooltip press">…</button>
</div>
```
- `k-btn-group`: 36px (`control-lg`), 2px padding/gap, full radius, `control-opaque` fill, `shadow-control-surface`. Buttons inside become transparent 32px pills (13px/20px); `k-btn--primary` keeps its fill. `k-btn-group__divider` 1×16px `border`. `k-btn-group__dropdown` for a chevron trigger. `k-btn-group__label` text segment.
- `k-btn-group--compact` (32px capsule, 28px buttons); `k-btn-group--joined` (split control sharing the capsule).
- Selected `aria-pressed="true"`/`data-state="on"`: `surface` tinted 10% `accent`, label `link`. No group runtime; use Button hooks.

### Card — elevated content group; CardCarousel row; LinkCard web preview
```html
<article class="k-card k-card--md">
  <img class="k-card__media" alt="…" src="…">
  <div class="k-card__body">
    <span class="k-card__eyebrow">Weekly report</span>
    <h3 class="k-card__title">Signups grew 12%</h3>
    <p class="k-card__text">Most growth came from onboarding.</p>
    <div class="k-card__actions">…</div>
  </div>
</article>
<div class="k-carousel" data-kube="carousel" aria-label="Related reading">
  <div class="k-carousel__track">
    <a class="k-link-card k-link-card--sm" href="…">
      <img class="k-link-card__media" alt="" src="…">
      <div class="k-link-card__body"><span class="k-link-card__title">Page title</span><span class="k-link-card__meta"><span class="k-favicon k-favicon--sm">E</span>example.com</span></div>
    </a>
  </div>
  <button class="k-carousel__btn k-carousel__btn--prev" type="button">…</button>
  <button class="k-carousel__btn k-carousel__btn--next" type="button">…</button>
</div>
```
- `k-card`: `--surface-elevated`, 1px `--border`, `--radius-3xl`, clips media. Widths default 560px, `k-card--sm` 360, `--md` 440, `--full` 100%. `k-card--shadow`: `--border-heavy` hairline + `--shadow-md` instead of border. Interactive (`<a>`/`<button>`/`k-card--interactive`): `--fill-subtle` wash on hover (`--duration-basic`), skipped while over an inner control. Parts `__media` 16:9 cover, `__body` 16px/4px gap, `__eyebrow` 12px `ink-tertiary`, `__title` 16px/600, `__text` `ink-secondary`, `__actions` 12px above/8px gap.
- Carousel: `__track` horizontal, 16px gap, proximity snap, hidden scrollbar; `__btn--prev/--next` 28px round `surface-elevated` + `shadow-md`, visible on hover/focus. Runtime `carousel`: steps per card, `aria-disabled` at ends, `data-can-prev/next`, track focusable with arrows/Home/End; `kube:carouselchange`; API `prev() next() update()`.
- LinkCard: `k-link-card` 1px border, `radius-xl`, `shadow-md` on hover, 240px (`--sm` 200 under 768); `__body`, `__title` 13px/510 two-line clamp, `__meta` 12px with favicon.

### ChartTheme — look of data charts (palette, grid, tooltip, legend, hover dimming) for hand-drawn SVG
```html
<div class="k-chart" data-kube="chart">
  <ul class="k-chart__legend">
    <li><button class="k-chart__legend-item" type="button" data-series="1" aria-pressed="true"><span class="k-chart__marker" data-series="1"></span><span class="k-chart__legend-label">Deploys</span></button></li>
  </ul>
  <div class="k-chart__scroll">
    <svg class="k-chart__plot" viewBox="0 0 520 200" role="img" aria-label="Deploys per day">
      <g class="k-chart__grid"><line …/></g>
      <g class="k-chart__axis"><text class="k-chart__tick" …>0</text></g>
      <g class="k-chart__col" data-x="Mon">
        <rect class="k-chart__band" …/><rect class="k-chart__hit" …/>
        <rect class="k-chart__bar" data-series="1" data-label="Deploys" data-value="12" …/>
      </g>
    </svg>
  </div>
</div>
```
- Series `--k-chart-1…7` (blue, green, orange, purple, red, yellow, pink), set via `[data-series="1"…"7"]` → `--k-series`. Sequential `--k-chart-seq-1…4` via `[data-seq]`; `--k-chart-empty`. Chrome: `--k-chart-text`, `--k-chart-value`, `--k-chart-grid`, `--k-chart-axis`, `--k-chart-cursor`, `--k-chart-band`, `--k-chart-tooltip-bg/-fg/-label`, `--k-chart-legend-hover`, `--k-chart-hover-filter`.
- Parts: `k-chart` 14px/20px; `__plot` full-width SVG; `__scroll`; `__grid`/`__axis` 1px crisp; `__tick` 12px tabular; `__value` 14px/600; marks `__bar`, `__slice`, `__cell`, `__dot`, `__line` (2px), `__area` (16%), `__point`, `__empty`; `__col[data-x]` with `__hit`, `__band` or `__cursor`; `__tooltip` (created) with `__tooltip-title`, `__marker`, `__tooltip-label`, `__tooltip-value`; `__legend` (`--nowrap`), `__legend-item` (`aria-pressed="false"` 40%). Hover dims other bars/slices to 50%. `--grow`: bars rise on first paint.
- Runtime `chart`: pointer tooltip (12px offset, flips), keyboard columns (plot `tabindex=0`, arrows/Home/End), legend toggles (`data-off`, `data-dimmed`); `kube:series`, `kube:tooltip`; API `hide()`.

### Checkbox — native 18px box, ink fill, two-stroke check
```html
<input type="checkbox" class="k-checkbox" aria-label="Pin this chat">
<label class="k-checkbox-item"><input type="checkbox" class="k-checkbox"> Select all files</label>
<label class="k-checkbox-item k-checkbox-item--end"><input type="checkbox" class="k-checkbox"> Indicator at the end</label>
```
- `k-checkbox`: `appearance:none`, 18×18, 1px `--border-hover`, `--radius-xs`; mark on `::before/::after`, `--on-primary`. `k-checkbox-item` 14px/20px row, 8px gap; `--end` box after text.
- Hover border `--ink-tertiary`; checked `--primary` (short bar .1s after 80ms, long bar .1s after .16s); indeterminate = centered dash (morph .15s); disabled `--border-heavy`/`--fill-subtle`; `aria-invalid` → `--danger`.
- Runtime `checkbox`: `data-kube-indeterminate`, `data-kube-controls="<selector>"` (select-all); API `set(bool)`, `sync()`.

### ChoiceCard — radio/checkbox as a selectable card (CSS only)
```html
<div class="k-choice-cards" role="radiogroup" aria-labelledby="plan-label">
  <label class="k-choice-card">
    <input type="radio" name="plan" value="personal" checked>
    <span class="k-choice-card__title">Personal</span>
    <span class="k-choice-card__description">One workspace, your own projects.</span>
    <span class="k-choice-card__check" aria-hidden="true"><svg>…</svg></span>
  </label>
</div>
```
- `k-choice-cards` column, 12px gap, ≤380px. `k-choice-card` ≥96px, padding 16px 20px, 1px `--border`, radius 20px, `--surface-elevated`, .15s ease. Input visually hidden but focusable. `__title` 15px/20px/500; `__description` 15px `--ink-secondary`; `__check` 20px `--primary` circle shown when checked. Checked: `--ink` border + 1px ring. Disabled .5.

### CodeBlock — source code on a sunken surface with header bar and actions
```html
<div class="k-codeblock" data-kube="codeblock">
  <div class="k-codeblock__header">
    <svg class="k-codeblock__icon" aria-hidden="true">…</svg>
    <span class="k-codeblock__lang">python</span>
    <div class="k-codeblock__actions">
      <button class="k-codeblock__action" type="button" aria-label="Copy code" data-copy><svg data-icon="copy">…</svg><svg data-icon="done">…</svg></button>
    </div>
  </div>
  <pre class="k-codeblock__body" tabindex="0"><code>…</code></pre>
</div>
```
- `.k-codeblock`: `--surface-sunken`, 1px `--border-light`, `--radius-3xl`, `contain: inline-size`. `__header` ≥48px, 13px/510. `__action` 36px round ghost (`--fill-secondary` when `aria-pressed`). `__body` mono 12px/20px, padding 0 16px 12px.
- Variants: `k-codeblock--wrap`, `k-codeblock--sticky` (`--k-codeblock-sticky-top`), `k-codeblock--quiet` (actions on hover), `k-codeblock--preview` (`.k-codeblock__preview` + `.k-codeblock__body.k-codeblock__source`, `.k-codeblock__toggle`). Copy feedback: `data-copied` 2s, icon swap `[data-icon="copy"]`→`[data-icon="done"]`.
- Syntax: `hljs-*` classes styled via `--syntax-*` inside `.k-codeblock` and `.k-prose`.
- Runtime `codeblock`: `[data-copy]`, `[data-wrap]` (stored `kube.codeblock.wrap`), `[data-preview-toggle]`; options `data-kube-copy-text`, `data-kube-copied-ms`, `data-kube-wrap-persist`, `data-kube-source-visible`, `data-kube-preview-label`; events `kube:copy`, `kube:wrap`, `kube:sourcetoggle`; API `setWrap(on)`, `showSource(on)`.
- Inline copy: `<button class="k-copy-inline" data-kube="copy-inline">3f9a-21c7</button>` crossfades to "Copied" in `--success` for 1s (`data-kube-text`, `data-kube-copied-ms`).

### CodeInput — OTP/PIN slots over one real input
```html
<div class="k-code-input" data-kube="code-input" data-kube-length="6">
  <input type="text" inputmode="numeric" aria-label="Verification code">
</div>
<input class="k-input k-input--code" inputmode="numeric" maxlength="6" aria-label="Code">
```
- Generated `k-code-input__slots` / `k-code-input__slot` (32×44, full radius, 1px `--border`, `--surface`, 16px; en dash when empty; `k-code-input--mask` for password). Active slot border `--focus-ring`; read-only `--ink-tertiary`; `aria-invalid` → `--danger`.
- Runtime `code-input`: `data-kube-length`, `data-kube-pattern` "[0-9]"; sets `data-filled`, `data-active`, `data-char`; `kube:complete {value}`; API `value`, `clear()`.

### CommandPalette — centered Ctrl/Cmd+K command menu (dialog + list)
```html
<button class="k-btn" type="button" data-kube-open="#palette">Open command menu</button>
<dialog class="k-command" id="palette" data-kube="dialog command-palette" aria-label="Command menu">
  <div class="k-menu__search k-command__search"><svg aria-hidden="true">…</svg><input type="text" placeholder="Type a command or search" aria-label="Command"></div>
  <div class="k-command__list" role="listbox" aria-label="Commands">
    <div class="k-command__group" id="cg-create" role="presentation">Create</div>
    <div role="group" aria-labelledby="cg-create">
      <div class="k-command__item" role="option">
        <span class="k-menu__icon"><svg>…</svg></span><span class="k-menu__label">New document</span><kbd class="k-menu__shortcut">Ctrl N</kbd>
      </div>
    </div>
  </div>
  <div class="k-command__empty" hidden>No commands found</div>
</dialog>
```
- `k-command`: `surface-elevated`, `radius-2xl`, `shadow-2xl`, 4px padding/gap, 13px, ≤520px (92vw small), ≥16px from top; border `--border-elevated`; backdrop `scrim`. `k-command--tall` (list 440px vs 300), `k-command--standalone` (`radius-xl`, `radius-md` rows). `k-command__search`, `k-command__list` (scroll padding 32px), `k-command__group` 12px `ink-tertiary`, `k-command__item` ≥24px `radius-lg` 75% opacity → `--fill-menu` full when highlighted (disabled 25%), `k-command__empty`.
- Runtime `dialog command-palette`: `data-kube-shortcut` ("k"; "" off) toggles with Ctrl/Cmd+key; opens modal, scale .95→1 150ms, focuses field, highlights first; field is `role=combobox` with `aria-activedescendant`; `kube:filter {query, list}` (cancelable), arrows/Home/End, Enter runs → `kube:select {option, value, label, query}` then closes unless prevented. API `open() close() refresh()`.

### Composer — the prompt bar: auto-growing input, attachments, footer controls, send/stop disc
```html
<div class="k-composer-banners"></div>
<div class="k-composer" data-kube="composer">
  <div class="k-composer__body">
    <div class="k-composer__reply">…<span class="k-composer__reply-text">Replying to…</span></div>
    <div class="k-composer__attachments"></div>
    <textarea class="k-composer__input" rows="1" aria-label="Message" placeholder="Ask anything"></textarea>
    <div class="k-composer__footer">
      <div class="k-composer__footer-start">
        <button class="k-composer__btn k-composer__btn--icon" aria-label="Add files"><svg>…</svg></button>
        <button class="k-composer__btn k-composer__dropdown" aria-haspopup="menu" aria-expanded="false">
          <span class="k-composer__dropdown-icon"><svg>…</svg></span>
          <span class="k-composer__dropdown-value k-composer__dropdown-value--medium" data-collapse="sm">Balanced</span>
          <span class="k-composer__dropdown-chevron"><svg>…</svg></span>
        </button>
      </div>
      <div class="k-composer__footer-end"><button class="k-composer__send" aria-label="Send" disabled><svg>…</svg></button></div>
    </div>
  </div>
</div>
```
- Surface `surface-elevated`, 22px radius, `--shadow-composer`; body z-index 10. Input 14px/20px, min 44px, placeholder ink 50%. `k-composer__btn` 28px ghost pill (`--icon` square, `--sm` 20px). `k-composer__send` 28px `primary` disc; `data-state="stop"` + `aria-busy` while streaming. Dropdown value widths `--narrow|--medium|--wide` (64/80/112px); `data-foreground="secondary|tertiary|warning"`. Reply strip `fill-secondary`.
- Variants: `k-composer--single-line`, `--large` (28px radius), `--compact` (+`--dense`), `--inline`, `--document` (+`k-composer__doc-controls`). Rich: see RichComposer.
- States: `data-drag-active` + `data-drop-label`; `aria-disabled="true"` 60%; `data-collapse="sm|secondary|xs"` responsive labels; `data-secondary` chevron. Expand button `k-composer__expand[data-composer-expand]`; dictation `[data-composer-dictate]` + `<div class="k-composer__dictation"><canvas class="k-waveform" data-kube="waveform"></canvas></div>`.
- Runtime `composer`: options `data-kube-layout="auto"`, `data-kube-drop-label`, `data-kube-stop-label`; Enter sends, Shift/Alt+Enter newline, Ctrl/Cmd+Enter sends; events `kube:submit {text, files, attachments}` (cancelable), `kube:stop`, `kube:files`, `kube:layout`, `kube:expand`, `kube:dictation-start/stop`; API `value setValue focus submit clear setBusy isBusy addFiles attach files insertToken setExpanded setDictating sync`. Waveform `data-kube="waveform"`: `data-kube-source="demo|none"`, `data-kube-autostart`; API `start stop connect(analyser) disconnect setLevel setMode`.

### ComposerDrawer — drawer sliding out from behind the composer's top edge
```html
<div class="k-composer-stack">
  <div class="k-composer-drawer" data-kube="composer-drawer">
    <div class="k-composer-drawer__item" data-item="context" data-state="open">
      <div class="k-composer-drawer__content">
        <div class="k-composer-drawer__row">
          <div class="k-composer-drawer__lead"><span class="k-composer-drawer__icon"><svg>…</svg></span><span class="k-composer-drawer__text">Using plan.md and 2 other files</span></div>
          <div class="k-composer-drawer__actions"><button class="k-composer__btn k-composer__btn--sm">…</button></div>
        </div>
        <ul class="k-composer-drawer__list"><li>…</li></ul>
      </div>
    </div>
  </div>
  <div class="k-composer" data-kube="composer">…</div>
</div>
```
- Drawer immediately before `k-composer` in `k-composer-stack`; z 0 behind composer; inset 13px (`--k-drawer-inset`; `--flush` removes), top corners `radius-2xl`, bottom tucked 20px under the composer; fill ink 3% over `surface-elevated`; `k-composer-drawer__item--warning`. Items open via grid rows 0fr→1fr, 150ms `--ease-enter-snappy`.
- `k-composer-drawer--tray`: command/mention tray (`radius-3xl`, rows `k-composer-tray__option` 28px with `k-composer-tray__hint`, `k-composer-tray__empty`).
- Runtime `composer-drawer`: API `show(item) hide toggle(item, force) remove isOpen items` (promises); `kube:drawer-open/close {item}`. `composer-drawer composer-tray`: `data-kube-trigger` "/", `data-kube-input`; `kube:command {value, option, query}`, `kube:tray-open/close`; API `open close update isOpen`.

### ContextMenu — `k-menu` opened at the pointer on right-click
```html
<div class="canvas" tabindex="0" data-kube="context-menu" data-kube-target="canvas-actions">…</div>
<div class="k-menu" id="canvas-actions" role="menu" aria-label="Canvas actions">
  <div class="k-menu__item" role="menuitem"><span class="k-menu__label">Copy</span><kbd class="k-menu__shortcut">Ctrl C</kbd></div>
  <div class="k-menu__item" role="menuitem" aria-disabled="true"><span class="k-menu__label">Paste</span></div>
  <div class="k-menu__separator" role="separator"></div>
  <div class="k-menu__item k-menu__item--danger" role="menuitem"><span class="k-menu__label">Delete</span></div>
</div>
```
- All Menu/Submenu rows and states apply. Runtime `context-menu` on the area: `data-kube-target` (or `aria-controls`), `data-kube-offset` 2. Right-click opens 2px right of pointer (flips/shifts), 700ms long press on touch, Shift+F10/ContextMenu key; 150ms in/100ms out. Events `kube:open/close`, `kube:select`. API `open(x, y)`, `close()`; or `Kube.openMenu(menu, {x, y}, {side: "right", offset: 2})`.

### Cover — the kit's own gallery card (no README in the kit; no `k-cover` class in kube.css)
No markup in README (the folder holds only `preview.html`, a 960×288 card). What it shows, as a recipe for a hero/welcome panel built from tokens alone:
```html
<div class="cover" style="position: relative; overflow: hidden">
  <div class="art"><svg viewBox="0 0 480 288" aria-hidden="true">
    <rect class="ink slab" x="32" y="-24" width="152" height="248"/>
    <rect class="ground row" x="48" y="24" width="120" height="32"/>
    <rect class="mid pill" x="208" y="24" width="232" height="32"/>
    <rect class="accent pill" x="208" y="104" width="296" height="32"/>
    <rect class="soft pill" x="208" y="144" width="152" height="32"/>
  </svg></div>
  <div class="words"><h1 class="name">Kube</h1><p class="tagline">A quiet, monochrome interface for tools people work in all day.</p></div>
</div>
```
- Fills: `.ink` `var(--ink)`, `.mid` `var(--ink-secondary)`, `.soft` `var(--ink-tertiary)`, `.accent` `var(--accent)` (one accent pill only), `.ground` `var(--surface)`. Radii: `.slab`/`.pill` `rx: var(--radius-2xl)`, `.row` `rx: var(--radius-md)`. Scale: rows 32px (`control-md`), gap 8px (`space-2`), column pitch 24px (`space-6`).
- Words: `.words` positioned `left/bottom: var(--space-8)`, max 440px; `.name` 112px/.92/600, letter-spacing -.035em, `var(--ink)`; `.tagline` 14px/1.5, -.15px, `var(--ink-secondary)`, margin-top `var(--space-3)`.
- For in-app "cover" needs use `k-ambient-glow` (AmbientGlow), `k-image--cover` (ImageFrame), `k-card__media` (Card) or `k-empty--page` (EmptyState).

### DatePicker — select-style trigger + sliding month calendar
```html
<button class="k-select k-select--regular" type="button" popovertarget="picker">
  <svg class="k-select__icon" aria-hidden="true">…</svg><span class="k-select__value">Select date...</span><svg class="k-select__chevron" aria-hidden="true">…</svg>
</button>
<div class="k-datepicker" id="picker" role="dialog" aria-label="Choose a date" data-kube="datepicker popover" data-kube-min="2026-01-01"></div>
<div class="k-datepicker" role="group" aria-label="Calendar" data-kube="datepicker" data-kube-week-start="locale"></div>
```
- `k-datepicker`: `--surface-elevated`, `--radius-xl`, `--shadow-xl` + `--shadow-hairline`, padding 10px 12px 12px. Generated: `__body` (210px window), `__calendar`, `__month` (28px, 13px/600), `__grid[role=grid]`, `__week`, `__weekday` (12px), `__cell`, `__day` (30px circle, 14px tabular), `__nav` (28px corner buttons).
- Day states: hover 1px `--ink` ring; `aria-selected="true"` `--primary`/`--on-primary`; `aria-current="date"` 3px dot; disabled .4. Months 242px apart slide .25s `--ease-move`; body height eases.
- Runtime `datepicker`: `data-kube-value|min|max|initial` (YYYY-MM-DD), `data-kube-locale`, `data-kube-week-start` (0–6 or "locale"), `data-kube-placeholder`. Trigger = element with `popovertarget`/`aria-controls`; `k-select__clear` inside a `role=button` trigger clears. Grid keyboard (arrows, Home/End, PgUp/Dn, Shift+PgUp/Dn, Enter/Space). Events `kube:change {value, date}`, `kube:navigate {month}`; API `value setValue(v) next prev open close`. Single dates only. Native `<input type="date" class="k-input">` is a valid alternative.

### Dialog — modal window over a scrim, native `<dialog>`
```html
<button type="button" data-kube-open="#move">Move…</button>
<dialog class="k-dialog" id="move" data-kube="dialog" aria-labelledby="move-title">
  <div class="k-dialog__body">
    <div class="k-dialog__header">
      <span class="k-dialog__icon"><svg>…</svg></span>
      <div class="k-dialog__heading"><h2 class="k-dialog__title" id="move-title">Move to folder</h2><p class="k-dialog__description">Pick where the files should live.</p></div>
    </div>
    <div class="k-dialog__section">…</div>
    <div class="k-dialog__actions"><button type="button" data-kube-close>Cancel</button><button type="button" data-kube-close="move">Move</button></div>
  </div>
  <button class="k-dialog__close" type="button" aria-label="Close" data-kube-close><svg>…</svg></button>
</dialog>
```
- Sizes: `k-dialog--narrow` 380 · `--compact` 420 (16px radius) · `--medium` 448 · default 520 · `--wide` 600 · `--xwide` 680 · `--xxwide` 800; all ≤92vw, ≤viewport−2rem then scroll.
- Default: frosted `surface` 90% + 24px blur, `radius-3xl`, `shadow-lg`, 0.5px `border-heavy` ring, `scrim`. `k-dialog--form` (opaque, `radius-form-dialog`, dim backdrop, wrap in `<form method="dialog">`). `k-dialog--confirm` (centered, 32px padding, 24px title; `role="alertdialog"`; `k-dialog__icon--danger`). `k-dialog__bar` + `k-dialog__scroll` + `k-dialog__actions` for long content. `k-dialog--responsive` → bottom sheet under 768px. Backdrops `k-backdrop`, `k-backdrop--dim`, `k-backdrop--blur`, `k-backdrop--media`. A `<div class="k-dialog" role="dialog" data-kube="dialog" hidden>` fallback works.
- Motion: in fade + 20px rise 0.6s `--ease-enter`; out 0.3s `--ease-exit`; shake 0.4s on blocked dismiss; `data-kube-auto-height`.
- Runtime `dialog`: `data-kube-dismissable` true, `data-kube-outside` true, `data-kube-modal` true, `data-kube-auto-height`. Open via `[data-kube-open="#id"]`, `Kube.open(el, trigger)`, or `showModal()`; close via `[data-kube-close="value"]`, `Kube.close(el, value)`, `<form method="dialog">`, Escape, backdrop. Instance `open(trigger) close(value) toggle() shake() isOpen`. Events `kube:open` (cancelable), `kube:close {reason, value}` (cancelable → shake), `kube:closed {value}`; reasons escape|outside|drag|api. Focus to `[autofocus]` or first focusable; trapped; returns to trigger. Scroll lock `html[data-kube-scroll-lock]`. Paint order: native top layer; fallbacks backdrop 50, dialog 51, toaster 60, popover/tooltip 70, docked banner 100.
- Image viewer: `data-kube="image-zoom"` on `.k-image-zoom` or `Kube.openImage(...)`; zoom −/+ 0.25 to 5x, wheel/pinch, double-click 2x, pan, galleries via `data-kube-group`, captions via `data-kube-caption`/figcaption, `data-kube-transparent` checkerboard (`k-checkerboard` class).

### DiffView — file diff with sticky header, hunks, folds, unified/split
```html
<section class="k-diff" data-kube="diff">
  <header class="k-diff__header">
    <button class="k-diff__toggle" type="button" aria-label="Toggle src/load.ts"><svg>…</svg></button>
    <span class="k-git-badge" data-git="modified" role="img" aria-label="Modified">M</span>
    <span class="k-diff__path">src/<b>load.ts</b></span>
    <span class="k-git-stat"><span class="k-git-stat__add">+3</span><span class="k-git-stat__del">&minus;1</span></span>
    <div class="k-diff__actions"><div class="k-diff__modes" role="group" aria-label="Diff layout">
      <button class="k-diff__mode" type="button" data-diff-mode="unified" aria-pressed="true">Unified</button>
      <button class="k-diff__mode" type="button" data-diff-mode="split" aria-pressed="false">Split</button>
    </div></div>
  </header>
  <div class="k-diff__body"><div class="k-diff__lines">
    <div class="k-diff__hunk"><code>@@ -1,4 +1,6 @@</code> function load()</div>
    <div class="k-diff__line" data-old="1" data-new="1"><span class="k-diff__sign"> </span><span class="k-diff__code">…</span></div>
    <div class="k-diff__line" data-type="del" data-old="2" data-new=""><span class="k-diff__sign">-</span><span class="k-diff__code"><span class="k-diff__word">return</span> parse(raw);</span></div>
    <div class="k-diff__line" data-type="add" data-old="" data-new="2"><span class="k-diff__sign">+</span><span class="k-diff__code">…</span></div>
    <div class="k-diff__fold">
      <button class="k-diff__expand" type="button" data-expand="down" aria-label="Expand down">…</button>
      <button class="k-diff__expand" type="button" data-expand="up" aria-label="Expand up">…</button>
      <button class="k-diff__fold-label" type="button" data-expand="all"><span data-count>12</span> unchanged lines</button>
    </div>
  </div></div>
</section>
```
- `.k-diff`: `--k-diff-bg`, 1px `--k-diff-border`, `--radius-xl`. `__header` 40px sticky (`--k-diff-sticky-top`). `__body` mono 12px/1.8 (`--k-diff-font-size`, `--k-diff-line-height`). `__line` grid: numbers from `data-old`/`data-new` (5ch, `--k-diff-num-width`), sign, code; `data-type="add|del"` tints (`--k-diff-added-line/-gutter/-text`, `--k-diff-removed-*`). `__word` highlights. `__hunk`, `__fold`, `__expand`, `__fold-label[data-count]`. `--bars` (stripe instead of signs), `--wrap`. Split built as `.k-diff__split` (`--k-diff-empty` hatch). `.k-diff__copy` floating copy-line button.
- Runtime `diff`: `data-mode="split"`, `[data-diff-mode]`, `[data-expand="up|down|all"]`, `data-kube-step` 20, `data-kube-copy` true, `data-kube-copy-label`; events `kube:modechange`, `kube:expand {count, remaining}`, `kube:toggle {collapsed}`, `kube:copy`; API `setMode expand(fold, dir) toggle(collapsed)`.

### Divider — 1px rule
```html
<hr class="k-divider">
<span class="k-divider k-divider--vertical" role="separator" aria-orientation="vertical"></span>
```
- Default 1px `--border-light`, 8px space above/below. `k-divider--flush` (no space), `k-divider--strong` (`--border-heavy`), `k-divider--vertical` (in a flex row, ≥1em). Tune `--k-divider-size`, `--k-divider-color`.

### DocumentEditor — contenteditable page that reads like prose
```html
<div class="k-doc k-doc--page" data-kube="doc" aria-label="Document">
  <h1>Launch checklist</h1><p>…</p>
  <ul class="k-doc__tasks">
    <li data-checked="false">
      <span class="k-doc__handle" aria-hidden="true"><svg>…</svg></span>
      <span class="k-doc__check"><input type="checkbox" aria-label="Done"></span>
      <div class="k-doc__task"><p>Write the migration guide</p></div>
    </li>
  </ul>
  <p><br></p>
</div>
```
- `k-doc`: 15px (`--k-doc-size`)/1.6, padding 8px 16px (`--k-doc-pad`); `k-doc--page` centered ≤720px (`--k-doc-max`). Headings 150/125/115%, quote rule `border-heavy`, code `fill-secondary`/`surface-sunken`, selection `--k-doc-selection`, caret `--k-doc-caret`, `data-placeholder` blocks. Tasks: `k-doc__tasks`, `k-doc__check` 16px (`accent-solid` checked), `k-doc__handle`.
- Runtime `doc`: `data-kube-placeholder`, `data-kube-block-placeholder`, `data-kube-heading-placeholder`; `kube:task {item, checked}`; API `html()`.

### DropZone — dashed file target + drag handle/insertion line
```html
<div class="k-dropzone" data-kube="dropzone" data-kube-accept=".png,.jpg,.pdf">
  <svg class="k-dropzone__outline" aria-hidden="true" focusable="false"><rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="15" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="7 6.3"/></svg>
  <svg class="k-dropzone__icon" aria-hidden="true">…</svg>
  <p>Drop files here</p>
  <button type="button" class="k-btn k-btn--sm" data-kube-pick>Choose files</button>
</div>
<li class="k-reveal"><button class="k-drag-handle k-reveal__item" aria-label="Reorder Groceries">…</button> Groceries</li>
<li class="k-drop-indicator" aria-hidden="true"></li>
```
- Outline SVG rect `--border-heavy`; while `data-drag-over="true"` → `--focus-ring`, `--fill-subtle` bg, text `--ink`, icon nods every 1.8s. `k-drag-handle` grab cursor; `k-drop-indicator` 2px `--focus-ring` line.
- Runtime `dropzone`: `data-kube-accept`, `data-kube-multiple` true, `data-kube-max-size` bytes, `data-kube-click` true; `[data-kube-pick]` opens picker (hidden file input created); events `kube:drop {files, rejected, source}`, `kube:dragstate {active}`.

### Editor — theme layer for a code editor (gutter, caret, selection, find, brackets, guides, diagnostics)
```html
<div class="k-editor k-editor--framed" data-kube="editor">
  <div class="k-editor__scroller">
    <div class="k-editor__content" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="load.ts">
      <div class="k-editor__line"><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>;</div>
      <div class="k-editor__line" data-active data-change="modified"><span class="k-editor__indent">    </span>…</div>
    </div>
  </div>
</div>
```
- `.k-editor` mono 12px (`--k-editor-font-size`), `--k-editor-bg/-fg`; `--framed` adds border/`--radius-xl`/`--surface`. `__scroller`, `__content` (line height `--k-editor-line-height`, caret `--k-editor-cursor`, selection `--k-editor-selection(-inactive)`), `__line` (CSS counter gutter 5ch `--k-editor-gutter-width`, `--k-editor-first-line`; `--no-gutter-border`, `--no-numbers`, `--wrap`). `[data-active]` line highlight; `[data-change="added|modified|deleted"]` gutter marks.
- Decorations: `__cursor`, `__selection(--inactive)`, `__selection-match`, `__match(--current)`, `__bracket(--mismatch)`, `__indent(--active)`, `__hint`, `__error|__warning|__info`, `__pending`, `__whitespace`, `__inline-code`, `__sticky`, `__widget` + `__widget-count`. All colors `--k-editor-*`.
- Runtime `editor`: marks caret line `data-active`, `kube:activeline {line, index}`.

### EmptyState — centered placeholder with icon, title, description, actions
```html
<div class="k-empty k-empty--page">
  <div class="k-empty__body">
    <div class="k-empty__art k-empty__art--tile"><svg>…</svg></div>
    <div class="k-empty__text"><h2 class="k-empty__title">No projects yet</h2><p class="k-empty__desc">Projects keep related items together.</p></div>
    <div class="k-empty__actions"><button class="k-btn k-btn--primary" type="button">New project</button></div>
  </div>
</div>
```
- `k-empty` centered column 24×12px; `__body` ≤36rem, 12px gap (`k-empty--spacious` 16px); `__art` 32px `ink-secondary` icon; `__art--tile` 48px tile `--radius-xl` `fill-hover` with 24px `ink` icon; `__title` 16px/24px/500; `__desc` 13px `ink-secondary`; `__actions` 8px gap.
- `k-empty--page` (fills pane, ≥26.25rem), `k-empty--popover` (≥20rem), `k-empty--faded` (60%). One primary action; say what will appear and how to add it.

### Field — label, hint, error layout; rows, inline settings rows, fieldsets, input groups
```html
<div class="k-field">
  <label class="k-field__label" for="name">Workspace name</label>
  <input class="k-input" id="name" aria-describedby="name-hint">
  <p class="k-field__hint" id="name-hint">Shown to everyone you invite.</p>
</div>
<div class="k-field">
  <label class="k-field__label" for="email">Email</label>
  <input class="k-input" id="email" aria-invalid="true" aria-describedby="email-err">
  <p class="k-field__error" id="email-err"><svg aria-hidden="true">…</svg> Enter a complete email address.</p>
</div>
<div class="k-field-row"><div class="k-field">…</div><div class="k-field">…</div></div>
<div class="k-field k-field--inline">
  <div class="k-field__text"><label class="k-field__label" for="lang">Language</label><p class="k-field__hint">Used for menus and dates.</p></div>
  <label class="k-select k-select--sm k-select--regular"><select id="lang">…</select><svg class="k-select__chevron">…</svg></label>
</div>
<fieldset class="k-fieldset"><legend class="k-fieldset__legend">Notify me about</legend><label class="k-checkbox-item"><input type="checkbox" class="k-checkbox"> Mentions</label></fieldset>
<div class="k-input-group" role="group" aria-label="Card details"><input class="k-input" placeholder="Card number"><input class="k-input" placeholder="MM / YY"></div>
```
- `k-field` column 6px gap; `__label` 13px/18px/500 `--ink`; `__hint` 12px `--ink-tertiary`; `__error` 12px `--danger` (+14px icon); `__text` stack. `k-field--inline` label left/control right (control ≤200px). `k-field-row` auto-fit grid ≥160px cols. `k-fieldset`/`__legend` (12px uppercase .025em `--ink-secondary`). `k-input-group`: 40px rows in one `--border` frame `--radius-xl`.
- Runtime `field`: syncs `aria-invalid` ↔ `.k-field__error` (+`aria-describedby`); native validation replaced by field error (`data-kube-native="false"` off); `kube:validate {valid, message}`; API `setError(msg)`, `clearError()`.

### FileIcon — square tile with the file type glyph in its `file-*` color
```html
<span class="k-file-icon" data-type="pdf"><svg class="k-icon" aria-hidden="true"><use href="icons/kube-icons.svg#file-type"></use></svg></span>
```
- `data-type` → glyph/color: `audio` (`file-music`), `video` (`file-play`), `image` (`file-image`), `document` (`file-text`), `pdf` (`file-type`), `presentation` (`presentation`), `spreadsheet` (`file-spreadsheet`), `canvas` (`file-pen-line`), `three-d` (`file-axis-3d`); no type = neutral `ink-secondary` with `file`. Tile = 12% tint of `--k-file-color`, glyph half the tile.
- Sizes `k-file-icon--sm` 20px (`radius-xs`), default 32 (`radius-md`), `k-file-icon--lg` 40 (`radius-lg`); `k-file-icon--plain` no tint. Decorative: always show the name next to it. Map extensions yourself.

### FileName — middle-truncated file name keeping the extension
```html
<span class="k-filename" data-kube="truncate-middle">report-final-reviewed-by-team-v2.pdf</span>
```
- `k-filename` inline, ≤100%, `white-space: pre`; without runtime ends in an ellipsis. With runtime: `data-truncate`, generated `k-filename__full` (from `data-name`), `k-filename__display`, `k-filename__probe`, `k-filename__sr`; `data-truncated` while shortened.
- Runtime `truncate-middle`: reads text or `data-kube-name`, sets `title`; binary search over graphemes, tail keeps extension + 1 char; refits on resize/fonts; API `set(name)`; `Kube.truncateMiddle(text, fits)`. Container needs a width limit (`min-width: 0` in flex).

### FloatingLabelInput — label inside the input that floats up (CSS only)
```html
<div class="k-float-field"><input class="k-input" id="name" placeholder="Alex Morgan"><label class="k-float-field__label" for="name">Full name</label></div>
<div class="k-float-row"><div class="k-float-field">…</div><div class="k-float-field">…</div></div>
```
- `--k-float-pad` 12px; input padding top pad+1.25em; label absolute 14px `--ink-tertiary`, floats (`:focus` / `:not(:placeholder-shown)`) to top with `scale(.888889)`, opacity .8, `--duration-basic`. Every input needs a `placeholder` (a space suffices). `k-float-row` two columns 12px gap.

### FloatingSurface — opaque island lifted off the page
```html
<div class="k-floating">…</div>
<div class="k-floating k-island" role="list">
  <div class="k-island__row" role="listitem"><svg>…</svg>Tests passed <span class="k-island__meta">12s</span></div>
</div>
<div class="k-floating k-floating--pill">…</div>
<div class="k-floating k-floating--inset" style="--k-inner-radius: var(--radius-xl)"><div>…</div></div>
```
- `--surface-elevated`, `--radius-2xl`, shadow = 0.5px `--border` ring + 0 3px 7.5px 4% + 0 0 20px 5% halo. `--inset` pads by `--k-floating-inset` (6px), outer radius = inner + inset. `k-island__row` ≥28px, 14px/20px, 16px side padding, 16px `--ink-secondary` icons; `__meta` 12px `--ink-tertiary` tabular. Add `k-squircle` for superellipse corners. One per screen corner; never nested.

### GitStatus — status letters, colored tree rows, +/- counts
```html
<ul class="k-git-tree">
  <li><a class="k-git-row" href="#" data-git-contains style="--k-git-depth: 0"><svg class="k-git-row__icon">…</svg><span class="k-git-row__name">src</span><span class="k-git-row__lane" role="img" aria-label="Contains changes"></span></a></li>
  <li><a class="k-git-row" href="#" data-git="modified" style="--k-git-depth: 1"><svg class="k-git-row__icon">…</svg><span class="k-git-row__name">load.ts</span><span class="k-git-row__lane"><span class="k-git-badge" role="img" aria-label="Modified">M</span></span></a></li>
</ul>
<span class="k-git-stat"><span class="k-git-stat__add">+12</span><span class="k-git-stat__del">&minus;3</span></span>
```
- Colors `--k-git-added|modified|deleted|renamed|untracked|conflict|ignored`; `[data-git="…"]` sets `--k-git-color`. `.k-git-badge` 11px mono semibold letter (A M D R U C I). `.k-git-tree` 13px/18px; `.k-git-row` 30px, `--radius-md`, indent 12px × `--k-git-depth`, `--fill-hover` hover, `--fill-secondary` current/selected; `__icon` 16px, `__name`, `__lane` 20px; `[data-git-contains]` 6px dot. `.k-git-stat` 12px mono (`__add`, `__del`).

### Glass — translucent material for surfaces floating over moving content
```html
<div class="k-glass">…</div>
<div class="k-glass k-glass--thin k-glass--pill">…</div>
<div class="k-glass k-squircle">…</div>
```
- 90% tint of `--surface-elevated` (`--k-glass-opacity`), 16px backdrop blur (`--k-glass-blur`), border `--border` 60%, inset highlights (`--glass-highlight`), `--shadow-lg` (`--k-glass-elevation`), radius `--k-radius` (`--radius-xl`). `k-glass--thin`: 8px blur, 92% tint, soft drop shadow. `k-glass--pill`.
- Falls back to solid `--surface-elevated` without backdrop-filter or under `prefers-reduced-transparency`; `Canvas` in forced-colors. `<html data-vibrancy="on">` → only a 16% `--surface` tint. `k-squircle` superellipse where `corner-shape` exists. Text on glass stays `--ink`/`--ink-secondary`; no glass on glass; not for menus/dialogs.

### HoverReveal — row actions hidden until hover/focus, label fades under them (CSS only)
```html
<div class="k-reveal row">
  <span class="k-reveal__label">Quarterly planning notes</span>
  <div class="k-reveal__item actions"><button type="button" aria-label="Rename">…</button><button type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false">…</button></div>
</div>
```
- `k-reveal__item` opacity 0 → fades in 150ms on `k-reveal` hover (hover-capable devices), focus within, or open menu inside (`aria-expanded="true"` / `data-state="open"`). Stays in tab order. `k-reveal__label` one line, fades out from `--k-reveal-space` (48px) before its end. Touch/coarse pointers: always visible. No script.

### Icon — Lucide outline sprite drawn through `k-icon`
```html
<svg class="k-icon" aria-hidden="true"><use href="icons/kube-icons.svg#copy"></use></svg>
```
- Sprite `dist/icons/kube-icons.svg`, 1,866 symbols, Lucide names. Sizes `k-icon--xs` 12, `--sm` 14, default 16, `--lg` 20, `--xl` 24 or `--k-icon-size`. Stroke `k-icon--thin` 1.5, `k-icon--bold` 2.5. Tones `--secondary|--muted|--accent|--success|--warning|--danger`. `k-icon--directional` mirrors in RTL. Same-origin only; inline needed `<symbol>`s otherwise. Keep `LICENSE-lucide.txt` next to the sprite. Icon-only buttons: `aria-label` + tooltip.

### IconButton — square button with one icon, name on `aria-label`, tooltip
```html
<button class="k-btn k-btn--ghost k-btn--icon" type="button" aria-label="Edit" data-kube="tooltip press"><svg>…</svg></button>
<button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" aria-label="Copy" data-kube="copy tooltip" data-kube-copy="https://example.com/r/4821">
  <span class="k-btn__swap"><svg>…copy…</svg><svg>…check…</svg></span>
</button>
```
- `k-btn--icon` on any Button color: width = height, no padding. Sizes 24/26/28/32/36/40 (16px icons ≤26, 18px above); `k-btn--pill` circle. Close buttons: `k-btn--ghost k-btn--icon k-btn--sm` (28px), `k-btn--xs` in toasts/chips.
- Icon swap: two icons in `k-btn__swap`; `data-swapped` shows the second (out .15s `ease-exit` to .6, in .3s `ease-enter`).
- Runtime: `copy` (`data-kube-copy`/`data-kube-text`, `data-kube-target`, `data-kube-copied`, `data-kube-duration` 1300; sets `data-copied`, `kube:copy {ok, text}`), `tooltip` (`data-kube-kbd`, `data-kube-text`, `data-kube-side`, `data-kube-delay`), `press`. When both copy and tooltip: payload in `data-kube-copy`.

### ImageFrame — rounded picture box with hairline, placeholder, hover action, caption
```html
<figure class="k-figure">
  <button class="k-image k-image--zoom" type="button" data-kube="image image-zoom" aria-label="Open image: hills at dusk"><img src="hills.jpg" width="240" height="160" alt="Hills at dusk"></button>
  <figcaption class="k-figure__caption">Hills at dusk</figcaption>
</figure>
<div class="k-image k-image--cover" style="--k-image-ratio: 1" data-kube="image">
  <img class="k-image__placeholder" src="tiny.jpg" alt="">
  <img src="full.jpg" alt="Abstract shapes">
  <span class="k-image__actions"><button class="k-image__action" type="button">Edit</button></span>
</div>
```
- `k-image`: `radius-md` (`--k-image-radius`), `fill-secondary` while empty, `::after` hairline ink 6% (`--k-image-frame`). `k-image__loading` (≥96px, `--k-image-min-height`), `k-image__placeholder` (blur 16px, scale 1.06), `k-image__actions` > `k-image__action` (36px chip; `--end`), `k-figure__caption` 13px `ink-secondary`.
- `k-image--zoom` (scale 1.03 on hover), `k-image--cover` (`--k-image-ratio` 16/9), `k-image--flush`. `k-checker` (`--k-checker-size` 36px, `--k-checker-a/-b`), `k-checker--hover`.
- Runtime `image`: fades in once decoded (`data-loaded`; `data-state="error"`); `kube:load`, `kube:error`. `image-zoom` opens the viewer.

### InlinePrompt — suggested prompt as arrow + text button
```html
<button class="k-prompt" type="button"><span class="k-prompt__arrow"><svg aria-hidden="true">…</svg></span><span class="k-prompt__text">Turn this into a checklist</span></button>
```
- Fit-content row, 6px gap; arrow 16px `ink-tertiary`; text dotted `ink-tertiary` underline. Hover/focus: arrow moves 2px, colors → `link` 80% with `ink`. No runtime; handle click (e.g. composer `setValue` + `submit()`). ≤3 in a row.

### InlineToken — inline chip for command/file/entity, optional ghost hint
```html
<span class="k-token">/summarize</span>
<span class="k-token" data-has-hint>/summ</span><span class="k-token__hint" aria-hidden="true">arize this thread</span>
```
- `fill-secondary`, `radius-md`, 1×4px padding, `box-decoration-break: clone`. `data-has-hint` squares the facing corners. Hint `ink-tertiary`, not selectable. In a rich composer `insertToken(label, {value, hint})`; Tab accepts the hint.

### Input — single-line field with inset hairline, 9 sizes, icon/affix/clear
```html
<input class="k-input" id="name" placeholder="Project name">
<div class="k-input">
  <svg class="k-input__icon" viewBox="0 0 16 16" aria-hidden="true">…</svg>
  <input type="email" placeholder="Email address" aria-label="Email address">
  <button class="k-input__clear" type="button" aria-label="Clear"><svg>…</svg></button>
</div>
<div class="k-input"><span class="k-input__affix">https://</span><input placeholder="example.com" aria-label="Website"></div>
```
- Sizes (height/font/radius/gutter/icon): `k-input--3xs` 22/12/`--radius-sm`/8/14 · `--2xs` 24/12/sm/8/16 · `--xs` 26/13/sm/8/16 · `--sm` 28/13/`--radius-md`/10/16 · default 32/13/md/12/18 · `--lg` 36/13/md/12/18 · `--xl` 40/14/`--radius-lg`/14/18 · `--2xl` 44/14/`--radius-xl`/16/20 · `--3xl` 48/14/xl/16/20. `k-input--soft` (`--fill-secondary` well), `k-input--pill`.
- Rest hairline `--border-heavy`; hover `--border-hover`; focus `--ink-tertiary` (inset box-shadow, `--duration-basic`); invalid `--danger` + 2px 20% glow; disabled .5; `--k-input-border-focus: var(--focus-ring)` for accent focus. `k-input__clear` hidden while empty (`data-empty` or `:placeholder-shown`).
- Runtime `input-clear` on the wrapper: keeps `data-empty`, clear button empties + fires `input` + refocuses; Escape clears non-empty (`data-kube-escape="false"` off); `kube:clear {value}` cancelable; API `clear()`, `sync()`.

### Kbd — flat keycap tinted from the text color
```html
<kbd class="k-kbd">Ctrl K</kbd>
<span class="k-kbd-group"><kbd class="k-kbd">Shift</kbd><kbd class="k-kbd">P</kbd></span>
```
- 12px `--font-sans`, line-height 1, 2×6px padding, ≥16px wide, `--radius-md`, bg 10% currentColor. `k-kbd-group` 2px gap. Bare `<kbd>` in `.k-prose` gets the same. Write combos as one keycap ("Ctrl K").

### Layout — Box, Grid, Flow, Spacer primitives (data attributes)
```html
<div class="k-box" data-align="center" data-gap="2"><h2>Title</h2><span class="k-spacer"></span><button class="k-btn">Share</button></div>
<div class="k-grid" style="--k-grid-min: 160px">…</div>
<div class="k-flow" data-layout="pack" data-gap="2">
  <div class="k-flow__item" data-span="2" data-aspect="soft" style="--k-aspect-w: 16; --k-aspect-h: 9">…</div>
  <div class="k-flow__item" data-aspect="fixed">…</div>
</div>
```
- `k-box`: flex, `min-width:0`; `data-direction` row|col|row-reverse|col-reverse; `data-inline`; `data-align` start|center|end|baseline|stretch; `data-justify` start|center|end|between|around|evenly|stretch; `data-wrap`|nowrap|wrap-reverse; `data-gap` n×4px (0–8, 10, 12) or `--k-gap`; `data-clip`, `data-scroll`; child `data-grow`.
- `k-grid`: equal columns `repeat(auto-fit, minmax(0,1fr))`, gap 8px; `--k-grid-min` column floor, `--k-grid-cols` fixed count; children `data-span="2"|"full"`.
- `k-flow`: wrapping tiles ≥`--k-flow-min` (160px); `data-layout="pack"|"fixed"`; `k-flow__item` with `data-span="2"`, `data-rows="2"`, `data-aspect="soft"|"fixed"` (`--k-aspect-w/h`).
- `k-spacer`: `flex:1`; `--k-spacer-min`.

### Link — inline text link
```html
<a class="k-link k-link--primary" href="/notes">release notes</a>
<a class="k-link k-link--underline" href="/guide">setup guide</a>
<a class="k-link k-link--secondary k-link--hover-underline" href="/history">View history</a>
```
- `k-link` inherits color (hover 80%); `k-link--primary` `link`→`link-hover`; `k-link--secondary` (`ink-secondary`→`ink`), `k-link--tertiary`; `k-link--underline`, `k-link--hover-underline` (70% color, .1em offset). Inline-flex 2px gap for a trailing 14px icon; .15s transitions; focus 2px `focus-ring` 1px out `radius-sm`. No runtime.

### List — rows of media, title, description, meta
```html
<ul class="k-list k-list--bleed">
  <li><a class="k-list__item" href="…">
    <span class="k-list__media"><span class="k-avatar k-avatar--lg">PR</span></span>
    <span class="k-list__content"><span class="k-list__title">Product review</span><span class="k-list__desc">Notes and open questions</span></span>
    <span class="k-list__meta">2m</span>
  </a></li>
</ul>
```
- `.k-list` grid, `--k-list-gap` (0). `.k-list__item` flex, 12px gap, 10px padding, `--radius-lg`; `__media`, `__content`, `__title` 14px/510, `__desc` 13px `--ink-secondary`, `__meta` 12px `--ink-tertiary` tabular. `k-list--bleed` (−10px), `k-list--divided` (`--border-light` rules).
- Interactive (`<a>`, `<button>`, `data-interactive`): `--fill-hover` wash scales .98→1 on hover, dips while pressed. Selected: `aria-current`, `aria-selected="true"`, `data-active`.

### MarkerList — list with drawn markers: dots, numbers, round checks, icon tiles, connector line
```html
<ol class="k-markers k-markers--decimal k-markers--connected">
  <li><span class="k-markers__marker"></span><div class="k-markers__body">Connect the repository<div class="k-markers__desc">Read access is enough.</div></div></li>
</ol>
<ul class="k-markers k-markers--check">
  <li><label class="k-markers__marker"><input class="k-markers__check" type="checkbox" id="t1"></label><label class="k-markers__body" for="t1">Collect feedback</label></li>
</ul>
```
- Row grid `1.5rem | 1fr` (`--k-marker-col`), gap `--k-marker-gap` 8px. `__marker`, `__body`, `__desc` (13px/18px `ink-secondary`). Default 6px dot; `k-markers--decimal` (600 tabular); `k-markers--check` (20px circle, `ink` fill when checked, strike-through); `k-markers--icon` + `k-markers__icon` (24px `radius-xl`; `--tile` adds `fill-secondary`; `k-markers--lg` 64px); `k-markers--connected` (2px ink 10% line, 8px rings).

### Marquee — one-line text that scrolls only when it overflows
```html
<div class="k-marquee" data-kube="marquee"><span class="k-marquee__clip"><span class="k-marquee__track"><span class="k-marquee__content">Build 4128 passed · Deploy finished</span></span></span></div>
<span class="k-marquee k-marquee--hover k-marquee--once" data-kube="marquee" tabindex="0"><span class="k-marquee__clip"><span class="k-marquee__track"><span class="k-marquee__content">A long title</span></span></span></span>
```
- `k-marquee` block nowrap; `__clip` (fades `--k-marquee-fade-start` .571em / `--k-marquee-fade-end` 1.143em while `data-overflowing`); `__track` (gap `--k-marquee-gap` 1.15em); `__content` (runtime clones it). Default loops, pauses on hover/focus/`data-paused`; `k-marquee--hover` (scroll on hover), `k-marquee--group` (parent hover), `k-marquee--once`.
- Runtime `marquee`: sets `data-overflowing`, `--k-marquee-distance`, `--k-marquee-duration` (`data-kube-speed` 2em/s); API `pause() play() update()`. Reduced motion: still, faded end.

### Mention — person/file/entity inside text
```html
<a class="k-mention" href="…"><span class="k-mention__icon"><svg aria-hidden="true">…</svg></span><span class="k-mention__label">Chloe Park</span></a>
<span class="k-mention k-mention--pill"><span class="k-mention__label">Design review</span></span>
```
- Inline, weight 510, text = `--accent` 80% + `--ink`; `__icon` 1em; `k-mention--neutral` (`--ink`), `k-mention--discovery` (purple), `k-mention--pill` (`--radius-full`, `--fill-hover`). Interactive: dashed underline on hover.

### Menu — floating action/choice list opened from a trigger
```html
<button class="k-btn" type="button" data-kube="menu" aria-controls="item-actions">Actions</button>
<div class="k-menu" id="item-actions" role="menu" aria-label="Item actions">
  <div class="k-menu__item" role="menuitem"><span class="k-menu__icon"><svg>…</svg></span><span class="k-menu__label">Rename</span><kbd class="k-menu__shortcut">F2</kbd></div>
  <div class="k-menu__separator" role="separator"></div>
  <div class="k-menu__heading">View</div>
  <div class="k-menu__item" role="menuitemcheckbox" aria-checked="true"><span class="k-menu__label">Show hidden files</span><svg class="k-menu__check">…</svg></div>
  <div class="k-menu__item" role="menuitemcheckbox" aria-checked="false"><span class="k-menu__label">Compact rows</span><input class="k-switch k-switch--menu" type="checkbox"></div>
  <div class="k-menu__item k-menu__item--danger" role="menuitem"><span class="k-menu__label">Delete</span></div>
</div>
```
- `k-menu`: 4px gutter, `radius-2xl`, 13px, 90% `surface-elevated` + 8px blur, 0.5px `border`, `shadow-xl`; `--k-menu-min-width` 180px, `--k-menu-max-height`. `k-menu--opaque`, `k-menu--descriptive` (44px rows, `radius-3xl`), `k-menu--scroll` + `k-menu__scroll k-scroll-fade` (`--k-menu-scroll-height` 250px).
- Parts: `k-menu__item` (5×8px, `radius-xl`), `__icon` (16px slot, 14px icon 75%), `__label`, `__text` + `__desc` (12px `ink-tertiary`), `__shortcut`, `__separator`, `__heading`, `__group[role=group]`, `__footer`, `__search` (`--sticky`, `--inset`), `__empty`, `__check` (14px; 18px radios), `__checkbox` (16px circle), `__radio` (18px ring), `__chevron` (submenu). Item roles: `menuitem`, `menuitemcheckbox`, `menuitemradio` (+`aria-checked`), switch row with `k-switch--menu`, `k-menu__item--danger`. `data-indicator-position="leading"` on menu or group.
- States: `data-highlighted` (fill `--fill-menu` scales .98→1, 150ms), `data-state="open"` trigger, `aria-disabled` 50%, `aria-checked` indicator scales in .4s. Motion: open fade+scale .95 150ms `ease-enter`, close 100ms `ease-exit`; `data-side`, `data-align` set transform-origin.
- Runtime `menu` on the trigger (or on inline `[role=menu]`): `aria-controls`/`data-kube-target`, `data-kube-side` bottom, `data-kube-align` start, `data-kube-offset` 1, `data-kube-hover`. Menu gets `popover="manual"`, placed by `Kube.position`, in `Kube.layers`; keep menus at the end of `<body>`. Events: `kube:select {item, value, label, checked}` on the row (actions close; preventDefault keeps open; checkbox/radio stay open), `kube:open`/`kube:close {reason}` on the menu, `kube:filter {query, menu}` on the search field. API `open("first"|"last"|"content"|"none") close(reason) toggle() isOpen()`; `Kube.openMenu(menu, anchor, {side, align, offset, focus, returnTo})`, `Kube.closeMenu(menu)`. Keyboard: Enter/Space/ArrowDown/ArrowUp on trigger; arrows stop at ends, Home/End/PgUp/PgDn, typeahead (1s buffer), Escape closes all and refocuses trigger; Tab held.

### Message — a conversation turn (user bubble / assistant text) with hover action row
```html
<div class="k-message k-message--user">
  <div class="k-message__bubble">Can you summarize these notes?</div>
  <div class="k-message__actions"><button class="k-message__action" aria-label="Copy message"><svg>…</svg></button><button class="k-message__action" aria-label="Edit message"><svg>…</svg></button></div>
</div>
<div class="k-message k-message--assistant" data-streaming>
  <div class="k-message__content"><p>…</p></div>
  <div class="k-message__actions"><button class="k-message__action" aria-label="Copy response"><svg>…</svg></button><span class="k-message__time">2:41 PM</span></div>
</div>
```
- User bubble: `fill-secondary`, 22px radius, 10×16px, ≤70%; `k-message__bubble--compact`, `--accent`, `--pending` (dashed), `--with-media` (+`k-message__bubble-body`); `k-message__meta`; `k-message--start`. Assistant: no surface, 14px/1.625; `data-streaming` pulsing dot; `k-word-arrival--response` / `k-word-arrival` (`--word-arrival-color`).
- Action row: `k-message__action` 26px, 16px icon, `radius-sm`, `ink-tertiary`; `data-state="done"` success; row visible on hover/focus/open menu/touch/`data-visible`; `data-enter` rise 8px 300ms; `k-message__time`, `k-message__timestamp`.
- Runtime `message`: `[data-action="copy|react|reaction-pill|reply-ref|…"]` → `kube:copy`, `kube:react`, `kube:reply-ref`, `kube:action {action, button}`. Helpers `Kube.stream(turn, text, {mode, interval, end})`, `Kube.sendMorph`.

### MessageReactions — single pop-in reaction or count pills on a bubble
```html
<div class="k-message__reactions"><div class="k-reaction" role="img" aria-label="Reacted 👍" data-reaction="👍"><span class="k-reaction__bg" aria-hidden="true"></span><span class="k-reaction__glyph" aria-hidden="true">👍</span></div></div>
<div class="k-message k-message--user" data-kube="message"><div class="k-message__surface">
  <div class="k-message__reactions k-message__reactions--pills"><button class="k-reaction-pill" type="button" data-action="reaction-pill" data-reaction="👍" aria-pressed="true" aria-label="Thumbs up, 2"><span class="k-reaction-pill__glyph" aria-hidden="true">👍</span><span class="k-reaction-pill__count">2</span></button></div>
  <div class="k-message__bubble k-message__bubble--compact">…</div>
</div></div>
```
- `k-reaction` 36px `fill-secondary` disc, 16px glyph; `k-reaction--pending` dashed ring; enter rises 38.72px at 1.67x then settles. Pills ≥32×32, 2px `surface` border, `aria-pressed="true"` → `accent-subtle`; `data-keep`. Runtime via `message`; `Kube.react(message, glyph, {label, pending})`.

### NavRail — floating table-of-contents rail that grows toward the pointer
```html
<nav class="k-rail k-rail--floating" aria-label="Jump to section" data-kube="nav-rail" data-kube-scroller="#doc">
  <button class="k-rail__mark" type="button" data-level="1" data-kube-jump="#overview" aria-current="true" aria-label="Overview"></button>
  <button class="k-rail__mark" type="button" data-level="2" data-kube-jump="#travel" data-bookmarked data-kube-preview="#p-travel" aria-label="Travel"></button>
</nav>
<div class="k-rail__preview" id="p-travel" hidden>
  <div class="k-rail__preview-title"><span>Travel</span><span>3 items</span></div>
  <div class="k-rail__preview-text">…</div>
  <div class="k-rail__preview-meta"><span>Spent 4 210 €</span></div>
</div>
```
- `k-rail` ≤min(70vh, 40rem); `k-rail--floating` 8px from end edge, centered. `k-rail__mark` 44×10px; line 26×2px `ink-secondary` 40%, scaled by `data-level` (1: 12px, 2: 8px, 3: 4px). `aria-current="true"` 60% ink; hover grows to full with neighbors 70/40/20%; `data-bookmarked` dot. `k-rail__preview` 320px card (`--tooltip` dark variant); parts `__preview-title`, `__preview-text`, `__preview-meta`.
- Runtime `nav-rail`: click smooth-scrolls `data-kube-jump`; press-and-move scrubs (`data-scrub-target`, `data-neighbor-distance`, `data-scrubbing`); `aria-current` follows `data-kube-scroller`; `data-kube-preview="#card"` shows the card 150ms after rest; `kube:jump {mark, target}`.

### NavRow — 30px navigation row with icon, fading label, badge/meta/actions
```html
<a class="k-nav-row" href="#" aria-current="page"><span class="k-nav-row__icon"><svg>…</svg></span><span class="k-nav-row__label">Inbox</span><span class="k-nav-row__badge">3</span></a>
<div class="k-nav-item">
  <a class="k-nav-row k-nav-row--sm" href="#"><span class="k-nav-row__label">Quarterly budget review</span><span class="k-nav-row__meta">2h</span></a>
  <div class="k-nav-item__actions"><button class="k-nav-action" type="button" aria-label="Archive"><svg>…</svg></button></div>
</div>
```
- Row `--k-row-h` 30px, 4×8px padding, 8px gap, `--radius-lg`, 14px at 85% ink. Parts `__icon` 16px, `__avatar` 20px, `__label` (last 1rem fades), `__meta` 12px `ink-tertiary`, `__badge` (15px, `accent`, 11px/590 white), `__dot` 6px `accent`, `__chevron`, `__text` + `__desc`.
- States: hover / `data-state="open"` → `fill-secondary`; `aria-current="page|true"` / `aria-selected` → `fill-secondary` + full `ink`; focus ring 2px inside; disabled 50%. Variants `k-nav-row--sm` 13px, `--accent`, `--two-line`, `--footer`. Hover actions: `k-nav-item` > `k-nav-item__actions` > 20px `k-nav-action`, reserves `--k-nav-actions-w` 52px; always shown on touch.
- Runtime `nav-list` on the container: roving focus (one Tab stop, arrows, Home/End, ArrowRight into actions); API `refresh()`. Rows live in `k-nav-list` (1px gap).

### NumberField — number input with hidden spinners and flush stepper
```html
<div class="k-input k-number-field" data-kube="number-field">
  <input type="number" inputmode="numeric" value="4" min="0" max="10" step="1" aria-label="Replicas">
  <span class="k-number-field__stepper"><button class="k-number-field__step" type="button" aria-label="Decrease">…</button><button class="k-number-field__step" type="button" aria-label="Increase">…</button></span>
</div>
```
- Tabular figures; `__stepper` 1px inside hairline; `__step` width = control − 4px, `--border-light` divider, hover `--fill-hover`. All Input sizes/states; unit in `k-input__affix`.
- Runtime `number-field`: buttons/ArrowUp/Down step (Shift ×10), PgUp/Dn ×10, Home/End; clamps; decimals from `step`; disables at limits; fires `input`, `change`, `kube:change {value}`; API `stepUp(n) stepDown(n) setValue(v) sync()`.

### NumberRoll — digit columns roll to a new value
```html
<span class="k-digits" data-kube="number-roll" data-kube-value="1284"></span>
<script>Kube.setNumber(document.querySelector('.k-digits'), 1321);</script>
<!-- rendered -->
<span class="k-digits"><span class="k-digits__sr">1,284</span><span class="k-digits__col" aria-hidden="true"><span class="k-digits__stack" style="--k-digit: 1"><span>0</span>…<span>9</span></span></span><span aria-hidden="true">,</span>…</span>
```
- `k-digits__col` 1ch×1lh clipped; `k-digits__stack` moves by `--k-digit` lines over `--duration-relaxed` (.3s) `cubic-bezier(.16,1,.3,1)`; tabular figures; `k-digits__sr` holds the full number.
- `Kube.setNumber(el, n, intlOptions)` (locale `data-kube-locale` or `lang`); `data-kube="number-roll"` renders `data-kube-value` on mount and rolls on change. Use ≥13px; not for values changing many times per second; reduced motion switches instantly.

### OverflowRow — one-line chip/action row that collapses extras into a "+N" menu
```html
<div class="k-overflow-row" data-kube="overflow-row" data-gap="1">
  <button class="k-btn k-btn--outline k-btn--sm k-btn--pill" type="button">Design</button>…
  <button class="k-btn k-btn--ghost k-btn--sm k-btn--pill" type="button" data-overflow-more data-kube="menu" aria-controls="more-filters"><span data-overflow-count>+0</span></button>
</div>
<div class="k-menu" id="more-filters" role="menu" tabindex="-1" aria-label="More filters" hidden></div>
```
- Wrapping flex, 4px gap (`data-gap`). `[data-overflow-more]` shown only while `data-has-overflow`; `[data-overflow-count]` "+N"; `[data-overflow-end]` always stays; hidden items get `data-overflow-hidden`.
- Runtime `overflow-row`: `data-kube-rows` 1; fills the controlled `k-menu` with hidden items; `kube:overflow {hidden}`; API `hidden`, `update()`.

### PageHeader — page title/subtitle, actions with page search, filter row, scroll hairline
```html
<header class="k-page-header k-page-header--sticky">
  <div class="k-page-header__content">
    <div class="k-page-header__heading"><h1 class="k-page-header__title">Projects</h1><p class="k-page-header__subtitle">Everything your team is working on.</p></div>
    <div class="k-page-header__actions">
      <label class="k-page-search k-page-header__search"><svg>…</svg><input class="k-page-search__input" type="search" placeholder="Search projects" aria-label="Search projects"><button class="k-page-search__clear" type="button" aria-label="Clear search"><svg>…</svg></button></label>
      <button class="k-btn k-btn--primary" type="button">New project</button>
    </div>
    <div class="k-page-header__nav">…</div>
  </div>
</header>
```
- `k-page-header` 16px top padding, bottom border → `border-light` with `data-scrolled`; `__heading` ≥60px; `__title` 28px/1.2/500; `__subtitle` 14px/24px `ink-secondary`; `__actions` ≥60px end-aligned (wraps under 48rem); `__search` 240px; `__nav` second row. `k-page-header--sticky` (16px above top, `surface`), `k-page-header--bar` (52px compact).
- `k-page-search`: 32px pill, `border-heavy` on `surface-elevated`, 18px icon, focus `focus-ring`; `__clear` only with text; `k-page-search--settings|--toolbar|--sidebar`.
- Runtime `page-header`: `data-kube-scroller`; sets `data-scrolled` and `data-page-scrolled` on `k-app`; `kube:scrolled {scrolled}`.

### Pagination — previous / numbers / next, or compact "3 / 12" pill
```html
<nav class="k-pager" aria-label="Pages" data-kube="pager" data-kube-total="12" data-kube-page="5">
  <ul class="k-pager__list">
    <li><button class="k-pager__btn" type="button" data-pager="prev" aria-label="Previous page"><svg>…</svg></button></li>
    <li><button class="k-pager__btn" type="button" data-pager="next" aria-label="Next page"><svg>…</svg></button></li>
  </ul>
</nav>
<nav class="k-pager k-pager--compact" aria-label="Pages" data-kube="pager" data-kube-total="8"><ul class="k-pager__list"><li>…prev…</li><li class="k-pager__count" aria-live="polite">1 / 8</li><li>…next…</li></ul></nav>
```
- `k-pager__btn` 32px pill, 14px tabular `ink-secondary`; `aria-current="page"` `fill-secondary`/`ink` 500; disabled 40%; `k-pager__gap` "…"; `k-pager--compact` 32px pill with `k-pager__count` (mono 13px).
- Runtime `pager`: `data-kube-total`, `data-kube-page` 1, `data-kube-siblings` 1; renders numbers; `kube:page {page, previous, total}` cancelable; API `page total go(n) setTotal(n)`.

### PickerMenu — fixed-width choice menu with heading, rich radio rows, footer
```html
<button class="k-btn" type="button" data-kube="menu" aria-controls="layout-picker">Layout</button>
<div class="k-menu k-menu--picker" id="layout-picker" role="menu" aria-label="Layout">
  <div class="k-menu__list">
    <div class="k-menu__heading">Choose a layout</div>
    <div role="group" class="k-menu__group" aria-label="Layout">
      <div class="k-menu__item" role="menuitemradio" aria-checked="true"><span class="k-menu__text"><span class="k-menu__label">Comfortable</span><span class="k-menu__desc">Balanced spacing</span></span><svg class="k-menu__check">…</svg></div>
    </div>
    <div class="k-menu__separator" role="separator"></div>
    <div class="k-menu__item" role="menuitemcheckbox" aria-checked="true"><span class="k-menu__label">Show previews</span><svg class="k-menu__check">…</svg></div>
  </div>
  <div class="k-menu__footer"><span class="k-menu__desc">Applies to this workspace</span></div>
</div>
```
- `k-menu--picker` 254px, clipped `radius-2xl`; `k-menu__list` scroll ≤316px; `k-menu__footer` hides when empty. Opens slower (320ms `ease-enter-snappy` from .98, 30ms delay). Runtime = Menu; radio rows keep it open (close via `Kube.get(trigger, "menu").close("select")` on `kube:select`).

### Popover — anchored non-modal panel on native `popover`; also hover card
```html
<button type="button" popovertarget="share" aria-expanded="false">Share</button>
<div class="k-popover" id="share" data-kube="popover" role="dialog" aria-labelledby="share-title"><p id="share-title">Sharing</p>…<button type="button" data-kube-close>Done</button></div>
<a href="/people/sam" data-kube="hover-card" data-kube-target="#sam-card">Sam Rivera</a>
<div class="k-popover" id="sam-card" role="dialog" aria-labelledby="sam-name" style="width: 260px; min-width: 0">…</div>
```
- Width 300–700px (≤viewport−32, ≤`--k-available-width`); height ≤`--k-available-height`; padding `space-4`, `radius-xl`, `surface-elevated`, two-layer shadow + 0.5px `border-heavy` ring. `k-popover--translucent` (72% + 16px blur). `data-animate="shake"`. No arrow. Open: scale .95 → 1, 0.35s `--ease-enter` from `--k-origin`; close 0.2s `--ease-exit`.
- Runtime `popover`: `data-kube-side` bottom, `data-kube-align` start, `data-kube-offset` 4, `data-kube-padding` 6, `data-kube-outside` true, `data-kube-focus` auto|first|none, `data-kube-anchor`. API `Kube.open(el, anchor)`, `Kube.close(el)`, instance `open(anchor) close() toggle(anchor) update() shake() isOpen`. Events `kube:open`, `kube:close {reason}`, `kube:closed`. Opened by `popovertarget` or `data-kube-open`.
- Hover card `data-kube="hover-card"` on the trigger: `data-kube-target`, 200ms open (`data-kube-delay`), 100ms close (`data-kube-close-delay`), `data-kube-side|align|offset|padding`; no touch; events on trigger.

### PressFeedback — layered hover/press/focus state for custom controls
```html
<button class="k-pressable k-press tile" type="button" data-kube="press">Weekly review</button>
<button class="k-pressable k-press-scale card" type="button" data-kube="press">…</button>
```
- `k-press`: fill on `::before` (`--k-press-fill`, default `--fill-hover`), focus ring on `::after`, both follow the radius; rest invisible at `--k-press-scale`, hover fades in and grows, press shrinks back and darkens to `--k-press-fill-active` (ink 14%). Open (`aria-expanded="true"`/`data-state="open"`) 60%; selected (`aria-selected`, `aria-pressed`, `aria-current="page"`) 100%. `k-press-scale` scales the whole element on `:active` (.97 without runtime).
- Runtime `press`: sets `--k-press-scale` from width on pointerenter (.96/.97/.98/.985/.995); `data-kube-multiplier` (0 off); reduced motion clears it. Don't set a background on a `k-press` element (use `--k-press-fill`).

### Pressable — unstyled button reset for rows, tiles, cards
```html
<button class="k-pressable">…</button>
<button class="k-pressable k-pressable--ghost" aria-selected="true">Weekly report</button>
<button class="k-pressable k-pressable--inset-focus">…</button>
```
- `k-pressable`: no border/margin/padding/background, inherits font/color, pointer cursor, text not selectable. `k-pressable--ghost`: `fill-hover` on hover, press 14% ink, selected via `aria-pressed`/`aria-selected`/`data-state="on"`. `k-pressable--inset-focus`: outline 4px inside in currentColor. Focus 2px `focus-ring`; disabled 50%. Add `k-press`/`k-press-scale` + `data-kube="press"` for press motion. App provides size, radius, role/state attributes.

### Print — clean printout of a document view
```html
<article class="k-print k-prose"><h2>Quarterly summary</h2><table class="k-table">…</table><p class="k-print-hide">Only on screen.</p></article>
```
- `@media print`: page `k-print` 16mm margins; only `.k-print` and ancestors print; light tokens pinned; 11pt/1.5 (`.k-print-small` 9pt, code 10pt); headings keep with next, 3-line orphans/widows; no splits in images/rows/code; code wraps; table headers repeat. Hidden: `[role=toolbar]`, `[role=scrollbar]`, `[data-block-actions]`, `.k-block-actions`, code actions, `.k-print-hide`, placeholders. One `k-print` per page.

### Progress — bar, labeled row, countdown, donut ring
```html
<div class="k-progress" role="progressbar" aria-label="Uploading report.pdf" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40" style="--k-progress: .4"><div class="k-progress__bar"></div></div>
<div class="k-progress-row"><span class="k-progress-row__label">Uploading report.pdf</span><div class="k-progress" …><div class="k-progress__bar"></div></div><span class="k-progress-row__value">40%</span></div>
<div class="k-progress k-progress--indeterminate" role="progressbar" aria-label="Preparing"><div class="k-progress__bar"></div></div>
<span class="k-countdown" style="--k-duration: 5s"></span>
<svg class="k-donut" viewBox="0 0 12 12" style="--k-progress: 30" role="img" aria-label="30% complete"><circle class="k-donut__track" cx="6" cy="6" r="5"/><circle class="k-donut__arc" cx="6" cy="6" r="5" pathLength="100"/></svg>
```
- `k-progress` 6px (`k-progress--sm` 4px), `--radius-full`, track `--fill-hover`, bar `--ink` (`--k-progress-color`); width follows `--k-progress` 0..1 with 120ms ease-out; `k-progress--indeterminate` breathes 68–96% over 2.5s. `k-progress-row` 12px `--ink-secondary`, value column ≥28px. `k-countdown` 2px `--ink-tertiary` drains over `--k-duration` (5s). `k-donut` 12px (viewBox 12, r 5) or `k-donut--lg` 24px (viewBox 24, r 11), stroke 2, `--k-progress` 0..100; `k-donut--fill-on-mount` (delay `--k-delay`), `k-donut--indeterminate`.
- `Kube.setProgress(el, v | null)`; `Kube.replay(el)` for fill-on-mount. Reduced motion: jumps; indeterminate rests at 40%.

### Prose — rendered Markdown from one scoping class
```html
<article class="k-prose">
  <h2>Migration</h2><p>Run <code>sync --dry-run</code> first. See the <a href="#guide">guide</a>.</p>
  <ul><li>Update the client</li><li><input type="checkbox" checked disabled> Back up the database</li></ul>
  <blockquote><p>Policies run on the server.</p></blockquote>
  <div class="k-table-scroll k-scroll-fade k-scroll-fade--x" role="region" aria-label="…" tabindex="0"><table>…</table></div>
  <pre><code>sync migrate --env staging</code></pre>
</article>
```
- All measures from `--k-prose-size` (14px): line-height ×1.625, unit `--k-prose-space` = size/4; h1 1.5×, h2 1.25×, h3 1.125×, h4 1× (600); lists indent one line-height; blockquote 1-unit `--border-heavy` rule; tables `--k-prose-small`; inline code mono .92em on `--fill-hover`; images `--radius-md` ≤min(70vh, 40rem).
- `k-prose--sm` 13px, `k-prose--lg` 16px; `.k-prose-wide` breakout block (`--k-prose-wide-max` 64rem); `.k-math`; GFM footnotes styled; `a.k-link-subtle`; `k-image-zoom` buttons; code blocks take `data-kube="codeblock"`, tables `data-kube="table"`; `.k-prose--streaming` fades in arriving items (`.k-fade-in`, `--k-fade-delay`). Wrap every table in `.k-table-scroll`.

### PulseDot — breathing dot or three fading dots for live/pending state
```html
<span class="k-dot-pulse" role="status" aria-label="Responding"></span>
<span class="k-dot-pulse" style="--k-dot-size: 6px; --k-dot-color: var(--success)"></span>
<span class="k-dots" role="status" aria-label="Typing"><span></span><span></span><span></span></span>
```
- `k-dot-pulse`: `--k-dot-size` 8px, `--k-dot-color` `--ink`, scales 1→1.25 every 1.25s. `k-dots`: three 8px dots (`k-dots--sm` 4px) fading .15–.4 staggered .2s, `currentColor`. One pulse per surface; pair colored dots with a word; reduced motion: solid / static ellipsis.

### Radio — native 16px round choice in a RadioGroup
```html
<div class="k-radio-group" role="radiogroup" aria-label="Theme">
  <label class="k-radio-item"><input type="radio" class="k-radio" name="theme" checked> System</label>
  <label class="k-radio-item"><input type="radio" class="k-radio" name="theme"> Light</label>
</div>
<fieldset class="k-fieldset"><legend class="k-fieldset__legend">Frequency</legend><div class="k-radio-group k-radio-group--col">…</div></fieldset>
```
- `k-radio` `--k-radio-size` 16px, 1px inset `--border-heavy` ring; checked `--primary` + 6px `--on-primary` dot (fades/scales .6s `--ease-enter`). `k-radio-item` 14px/20px, 6px gap (`--block`). `k-radio-group` row 20px gap; `--col` 10px gap; `--lg` 20px radio/16px text. Hover `--border-hover`; disabled .5; `aria-invalid` → `--danger`. CSS only.

### ReplyReference — quoted line above a reply that jumps to the parent
```html
<div class="k-message k-message--user" data-kube="message">
  <button class="k-reply-ref" type="button" data-action="reply-ref" data-target="m-parent"><svg aria-hidden="true">…</svg><span class="k-reply-ref__text">Can we move the review?</span></button>
  <div class="k-message__bubble">Thursday is fine.</div>
</div>
```
- 12px/16px `ink-secondary`, 14px icon, two-line clamp, aligned to sender side. Runtime via `message`: `kube:reply-ref {target}` then `Kube.highlightMessage(target)` (scroll + 2px `primary` ring flash 1.2s).

### RichComposer — composer whose field is a contenteditable with tokens
```html
<div class="k-composer" data-kube="composer"><div class="k-composer__body">
  <div class="k-composer__attachments"></div>
  <div class="k-composer__input k-composer__input--rich" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Ask anything"></div>
  <div class="k-composer__footer">…</div>
</div></div>
```
- Same box as textarea; placeholder from `data-placeholder` while `:empty`; styles lists, quotes (3.5px `border` rule), inline code (`fill-secondary`, 13px mono), `pre`, `hr`. Runtime `composer` adapts: `kube:submit` adds `html`, `tokens`; paste is plain text; API `insertToken(label, {value, hint})`; tray options with `data-token`/`data-hint` insert tokens. Bring your own editor engine for formatting; sanitize `html`.

### ScrollFade — edge fades on scrollable areas while more content lies beyond
```html
<div class="k-scroll-fade" data-kube="scroll-fade" style="max-height: 320px; overflow-y: auto">…</div>
<div class="k-scroll-fade k-scroll-fade--bottom" data-kube="scroll-fade" style="overflow-y: auto">…</div>
<div class="k-scroll-fade k-scroll-fade--x" data-kube="scroll-fade" style="display: flex; overflow-x: auto">…</div>
<div class="k-scroll-fade k-scroll-fade--divider" data-kube="scroll-fade" style="overflow-y: auto">…</div>
<div class="k-scroll-shade" data-kube="scroll-fade" style="max-height: 240px"><div class="k-scroll-shade__viewport">…</div></div>
<div class="k-scroll-fade k-scroll-fade--bottom" role="menu" data-kube="scroll-fade" data-kube-peek style="max-height: 280px; overflow-y: auto">…</div>
<span class="k-text-fade" data-kube="scroll-fade">A long file name that runs past the edge.md</span>
```
- Pure CSS where `animation-timeline: scroll()` exists (top fade over first 20px, bottom over last 40px); else driven by `data-can-scroll-up|down|start|end`. Sizes `--k-scroll-fade-top` 20px, `--k-scroll-fade-bottom` 40px, `--k-scroll-fade-x` 24px, `--k-scroll-shade-color` (`--surface`). `k-text-fade` masks last 1rem (`--k-text-fade`). `k-scroll-fade--off` draws nothing. `k-scroll-fade--top` (Terminal). Reduced motion keeps fades.
- Runtime `scroll-fade`: 1px tolerance; sets `data-has-overflow` and the `data-can-scroll-*`; `data-kube-force` (script path), `data-kube-peek[="selector"]` (cuts max-height through the last visible row); `kube:overflow {overflow}`; `Kube.scrollFade(el)` for manual tracking. Don't put a sticky header inside a top-faded scroller.

### ScrollSnap — horizontal snapping row with optional columns and scroll buttons
```html
<div class="k-snap-frame">
  <div class="k-snap-x k-snap-x--buttons k-scroll-fade k-scroll-fade--x" data-kube="snap-x scroll-fade" role="list" tabindex="0" aria-label="Recent files"><div role="listitem">…</div></div>
</div>
<div class="k-snap-x k-snap-x--cols" style="--k-snap-cols: 2">…</div>
<div class="k-snap-x" data-snap="mandatory" data-snap-align="center">…</div>
```
- Items snap at start (`x proximity`); `data-snap="mandatory"`, `data-snap-align="center"`; smooth, no chaining, hidden scrollbar. `--cols`: `--k-snap-cols` items + `--k-snap-cue` (0.1) peek, gap `--k-snap-gap` 12px. `--buttons`: native `::scroll-button()` or runtime `.k-snap-frame__button`s (fine pointers).
- Runtime `snap-x`: `data-kube-prev-label`, `data-kube-next-label`, `data-kube-force`; scrolls 85% width; sets `data-can-scroll-start/end`.

### Scrollbar — thin native scrollbar styling
```html
<div class="k-scrollbar" style="overflow-y: auto">…</div>
<div class="k-scrollbar k-scrollbar--hover" style="overflow-y: auto">…</div>
<div class="k-scrollbar--none" style="overflow-x: auto">…</div>
<main class="k-scrollbar k-scrollbar--stable-both k-scroll-contain" style="overflow-y: auto">…</main>
```
- `k-scrollbar`: thin, thumb `--border` (→ `--border-heavy` on hover/active/focus). `--hover` transparent until hover/focus; `--none` hidden; `--stable` / `--stable-both` (`scrollbar-gutter: stable`); `k-scroll-contain` (`overscroll-behavior: contain`). Use `--stable-both` on the main column, `k-scroll-contain` on nested scrollers.

### SearchHighlight — match marks and find-in-page with count and prev/next
```html
<div class="k-find" data-kube="find" data-kube-target="#doc">
  <input class="k-input k-input--sm" type="search" aria-label="Find in page">
  <span class="k-find__count" aria-live="polite"></span>
  <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" data-find="prev" aria-label="Previous match">…</button>
  <button class="k-btn k-btn--ghost k-btn--icon k-btn--sm" type="button" data-find="next" aria-label="Next match">…</button>
</div>
<p>Results for <q>sync</q>: the weekly <mark class="k-mark">sync</mark> notes.</p>
```
- `--find-match` (#facc15). `mark.k-mark` 40%, `k-mark--current` 70% + glow. Find-in-page uses `::highlight(k-find)` 24% / `::highlight(k-find-current)` 52%; flash option fades over 4.5s. `k-find__count` 12px tabular `ink-tertiary`.
- `Kube.highlight(root, query, {caseSensitive, current, scroll})`; runtime `find`: `data-kube-target`, `data-kube-flash`; Enter/Shift+Enter, `[data-find="next|prev"]`, Escape clears; API `run()`, `controller`.

### SearchInput — Input with leading search icon and clear button
```html
<div role="search"><div class="k-input" data-kube="input-clear">
  <svg class="k-input__icon" viewBox="0 0 16 16" aria-hidden="true">…</svg>
  <input type="search" placeholder="Search files" aria-label="Search files">
  <button class="k-input__clear" type="button" aria-label="Clear search"><svg>…</svg></button>
</div></div>
```
- Native cancel glyph hidden; `k-input__clear` hidden while empty (.75 opacity, 1 on hover/focus). Runtime `input-clear` as Input. Any Input size; `k-input--soft k-input--pill` for filters in menus/toolbars; `--k-input-radius`. Icon `search`.

### SegmentedControl — 2–5 options with a sliding raised thumb
```html
<div class="k-seg k-seg--pill" data-kube="segmented" aria-label="Range">
  <span class="k-seg__thumb" aria-hidden="true"></span>
  <button class="k-seg__item" type="button" aria-checked="true" data-value="day">Day</button>
  <button class="k-seg__item" type="button" data-value="week">Week</button>
  <button class="k-seg__item" type="button" data-value="month">Month</button>
</div>
```
- `k-seg`: 2px padding/gap, `track` bg, 13px/600. `k-seg__item` `ink-secondary` (16px icon ok), radius = track − 2px. `k-seg__thumb` (optional first child) `track-thumb` fill + soft shadow, moved by runtime (`data-ready` enables .3s `ease-enter` glide). Sizes `k-seg--xs` 26 (`radius-sm`), `--sm` 28, default 32, `--lg` 36 (`radius-md`), `--xl` 40 (`radius-lg`); `k-seg--pill`, `k-seg--ghost` (no track, `surface-sunken` thumb), `k-seg--block`.
- States: hover `fill-hover` wash; checked `aria-checked="true"` (also `aria-selected`, `aria-pressed`, `data-state="on"`); focus ring; disabled 50%.
- Runtime `segmented`: single select, click/Enter/Space; arrows move focus only; `role=radiogroup/radio` added; `data-kube-value`; `kube:change {value, item}` on user selection; API `value`, `select(v)`. Views of the same content only; tabs for pages; select for >5.

### Select — trigger for a choice list; also wraps a native `<select>`
```html
<button class="k-select" type="button" aria-haspopup="listbox" aria-expanded="false"><svg class="k-select__icon" aria-hidden="true">…</svg><span class="k-select__value">English</span><svg class="k-select__chevron" aria-hidden="true">…</svg></button>
<div class="k-select" role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="Owner">
  <span class="k-select__value">Alex Morgan</span>
  <span class="k-select__indicators"><button class="k-select__clear" type="button" aria-label="Clear owner" tabindex="-1">…</button><svg class="k-select__chevron" aria-hidden="true">…</svg></span>
</div>
<label class="k-select k-select--block"><select required aria-label="Time zone"><option value="">Select a time zone</option><option>UTC</option></select><svg class="k-select__chevron" aria-hidden="true">…</svg></label>
<div class="k-select k-select--block" data-kube="select"><svg class="k-select__icon">…</svg><span class="k-select__value"></span><span class="k-select__indicators"><button class="k-select__clear" type="button" aria-label="Clear region">…</button><svg class="k-select__chevron">…</svg></span><select aria-label="Region"><option value="">Choose a region</option>…</select></div>
```
- Sizes `k-select--3xs` 22 / `--2xs` 24 / `--xs` 26 / `--sm` 28 / default 32 / `--lg` 36 / `--xl` 40 / `--2xl` 44 / `--3xl` 48 (gutter 6–16, font 12–14, radius sm→xl, icon 14–20, chevron scaled). Weight `--k-select-weight` 500; `k-select--regular` 400. Variants outline (default, `--border-heavy`, hover `--border-hover`), `k-select--soft` (`--fill-secondary`), `k-select--ghost`, `k-select--pill`, `k-select--block`.
- States: `::before` fill/hairline ease `--duration-basic`, press scales .98; focus 2px `--focus-ring` on `::after`; chevron/clear .75→1; `data-placeholder` → `--ink-tertiary`; `aria-invalid` → `--danger`; disabled `--border-light`.
- Runtime `select` (native wrapper): writes option label into `k-select__value`, `data-placeholder` on empty, clear sets "" + fires `input`/`change`; `kube:change {value}`, `kube:clear`; API `sync()`. Custom triggers are opened by Menu/SelectMenu.

### SelectMenu — the listbox a select opens (inline or popup)
```html
<button class="k-select" type="button" id="tz"><span class="k-select__value">London</span><svg class="k-select__chevron">…</svg></button>
<div class="k-select-menu" data-kube="select-menu" data-kube-trigger="tz">
  <div class="k-menu__search"><svg>…</svg><input type="search" placeholder="Search time zones" aria-label="Search time zones"></div>
  <div class="k-select-menu__options" role="listbox" aria-labelledby="tz-label">
    <div class="k-select-menu__group" id="g-eu" role="presentation">Europe</div>
    <div role="group" aria-labelledby="g-eu">
      <div class="k-select-menu__option" role="option" aria-selected="true"><span>London</span><svg class="k-select-menu__check">…</svg></div>
      <div class="k-select-menu__option" role="option" aria-selected="false" aria-disabled="true"><span>Berlin</span><svg class="k-select-menu__check">…</svg></div>
    </div>
    <div class="k-select-menu__empty" hidden>No time zones match</div>
  </div>
  <div class="k-select-menu__actions"><button class="k-select-menu__action" type="button"><svg>…</svg>Add time zone</button></div>
</div>
```
- `k-select-menu`: opaque `surface-elevated`, `radius-2xl`, 0.5px `border`, `shadow-xl`, 13px; width = trigger (`--k-select-menu-width`), ≥300px (`--k-select-menu-min-width`), ≤400px tall (`--k-select-menu-max-height`). Parts `__options` (4px gutter), `__option` (5×8px, 12px corners, wraps), `__check` 16px (selected only, space reserved), `__group` (11px/600 uppercase), `__empty`, `__actions`/`__action` footer.
- States `data-highlighted` (`--fill-menu` .98→1), `aria-selected="true"` (check + 600), `aria-disabled` 50%.
- Runtime `select-menu`: `data-kube-trigger` id, `data-kube-side` bottom, `data-kube-align` start, `data-kube-offset` 8; open .3s `ease-enter`, close .2s; `aria-activedescendant`; arrows/Home/End/Enter/Space/typeahead/Escape; `kube:filter`, `kube:select {option, value, label, selected}` (writes label into trigger, closes); `aria-multiselectable="true"` toggles; API `open() close() highlight(option)`.

### SettingsPage — nav column + centered 48rem page of grouped rows
```html
<div class="k-settings-layout">
  <nav class="k-settings-nav" aria-label="Settings">…k-nav-row…</nav>
  <div class="k-settings-scroll"><div class="k-settings">
    <header class="k-settings__header"><h1 class="k-settings__title">General</h1><p class="k-settings__subtitle">Choose how the app looks.</p></header>
    <section class="k-settings-section">
      <div class="k-settings-section__header"><div class="k-settings-section__text"><h2 class="k-settings-section__title">Appearance</h2></div></div>
      <div class="k-settings-section__content">
        <div class="k-settings-group">
          <div class="k-settings-row">
            <div class="k-settings-row__text"><span class="k-settings-row__label">Theme</span><span class="k-settings-row__desc">Follow the system or pick one.</span></div>
            <div class="k-settings-row__control">…</div>
          </div>
        </div>
        <div class="k-settings-section__footer">…</div>
      </div>
    </section>
  </div></div>
</div>
```
- `k-settings-nav` 220px on `surface-under` (horizontal under 640px). `k-settings` ≤48rem, 20px padding, sections 40px apart (`--k-settings-gap`); `__header` title 28px/500, subtitle 14px/24px `ink-secondary`. Section header 46px (with `k-settings-section__subtitle` 13px → 16px title); `__content` 6px gap; `__footer` 12px/16px note.
- `k-settings-group`: 16px radius, 1px `border`, `fill-subtle`, dividers inset 16px; `k-settings-group--flat`. `k-settings-row` 12×16px, 24px gap, wraps; `__label` 13px/1.43/500 (`--featured` 14px, `--nested` normal weight); `__desc` 12px/16px `ink-secondary`; `__control` end-aligned (use `k-switch`, `k-select`, `k-btn k-btn--sm`). `k-settings-row--compact|--stacked|--empty`. `k-settings__bar` sticky save bar. `k-settings--compact` 42rem. One control per row; label controls explicitly.

### Sheet — modal panel sliding from bottom or side edge
```html
<button type="button" data-kube-open="#collect">Add to collection</button>
<dialog class="k-sheet" id="collect" data-kube="sheet" aria-labelledby="collect-title">
  <span class="k-sheet__grab" aria-hidden="true"></span>
  <div class="k-sheet__header"><h2 class="k-sheet__title" id="collect-title">Add to collection</h2><p class="k-sheet__subtitle">Choose one or more</p><button class="k-sheet__close" type="button" aria-label="Close" data-kube-close><svg>…</svg></button></div>
  <div class="k-sheet__body">…</div>
  <footer>…</footer>
</dialog>
```
- Grid header / scrolling body / footer; safe-area padding. `k-sheet` ≤448px bottom-docked (16px top corners), floats centered from 640px. `k-sheet--edge` (full window below 640, 40px corners), `k-sheet--image` (media sheet, `k-backdrop--media`), `k-sheet--side` (400px drawer at inline end, max 92vw). Backdrop `k-backdrop--blur` default. Slide in 0.6s `--ease-enter`, out 0.3s `--ease-exit`.
- Runtime `sheet`: everything from Dialog (options, events, `Kube.open/close`, `data-kube-open/close`). Drag to dismiss from `.k-sheet__grab` or `[data-kube-drag-handle]` (`data-dragging`, `--drag-y`/`--drag-x`; release past 30% or flick → close reason `drag`; `data-kube-dismissable="false"` shakes).

### Shimmer — band of light sweeping a status label/element
```html
<span class="k-shimmer" role="status">Thinking</span>
<span class="k-shimmer k-shimmer--strong" role="status">Searching 12 files</span>
<span class="k-shimmer-once k-shimmer-once--strong is-active" role="status"><span>Reading project notes</span><span class="k-shimmer-once__sweep" aria-hidden="true"><span class="k-shimmer-once__highlight">Reading project notes</span></span></span>
<span class="chip k-shimmer-mask">…</span>
```
- `k-shimmer`: text `--ink-tertiary` 55%, band `--surface` 75%, 2s loop (`--k-shimmer-duration`). `k-shimmer--strong`: base `--ink-secondary`, band `--ink` (use when the label carries information). `k-shimmer-once`: single 1s sweep, re-add `.is-active` or `Kube.replay(el)`; duplicate text in `__highlight`. `k-shimmer-mask`: 30% dim band across any element every 2.8s. One shimmer per view; reduced motion = plain text.

### ShortcutRecorder — set a shortcut by pressing it
```html
<div class="k-field">
  <label class="k-field__label" for="open-shortcut">Open the app</label>
  <button class="k-input k-shortcut" id="open-shortcut" type="button" data-kube="shortcut" data-kube-value="Alt+Space" data-kube-reserved="Alt+F4,Ctrl+W" data-kube-error="#open-shortcut-err" aria-describedby="open-shortcut-err"></button>
  <p class="k-field__error" id="open-shortcut-err" hidden></p>
</div>
```
- `k-input k-shortcut` on a button; generated `k-shortcut__keys` (`k-kbd` caps), `k-shortcut__placeholder`, `k-shortcut__pending`. `data-recording`: `--focus-ring` border pulsing glow; refusal → `--danger` + `aria-invalid`.
- Runtime `shortcut`: click/Enter/Space records; needs Ctrl/Alt/Cmd-Win (`data-kube-modifier="false"` allows bare); Esc cancels, Backspace/Delete clears; keys by `KeyboardEvent.code`; options `data-kube-value`, `data-kube-reserved`, `data-kube-error`, `data-kube-placeholder`, `data-kube-empty`, `data-kube-modifier-text`, `data-kube-reserved-text`; events `kube:change {value, previous}` (cancelable), `kube:invalid {combo, reason}`; API `value recording record() cancel() clear()`.

### Sidebar — resizable navigation column with collapsible sections and peek
```html
<nav class="k-sidebar" id="sidebar" data-kube="sidebar" data-kube-key="app:sidebar-width" data-state="open" aria-label="Main">
  <div class="k-sidebar__inner" data-kube="nav-list">
    <div class="k-sidebar__toolbar">…</div>
    <div class="k-sidebar__header"><a class="k-nav-row" href="#" aria-current="page">…</a></div>
    <div class="k-sidebar__scroll">
      <section class="k-nav-section" data-kube="nav-section">
        <div class="k-nav-section__title">
          <button class="k-nav-section__toggle" type="button" aria-expanded="true"><span class="k-nav-section__label">Recent</span><svg class="k-nav-section__chevron">…</svg></button>
          <div class="k-nav-section__actions"><button class="k-nav-action" aria-label="Add">…</button></div>
        </div>
        <div class="k-nav-section__body"><div class="k-nav-list">…rows…</div></div>
      </section>
    </div>
    <div class="k-sidebar__footer">…</div>
  </div>
  <div class="k-resizer k-resizer--end" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize sidebar"></div>
</nav>
<button class="k-toolbar__btn" data-kube-toggle="#sidebar" data-kube-peek="#sidebar" aria-label="Toggle sidebar">…</button>
```
- Width `clamp(240px, var(--sidebar-width, var(--sidebar)), min(520px, 100vw − 240px))`; runtime default 340px. `k-sidebar__inner` keeps full width while animating. Parts: `__toolbar` 46px, `__header` (`data-scrolled` hairline), `__scroll`, `__footer` (+`k-sidebar__card`), `k-nav-section__title` 30px `ink-tertiary`, `__toggle`, `__label`, `__chevron`, `__actions` (hidden until hover), `__body` (grid-rows 1fr→0fr + opacity .3s `--ease-enter`), `k-resizer` (16px hit, `border-heavy` line).
- Runtime `sidebar`: spring 0.3s bounce 0.1; collapsed = `inert`; resize by drag/arrows (10px)/Home/End/double-click; stores px under `data-kube-key` (+`:open`); drawer under `data-kube-breakpoint` (768) with scrim; peek via `[data-kube-peek="#id"]` (floating popover, settles when pinned). Options `data-kube-key`, `data-kube-default` 340, `data-kube-breakpoint` 768. Events `kube:open/close {source, drawer}`, `kube:peek {peeking}`, `kube:resize {width, final}`. API `open close toggle isOpen peek unpeek width() setWidth(px)`. States `data-state="open|collapsed"`, `data-shown`, `data-drawer`, `data-peek`, `data-settling`, `data-resizing`. `nav-section`: `data-kube-key`, `kube:toggle {expanded}`, API `expand collapse toggle`.

### Skeleton — placeholder shapes with sweep or pulse
```html
<div aria-busy="true" aria-label="Loading results">
  <span class="k-skeleton k-skeleton--thumb"></span>
  <div class="k-skeleton-lines"><span class="k-skeleton" style="width: 100%"></span><span class="k-skeleton" style="width: 78%"></span><span class="k-skeleton" style="width: 55%"></span></div>
</div>
<div class="card k-skeleton--pulse"></div>
<div class="k-placeholder" style="aspect-ratio: 4 / 3"></div>
<span class="k-loading-line" style="width: 90%"></span>
<span class="k-loading-line k-loading-line--pulse" style="width: 45%"></span>
```
- `k-skeleton` 14px (`--sm` 12, `--lg` 16), `--radius-md`, fill `--ink-tertiary` 10%, sweep 16% over 3s; `k-skeleton--thumb` 40×40 `--radius-lg`; `k-skeleton--fill` (+`--flush`); `k-skeleton-lines` column with staggered `--k-skeleton-delay`; `k-skeleton--pulse` (opacity 1→.86, 1.5s; `--k-skeleton-duration`).
- `k-placeholder` (`--k-placeholder-base`, `--k-placeholder-peak`, 3s breathe); `k-loading-line` (1lh, pill 72%, 2.2s sheen; `--pulse`, `--indeterminate`, `--k-loading-delay`). Set `aria-busy` on the region; 3–5 rows max; swap to content with `k-transition`.

### Slider — native range: default, pill, stepped pill, power slider, slider field
```html
<input type="range" class="k-slider" data-kube="slider" min="0" max="100" value="64" aria-label="Opacity">
<div class="k-slider-field" data-kube="slider" data-kube-unit="%" data-kube-reset="64">
  <div class="k-slider-field__header"><label for="opacity">Opacity</label><button class="k-slider-field__reset" type="button" aria-label="Reset to default"><svg>…</svg></button><span class="k-slider-field__value"><input type="text" inputmode="decimal" value="64" aria-label="Opacity value"><span class="k-slider-field__unit">%</span></span></div>
  <input type="range" class="k-slider" id="opacity" min="0" max="100" value="64">
  <div class="k-slider__marks" aria-hidden="true"><span data-value="0">0</span><span data-value="50">50</span><span data-value="100">100</span></div>
</div>
<input type="range" class="k-slider k-slider--pill" data-kube="slider" aria-label="Zoom">
<input type="range" class="k-slider k-slider--pill k-slider--stepped" data-kube="slider" min="1" max="5" step="1" aria-label="Effort">
<div class="k-power-slider" data-kube="slider" data-kube-labels="Minimal, Low, Medium, High, Max"><input type="range" min="0" max="4" step="1" value="2" aria-label="Effort"></div>
```
- Default: 4px `--border-heavy` track, `--ink-tertiary` fill (`--k-slider-value` set by runtime), 14px thumb (`--k-slider-thumb`). `k-slider--pill` 24px `--fill-secondary` rail, 20px `--track-thumb` thumb; `k-slider--stepped` dots (`--k-slider-steps`). `k-slider-field__header/__reset/__value/__unit`, `k-slider__marks[data-value]`. `k-power-slider`: 24px track, `--accent` fill, ticks, 28px thumb, springs `--k-spring-grow`/`--k-spring-release`.
- Runtime `slider`: `data-kube-unit`, `data-kube-labels`, `data-kube-reset`; value box typing/arrows/commit; power wheel steps; `kube:change {value}`; API `value setValue(v) refresh()`. ≤7 steps for stepped/power.

### Source — citation chips with favicon
```html
<div class="k-sources">
  <a class="k-source" href="…"><span class="k-favicon k-favicon--sm"><img alt="" src="…"></span><span class="k-source__label">example.com</span></a>
  <button class="k-source" type="button" aria-expanded="false">+4 more</button>
</div>
```
- `.k-sources` wrapping 4px gap; `.k-source` 25px, `--radius-full`, `--fill-secondary`, 12px/18px `--ink-secondary`; hover/`aria-expanded` `--fill-hover`/`--ink`; `__label`, `__icon` 16px. `.k-favicon` round 32px (`--sm` 16, `--inline` 12), `--surface-sunken` fallback initial, inset `--border` ring.

### Spinner — spinner, loader, page loader for unknown-length work
```html
<svg class="k-spinner" viewBox="0 0 16 16" aria-hidden="true"><circle class="k-spinner__track" cx="8" cy="8" r="5.67"/><circle class="k-spinner__arc" cx="8" cy="8" r="5.67" pathLength="100"/></svg>
<span class="k-loader" role="status" aria-label="Loading"></span>
<div class="k-page-loader k-delay" role="status"><svg class="k-spinner">…</svg><span class="k-page-loader__label">Loading workspace</span></div>
```
- `k-spinner` 16px (`--sm` 12, `--lg` 20): quarter arc ticks round in 60 steps every 2s; keep viewBox/r/pathLength. `k-loader` 1em comet ring (`--k-loader-size`, `--k-loader-stroke` 2px, `--k-loader-duration` .8s). Both `currentColor`. `k-page-loader` + `k-delay` (hidden 400ms) or `k-delay--fade` (hidden `--k-delay` 1s then fades).
- `Kube.loading(el, promise|true|false, {region})`, `data-delay-state`, `kube:loading {state}`. Button spinners: `Kube.setLoading`. Known progress → Progress; known layout → Skeleton.

### SplitPane — side/bottom panel that takes space from the main column (spring)
```html
<div class="k-split">
  <div class="k-split__main">…</div>
  <aside class="k-side-panel" id="details" data-kube="side-panel" data-kube-key="app:details-width" data-state="closed" aria-label="Details" inert>
    <div class="k-side-panel__frame"><div class="k-toolbar k-toolbar--pane">…</div><div class="k-side-panel__body">…</div></div>
    <div class="k-resizer k-resizer--start" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize panel"></div>
  </aside>
</div>
<button class="k-toolbar__btn" data-kube-toggle="#details" aria-label="Details">…</button>
<div class="k-split k-split--vertical">
  <div class="k-split__main">…</div>
  <section class="k-bottom-panel" id="output" data-kube="bottom-panel" data-kube-key="app:output-height" data-state="closed" aria-label="Output" inert>
    <div class="k-resizer k-resizer--top" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize bottom panel"></div>
    <div class="k-bottom-panel__frame"><div class="k-toolbar k-toolbar--pane">…</div><div class="k-bottom-panel__body">…</div></div>
  </section>
</div>
```
- `k-split` flex row + inline-size container; `k-split__main` `flex:1; min-width:0`. Slot width = progress × size; `k-side-panel__frame` keeps full size (content never reflows). Size ≥320px, ≤max(320, split − 352); under 320px main → panel covers (`data-mode="full"`, `data-covering`). Frame: `surface`, 1px `border` start edge, `--shadow-panel-edge`. `k-split--inset` (4px gap, `--radius-xl`, `border-light` ring, `--shadow-card`). `k-pane__fade`.
- Runtime `side-panel`: spring 0.5s bounce 0.1; `data-kube-key`, `data-kube-default` 600, `data-kube-reserve` 352, `data-kube-titlebar-left/right`; `data-kube-toggle="#id"` triggers; drag handle (close under 160px, full past max), arrows 10px, Home/End, double-click reset; events `kube:open/close {source}`, `kube:resize {width, ratio, full, final}`; API `open close toggle isOpen width() setWidth(px)`; states `data-state`, `data-shown`, `data-mode`, `data-covering`, `data-resizing`. `bottom-panel` (`k-split--vertical`): height = progress × size, opacity follows; default 280px within max(160, min(size, 50%)); same API with `height()`. Without script toggle `data-state` (CSS `--k-shell-spring`, `--k-panel-w`).

### StatusPill — small rounded in-thread label for a background step, optional draining fill
```html
<span class="k-status-pill"><span class="k-status-pill__label">Queued</span></span>
<button class="k-status-pill" type="button" aria-label="Cancel scheduled send">
  <span class="k-status-pill__progress" style="--k-pill-duration: 12s"></span>
  <span class="k-status-pill__label">Sending soon</span>
  <span class="k-status-pill__hover">Cancel</span>
</button>
```
- Full radius, 2px/8px/10px padding, 13px/18px, ≤150px, `accent` 15% behind `ink`. Label and `__hover` share one grid cell. `__progress` `accent` 25% drains over `--k-pill-duration` (10s; negative `animation-delay` to resume). Tones `--success|--warning|--danger` (subtle fills). Button: hover → `fill-hover`, hover label replaces label, focus ring. Reduced motion: fill stays full.

### StickyHeader — pinned header with a hairline once content scrolls under
```html
<div style="max-height: 360px; overflow-y: auto"><header class="k-sticky-header" data-kube="sticky-header">Notes</header>…</div>
<header class="k-sticky-header k-sticky-header--fade">…</header>
<section class="k-sticky-section"><h3 class="k-sticky-section__heading">Today</h3>…</section>
```
- Hairline 1px `--border` on `::after` fades over first 8px of scroll (`scroll(nearest)`) or via `data-scrolled="true"` (150ms). Background `--surface` (`--k-sticky-bg`). `--fade`: gradient to transparent, no hairline. `k-sticky-section__heading` fades out over last `--k-sticky-heading-height` (32px). Header must be a direct child of the scroller.
- Runtime `sticky-header`: sets `data-scrolled` while `scrollTop > 0`; `data-kube-force`; `kube:scrolled {scrolled}`.

### Submenu — nested menu beside its trigger row
```html
<div class="k-menu__item k-menu__item--sub" role="menuitem" aria-haspopup="menu" aria-controls="sort-menu">
  <span class="k-menu__icon"><svg>…</svg></span><span class="k-menu__label">Sort by</span><svg class="k-menu__chevron" viewBox="0 0 16 16">…</svg>
</div>
<div class="k-menu k-submenu" id="sort-menu" role="menu" aria-label="Sort by">
  <div role="group" class="k-menu__group"><div class="k-menu__item" role="menuitemradio" aria-checked="true"><span class="k-menu__label">Name</span><svg class="k-menu__check">…</svg></div></div>
</div>
```
- Any row with `aria-haspopup="menu"` + `aria-controls` inside a `menu`/`context-menu` tree. `k-menu__chevron` 14px (RTL mirrored); `k-submenu` ≥180px. Trigger `data-state="open"` + `aria-expanded`; submenu `data-state`, `data-side`. Placed 4px past the parent edge, first row aligned; flips left; hover intent 100ms, safe-triangle grace 300ms; ArrowRight/Enter/Space open, ArrowLeft closes level, Escape closes all. Events `kube:open/close {trigger}`. Render at end of body, not inside the parent; ≤2 levels.

### SuggestionCard — starter prompt cards in a snapping row
```html
<div class="k-suggestion-list" data-kube="suggestion-list" data-kube-remember="home-suggestions">
  <div data-id="weekly">
    <button class="k-suggestion k-suggestion--illustrated" type="button">
      <span class="k-suggestion__top"><span class="k-suggestion__icon"><svg>…</svg></span></span>
      <span class="k-suggestion__text"><span class="k-suggestion__label">Draft a weekly update</span><span class="k-suggestion__description">Turn this week's notes into a status email.</span></span>
    </button>
    <button class="k-suggestion__dismiss" aria-label="Dismiss Draft a weekly update"><svg>…</svg></button>
  </div>
</div>
```
- Card `surface`, 0.5px `border-heavy` ring + `shadow-md`, hover ink 5%, press .98. Compact ≥104px `radius-2xl` 12×16px (`__kbd` optional); `k-suggestion--illustrated` 150px `radius-3xl`, 40px icon tile. `__dismiss` 28px ghost inset 10px, on hover/focus. `k-suggestion-list` 16px gap, snap, 12px bleed; `k-suggestion-list--chat`.
- Runtime `suggestion-list`: `kube:suggest {text, item}`, `kube:dismiss {text, item, id}` (cancelable, folds card 150ms); `data-kube-remember="key"` persists dismissed `data-id`s; API `reset()`. 3–4 cards.

### SuggestionMenu — inline autocomplete list for mentions/commands driven from a field
```html
<div class="k-suggest">
  <div class="k-suggest__header">Mention a file or person</div>
  <div class="k-suggest__list k-scroll-fade" data-kube="scroll-fade" id="mentions" role="listbox" aria-label="Suggestions">
    <div class="k-suggest__section" role="presentation">Files</div>
    <div class="k-suggest__item" role="option"><span class="k-menu__icon"><svg>…</svg></span><span class="k-menu__label">design-notes.md</span><span class="k-menu__shortcut">docs/</span></div>
    <div class="k-suggest__empty" hidden>No matches</div>
  </div>
</div>
<input data-kube="suggestion-menu" aria-controls="mentions" aria-label="Message">
```
- `k-suggest` opaque `surface-elevated`, 1px `border`, `radius-2xl`, 4px padding, 13px, ≤330px (`--k-suggest-max-height`); `__header` 32px sticky, `__list`, `__section`, `__item` (5×8px, `radius-xl`, 75% opacity; `data-highlighted`/`aria-selected` → `--fill-menu` full), `__empty`.
- Runtime `suggestion-menu` on the field: `aria-controls`, `data-kube-trigger` "@"; query = text between trigger and caret; `kube:filter {query, list}`; arrows wrap, Enter/Tab insert, Escape closes; `kube:select {item, value, label, query}`; API `refresh() close()`.

### Switch — checkbox with `role="switch"` drawn as pill + thumb
```html
<input type="checkbox" role="switch" class="k-switch" aria-label="Send notifications">
<label class="k-switch-item k-switch-item--end"><input type="checkbox" role="switch" class="k-switch" checked> Send notifications</label>
```
- Default 32×20 track, 16px thumb, 2px inset; `k-switch--sm` 28×16/12px; `k-switch--menu` 32×19/13px/3px inset (inside menu rows). Off track `--ink` 10%, on `--accent`; `k-switch--neutral` (`--ink` on, `--surface` thumb). Thumb white + `--shadow-sm`. Thumb slides `--duration-basic` `cubic-bezier(0,0,.2,1)` (menu: .25s `--ease-move`). Disabled .6; focus ring offset 0; RTL mirrored. Use for settings that apply immediately; Checkbox when a Save button exists.

### Table — data rows with hairlines, tabular figures, own horizontal scroller
```html
<div class="k-table-block" data-kube="table">
  <div class="k-block-actions">
    <button class="k-block-actions__btn" type="button" aria-label="Copy table" data-table-copy>…</button>
    <button class="k-block-actions__btn" type="button" aria-label="Expand table" data-table-expand>…</button>
  </div>
  <div class="k-table-scroll k-scroll-fade k-scroll-fade--x" data-kube="scroll-fade" aria-label="Traffic by region">
    <table class="k-table">
      <thead><tr><th>Region</th><th class="k-table__num">Requests</th></tr></thead>
      <tbody><tr><td>North</td><td class="k-table__num">1,284,020</td></tr></tbody>
    </table>
  </div>
</div>
```
- `.k-table-scroll` horizontal scroller (wrap every table). `.k-table` ≥container width, `fit-content`, tabular nums; cells 10px/8px padding, 1px `--border`; header 600 with `--border-heavy`; outer cells lose outer padding. No row hover.
- Variants: `k-table__num` (end-aligned, no wrap, ≥3ch+24px), `k-table__muted`, `k-table--fixed`, `k-table--sticky` (header sticks; give scroller `max-height`; `--k-table-bg`), `k-table__row-label` + `k-table__row-label-content` (group heading row), `k-table--sticky-col`, `k-table__empty`, `k-table-frame` (bordered panel `--radius-2xl`).
- Runtime `table`: while overflowing the scroller gets `data-overflowing="true"`, `role="region"`, `tabindex="0"`, `aria-label` (`data-kube-label`); ArrowLeft/Right 40px, Alt+arrow a viewport; `[data-table-copy]` (Markdown + HTML, 2s copied state), `[data-table-expand]` → `Kube.previewBlock` (`data-kube-preview-label`); `kube:overflow`; API `update()`, `markdown()`. `.k-block-actions` pill of 36px `.k-block-actions__btn`, shown on hover/focus/`data-visible="true"`, always on touch. No sort.

### Tabs — 28px window tab strip with close buttons and separators
```html
<div class="k-tabs" role="tablist" aria-label="Open items" data-kube="tabs">
  <div class="k-tab k-tab--leading"><button class="k-tab__btn" role="tab" aria-selected="false" aria-label="Home">…</button></div>
  <div class="k-tab">
    <button class="k-tab__btn" role="tab" aria-selected="true"><span class="k-tab__icon"><svg>…</svg></span><span class="k-tab__label">Quarterly budget review</span></button>
    <button class="k-tab__close" type="button" tabindex="-1" aria-label="Close Quarterly budget review tab"><svg>…</svg></button>
  </div>
</div>
```
- `k-tabs` 46px strip, scrolls, drag region. `k-tab` 28px, `flex: 0 1 156px`, 90–240px, `--radius-md` fill ink 5% on hover/selected; `k-tab__btn` 13px `ink-secondary` → `ink` when `aria-selected="true"`; `k-tab__label` fades last 24px; `k-tab__close` 20px on hover/focus/selected (hidden under 4rem); separator 1×12px. `k-tab--leading` (fixed icon tab), `k-tab--preview` (italic).
- Runtime `tabs`: selection follows focus (arrows wrap, Home/End); `aria-controls` panels shown/hidden; close via button, middle click, Delete (width → 0 over 0.2s); `add(tab, {select})` grows in; pointer reorder (6px activation) and keyboard reorder (Space/Enter pick up) unless `data-kube-reorder="false"`; rename on double-click/F2 with `data-kube-rename` (strip) or `data-kube-renamable` (tab); add `k-scroll-fade k-scroll-fade--x` + `data-kube="tabs scroll-fade"` for edge fades. Events `kube:select {tab, index}`, `kube:close` (cancelable), `kube:reorder {from, to}`, `kube:rename {value, previous}`. API `select(tabOrIndex) close(tab) add(tab, {select}) rename(tab) tabs()`.

### TagInput — Input holding removable chips
```html
<div class="k-input k-tag-input" data-kube="tag-input">
  <span class="k-tag-input__tag" data-value="design"><span class="k-tag-input__value">design</span></span>
  <input placeholder="Add a label" aria-label="Labels">
</div>
```
- Wraps, min-height = control, inner spacing 6px (4px ≤sm, 8px ≥xl); focus inside → `--focus-ring` hairline. `k-tag-input__tag` `--radius-md`, `--fill-secondary`, `--ink-secondary`; `k-tag-input__remove` 14px (added by runtime, `aria-label="Remove <value>"`). Field `field-sizing: content`.
- Runtime `tag-input`: Enter or `,` adds; paste splits; `data-kube-unique="false"` allows duplicates; Backspace/ArrowLeft at start focuses last chip; arrows between chips; events `kube:add {value}`, `kube:remove {value}` (cancelable), `kube:change {values}`; API `values add(text) remove(value)`.

### TaskCheckbox — to-do row with round 20px checkbox (CSS only)
```html
<label class="k-task k-task--strike"><input type="checkbox" class="k-checkbox"><span class="k-task__label">Send the agenda</span></label>
```
- `k-task` row, whole row is the hit target; `k-checkbox` inside becomes 20px circle; `k-task__label` 16px/26px, 10px from box; `k-task--strike` strikes + `--ink-secondary` when checked.

### Terminal — themed embedded terminal / live command log
```html
<div class="k-terminal k-terminal--framed" data-kube="terminal" style="height: 260px">
  <div class="k-terminal__viewport k-scroll-fade k-scroll-fade--top" data-kube="scroll-fade">
    <div class="k-terminal__screen">
      <div class="k-terminal__line k-terminal__command" data-exit="0"><span class="k-terminal__prompt">~/app $</span> npm test</div>
      <div class="k-terminal__line"><span class="ansi-green-fg">✓</span> 22 passed</div>
      <div class="k-terminal__line"><span class="k-terminal__cursor"></span></div>
    </div>
  </div>
  <button class="k-terminal__jump" type="button"><svg aria-hidden="true">…</svg>Jump to bottom</button>
</div>
```
- `.k-terminal` on `--k-term-bg`/`--k-term-fg`; `--framed` 1px `--k-term-border` + `--radius-xl`; give it a height. `__viewport` (padding `--k-term-padding` 12px, scrollbar `--k-term-scrollbar`), `__screen` (mono 12px `--k-term-font-size`, 1.2 `--k-term-line-height`, tab 8, wraps), `__line`, `__prompt` (`--k-term-bright-black`), `__command[data-exit]` (dot `--k-term-mark`, `-success`, `-error`), `__cursor` (2px bar, blink 1s; `--block`, `--underline`; `data-cursor="hidden"`), selection `--k-term-selection(-inactive)`, `__jump` (28px pill, `data-following="false"` shows, `data-new` dot).
- Colors `--k-term-{black,red,green,yellow,blue,magenta,cyan,white}` + `--k-term-bright-*`, 4.5:1 on `surface`/`surface-sunken` in both themes; painted by the `ansi-*` classes.
- Runtime `terminal`: follows output while at end; `role="log"`, `tabindex="0"`, `aria-label` (`data-kube-label`); creates jump button (`data-kube-jump-label`); raw text parsed as ANSI (`data-kube-escapes`, `data-kube-links`); API `write(text) writeln(text) clear() scrollToBottom(smooth) isFollowing()`; `data-kube-scrollback` 5000; `kube:follow {following}`. Map an emulator's theme to the `--k-term-*` variables.

### Textarea — multi-line field sharing Input's hairline and sizes
```html
<textarea class="k-textarea" placeholder="Describe the change" aria-label="Description"></textarea>
<textarea class="k-textarea k-textarea--auto" style="--k-textarea-min-rows: 1"></textarea>
<div class="k-textarea"><textarea aria-label="Notes"></textarea></div>
```
- Line `--k-textarea-line` 20px; rows `--k-textarea-min-rows` (3) to `--k-textarea-max-rows` (10) then scrolls; size modifiers `k-textarea--3xs…--3xl`; `k-textarea--auto` (`field-sizing: content`); `k-textarea--resize`; `k-textarea--soft`. States as Input.
- Runtime `autogrow`: measures where `field-sizing` is missing (`data-kube-native="false"` forces script); API `fit()`.

### Thread — conversation pane: centered 48rem column + docked composer
```html
<div class="k-thread" data-kube="thread">
  <div class="k-thread__scroll"><div class="k-thread__column">
    <div class="k-thread__divider">Today</div>
    <div class="k-message k-message--user">…</div>
    <div class="k-message k-message--assistant">…</div>
  </div></div>
  <button class="k-thread__jump" aria-label="Jump to latest" data-state="hidden"><svg>…</svg></button>
  <div class="k-thread__dock"><div class="k-composer">…</div></div>
</div>
```
- `k-thread` flex column on `surface` (give height); `__scroll` (`overscroll-behavior: contain`); `__column` ≤48rem + 16px gutters, 24px top/bottom (turn gaps 12px, 32px on speaker change, 4px same speaker); `__dock` same width, 16px from bottom; `k-thread--narrow` 42rem, `k-thread--compact` 40rem; `__divider` 12px `ink-tertiary` between rules; `__jump` 32px `surface` disc (`data-state="hidden|visible"`); `k-thread__unread`.
- Runtime `thread`: follows bottom within 96px; new `k-message` get `data-enter`; swipe reveals `k-message__timestamp`; `kube:follow {following}`; API `scrollToLatest(smooth) isFollowing() setTyping(on)`. `Kube.sendMorph(from, turn, options)` flies the sent bubble from the composer.

### Timeline — time column, rail with dots, events
```html
<ol class="k-timeline">
  <li class="k-timeline__item k-timeline__item--current">
    <time class="k-timeline__time" datetime="2026-10-18T09:42">09:42</time>
    <span class="k-timeline__rail" aria-hidden="true"><span class="k-timeline__dot"></span></span>
    <div class="k-timeline__content"><div class="k-timeline__title">Draft shared with the team</div><div class="k-timeline__desc">Three reviewers were added.</div></div>
  </li>
</ol>
```
- `k-timeline__item` grid `68px | 1px | 1fr` (`--k-timeline-time`), 12px gap. `__time` 11px tabular `ink-tertiary`; `__rail` two 1px `border` segments (0–17px, 27px–end; none above first/below last); `__dot` 6px at 19px `ink-tertiary` (`--k-timeline-dot`); `k-timeline__item--current` `accent` dot + 3px `accent-subtle` halo; `__content` padding 12px 4px 34px 0; `__title` 500, `__desc` 13px/18px `ink-secondary`. `k-timeline__item--gap-before` / `--gap-after` dashed segments. Use `<ol>` + `<time datetime>`; status in text, not dot color only.

### TitleBar — 44px window title bar / drag region
```html
<header class="k-titlebar">
  <div class="k-titlebar__lights" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="k-titlebar__group"><button class="k-toolbar__btn" type="button" aria-label="Toggle sidebar"><svg>…</svg></button></div>
  <div class="k-titlebar__title">Quarterly budget review</div>
  <div class="k-titlebar__group">…</div>
</header>
```
- `k-titlebar` 44px (or OS overlay height), 8px insets/gap, 13px `ink-secondary`, drag region, no selection; `__title` centered 510 truncating; `__group` 4px-gap cluster of `k-toolbar__btn`; `__lights` placeholder for native controls (remove when the OS draws them). `k-titlebar--sm` 36px menu bar (use `k-toolbar__btn--label`). Interactive children excluded from drag automatically; pad for native controls on frameless windows. Keep on `surface-under`, no fill.

### Toast — brief top-center notice (script-created `k-alert k-toast`)
```js
Kube.toast({ title: "Changes saved", tone: "success" });
Kube.toast({ title: "Upload failed", description: "The file is larger than 20 MB.", tone: "danger" });
var t = Kube.toast({ title: "Message archived", action: { label: "Undo", onClick: function (e, toast) {} } });
t.update({ title: "Archived" }); t.dismiss();
```
```html
<ol class="k-toaster" data-kube="toaster" aria-live="polite" aria-label="Notifications">
  <li class="k-alert k-toast k-alert--success" role="status" data-state="open">
    <div class="k-alert__row">
      <span class="k-alert__icon"><svg>…</svg></span>
      <div class="k-alert__content"><div class="k-alert__title">Changes saved</div><div class="k-alert__description">Optional detail.</div></div>
      <div class="k-alert__actions"><button class="k-btn k-btn--sm">Undo</button></div>
      <button class="k-alert__close" type="button" aria-label="Close"><svg>…</svg></button>
    </div>
  </li>
</ol>
```
- Options: `title`, `description`, `tone` info|success|warning|danger|inverse, `action {label, onClick}` (preventDefault keeps toast), `duration` (0 = until closed), `id` (replace in place), `icon: false`, `dismissible: false`. Returns `{ id, el, update(opts), dismiss() }`. First call creates the region at end of body (place your own `data-kube="toaster"` element to control position).
- Levels: default `surface-elevated` + `border`; `k-alert--success|warning|danger` subtle fill (danger → `role="alert"`); `k-alert--inverse` `primary`. Region fixed 48px from top, z 60; toast `radius-xl`, 8×12px, 14px/1.4, max-content width. Stack: newest front, two behind 8px lower and 5% smaller, fourth fades; expands on hover/focus.
- Motion: enter from `translate: 0 -100%` + fade .3s; exit reverse; swipe right past 45px or 0.11px/ms dismisses. Auto-dismiss only success without action (5s); timers pause while expanded or window blurred. Events `kube:toast {id, el}` (region), `kube:dismiss {id, reason}` (toast; close|action|timeout|swipe|api). Give repeated events an `id`.

### Toolbar — 46px pane-top bar with title, spacer, quiet buttons
```html
<div class="k-toolbar">
  <span class="k-toolbar__title">Quarterly budget review</span>
  <span class="k-toolbar__spacer"></span>
  <button class="k-toolbar__btn k-toolbar__btn--label" type="button"><svg>…</svg>Share</button>
  <span class="k-toolbar__sep" aria-hidden="true"></span>
  <button class="k-toolbar__btn" type="button" aria-label="Toggle panel" aria-pressed="false"><svg>…</svg></button>
</div>
```
- `k-toolbar` `--toolbar` 46px, 16px side padding, 8px gap, drag region (buttons excluded). `__title` 14px/500 `ink`; `__spacer`; `__group` 4px gap; `__sep` 1×16px `border`; `__btn` 28px square `--radius-lg` `ink-tertiary` 16px icon (hover / `aria-expanded` / `aria-pressed` / `data-state="open"` → `fill-secondary` + `ink`; disabled 40%); `__btn--label` icon + 13px/510 text. `k-toolbar--sm` 36px; `k-toolbar--pane` 40px (`surface`, `border-light` bottom, not draggable; side panels); `k-toolbar--split` 3-column grid. No primary buttons in a toolbar.

### ToolbarButton — 28px quiet button as a Button variant
```html
<div role="toolbar" aria-label="Document">
  <button class="k-btn k-btn--toolbar k-btn--icon" aria-label="Sidebar" aria-pressed="true" data-kube="tooltip press" data-kube-kbd="Ctrl B"><svg>…</svg></button>
  <button class="k-btn k-btn--toolbar"><svg>…</svg>Share</button>
  <button class="k-btn k-btn--toolbar k-btn--icon" aria-label="More" aria-haspopup="menu" aria-expanded="false">…</button>
</div>
```
- `k-btn--toolbar`: `control-sm` 28px, padding `space-2`, 16px icons, 13px/18px label, gap `space-1`, `radius-lg`; `k-btn--icon` square. Hover wash keeps `ink-tertiary`; pressed (`aria-pressed`/`data-state="on"`) full wash + `ink`; open 60%; disabled 40%; `-webkit-app-region: no-drag`. Runtime: `tooltip` (+`data-kube-kbd`), `press`, `Kube.setLoading`.

### Tooltip — short label on hover/focus with optional shortcut chip
```html
<button type="button" aria-label="Copy link" data-kube="tooltip">…</button>
<button type="button" data-kube="tooltip" data-kube-tooltip="Start fresh" data-kube-kbd="Ctrl N">New chat</button>
<div class="k-tooltip" role="tooltip"><div class="k-tooltip__row"><span class="k-tooltip__label">New chat</span><kbd class="k-tooltip__kbd">Ctrl N</kbd></div></div>
```
- Default 5×12px, 13px/18px weight 430, `radius-2xl`, ≤320px; `k-tooltip--sm` 4×8, `k-tooltip--lg` 8×16, `k-tooltip--start`. Parts `__kbd` (25% `on-tooltip`), `__secondary`/`__tertiary`, `k-tooltip-wrap` + `k-tooltip__caret` (`data-side="bottom"`), `k-tooltip--interactive`, `k-tooltip-trigger` (dotted underline while open). Colors `tooltip-bg`/`on-tooltip`.
- Runtime `tooltip` on the trigger: `data-kube-tooltip` (fallback `data-kube-text` unless `copy`, then `aria-label`; `title` is moved), `data-kube-kbd`, `data-kube-side` top, `data-kube-align` center, `data-kube-offset` 5, `data-kube-delay` 200, `data-kube-size` sm|lg. 200ms delay, 300ms skip window, instant on `:focus-visible`, never on touch, no animation; closes on leave/blur/click/right-click/Escape/window blur; hidden while `aria-expanded="true"` or disabled; sets `aria-describedby` and `data-state="delayed-open|instant-open|closed"`. API `show() hide()`, `Kube.hideTooltip()`. One shared bubble, manual popover (above dialogs).

### Transitions — shared enter/exit/reveal/resize motions and streaming settle effects
```html
<div class="k-transition">…</div>
<div class="k-transition k-transition--rise">…</div>
<div data-kube="transition" data-kube-stagger="40">…</div>
<span class="k-presence" data-hidden>3 new</span>
<div class="k-slide-in" data-state="open">…</div>
<details class="k-disclosure" data-kube="disclosure"><summary>Show details</summary>…</details>
<div class="k-height" data-kube="height"><div class="inner">…</div></div>
<span class="k-stream-word">word </span><span class="k-stream-word k-stream-word--accent">word </span>
<span class="badge k-pop">Done</span>
<span class="k-accent-settle">42 passed</span><span class="badge k-badge-settle">Draft</span>
<mark class="k-highlight k-highlight--sweep">marked for review</mark>
<div class="row k-entrance">…</div>
<span class="k-flash" data-kube="flash">$4,100.00</span>
<svg class="k-glow">…</svg>
```
- `k-transition`: opacity in 400ms ease / out 200ms; `--k-from-opacity`, `--k-from-transform`, `--k-enter-delay`. `k-transition--rise`: + translateY(`--space-2`), in 500ms `--ease-enter`, out 300ms `--ease-exit` (`--k-enter-*`/`--k-exit-*`). `k-presence` opacity `--duration-basic` (`[data-hidden]`). `k-slide-in` .25s `--ease-enter` in / .2s out (`data-state="open|closed"`). `k-height` height `--duration-relaxed` `--ease-enter-snappy` (`[data-height-ready]`). `k-disclosure` `::details-content` `--duration-relaxed`. `k-stream-word` .7s (`--accent`: `--k-stream-accent`). `k-accent-settle` .7s; `k-badge-settle` .2s + .28s; `k-badge-enter` .7s. `k-highlight` (`--k-highlight-color` `--accent-subtle`; `--sweep` .95s). `k-entrance` diagonal wipe .42s. `k-pop` from .7 over .52s. `k-flash[data-flash]` 3s `--accent-subtle`. `k-glow` two currentColor drop shadows.
- Runtime: `Kube.enter(el|list, {delay, stagger})`, `Kube.exit(el|list, {remove})`, `data-kube="transition"` (+`data-kube-stagger`), `data-kube="height"`, `data-kube="disclosure"` (`data-kube-force`), `Kube.replay(el)`, `Kube.flash(el, ms)`, `data-kube="flash"` (`data-kube-duration` 3000, `kube:flash {value}`). Stagger lists by 40ms, ≤5 steps; don't combine `k-pop` with `k-transition`; `Kube.exit` sets `inert`.

### TypingIndicator — three dots hopping in a stepped wave
```html
<span class="k-typing" role="status" aria-label="Responding"><span class="k-typing__dot"></span><span class="k-typing__dot"></span><span class="k-typing__dot"></span></span>
```
- 4px dots, currentColor 70%, 4px apart, 20px line; 1s `steps(3, end)` cycle with .1s/.2s offsets. `k-typing--lg` 6px dots; `k-typing__label` 13px `ink-tertiary` word. No runtime (Thread `setTyping(true)` inserts one). Reduced motion: still.

### Typography — the 31 type-style classes
```html
<h1 class="k-heading-app">Projects</h1>
<p class="k-body">Changes are saved as you type.</p>
<span class="k-small-caps-md">Recent</span>
```
- Headings `k-heading-app` (28px, once per screen), `k-heading-lg|md|sm`, display `k-heading-xl…5xl`, `k-card-title`. Text `k-body` 14 (default), `k-body-lg` 16, `k-control-label` 13/510, `k-caption` 12, `k-micro` 11/590. Titles `k-title-xs…lg`. Body scale `k-text-3xs…lg`. Captions `k-text-caption-sm|md|lg`. `k-small-caps-md|lg`. `k-code` 13px mono. Set color separately; never stack two type classes; add `text-wrap: balance` on free headings; don't mix with `k-prose`. (Metrics in §1 Type.)

### UnreadDivider — labelled rule before the first unread message
```html
<div class="k-thread__unread" role="separator" aria-label="2 unread messages"><span>2 unread</span></div>
```
- 12px/16px/500 `ink-secondary`, two 1px rules (ink 14%) 8px from the label; 8px above/12px below in a thread column. Insert once; remove after reading. Dates use `k-thread__divider`.

### VideoEmbed — 16:9 media frame with poster, play, duration badge, controls bar
```html
<div class="k-video" data-kube="video">
  <video src="clip.mp4" preload="metadata" playsinline aria-label="Product walkthrough"></video>
  <img class="k-video__poster" src="poster.jpg" alt="">
  <button class="k-video__play" type="button" data-media="play" aria-label="Play"><span><svg>…</svg></span></button>
  <span class="k-video__badge"><svg>…</svg><span data-media="duration">0:00</span></span>
  <div class="k-video__controls">
    <button class="k-video__btn" type="button" data-media="play" aria-label="Play"><svg data-icon="play">…</svg><svg data-icon="pause">…</svg></button>
    <span class="k-media-time" data-media="current">0:00</span>
    <div class="k-scrubber" aria-label="Seek"><span class="k-scrubber__rail"></span><span class="k-scrubber__preview"></span><span class="k-scrubber__fill"></span></div>
    <span class="k-media-time" data-media="duration">0:00</span>
    <button class="k-video__btn" type="button" data-media="mute" aria-label="Mute"><svg data-icon="mute">…</svg><svg data-icon="unmute">…</svg></button>
    <button class="k-video__btn k-video__btn--wide" type="button" data-media="fullscreen" aria-label="Full screen"><svg>…</svg></button>
  </div>
</div>
```
- `k-video` ratio `--k-video-ratio` 16/9, `radius-md`, `surface-sunken`, ink 6% hairline; `__poster` scale 1.01; `__play` 56px disc black 40% + blur; `__badge` 24px pill (`k-video--compact` 20px); `__controls` bottom bar over 60% black gradient, 32px `__btn` (`--wide` drops under 480px); chrome white on black (`--media-fg`/`--media-bg`).
- Runtime `video`: `[data-media]` play/current/duration/remaining/skip/speed/mute/fullscreen; `data-state` idle|playing|paused, `data-muted`; `data-icon` swaps; seek slider keyboard (`data-kube-step` 5s); events `kube:play/pause/seek/error`; API `play() pause() toggle() seek(s) media`; iframe embed: play reveals (`k-video--click-through`). Link-out card: `a.k-video` with poster + badge.

### WideBlock — diagram/visualization breaking out of the reading column
```html
<figure class="k-wide-block k-wide-block--framed" aria-label="Request path diagram"><div class="k-wide-block__canvas"><svg viewBox="0 0 720 180" role="img" aria-label="…">…</svg></div></figure>
<div class="k-wide-block"><div class="k-skeleton k-wide-block__placeholder" role="status" aria-label="Loading diagram"></div><p class="k-wide-block__status">Loading diagram</p></div>
```
- Width `max(100%, min(--k-prose-wide-max + 8rem, 100vw − 32px))` (72rem default), centered, `flow-root`; `__canvas` caps at `--k-wide-block-max-height` (80vh), scales svg/img/canvas/video; `k-wide-block--framed` (1px `--border-light`, `--radius-lg`); `__placeholder` 16:9 ≥240px; `__status` 13px. CSS only; full-size view via `Kube.previewBlock`. Don't nest in a card or table cell.

### WorkflowSteps — collapsible record of steps with status dots on a connecting line
```html
<div class="k-steps" data-kube="steps" data-expanded="false">
  <div class="k-steps__header">
    <button class="k-steps__title" type="button"><span class="k-steps__title-text">Worked through 4 steps</span><svg class="k-steps__chevron" aria-hidden="true">…</svg></button>
    <button class="k-steps__sources" type="button"><svg aria-hidden="true">…</svg>3 sources</button>
  </div>
  <div class="k-steps__body"><div class="k-steps__inner"><ol class="k-steps__list">
    <li class="k-steps__entry" data-status="done"><span class="k-steps__indicator" aria-hidden="true"></span><span class="k-steps__text">Read the meeting notes</span></li>
  </ol></div></div>
</div>
```
- Header: `__title` 14px/20px `ink-secondary` (hover `ink`) with 16px `__chevron` (90° when open); `__sources` 13px. Open adds a 1px `border` rule. Entries 13px/20px `ink-secondary`; `__indicator` 6px dot + 1px `border` line to the next entry. `data-status`: `done` (`ink-tertiary`), `running` (`accent`, pulsing 1.2s, text `ink`), `pending` (hollow ring), `error` (`danger`). `data-streaming` on root fades new entries in from 6px above.
- Runtime `steps`: title toggles `data-expanded`/`aria-expanded` (rows 0fr→1fr 300ms `--ease-move`; collapsed body `inert`); `kube:steps-toggle {expanded}`; API `toggle(force)`, `add(text, status) → entry`, `setStatus(entry, status)`.

## 4. Icons (dist/icons/kube-icons.svg)

- 1,866 `<symbol id="…">` Lucide outlines, 24-unit grid, stroke 2 (ISC/MIT, `LICENSE-lucide.txt`). Usage: `<svg class="k-icon" aria-hidden="true"><use href="icons/kube-icons.svg#trash"></use></svg>`. Lucide renamed some icons: there is no `home` (use `house`), no `trash-2` (use `trash`), `bar-chart` → `chart-bar`, `pie-chart` → `chart-pie`, `more-horizontal` → `ellipsis`, `filter` → `funnel`, `alert-circle` → `circle-alert`, `check-circle` → `circle-check`, `x-circle` → `circle-x`, `alert-triangle` → `triangle-alert`, `help-circle` → `circle-question-mark`.
- Ids verified in the sprite, useful for a disk-cleaning app (all exist):
  - Cleaning / storage: `broom`, `broom-sparkles`, `brush-cleaning`, `trash`, `trash-off`, `recycle`, `eraser`, `paintbrush`, `hard-drive`, `hard-drive-download`, `hard-drive-upload`, `disc`, `disc-2`, `disc-3`, `database`, `database-zap`, `database-x`, `database-backup`, `database-search`, `server`, `server-crash`, `memory-stick`, `cpu`, `usb`, `monitor`, `monitor-check`, `monitor-x`, `monitor-cog`, `laptop`, `laptop-minimal`, `smartphone`, `battery`, `battery-charging`, `battery-low`, `power`, `power-off`.
  - Files / folders: `file`, `file-x`, `file-check`, `file-search`, `file-clock`, `file-archive`, `file-text`, `file-code`, `file-image`, `file-music`, `file-play`, `file-spreadsheet`, `file-type`, `file-pen-line`, `file-axis-3d`, `file-stack`, `file-box`, `file-down`, `file-up`, `file-symlink`, `file-lock`, `file-key`, `file-terminal`, `folder`, `folder-open`, `folder-x`, `folder-check`, `folder-search`, `folder-clock`, `folder-archive`, `folder-cog`, `folder-tree`, `folder-root`, `folder-lock`, `folder-sync`, `folder-git`, `folder-code`, `archive`, `archive-x`, `archive-restore`, `package`, `package-x`, `package-check`, `package-search`, `package-open`, `box`, `layers`, `layers-2`.
  - Web / downloads / cloud: `download`, `cloud`, `cloud-download`, `cloud-upload`, `cloud-off`, `cloud-check`, `cloud-sync`, `globe`, `globe-lock`, `globe-x`, `wifi`, `wifi-off`, `external-link`, `copy`, `copy-check`.
  - Code / dev: `code`, `code-xml`, `braces`, `terminal`, `square-terminal`, `bug`, `bug-off`, `git-branch`, `git-commit-horizontal`, `git-merge`, `wrench`, `hammer`, `settings`, `settings-2`, `sliders-horizontal`, `sliders-vertical`, `funnel`, `funnel-x`, `funnel-plus`.
  - Security: `shield`, `shield-check`, `shield-alert`, `shield-x`, `shield-off`, `shield-ban`, `shield-lock`, `lock`, `lock-open`, `lock-keyhole`, `key`, `key-round`, `eye`, `eye-off`, `eye-closed`, `user`, `user-check`, `user-x`, `user-cog`, `user-shield`.
  - Time: `clock`, `clock-alert`, `clock-fading`, `history` (absent — use `clock-arrow-left` or `rotate-ccw-clock`), `timer`, `timer-reset`, `timer-off`, `hourglass`, `calendar`, `calendar-clock`, `calendar-days`, `calendar-check`, `calendar-x`, `calendar-range`, `rotate-ccw-clock`, `rotate-cw-clock`.
  - Status / feedback: `check`, `check-check`, `circle-check`, `circle-check-big`, `square-check`, `badge-check`, `x`, `circle-x`, `square-x`, `circle-alert`, `triangle-alert`, `info`, `circle-question-mark`, `circle-dashed`, `circle-dashed-check`, `circle-dot`, `circle-slash`, `circle-off`, `circle-pause`, `circle-play`, `circle-stop`, `circle-ellipsis`, `ellipsis`, `ellipsis-vertical`, `loader`, `loader-circle`, `loader-pinwheel`, `bell`, `bell-ring`, `bell-off`, `bell-dot`, `star`, `heart`, `flame`, `leaf`, `droplet`, `wind`, `snowflake`, `sun`, `moon`, `sun-moon`.
  - Energy / speed: `sparkles`, `sparkle`, `zap`, `zap-off`, `rocket`, `wand`, `wand-sparkles`, `gauge`, `circle-gauge`, `activity`, `trending-up`, `trending-down`, `chart-bar`, `chart-column`, `chart-pie`, `chart-line`, `chart-area`, `chart-no-axes-column`.
  - Search / scan: `search`, `search-x`, `search-check`, `search-code`, `scan`, `scan-search`, `scan-line`, `scan-eye`.
  - Navigation / layout: `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up-right`, `arrow-down-to-line`, `arrow-up-from-line`, `arrow-left-right`, `arrow-up-down`, `arrow-down-wide-narrow`, `arrow-up-narrow-wide`, `chevron-up`, `chevron-down`, `chevron-left`, `chevron-right`, `chevron-first`, `chevron-last`, `refresh-cw`, `refresh-ccw`, `rotate-cw`, `rotate-ccw`, `undo`, `undo-2`, `redo`, `redo-2`, `play`, `pause`, `square`, `circle`, `plus`, `minus`, `menu`, `maximize`, `maximize-2`, `minimize`, `minimize-2`, `layout-dashboard`, `layout-grid`, `layout-list`, `layout-panel-left`, `panel-left`, `panel-left-close`, `panel-left-open`, `panel-right`, `panel-right-close`, `panel-right-open`, `panel-bottom`, `panel-top`, `grid-2x2`, `grid-3x3`, `list`, `list-checks`, `list-filter`, `list-tree`, `list-x`, `list-todo`, `table`, `table-2`, `table-properties`, `house`.
