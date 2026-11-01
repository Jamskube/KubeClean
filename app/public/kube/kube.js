/* --- 00-core.js --- */
/* Kube runtime core. No dependencies.
 *
 * A behavior is registered once and mounts on every element whose data-kube attribute lists its name:
 *   <div class="k-split" data-kube="split">...</div>
 * Options are read from data-kube-* attributes on that element. Mounting is automatic on load and for
 * nodes added later (MutationObserver); removed nodes are destroyed. Behaviors talk to the page through
 * CustomEvents named "kube:<event>" that bubble from the element, and through Kube.get(el, name).
 */
(function () {
  "use strict";

  var Kube = (window.Kube = window.Kube || {});
  Kube.version = "2.0.0";

  var behaviors = {};
  var instances = new WeakMap(); // element -> { name: instance }
  var started = false;

  // setup(el, util) returns an optional instance object; its destroy() runs when el leaves the document.
  Kube.register = function (name, setup) {
    if (behaviors[name]) throw new Error("Kube: behavior already registered: " + name);
    behaviors[name] = setup;
    if (started) scan(document);
  };

  Kube.init = function (root) { scan(root || document); };
  Kube.get = function (el, name) { var m = instances.get(el); return m ? m[name] : undefined; };
  Kube.destroy = function (el) {
    var m = instances.get(el);
    if (!m) return;
    Object.keys(m).forEach(function (k) { if (m[k] && typeof m[k].destroy === "function") m[k].destroy(); });
    instances.delete(el);
  };

  function namesOf(el) { return (el.getAttribute("data-kube") || "").split(/\s+/).filter(Boolean); }

  function mount(el) {
    var m = instances.get(el);
    namesOf(el).forEach(function (name) {
      var setup = behaviors[name];
      if (!setup || (m && m[name])) return;
      if (!m) instances.set(el, (m = {}));
      try {
        m[name] = setup(el, util) || {};
      } catch (err) {
        m[name] = {};
        console.error("Kube: " + name + " failed to mount", el, err);
      }
    });
  }

  function scan(root) {
    if (root.nodeType === 1 && root.hasAttribute("data-kube")) mount(root);
    if (root.querySelectorAll) [].forEach.call(root.querySelectorAll("[data-kube]"), mount);
  }

  function unmountTree(node) {
    if (node.nodeType !== 1) return;
    if (instances.has(node)) Kube.destroy(node);
    [].forEach.call(node.querySelectorAll("[data-kube]"), function (el) { if (instances.has(el)) Kube.destroy(el); });
  }

  function start() {
    if (started) return;
    started = true;
    scan(document);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) { if (n.nodeType === 1) scan(n); });
        [].forEach.call(r.removedNodes, function (n) { if (!n.isConnected) unmountTree(n); });
        if (r.type === "attributes" && r.target.nodeType === 1) mount(r.target);
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-kube"] });
  }

  /* Shared helpers, passed to every setup() and exposed as Kube.util. */
  var util = (Kube.util = {
    // Add a listener and get back a function that removes it.
    on: function (target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      return function () { target.removeEventListener(type, fn, opts); };
    },
    // Fire "kube:<type>" on el; returns false when a listener called preventDefault().
    emit: function (el, type, detail) {
      return el.dispatchEvent(new CustomEvent("kube:" + type, { bubbles: true, cancelable: true, detail: detail }));
    },
    opt: function (el, key, fallback) {
      var v = el.getAttribute("data-kube-" + key);
      if (v === null) return fallback;
      if (typeof fallback === "number") { var n = parseFloat(v); return isNaN(n) ? fallback : n; }
      if (typeof fallback === "boolean") return v !== "false";
      return v;
    },
    reducedMotion: function () { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; },
    finePointer: function () { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; },
    clamp: function (v, min, max) { return Math.min(max, Math.max(min, v)); },
    uid: (function () { var n = 0; return function (prefix) { return (prefix || "k") + "-" + (++n).toString(36); }; })(),
    focusable: function (root) {
      return [].filter.call(
        root.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'),
        function (el) { return !el.disabled && el.tabIndex >= 0 && !el.closest("[inert], [hidden]") && el.getClientRects().length > 0; }
      );
    },
    // localStorage that never throws (private windows, blocked storage).
    store: {
      get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    },
    // Wait for the element's transitions/animations to end, with a timeout so a missing event never hangs.
    afterMotion: function (el, ms, fn) {
      if (util.reducedMotion()) { fn(); return function () {}; }
      var done = false;
      function finish(e) { if (done || (e && e.target !== el)) return; done = true; clear(); fn(); }
      var t = setTimeout(finish, ms + 50);
      var offA = util.on(el, "transitionend", finish);
      var offB = util.on(el, "animationend", finish);
      function clear() { clearTimeout(t); offA(); offB(); }
      return clear;
    },
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

/* --- 10-actions.js --- */
/* Actions behaviors: copy button, button loading state, width-aware press scale, segmented control.
 *
 *   <button class="k-btn" data-kube="copy" data-kube-text="hello">...</button>
 *   <button class="k-btn" data-kube="press">Save</button>
 *   <button class="k-btn k-btn--primary" data-kube-loading="true">Publish</button>   (or Kube.setLoading(btn, true))
 *   <div class="k-seg" data-kube="segmented">...</div>
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;

  /* ------------------------------------------------------------------ Clipboard */

  // Kube.copy(text, el) -> Promise<boolean>. Tries the async Clipboard API, then falls back to a hidden
  // textarea + execCommand("copy"), placed inside el's dialog or popover so a focus trap does not block it.
  Kube.copy = function (text, el) {
    text = text == null ? "" : String(text);
    var api;
    try { api = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(); } catch (e) { api = Promise.reject(e); }
    return api.then(function () { return true; }, function () { return selectCopy(text, el); });
  };

  function selectCopy(text, el) {
    var host = (el && el.closest && el.closest("dialog, [popover]")) || document.body;
    var prev = document.activeElement;
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    host.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    if (prev && prev !== document.body && typeof prev.focus === "function") prev.focus({ preventScroll: true });
    return ok;
  }

  // Copy button. Options: data-kube-text (literal; use data-kube-copy instead when the button is also a
  // tooltip trigger, which reads data-kube-text as its label) or data-kube-target (selector: an input's value
  // or an element's text), data-kube-copied (label while copied, "Copied"), data-kube-duration (ms, 1300).
  // Swaps .k-btn__swap icons, the .k-btn__label text and aria-label (and re-shows an open tooltip so it
  // reads the new label); ignores clicks while pending or copied. Emits kube:copy { ok, text }.
  Kube.register("copy", function (el) {
    var state = "idle";
    var timer = 0;
    var saved = null;

    function source() {
      var text = util.opt(el, "copy", util.opt(el, "text", null));
      if (text !== null) return text;
      var sel = util.opt(el, "target", null);
      var node = sel ? document.querySelector(sel) : null;
      if (!node) return "";
      return node.matches("input, textarea, select") ? node.value : node.textContent;
    }

    function show(copied) {
      var swap = el.querySelector(".k-btn__swap");
      var label = el.querySelector(".k-btn__label");
      if (copied) {
        saved = { aria: el.getAttribute("aria-label"), text: label ? label.textContent : null };
        var word = util.opt(el, "copied", "Copied");
        if (saved.aria !== null) el.setAttribute("aria-label", word);
        if (label) label.textContent = word;
      } else if (saved) {
        if (saved.aria !== null) el.setAttribute("aria-label", saved.aria);
        if (label && saved.text !== null) label.textContent = saved.text;
        saved = null;
      }
      if (swap) swap.toggleAttribute("data-swapped", copied);
      el.toggleAttribute("data-copied", copied);
      var tip = Kube.get(el, "tooltip");
      if (tip && tip.show && el.matches(":hover, :focus-visible")) { tip.hide(); tip.show(); }
    }

    var off = util.on(el, "click", function () {
      if (state !== "idle") return;
      var text = source();
      state = "pending";
      el.setAttribute("aria-busy", "true");
      Kube.copy(text, el).then(function (ok) {
        el.removeAttribute("aria-busy");
        if (state !== "pending") return; // destroyed meanwhile
        util.emit(el, "copy", { ok: ok, text: text });
        if (!ok) { state = "idle"; return; }
        state = "copied";
        show(true);
        timer = setTimeout(function () { state = "idle"; show(false); }, util.opt(el, "duration", 1300));
      });
    });

    return {
      destroy: function () {
        off();
        clearTimeout(timer);
        if (state === "copied") show(false);
        el.removeAttribute("aria-busy");
        state = "gone";
      },
    };
  });

  /* ------------------------------------------------------------------ Loading state */

  // Kube.setLoading(btn, on): sets aria-busy and disables the button (aria-disabled on non-buttons),
  // adding a .k-btn__loader if it has none. CSS fades the label out over .3s and the loader in over .15s
  // after .1s, without dimming. Turning it off restores the previous disabled state and, if focus fell
  // to the page while disabled, puts it back on the button.
  var wasDisabled = new WeakMap();
  Kube.setLoading = function (btn, on) {
    on = !!on;
    if (!btn || wasDisabled.has(btn) === on) return;
    var isButton = "disabled" in btn;
    if (on) {
      if (!btn.querySelector(":scope > .k-btn__loader")) {
        var loader = document.createElement("span");
        loader.className = "k-btn__loader";
        loader.setAttribute("aria-hidden", "true");
        loader.innerHTML = '<span class="k-loader"></span>';
        btn.prepend(loader);
        getComputedStyle(loader).opacity; // commit the hidden state so the fade-in transition runs
      }
      var focused = document.activeElement === btn;
      wasDisabled.set(btn, { disabled: isButton ? btn.disabled : btn.getAttribute("aria-disabled"), focused: focused });
      btn.setAttribute("aria-busy", "true");
      if (isButton) btn.disabled = true;
      else btn.setAttribute("aria-disabled", "true");
    } else {
      var prev = wasDisabled.get(btn);
      wasDisabled.delete(btn);
      btn.removeAttribute("aria-busy");
      if (isButton) btn.disabled = prev.disabled;
      else if (prev.disabled === null) btn.removeAttribute("aria-disabled");
      else btn.setAttribute("aria-disabled", prev.disabled);
      if (prev.focused && (document.activeElement === document.body || !document.activeElement)) btn.focus({ preventScroll: true });
    }
  };

  // data-kube-loading on any element mirrors into Kube.setLoading: present and not "false" means loading.
  function syncLoading(el) {
    var v = el.getAttribute("data-kube-loading");
    Kube.setLoading(el, v !== null && v !== "false");
  }
  function scanLoading(root) {
    if (root.nodeType !== 1) return;
    if (root.hasAttribute("data-kube-loading")) syncLoading(root);
    [].forEach.call(root.querySelectorAll("[data-kube-loading]"), syncLoading);
  }
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      if (r.type === "attributes") syncLoading(r.target);
      else [].forEach.call(r.addedNodes, scanLoading);
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-kube-loading"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scanLoading(document.documentElement); }, { once: true });
  else scanLoading(document.documentElement);

  /* ------------------------------------------------------------------ Press scale */

  // Width-aware press scale: on pointerenter, measure the element and set --k-press-scale so every control
  // travels about the same few pixels. Option data-kube-multiplier (1) scales the effect; 0 turns it off.
  // Under reduced motion the property is removed (scale 1).
  Kube.pressScale = function (width) {
    return width <= 80 ? 0.96 : width <= 150 ? 0.97 : width <= 220 ? 0.98 : width > 600 ? 0.995 : 0.985;
  };
  Kube.register("press", function (el) {
    var off = util.on(el, "pointerenter", function () {
      if (util.reducedMotion()) { el.style.removeProperty("--k-press-scale"); return; }
      var s = 1 + (Kube.pressScale(el.offsetWidth) - 1) * util.opt(el, "multiplier", 1);
      el.style.setProperty("--k-press-scale", String(Math.round(s * 1000) / 1000));
    });
    return { destroy: function () { off(); el.style.removeProperty("--k-press-scale"); } };
  });

  /* ------------------------------------------------------------------ Segmented control */

  // Single select over the .k-seg__item children. Click, Enter or Space selects; arrow keys and Home/End
  // move focus only and stop at the ends; one tab stop on the checked item. An optional .k-seg__thumb is
  // sized and moved to the checked item: the first placement and any resize jump, later changes glide.
  // A checked item scrolled within 15% of the track edge is brought to the center.
  // Option data-kube-value selects an item by value at mount. Emits kube:change { value, item } on user
  // selection. API: Kube.get(el, "segmented").value / .select(valueOrItem).
  Kube.register("segmented", function (el) {
    var thumb = el.querySelector(":scope > .k-seg__thumb");
    var offs = [];

    function items() { return [].slice.call(el.querySelectorAll(":scope > .k-seg__item")); }
    function isDisabled(i) { return i.disabled || i.getAttribute("aria-disabled") === "true"; }
    function enabled() { return items().filter(function (i) { return !isDisabled(i); }); }
    function valueOf(i) { return i.getAttribute("data-value") || i.value || i.textContent.trim() || i.getAttribute("aria-label") || ""; }
    function current() { return items().filter(function (i) { return i.getAttribute("aria-checked") === "true"; })[0] || null; }
    function find(v) { return typeof v === "string" ? items().filter(function (i) { return valueOf(i) === v; })[0] : v; }

    function roving(target) {
      var stop = target || current() || enabled()[0];
      items().forEach(function (i) { i.tabIndex = i === stop ? 0 : -1; });
    }

    function place(smooth) {
      var on = current();
      if (thumb) {
        thumb.style.opacity = on ? "" : "0";
        if (on) {
          var w = Math.floor(on.clientWidth);
          var x = on.offsetLeft;
          var padEnd = parseFloat(getComputedStyle(el).paddingRight) || 0;
          if (el.clientWidth - (w + x) < padEnd) w -= 1; // keep the thumb inside the track's end padding
          thumb.style.width = w + "px";
          thumb.style.transform = "translateX(" + x + "px)";
        }
      }
      if (on && el.scrollWidth > el.clientWidth) {
        var a = el.getBoundingClientRect();
        var r = on.getBoundingClientRect();
        var edge = el.clientWidth * 0.15;
        if (r.left < a.left + edge || r.right > a.right - edge) {
          el.scrollBy({ left: r.left + r.width / 2 - (a.left + a.width / 2), behavior: smooth && !util.reducedMotion() ? "smooth" : "instant" });
        }
      }
    }

    // Place without animation: drop data-ready, place, flush layout, then restore it.
    function jump() {
      var ready = thumb && thumb.hasAttribute("data-ready");
      if (ready) thumb.removeAttribute("data-ready");
      place(false);
      if (ready) { thumb.getBoundingClientRect(); thumb.setAttribute("data-ready", ""); }
    }

    function select(item, user) {
      item = find(item);
      if (!item || item.parentElement !== el || isDisabled(item) || item === current()) return;
      items().forEach(function (i) { i.setAttribute("aria-checked", i === item ? "true" : "false"); });
      roving(item);
      place(true);
      if (user) util.emit(el, "change", { value: valueOf(item), item: item });
    }

    if (!el.hasAttribute("role")) el.setAttribute("role", "radiogroup");
    items().forEach(function (i) {
      if (!i.hasAttribute("role")) i.setAttribute("role", "radio");
      if (i.getAttribute("aria-checked") !== "true") i.setAttribute("aria-checked", "false");
    });
    var initial = util.opt(el, "value", null);
    if (initial !== null) select(initial, false);
    roving();
    jump();
    // Transitions start only after the first placement has painted.
    var raf = requestAnimationFrame(function () { raf = requestAnimationFrame(function () { if (thumb) thumb.setAttribute("data-ready", ""); }); });

    offs.push(util.on(el, "click", function (e) {
      var item = e.target.closest(".k-seg__item");
      if (item && item.parentElement === el) select(item, true);
    }));
    offs.push(util.on(el, "keydown", function (e) {
      var list = enabled();
      var k = list.indexOf(document.activeElement);
      if (k < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === "Enter" || e.key === " ") && list[k].tagName !== "BUTTON") { e.preventDefault(); select(list[k], true); return; }
      var rtl = getComputedStyle(el).direction === "rtl";
      var step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
      var to = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : step === undefined ? -1 : util.clamp(k + step, 0, list.length - 1);
      if (to < 0) return;
      e.preventDefault();
      roving(list[to]);
      list[to].focus();
    }));
    // Leaving the group returns the tab stop to the checked item.
    offs.push(util.on(el, "focusout", function (e) { if (!el.contains(e.relatedTarget)) roving(); }));

    var ro = new ResizeObserver(function () { jump(); });
    ro.observe(el);

    return {
      get value() { var on = current(); return on ? valueOf(on) : null; },
      select: function (v) { select(v, false); },
      destroy: function () {
        cancelAnimationFrame(raf);
        ro.disconnect();
        offs.forEach(function (off) { off(); });
      },
    };
  });
})(window.Kube);

/* --- 20-menus.js --- */
/* Kube menus: dropdown menu, submenu, context menu, select option list, suggestion list.
 *
 * Behaviors
 *   data-kube="menu"            on a trigger button (menu found by aria-controls or data-kube-target),
 *                               or on a role="menu" element for an inline, always-open menu.
 *   data-kube="context-menu"    on the area that opens a menu at the pointer (data-kube-target).
 *   data-kube="select-menu"     on .k-select-menu; popup when data-kube-trigger names a trigger.
 *   data-kube="suggestion-menu" on the text field; aria-controls names the .k-suggest__list.
 *   data-kube="dialog command-palette" on a <dialog class="k-command">: overlays opens and closes it,
 *                               this adds the filtered command list and the Ctrl/Cmd+K shortcut.
 * Submenus need no attribute: any row with aria-haspopup="menu" + aria-controls inside a managed menu.
 *
 * Needs Kube.position and Kube.layers (40-overlays.js, same bundle).
 *
 * Reverse-read from the shipped Radix menu (MenuContentImpl, MenuSubTrigger, getNextMatch,
 * isPointInPolygon), the app's dropdown wrapper (sideOffset 1, collisionPadding 6, open-on-hover
 * 200 / 100 ms with a safe triangle) and its cmdk-style option lists (aria-activedescendant).
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var ITEM = "[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]";
  var OPTION = "[role=option]";
  var PAD = 6; // viewport collision padding
  var OPP = { top: "bottom", bottom: "top", left: "right", right: "left" };

  var inline = new WeakSet(); // inline root menus
  var floating = new WeakMap(); // floating root surface -> open state
  var exits = new WeakMap(); // surface -> cancel pending hide
  var buffers = new WeakMap(); // typeahead buffers

  /* ---------- Tree helpers ---------- */

  function menuOf(el) { return el && el.nodeType === 1 ? el.closest("[role=menu]") : null; }
  function byId(id) { return id ? document.getElementById(id) : null; }
  function shown(el, root) { var h = el.closest("[hidden]"); return !h || h.contains(root); }
  function off(el) { return el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled"); }
  function own(m) { return [].filter.call(m.querySelectorAll(ITEM), function (i) { return menuOf(i) === m; }); }
  function rows(m) { return own(m).filter(function (i) { return shown(i, m); }); }
  function enabled(m) { return rows(m).filter(function (i) { return !off(i); }); }
  function isSub(i) { return !!i && i.getAttribute("aria-haspopup") === "menu" && i.matches(ITEM); }
  function subOf(t) { return byId(t.getAttribute("aria-controls")); }
  function parentTrigger(m) {
    if (!m || !m.id) return null;
    return [].find.call(document.querySelectorAll('[aria-controls="' + CSS.escape(m.id) + '"]'), function (t) { return t.matches(ITEM); }) || null;
  }
  function rootOf(m) { var t; while (m && (t = parentTrigger(m))) m = menuOf(t); return m; }
  function managed(m) { var r = m && rootOf(m); return !!r && (inline.has(r) || floating.has(r)); }
  function inTree(t, root) {
    if (!t || t.nodeType !== 1) return false;
    if (root.contains(t)) return true;
    var m = menuOf(t);
    return !!m && rootOf(m) === root;
  }
  function isRtl(el) { return getComputedStyle(el).direction === "rtl"; }
  function labelOf(el) { var l = el.querySelector(".k-menu__label"); return ((l || el).textContent || "").trim(); }
  function fieldOf(m) { var f = m.querySelector(".k-menu__search input"); return f && menuOf(f) === m ? f : null; }
  var popovers = typeof HTMLElement.prototype.showPopover === "function";
  function popoverOpen(el) { return popovers && el.matches(":popover-open"); }

  /* ---------- Motion ---------- */

  // Longest running animation on el (duration + delay), read after data-state changed.
  function motionMs(el) {
    var cs = getComputedStyle(el), d = cs.animationDuration.split(","), l = cs.animationDelay.split(",");
    return Math.max.apply(null, d.map(function (v, k) { return (parseFloat(v) + parseFloat(l[k] || 0)) * 1000 || 0; }));
  }
  function cancelExit(el) { var c = exits.get(el); if (c) { c(); exits.delete(el); } }
  // Hide once the data-state="closed" animation has played; reopening cancels it.
  function hideAfter(el) {
    cancelExit(el);
    exits.set(el, util.afterMotion(el, motionMs(el), function () {
      exits.delete(el);
      if (el.dataset.state !== "closed") return;
      if (popoverOpen(el)) el.hidePopover();
      el.hidden = true;
    }));
  }
  function show(el) {
    cancelExit(el);
    el.hidden = false;
    el.setAttribute("data-floating", "");
    // Top layer: escapes overflow, transforms and dialogs. Older engines keep position: fixed + z-index.
    if (popovers) {
      if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
      if (!popoverOpen(el)) el.showPopover();
    }
    el.dataset.state = "open";
  }

  /* ---------- Placement and layers (Kube.position and Kube.layers from 40-overlays.js) ---------- */

  var subs = new WeakMap(); // open submenu -> { pos, layer }

  // Submenu: 4px past the parent menu edge, first row level with the trigger row; flips to the other side,
  // and drops below the row when neither side has room.
  function placeSub(sub, t) {
    var vw = document.documentElement.clientWidth;
    var beside = { getBoundingClientRect: function () {
      var m = menuOf(t).getBoundingClientRect(), row = t.getBoundingClientRect();
      var top = row.top - (parseFloat(getComputedStyle(sub).paddingTop) || 0);
      return { left: m.left, right: m.right, top: top, bottom: row.bottom, width: m.width, height: row.bottom - top };
    } };
    var below = { getBoundingClientRect: function () {
      var r = t.getBoundingClientRect();
      return { left: r.left + 16, right: r.right - 16, top: r.top, bottom: r.bottom, width: r.width - 32, height: r.height };
    } };
    var pos = Kube.position(sub, beside, { side: isRtl(t) ? "left" : "right", align: "start", offset: 4, padding: PAD });
    var x = parseFloat(sub.style.left);
    if (x < PAD || x + sub.offsetWidth > vw - PAD) {
      pos.destroy();
      pos = Kube.position(sub, below, { side: "bottom", align: "start", offset: 4, padding: PAD });
    }
    return pos;
  }

  /* ---------- Menu state ---------- */

  function prepare(m) {
    if (!m.hasAttribute("tabindex")) m.tabIndex = -1;
    own(m).forEach(function (r) {
      if (!r.hasAttribute("tabindex")) r.tabIndex = -1;
      var sw = r.querySelector("input.k-switch");
      if (sw) { sw.tabIndex = -1; sw.setAttribute("aria-hidden", "true"); sw.checked = r.getAttribute("aria-checked") === "true"; }
      if (!isSub(r)) return;
      var s = subOf(r);
      if (r.dataset.state !== "open") r.dataset.state = "closed";
      r.setAttribute("aria-expanded", String(r.dataset.state === "open"));
      if (!s) return;
      if (r.dataset.state !== "open") { s.hidden = true; s.dataset.state = "closed"; }
      prepare(s);
    });
  }

  function focusItem(i, keyboard) {
    i.focus({ preventScroll: true });
    if (keyboard) i.scrollIntoView({ block: "nearest" });
  }
  // How a menu takes focus when it opens: "first" / "last" row (keyboard), "content", or "none".
  function focusEntry(m, how) {
    if (how === "none") return;
    var f = fieldOf(m);
    if (f) { f.focus({ preventScroll: true }); return; }
    var list = enabled(m);
    if (how === "first" && list.length) focusItem(list[0], true);
    else if (how === "last" && list.length) focusItem(list[list.length - 1], true);
    else m.focus({ preventScroll: true });
  }

  function openSub(t, keyboard) {
    var sub = subOf(t);
    if (!sub) return;
    clearTimeout(pointer.openTimer); pointer.openTimer = 0;
    own(menuOf(t)).forEach(function (r) { if (r !== t && isSub(r) && r.dataset.state === "open") closeSub(r); });
    if (t.dataset.state !== "open") {
      t.dataset.state = "open";
      t.setAttribute("aria-expanded", "true");
      show(sub);
      prepare(sub);
      subs.set(sub, { pos: placeSub(sub, t), layer: Kube.layers.push({ el: sub, anchor: t, close: function () { closeSub(t); } }) });
      util.emit(sub, "open", { trigger: t });
    }
    if (keyboard) focusEntry(sub, "first");
  }
  function closeSub(t) {
    var sub = subOf(t);
    if (!sub || t.dataset.state !== "open") return;
    own(sub).forEach(function (r) { if (isSub(r)) closeSub(r); });
    t.dataset.state = "closed";
    t.setAttribute("aria-expanded", "false");
    sub.dataset.state = "closed";
    var s2 = subs.get(sub);
    if (s2) { s2.pos.destroy(); Kube.layers.remove(s2.layer); subs.delete(sub); }
    hideAfter(sub);
    util.emit(sub, "close", { trigger: t });
  }
  function closeSubs(m) { own(m).forEach(function (r) { if (isSub(r)) closeSub(r); }); }

  // Close the whole tree m belongs to (Escape and selection close every level, as Radix does).
  function closeTree(m, reason) {
    var root = rootOf(m), st = floating.get(root);
    if (st && st.open) { st.close(reason); return; }
    closeSubs(root);
    if (inTree(document.activeElement, root)) root.focus({ preventScroll: true });
    util.emit(root, "close", { reason: reason });
  }

  /* ---------- Floating surfaces (menu, context menu, select popup) ---------- */

  // anchor: an element or a {x, y} point. o: side, align, offset, focus, trigger, returnTo, onClose.
  // Escape and outside presses arrive through Kube.layers; a window blur closes it too (as the app does).
  function openFloating(el, anchor, o) {
    var prev = floating.get(el);
    if (prev && prev.open) prev.close("reopen");
    var st = { open: true };
    floating.set(el, st);
    if (el.matches("[role=menu]")) prepare(el);
    show(el);
    var pos = Kube.position(el, anchor, { side: o.side, align: o.align, offset: o.offset, padding: PAD });
    var layer = Kube.layers.push({ el: el, anchor: o.trigger || null, close: function (r) { st.close(r); } });
    var offBlur = util.on(window, "blur", function () { st.close("blur"); });
    st.close = function (reason) {
      if (!st.open) return;
      st.open = false;
      pos.destroy();
      Kube.layers.remove(layer);
      offBlur();
      var hadFocus = inTree(document.activeElement, el);
      if (el.matches("[role=menu]")) closeSubs(el);
      el.dataset.state = "closed";
      hideAfter(el);
      if (o.onClose) o.onClose(reason);
      var back = o.returnTo;
      if (back && back.isConnected && reason !== "outside" && reason !== "reopen" && (hadFocus || reason === "escape" || reason === "select")) {
        back.focus({ preventScroll: true });
      }
      util.emit(el, "close", { reason: reason });
    };
    focusEntry(el, o.focus || "content");
    util.emit(el, "open", { anchor: anchor });
    return st;
  }

  Kube.openMenu = function (menu, anchor, opts) {
    openFloating(menu, anchor, Object.assign({ side: "bottom", align: "start", offset: 1, focus: "content", returnTo: document.activeElement }, opts));
  };
  Kube.closeMenu = function (menu, reason) {
    var st = floating.get(menu);
    if (st && st.open) st.close(reason || "api");
  };

  /* ---------- Typeahead (getNextMatch: 1s buffer, a repeated letter cycles) ---------- */

  function buffer(holder, key) {
    var b = buffers.get(holder);
    if (!b) buffers.set(holder, (b = { q: "", t: 0 }));
    if (key === undefined) return b.q;
    b.q += key;
    clearTimeout(b.t);
    b.t = setTimeout(function () { b.q = ""; }, 1000);
    return b.q;
  }
  function clearBuffer(holder) { var b = buffers.get(holder); if (b) { clearTimeout(b.t); b.q = ""; } }
  function nextMatch(items, q, current) {
    var rep = q.length > 1 && q.split("").every(function (c) { return c === q[0]; });
    var n = (rep ? q[0] : q).toLowerCase(), i = Math.max(items.indexOf(current), 0);
    var order = items.slice(i).concat(items.slice(0, i));
    if (n.length === 1) order = order.filter(function (x) { return x !== current; });
    var hit = order.find(function (x) { return labelOf(x).toLowerCase().indexOf(n) === 0; });
    return hit !== current ? hit : undefined;
  }

  /* ---------- Filtering (search field at the top of a menu or option list) ---------- */

  // Hides rows whose label does not contain the query; listeners may preventDefault "kube:filter" to do it themselves.
  function filterRows(scope, rowsAll, query, extras) {
    var q = query.trim().toLowerCase(), any = false;
    rowsAll.forEach(function (r) {
      var hit = !q || labelOf(r).toLowerCase().indexOf(q) !== -1;
      if (hit) any = true;
      if (hit && r.hasAttribute("data-filtered")) { r.removeAttribute("data-filtered"); r.hidden = false; }
      else if (!hit && !r.hidden) { r.setAttribute("data-filtered", ""); r.hidden = true; }
    });
    extras(q);
    var empty = scope.querySelector(".k-menu__empty, .k-select-menu__empty, .k-suggest__empty, .k-command__empty");
    if (empty) empty.hidden = any;
    return any;
  }
  function toggleFiltered(el, hide) {
    if (hide && !el.hidden) { el.setAttribute("data-filtered", ""); el.hidden = true; }
    else if (!hide && el.hasAttribute("data-filtered")) { el.removeAttribute("data-filtered"); el.hidden = false; }
  }
  function filterMenu(m, query) {
    filterRows(m, own(m), query, function (q) {
      [].forEach.call(m.querySelectorAll(".k-menu__separator, .k-menu__heading"), function (x) { if (menuOf(x) === m) toggleFiltered(x, !!q); });
      [].forEach.call(m.querySelectorAll("[role=group]"), function (g) {
        if (menuOf(g) === m) toggleFiltered(g, !!q && !own(m).some(function (r) { return g.contains(r) && !r.hidden; }));
      });
    });
  }

  /* ---------- Document listeners for every managed menu ---------- */

  var pointer = { x: 0, dir: "right", grace: null, graceTimer: 0, openTimer: 0, down: null, keyboard: false };

  // Grace area: the pointer (bled 5px back toward the trigger) to the submenu's near and far corners.
  function setGrace(e, t, sub) {
    var b = sub.getBoundingClientRect(), right = sub.dataset.side === "right";
    var near = right ? b.left : b.right, far = right ? b.right : b.left;
    pointer.grace = {
      menu: menuOf(t), side: sub.dataset.side,
      area: [{ x: e.clientX + (right ? -5 : 5), y: e.clientY }, { x: near, y: b.top }, { x: far, y: b.top }, { x: far, y: b.bottom }, { x: near, y: b.bottom }],
    };
    clearTimeout(pointer.graceTimer);
    pointer.graceTimer = setTimeout(function () { pointer.grace = null; }, 300);
  }
  function inPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function inGrace(e, m) {
    var g = pointer.grace;
    return !!g && g.menu === m && pointer.dir === g.side && inPolygon(e.clientX, e.clientY, g.area);
  }
  function itemLeave(e, m) {
    if (inGrace(e, m)) return;
    m.focus({ preventScroll: true });
  }

  function onPointerMove(e) {
    if (e.pointerType !== "mouse") return;
    if (e.clientX !== pointer.x) { pointer.dir = e.clientX > pointer.x ? "right" : "left"; pointer.x = e.clientX; }
    var m = menuOf(e.target);
    if (!m || !managed(m)) return;
    var item = e.target.closest(ITEM);
    if (!item || menuOf(item) !== m) return;
    if (off(item)) { itemLeave(e, m); return; }
    if (inGrace(e, m)) return;
    if (document.activeElement !== item) item.focus({ preventScroll: true });
    if (isSub(item) && item.dataset.state !== "open" && !pointer.openTimer) {
      pointer.grace = null;
      pointer.openTimer = setTimeout(function () { pointer.openTimer = 0; openSub(item, false); }, 100);
    }
  }
  function onPointerOut(e) {
    if (e.pointerType !== "mouse" || !e.target.closest) return;
    var item = e.target.closest(ITEM);
    if (!item || item.contains(e.relatedTarget)) return;
    var m = menuOf(item);
    if (!managed(m)) return;
    if (isSub(item)) {
      clearTimeout(pointer.openTimer); pointer.openTimer = 0;
      var sub = subOf(item);
      if (sub && item.dataset.state === "open" && (sub.dataset.side === "right" || sub.dataset.side === "left")) setGrace(e, item, sub);
      else if (!inGrace(e, m)) pointer.grace = null;
    }
    itemLeave(e, m);
  }

  function onClick(e) {
    var item = e.target.closest && e.target.closest(ITEM), m = menuOf(item);
    if (!item || !managed(m)) return;
    if (off(item)) { e.preventDefault(); return; }
    if (isSub(item)) { item.focus({ preventScroll: true }); openSub(item, false); return; }
    var role = item.getAttribute("role"), checked;
    if (role === "menuitemcheckbox") {
      checked = item.getAttribute("aria-checked") !== "true";
      item.setAttribute("aria-checked", String(checked));
      var sw = item.querySelector("input.k-switch");
      if (sw) sw.checked = checked;
    } else if (role === "menuitemradio") {
      var group = item.closest("[role=group]") || m;
      own(m).forEach(function (r) { if (r.getAttribute("role") === "menuitemradio" && group.contains(r)) r.setAttribute("aria-checked", String(r === item)); });
      checked = true;
    }
    var label = labelOf(item);
    var keep = !util.emit(item, "select", { item: item, value: item.getAttribute("data-value") || label, label: label, checked: checked });
    if (role === "menuitem" && !keep) closeTree(m, "select");
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    var k = e.key;
    var t = e.target, m = menuOf(t);
    if (!m || !managed(m)) return;
    var field = fieldOf(m);
    var list = enabled(m);
    if (t === field) {
      // Search field: arrows step into the rows; letters type (no typeahead).
      if (k === "ArrowDown" || k === "ArrowUp") {
        var after = list.filter(function (i) { return field.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING; });
        var go = k === "ArrowDown" ? after[0] : after[after.length - 1];
        if (go) { e.preventDefault(); focusItem(go, true); }
      } else if (k === "Escape") { e.preventDefault(); closeTree(m, "escape"); }
      else if (k === "Tab") e.preventDefault();
      return;
    }
    var item = t.closest(ITEM);
    if (item && menuOf(item) !== m) item = null;
    var rtl = isRtl(m), openKey = rtl ? "ArrowLeft" : "ArrowRight", closeKey = rtl ? "ArrowRight" : "ArrowLeft";
    var typing = buffer(m) !== "";
    if (item && !off(item) && (k === "Enter" || (k === " " && !typing))) {
      e.preventDefault();
      if (isSub(item)) openSub(item, true); else item.click();
      return;
    }
    if (item && isSub(item) && k === openKey) { e.preventDefault(); openSub(item, true); return; }
    var pt = parentTrigger(m);
    if (pt && k === closeKey) { e.preventDefault(); closeSub(pt); pt.focus({ preventScroll: true }); return; }
    if (k === "Escape") { e.preventDefault(); closeTree(m, "escape"); return; }
    if (field && item === list[0] && (k === "ArrowUp" || (k === "Tab" && e.shiftKey))) { e.preventDefault(); field.focus(); return; }
    if (k === "Tab") { e.preventDefault(); return; } // menus are not navigated with Tab
    var i = list.indexOf(item);
    var to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, PageUp: 0, End: list.length - 1, PageDown: list.length - 1 }[k];
    if (to !== undefined) {
      e.preventDefault();
      if (!item) to = k === "ArrowDown" || k === "Home" || k === "PageUp" ? 0 : list.length - 1;
      if (list.length) focusItem(list[util.clamp(to, 0, list.length - 1)], true);
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); // a pending Space extends the query instead of scrolling
      var hit = nextMatch(list, buffer(m, k), item);
      if (hit) setTimeout(function () { focusItem(hit, true); });
    }
  }

  function onFocusIn(e) {
    var t = e.target, m = menuOf(t);
    if (!m || !managed(m)) return;
    own(m).forEach(function (r) {
      r.toggleAttribute("data-highlighted", r === t);
      // A submenu closes when focus moves anywhere in its parent but its own trigger.
      if (r !== t && isSub(r) && r.dataset.state === "open") closeSub(r);
    });
    // Keyboard focus on the menu itself (Tab into an inline menu): highlight the first row.
    if (t === m && pointer.keyboard && !inTree(e.relatedTarget, m) && inline.has(m)) {
      var first = enabled(m)[0];
      if (first) focusItem(first, true);
    }
  }
  function onFocusOut(e) {
    var t = e.target, m = menuOf(t);
    if (!m || !managed(m)) return;
    if (t.matches(ITEM)) t.removeAttribute("data-highlighted");
    if (!m.contains(e.relatedTarget)) clearBuffer(m);
  }

  function onInput(e) {
    var t = e.target, m = menuOf(t);
    if (!m || !managed(m) || t !== fieldOf(m)) return;
    if (util.emit(t, "filter", { query: t.value, menu: m })) filterMenu(m, t.value);
  }

  document.addEventListener("keydown", function () { pointer.keyboard = true; }, true);
  document.addEventListener("pointerdown", function (e) {
    pointer.keyboard = false;
    pointer.down = e.target.closest ? e.target.closest(ITEM) : null;
  }, true);
  // Press on the trigger, drag onto a row, release: the row is chosen (Radix MenuItem onPointerUp).
  document.addEventListener("pointerup", function (e) {
    var item = e.button === 0 && e.target.closest ? e.target.closest(ITEM) : null;
    var down = pointer.down;
    pointer.down = null;
    if (item && down !== item && managed(menuOf(item))) item.click();
  });
  document.addEventListener("mousedown", function (e) {
    var item = e.target.closest && e.target.closest(ITEM);
    if (item && e.button === 0 && !e.ctrlKey && managed(menuOf(item))) e.preventDefault(); // keep focus where it is
  });
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("input", onInput);

  /* ---------- menu ---------- */

  // Safe triangle for open-on-hover menus: pointer to the destination's near edge, 8px past each end.
  function safeTriangle(isIn, dest, side, p, onEnter, onInside, onOutside) {
    return util.on(document, "pointermove", function (e) {
      if (isIn(e.target)) { onEnter(); return; }
      var d = dest.getBoundingClientRect(), a, b;
      if (side === "left" || side === "right") {
        var x = side === "right" ? d.left : d.right;
        a = { x: x, y: d.top - 8 }; b = { x: x, y: d.bottom + 8 };
      } else {
        var y = side === "bottom" ? d.top : d.bottom;
        a = { x: d.left - 8, y: y }; b = { x: d.right + 8, y: y };
      }
      if (inPolygon(e.clientX, e.clientY, [p, a, b])) onInside(); else onOutside();
    }, true);
  }

  Kube.register("menu", function (el, u) {
    if (el.getAttribute("role") === "menu") {
      inline.add(el);
      prepare(el);
      return { destroy: function () { inline.delete(el); closeSubs(el); } };
    }

    var menu = byId(u.opt(el, "target", el.getAttribute("aria-controls")));
    if (!menu) throw new Error("no menu: set aria-controls or data-kube-target");
    if (!menu.id) menu.id = u.uid("k-menu");
    el.setAttribute("aria-haspopup", "menu");
    el.setAttribute("aria-controls", menu.id);
    el.setAttribute("aria-expanded", "false");
    el.dataset.state = "closed";
    menu.hidden = true;
    menu.dataset.state = "closed";
    prepare(menu);

    var hover = u.opt(el, "hover", false);
    var st = null, byHover = false, openTimer = 0, closeTimer = 0, offTri = null;
    function isOpen() { return !!st && st.open; }
    function clearHover() {
      clearTimeout(openTimer); clearTimeout(closeTimer); openTimer = closeTimer = 0;
      if (offTri) { offTri(); offTri = null; }
    }
    function open(focus, fromHover) {
      clearHover();
      byHover = !!fromHover;
      if (isOpen()) return;
      st = openFloating(menu, el, {
        side: u.opt(el, "side", "bottom"), align: u.opt(el, "align", "start"), offset: u.opt(el, "offset", 1),
        focus: focus, trigger: el, returnTo: el,
        onClose: function () { clearHover(); byHover = false; el.setAttribute("aria-expanded", "false"); el.dataset.state = "closed"; },
      });
      el.setAttribute("aria-expanded", "true");
      el.dataset.state = "open";
    }
    function close(reason) { if (isOpen()) st.close(reason || "api"); }

    var offs = [
      u.on(el, "pointerdown", function (e) {
        if (el.disabled || e.button !== 0 || e.ctrlKey) return;
        if (hover) { clearHover(); e.preventDefault(); return; }
        if (isOpen()) close("trigger");
        else { open("content"); e.preventDefault(); }
      }),
      u.on(el, "keydown", function (e) {
        if (el.disabled) return;
        var k = e.key;
        if (hover) {
          clearHover(); byHover = false;
          if (isOpen() && (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp")) {
            e.preventDefault();
            focusEntry(menu, k === "ArrowUp" ? "last" : "first");
            return;
          }
        }
        if (k === "Enter" || k === " ") { e.preventDefault(); if (isOpen()) close("trigger"); else open("first"); }
        else if (k === "ArrowDown") { e.preventDefault(); open("first"); }
        else if (k === "ArrowUp") { e.preventDefault(); open("last"); }
      }),
      // A click with no pointer and no key before it (screen reader activation, el.click()) opens it too.
      u.on(el, "click", function (e) {
        if (e.detail === 0 && !hover && !el.disabled && !isOpen()) open("first");
      }),
    ];
    if (hover) {
      offs.push(
        // Open after 200ms of mouse hover; a click pins it open (or opens it at once).
        u.on(el, "pointerenter", function (e) {
          if (e.pointerType !== "mouse" || el.disabled) return;
          clearHover();
          if (!isOpen()) openTimer = setTimeout(function () { open("none", true); }, 200);
        }),
        u.on(el, "click", function (e) {
          if (el.disabled || e.detail === 0) return;
          var keep = !isOpen() || byHover;
          clearHover(); byHover = false;
          if (keep) { if (!isOpen()) open("content"); else menu.focus({ preventScroll: true }); }
          else close("trigger");
        }),
        // Leaving the trigger or the menu closes after 100ms, at once if the pointer leaves the triangle toward the other.
        u.on(document, "pointerout", function (e) {
          if (e.pointerType !== "mouse" || !e.target.closest) return;
          var fromTrigger = el.contains(e.target), fromMenu = !fromTrigger && inTree(e.target, menu);
          if (!fromTrigger && !fromMenu) return;
          var to = e.relatedTarget;
          if (to && (el.contains(to) || inTree(to, menu))) return;
          if (fromTrigger) clearTimeout(openTimer);
          if (!isOpen() || !byHover) return;
          clearHover();
          var side = menu.dataset.side || "bottom";
          var closeNow = function () { clearHover(); close("hover"); };
          var later = function () { clearTimeout(closeTimer); closeTimer = setTimeout(closeNow, 100); };
          var isIn = function (n) { return !!n && n.nodeType === 1 && (el.contains(n) || inTree(n, menu)); };
          offTri = safeTriangle(isIn, fromTrigger ? menu : el, fromTrigger ? side : OPP[side], { x: e.clientX, y: e.clientY }, clearHover, later, closeNow);
          later();
        })
      );
    }
    return {
      open: function (focus) { open(focus || "first"); },
      close: close,
      toggle: function () { if (isOpen()) close("api"); else open("first"); },
      isOpen: isOpen,
      destroy: function () { clearHover(); close("destroy"); offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- context-menu ---------- */

  Kube.register("context-menu", function (el, u) {
    var menu = byId(u.opt(el, "target", el.getAttribute("aria-controls")));
    if (!menu) throw new Error("no menu: set data-kube-target");
    menu.hidden = true;
    menu.dataset.state = "closed";
    prepare(menu);
    var st = null, keyAt = 0, press = 0;
    // Radix ContextMenuContent: side right, sideOffset 2, align start, from a zero-size rect at the point.
    function openAt(x, y, focus) {
      clearTimeout(press);
      st = openFloating(menu, { x: x, y: y }, {
        side: isRtl(el) ? "left" : "right", align: "start", offset: u.opt(el, "offset", 2),
        focus: focus, returnTo: document.activeElement && document.activeElement !== document.body ? document.activeElement : el,
      });
    }
    function cancelPress() { clearTimeout(press); }
    var offs = [
      u.on(el, "contextmenu", function (e) {
        e.preventDefault();
        if (Date.now() - keyAt < 500) return; // the key already opened it
        openAt(e.clientX, e.clientY, "content");
      }),
      u.on(el, "keydown", function (e) {
        if (!((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu")) return;
        e.preventDefault();
        keyAt = Date.now();
        var r = e.target.getBoundingClientRect();
        openAt(r.left, r.top, "first");
      }),
      // Touch and pen: long press (700ms) opens; any movement cancels.
      u.on(el, "pointerdown", function (e) {
        if (e.pointerType === "mouse") return;
        cancelPress();
        if (st && st.open) st.close("outside");
        press = setTimeout(function () { openAt(e.clientX, e.clientY, "content"); }, 700);
      }),
      u.on(el, "pointermove", function (e) { if (e.pointerType !== "mouse") cancelPress(); }),
      u.on(el, "pointerup", cancelPress),
      u.on(el, "pointercancel", cancelPress),
    ];
    return {
      open: function (x, y) { openAt(x, y, "first"); },
      close: function (reason) { if (st && st.open) st.close(reason || "api"); },
      destroy: function () { cancelPress(); if (st && st.open) st.close("destroy"); offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- Option lists (listbox + aria-activedescendant) ---------- */

  function listbox(list, focusEl, o) {
    function all() { return [].filter.call(list.querySelectorAll(OPTION), function (x) { return shown(x, list); }); }
    function opts() { return all().filter(function (x) { return !off(x); }); }
    function current() { return list.querySelector(OPTION + "[data-highlighted]"); }
    [].forEach.call(list.querySelectorAll(OPTION), function (x) { if (!x.id) x.id = util.uid("k-opt"); });
    function highlight(x, scroll) {
      [].forEach.call(list.querySelectorAll(OPTION), function (y) { y.toggleAttribute("data-highlighted", y === x); });
      if (x) {
        focusEl.setAttribute("aria-activedescendant", x.id);
        if (scroll) x.scrollIntoView({ block: "nearest" });
      } else focusEl.removeAttribute("aria-activedescendant");
    }
    function onKey(e) {
      if (e.defaultPrevented || (o.active && !o.active())) return;
      var list2 = opts(), cur = current(), i = list2.indexOf(cur), k = e.key;
      var keys = { ArrowDown: i < 0 ? 0 : i + 1, ArrowUp: i < 0 ? list2.length - 1 : i - 1 };
      if (o.edges !== false) { keys.Home = 0; keys.End = list2.length - 1; }
      var to = keys[k];
      if (to !== undefined) {
        e.preventDefault();
        if (!list2.length) return;
        to = o.loop ? (to + list2.length) % list2.length : util.clamp(to, 0, list2.length - 1);
        highlight(list2[to], true);
        return;
      }
      if (k === "Enter" || (k === " " && !o.field && buffer(list) === "")) {
        if (cur) { e.preventDefault(); o.pick(cur); }
        return;
      }
      if (k === "Tab" && o.onTab) { o.onTab(e, cur); return; }
      if (k === "Escape" && o.onEscape) { o.onEscape(e); return; }
      if (!o.field && k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        var hit = nextMatch(list2, buffer(list, k), cur);
        if (hit) { e.preventDefault(); highlight(hit, true); }
      }
    }
    var offs = [
      util.on(focusEl, "keydown", onKey),
      util.on(list, "pointermove", function (e) {
        var x = e.target.closest(OPTION);
        if (!x || x === current()) return;
        highlight(off(x) ? null : x);
      }),
      util.on(list, "pointerleave", function () { if (o.clearOnLeave) highlight(null); }),
      util.on(list, "mousedown", function (e) { e.preventDefault(); }), // focus stays on the field or list
      util.on(list, "click", function (e) {
        var x = e.target.closest(OPTION);
        if (x && !off(x)) { highlight(x); o.pick(x); }
      }),
    ];
    return { all: all, opts: opts, current: current, highlight: highlight, destroy: function () { offs.forEach(function (f) { f(); }); } };
  }

  // Groups and their headings hide when every option in them is filtered out.
  function filterOptions(scope, list, query) {
    return filterRows(scope, [].slice.call(list.querySelectorAll(OPTION)), query, function () {
      [].forEach.call(list.querySelectorAll("[role=group]"), function (g) {
        var hide = ![].some.call(g.querySelectorAll(OPTION), function (x) { return !x.hidden; });
        toggleFiltered(g, hide);
        var head = byId(g.getAttribute("aria-labelledby"));
        if (head && list.contains(head)) toggleFiltered(head, hide);
      });
    });
  }

  /* ---------- select-menu ---------- */

  Kube.register("select-menu", function (el, u) {
    var list = el.matches("[role=listbox]") ? el : el.querySelector("[role=listbox]");
    if (!list) throw new Error("no [role=listbox] inside");
    if (!list.id) list.id = u.uid("k-listbox");
    var field = el.querySelector(".k-menu__search input");
    var trigger = byId(u.opt(el, "trigger", null));
    var focusEl = field || list;
    if (!list.hasAttribute("tabindex")) list.tabIndex = field ? -1 : 0;
    if (field) {
      field.setAttribute("role", "combobox");
      field.setAttribute("aria-controls", list.id);
      field.setAttribute("aria-autocomplete", "list");
      field.setAttribute("aria-expanded", "true");
      field.setAttribute("autocomplete", "off");
    }
    var st = null, open = function () {};
    function isOpen() { return !trigger || (!!st && st.open); }
    function selected() { return lb.opts().filter(function (x) { return x.getAttribute("aria-selected") === "true"; })[0]; }
    function pick(x) {
      var multi = list.getAttribute("aria-multiselectable") === "true";
      if (multi) x.setAttribute("aria-selected", String(x.getAttribute("aria-selected") !== "true"));
      else [].forEach.call(list.querySelectorAll(OPTION), function (y) { y.setAttribute("aria-selected", String(y === x)); });
      var label = labelOf(x);
      var ok = u.emit(x, "select", { option: x, value: x.getAttribute("data-value") || label, label: label, selected: x.getAttribute("aria-selected") === "true" });
      if (!ok || multi || !trigger) return;
      var v = trigger.querySelector(".k-select__value");
      if (v) { v.textContent = label; trigger.removeAttribute("data-placeholder"); }
      st.close("select");
    }
    var lb = listbox(list, focusEl, {
      field: !!field, pick: pick, clearOnLeave: !field,
      onTab: function (e) { if (trigger) e.preventDefault(); },
      onEscape: function (e) { if (trigger && isOpen()) { e.preventDefault(); st.close("escape"); } },
    });
    function entry() {
      if (!lb.current()) lb.highlight(selected() || lb.opts()[0], true);
    }
    var offs = [
      u.on(focusEl, "focus", function () { if (isOpen()) entry(); }),
    ];
    if (field) {
      offs.push(u.on(field, "input", function () {
        if (u.emit(field, "filter", { query: field.value, list: list })) filterOptions(el, list, field.value);
        lb.highlight(lb.opts()[0], true); // like cmdk: the first match is the answer
      }));
    }
    if (trigger) {
      if (!el.id) el.id = u.uid("k-select-menu");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-controls", list.id);
      trigger.setAttribute("aria-expanded", "false");
      el.hidden = true;
      el.dataset.state = "closed";
      open = function () {
        if (isOpen()) return;
        el.style.setProperty("--k-select-menu-width", trigger.offsetWidth + "px");
        st = openFloating(el, trigger, {
          side: u.opt(el, "side", "bottom"), align: u.opt(el, "align", "start"), offset: u.opt(el, "offset", 8),
          focus: "none", trigger: trigger, returnTo: trigger,
          onClose: function () { trigger.setAttribute("aria-expanded", "false"); trigger.dataset.state = "closed"; lb.highlight(null); },
        });
        trigger.setAttribute("aria-expanded", "true");
        trigger.dataset.state = "open";
        focusEl.focus({ preventScroll: true });
        lb.highlight(null);
        entry();
      };
      offs.push(
        u.on(trigger, "pointerdown", function (e) {
          if (trigger.disabled || e.button !== 0 || e.ctrlKey) return;
          if (isOpen()) st.close("trigger"); else { e.preventDefault(); open(); }
        }),
        u.on(trigger, "keydown", function (e) {
          if (trigger.disabled || [" ", "Enter", "ArrowDown", "ArrowUp"].indexOf(e.key) === -1) return;
          e.preventDefault();
          open();
        }),
        // Screen reader activation (a click with no pointer or key before it).
        u.on(trigger, "click", function (e) { if (e.detail === 0 && !trigger.disabled && !isOpen()) open(); })
      );
    }
    return {
      open: function () { open(); },
      close: function (reason) { if (st && st.open) st.close(reason || "api"); },
      highlight: lb.highlight,
      destroy: function () { if (st && st.open) st.close("destroy"); lb.destroy(); offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- suggestion-menu ---------- */

  Kube.register("suggestion-menu", function (input, u) {
    var list = byId(input.getAttribute("aria-controls"));
    if (!list) throw new Error("no list: set aria-controls on the field");
    var box = list.closest(".k-suggest") || list;
    var trig = u.opt(input, "trigger", "@");
    var re = new RegExp(trig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\S*)$");
    var dismissed = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("autocomplete", "off");

    // Caret position while the field has focus; the end of the text otherwise.
    function caret() { return document.activeElement === input && input.selectionStart !== null ? input.selectionStart : input.value.length; }
    function query() {
      var end = caret();
      var m = re.exec(input.value.slice(0, end));
      return m ? m[1] : null;
    }
    function setOpen(on) {
      box.hidden = !on;
      input.setAttribute("aria-expanded", String(on));
      if (!on) lb.highlight(null);
    }
    var last; // query + dismissed state of the last refresh: caret moves within one query keep the highlight
    function refresh() {
      var q = query(), key = dismissed + '|' + q;
      if (key === last) return;
      last = key;
      setOpen(q !== null && !dismissed);
      if (box.hidden) return;
      if (u.emit(input, "filter", { query: q, list: list })) {
        filterRows(box, [].slice.call(list.querySelectorAll(OPTION)), q, function () {
          var section = null, count = 0;
          [].forEach.call(list.children, function (c) {
            if (c.classList.contains("k-suggest__section")) { if (section) toggleFiltered(section, !count); section = c; count = 0; }
            else if (c.matches(OPTION) && !c.hidden) count++;
          });
          if (section) toggleFiltered(section, !count);
        });
      }
      lb.highlight(lb.opts()[0], true);
    }
    function pick(x) {
      var label = labelOf(x), q = query();
      if (!u.emit(x, "select", { item: x, value: x.getAttribute("data-value") || label, label: label, query: q })) return;
      var end = caret();
      var head = input.value.slice(0, end).replace(re, trig + label + " ");
      input.value = head + input.value.slice(end);
      input.setSelectionRange(head.length, head.length);
      input.focus();
      last = null;
      refresh();
    }
    var lb = listbox(list, input, {
      field: true, loop: true, edges: false, pick: pick, active: function () { return !box.hidden; },
      onTab: function (e, cur) { if (!box.hidden && cur) { e.preventDefault(); pick(cur); } },
      onEscape: function (e) { if (!box.hidden) { e.preventDefault(); dismissed = true; last = null; refresh(); } },
    });
    var offs = [
      u.on(input, "input", function () { dismissed = false; last = null; refresh(); }),
      u.on(input, "blur", function () { setOpen(false); last = null; }),
      u.on(input, "focus", refresh),
      u.on(document, "selectionchange", function () { if (document.activeElement === input) refresh(); }),
    ];
    refresh();
    return { refresh: refresh, close: function () { setOpen(false); }, destroy: function () { lb.destroy(); offs.forEach(function (f) { f(); }); } };
  });
  /* ---------- command-palette (cmdk-style: the field keeps focus, the list follows) ---------- */

  Kube.register("command-palette", function (el, u) {
    var list = el.querySelector("[role=listbox]"), field = el.querySelector("input");
    if (!list || !field) throw new Error("needs an input and a [role=listbox]");
    if (!list.id) list.id = u.uid("k-commands");
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-controls", list.id);
    field.setAttribute("aria-autocomplete", "list");
    field.setAttribute("aria-expanded", "true");
    field.setAttribute("autocomplete", "off");
    field.setAttribute("spellcheck", "false");
    if (!field.hasAttribute("autofocus")) field.setAttribute("autofocus", "");

    function filter() {
      if (u.emit(field, "filter", { query: field.value, list: list })) filterOptions(el, list, field.value);
      lb.highlight(lb.opts()[0], true);
      list.scrollTop = 0;
    }
    function isOpen() { return el.open || el.dataset.state === "open"; }
    function pick(x) {
      var label = labelOf(x);
      if (u.emit(x, "select", { option: x, value: x.getAttribute("data-value") || label, label: label, query: field.value })) Kube.close(el);
    }
    var lb = listbox(list, field, { field: true, pick: pick });
    // Mod+K (Ctrl, or Cmd on Apple keyboards) toggles it from anywhere; data-kube-shortcut="" turns it off.
    var key = String(u.opt(el, "shortcut", "k")).toLowerCase();
    var offs = [
      u.on(field, "input", filter),
      u.on(el, "kube:open", function (e) {
        if (e.target !== el) return;
        field.value = "";
        filter();
      }),
      u.on(document, "keydown", function (e) {
        if (!key || e.key.toLowerCase() !== key || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
        e.preventDefault();
        if (isOpen()) Kube.close(el); else Kube.open(el, document.activeElement);
      }),
    ];
    filter();
    return {
      open: function () { Kube.open(el, document.activeElement); },
      close: function () { Kube.close(el); },
      refresh: filter,
      destroy: function () { lb.destroy(); offs.forEach(function (f) { f(); }); },
    };
  });
})(window.Kube);

/* --- 30-forms.js --- */
/* Kube forms behaviors: autogrow, input-clear, number-field, slider, select, checkbox, field, tag-input, code-input, shortcut, datepicker.
 * Each mounts on [data-kube~=name] and reads data-kube-* options (see each component README).
 */
(function (Kube) {
  "use strict";

  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function decimals(step) { var s = String(step), i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; }
  function num(v, fallback) { var n = parseFloat(v); return isNaN(n) ? fallback : n; }
  // Value typed into a numeric text box, the way the source slider commits it: floor for whole steps, else round.
  function commitNumber(raw, step, prec, min, max) {
    var v = parseFloat(String(raw).trim()) || 0;
    v = step >= 1 ? Math.floor(v) : +v.toFixed(prec);
    return Math.min(max, Math.max(min, v));
  }

  /* ---------- autogrow: textarea height follows its content ---------- */
  Kube.register("autogrow", function (el, u) {
    var ta = el.matches("textarea") ? el : el.querySelector("textarea");
    if (!ta) return;
    if (u.opt(el, "native", true) && window.CSS && CSS.supports("field-sizing", "content")) {
      ta.style.fieldSizing = "content";
      return { fit: function () {}, destroy: function () { ta.style.fieldSizing = ""; } };
    }
    // Source algorithm: collapse to 0, then take scrollHeight. min/max-block-size (rows) clamp it.
    function fit() {
      var cs = getComputedStyle(ta);
      var extra = cs.boxSizing === "border-box"
        ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
        : -(parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
      ta.style.height = "0px";
      ta.style.height = ta.scrollHeight + extra + "px";
    }
    var width = 0;
    var ro = new ResizeObserver(function () { if (ta.clientWidth !== width) { width = ta.clientWidth; fit(); } });
    ro.observe(ta);
    var off = u.on(ta, "input", fit);
    fit();
    return { fit: fit, destroy: function () { off(); ro.disconnect(); ta.style.height = ""; } };
  });

  /* ---------- input-clear: clear button inside k-input ---------- */
  Kube.register("input-clear", function (el, u) {
    var input = el.querySelector("input, textarea");
    var btn = el.querySelector(".k-input__clear");
    if (!input || !btn) return;
    function sync() { el.toggleAttribute("data-empty", !input.value); }
    function clear() {
      if (!input.value || input.disabled || input.readOnly) return false;
      if (!u.emit(el, "clear", { value: input.value })) return false;
      input.value = "";
      fire(input, "input");
      sync();
      input.focus();
      return true;
    }
    var offs = [
      u.on(input, "input", sync),
      u.on(input, "change", sync),
      u.on(btn, "mousedown", function (e) { e.preventDefault(); }), // keep the caret in the field
      u.on(btn, "click", function (e) { e.preventDefault(); clear(); }),
      u.on(input, "keydown", function (e) {
        if (e.key === "Escape" && input.value && u.opt(el, "escape", true)) { e.preventDefault(); e.stopPropagation(); clear(); }
      }),
    ];
    sync();
    return { clear: clear, sync: sync, destroy: function () { offs.forEach(function (f) { f(); }); el.removeAttribute("data-empty"); } };
  });

  /* ---------- number-field: steppers, arrows (Shift x10), bounds, formatting ---------- */
  Kube.register("number-field", function (el, u) {
    var input = el.matches("input") ? el : el.querySelector("input");
    if (!input) return;
    var steps = el.querySelectorAll(".k-number-field__step");
    var down = steps.length > 1 ? steps[0] : null;
    var up = steps.length > 1 ? steps[steps.length - 1] : null;
    function lim() {
      var step = num(input.step, 1) || 1;
      return { min: num(input.min, -Infinity), max: num(input.max, Infinity), step: step, prec: decimals(step) };
    }
    function sync() {
      var l = lim(), v = parseFloat(input.value), off = input.disabled || input.readOnly;
      if (down) down.disabled = off || (!isNaN(v) && v <= l.min);
      if (up) up.disabled = off || (!isNaN(v) && v >= l.max);
    }
    function set(v) {
      var l = lim();
      v = Math.min(l.max, Math.max(l.min, v));
      var s = v.toFixed(l.prec);
      if (s !== input.value) {
        input.value = s;
        fire(input, "input");
        fire(input, "change");
        u.emit(el, "change", { value: +s });
      }
      sync();
    }
    function stepBy(n) {
      if (input.disabled || input.readOnly) return;
      var l = lim(), cur = parseFloat(input.value);
      set(isNaN(cur) ? Math.min(l.max, Math.max(l.min, 0)) : +(cur + n * l.step).toFixed(l.prec));
    }
    var offs = [
      u.on(input, "input", sync),
      u.on(input, "keydown", function (e) {
        var l = lim(), k = e.key, big = e.shiftKey ? 10 : 1;
        if (k === "ArrowUp" || k === "ArrowDown") stepBy((k === "ArrowUp" ? 1 : -1) * big);
        else if (k === "PageUp" || k === "PageDown") stepBy(k === "PageUp" ? 10 : -10);
        else if (k === "Home" && isFinite(l.min)) set(l.min);
        else if (k === "End" && isFinite(l.max)) set(l.max);
        else return;
        e.preventDefault();
      }),
      u.on(input, "blur", function () {
        if (input.value === "") return;
        var l = lim();
        set(commitNumber(input.value, l.step, l.prec, l.min, l.max));
      }),
    ];
    [down, up].forEach(function (b, i) {
      if (!b) return;
      offs.push(u.on(b, "mousedown", function (e) { if (document.activeElement === input) e.preventDefault(); }));
      offs.push(u.on(b, "click", function (e) { stepBy((i ? 1 : -1) * (e.shiftKey ? 10 : 1)); }));
    });
    sync();
    return {
      stepUp: function (n) { stepBy(n || 1); },
      stepDown: function (n) { stepBy(-(n || 1)); },
      setValue: function (v) { set(+v); },
      sync: sync,
      destroy: function () { offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- slider: fill, value box, reset, marks, step dots, power style ---------- */
  var WHEEL_STEP = 30, WHEEL_RESET = 160, MARK_GAP = 16;
  // Thumb travel inset of the power style: 13px at 0%, 0 at 50%, -13px at 100% (thumb 28px, 1px overlap).
  function powerEdge(p) { return 13 - (p / 50) * 13; }
  function powerPos(p) { return "calc(" + p + "% + " + powerEdge(p) + "px)"; }

  Kube.register("slider", function (el, u) {
    var range = el.matches("input[type=range]") ? el : el.querySelector("input[type=range]");
    if (!range) return;
    var field = el.classList.contains("k-slider-field") ? el : null;
    var power = el.classList.contains("k-power-slider") ? el : null;
    var valueBox = field && field.querySelector(".k-slider-field__value > input");
    var reset = field && field.querySelector(".k-slider-field__reset");
    var marks = el === range
      ? (range.nextElementSibling && range.nextElementSibling.matches(".k-slider__marks") ? range.nextElementSibling : null)
      : el.querySelector(".k-slider__marks");
    var unit = u.opt(el, "unit", "");
    var labels = u.opt(el, "labels", "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    var resetTo = num(u.opt(el, "reset", ""), num(range.defaultValue, NaN));
    var dragging = false, debounce = 0, offs = [], built = [], ticks = [];

    function lim() {
      var min = num(range.min, 0), max = num(range.max, 100), step = num(range.step, 1) || 1;
      return { min: min, max: max > min ? max : min + step, step: step, prec: decimals(step) };
    }
    function value() { return range.valueAsNumber; }
    // Source sizing of the typed value: 7.8px per character at 13px.
    function sizeBox() { valueBox.style.width = Math.ceil(Math.max(valueBox.value.length, 1) * 7.8) + "px"; }
    function fmt(v) { return v.toFixed(lim().prec); }

    function paint() {
      var l = lim(), v = value(), p = ((v - l.min) / (l.max - l.min)) * 100;
      range.style.setProperty("--k-slider-value", p + "%");
      var label = labels[Math.round((v - l.min) / l.step)];
      if (label || unit) range.setAttribute("aria-valuetext", label || fmt(v) + unit);
      if (valueBox && document.activeElement !== valueBox) valueBox.value = fmt(v);
      if (valueBox) sizeBox();
      if (reset) reset.setAttribute("data-hide", String(range.disabled || (v === resetTo && !dragging)));
      if (power) paintPower(l, v);
    }

    // Stepped pill: up to 12 evenly spaced 3px dots inside a 16px inset, drawn as track background layers.
    function steps() {
      if (!range.classList.contains("k-slider--stepped")) return;
      var l = lim(), n = Math.min(Math.round((l.max - l.min) / l.step), 11);
      if (!(n > 0)) { range.style.removeProperty("--k-slider-steps"); return; }
      var layers = [];
      for (var k = 0; k <= n; k++) {
        var f = k / n; // left edge = 16px + f * (width - 32px) - 1.5px, written against (width - 3px) for a 3px layer
        layers.push("radial-gradient(circle closest-side, var(--k-slider-step-dot) 98%, transparent) calc(" +
          (100 * f) + "% + " + (14.5 - 29 * f) + "px) 50% / 3px 3px no-repeat");
      }
      range.style.setProperty("--k-slider-steps", layers.join(", "));
    }

    // Marks under their value, the way the source lays them out; on collision they shrink, then hide.
    function placeMarks() {
      if (!marks) return;
      var items = [].slice.call(marks.children).filter(function (m) { return m.hasAttribute("data-value"); });
      if (!items.length) return;
      marks.setAttribute("data-placed", "");
      var l = lim(), w = marks.clientWidth, half = num(getComputedStyle(range).getPropertyValue("--k-slider-thumb"), 14) / 2;
      if (power) half = 13;
      items.forEach(function (m) { m.style.width = ""; m.style.display = ""; });
      function lay() {
        items.forEach(function (m) {
          var o = (num(m.getAttribute("data-value"), l.min) - l.min) / (l.max - l.min);
          var s = m.getBoundingClientRect().width;
          var x = o * w + (half - (half / 0.5) * o) - s / 2;
          m.style.insetInlineStart = Math.max(0, Math.min(x, w - s)) + "px";
        });
      }
      function crowded() {
        for (var i = 0; i < items.length - 1; i++) {
          var a = items[i].getBoundingClientRect(), b = items[i + 1].getBoundingClientRect();
          if (Math.min(a.right, b.right) + MARK_GAP > Math.max(a.left, b.left)) return true;
        }
        return false;
      }
      lay();
      if (crowded()) {
        items.forEach(function (m) { m.style.width = "min-content"; });
        lay();
        if (crowded()) items.forEach(function (m) { m.style.display = "none"; });
      }
      var h = Math.max.apply(null, items.map(function (m) { return m.getBoundingClientRect().height; }));
      marks.style.height = h > 0 ? h + "px" : "";
    }

    function buildPower() {
      var track = document.createElement("span");
      track.className = "k-power-slider__track";
      track.setAttribute("aria-hidden", "true");
      var fill = document.createElement("span");
      fill.className = "k-power-slider__fill";
      track.appendChild(fill);
      var thumb = document.createElement("span");
      thumb.className = "k-power-slider__thumb";
      thumb.setAttribute("aria-hidden", "true");
      thumb.appendChild(document.createElement("span"));
      el.insertBefore(track, range);
      el.insertBefore(thumb, range);
      built.push(track, thumb);
      var l = lim(), n = Math.round((l.max - l.min) / l.step);
      for (var k = 0; k <= n; k++) {
        var t = document.createElement("span");
        t.className = "k-power-slider__tick";
        t.style.insetInlineStart = powerPos(n ? (k / n) * 100 : 0);
        track.appendChild(t);
        ticks.push(t);
      }
    }
    function paintPower(l, v) {
      var n = ticks.length - 1, idx = Math.round((v - l.min) / l.step), p = n > 0 ? (idx / n) * 100 : 0;
      // The fill ends under the thumb centre between steps and reaches the track edges at 0 and 100%.
      var reach = n > 0 ? Math.min(idx, n - idx, 1) : 0;
      el.style.setProperty("--k-power-pos", powerPos(p));
      el.style.setProperty("--k-power-fill", "calc(" + p + "% + " + powerEdge(p) * reach + "px)");
      ticks.forEach(function (t, k) { t.toggleAttribute("data-selected", k <= idx); });
    }
    function hoverPower(e) {
      var x = e.clientX, t = built[1].getBoundingClientRect();
      el.toggleAttribute("data-hover", Math.abs(x - (t.left + t.width / 2)) <= 17); // 28px thumb + 3px hit slop
      ticks.forEach(function (t) { var b = t.getBoundingClientRect(); t.toggleAttribute("data-hover", Math.abs(x - (b.left + b.width / 2)) <= 8 && !dragging); });
    }
    function wheel(e) {
      if (e.ctrlKey || range.disabled) return;
      e.preventDefault();
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
      d = e.deltaMode === 0 ? d : Math.sign(d) * WHEEL_STEP;
      if (!d) return;
      var acc = wheel.acc || 0;
      if (e.timeStamp - (wheel.last || 0) > WHEEL_RESET || Math.sign(d) !== Math.sign(acc)) acc = 0;
      wheel.last = e.timeStamp;
      acc += d;
      if (Math.abs(acc) < WHEEL_STEP) { wheel.acc = acc; return; }
      wheel.acc = acc - Math.sign(acc) * WHEEL_STEP;
      var before = value();
      if (Math.sign(acc) > 0) range.stepUp(); else range.stepDown();
      if (value() !== before) { fire(range, "input"); fire(range, "change"); }
    }

    function setValue(v, commit) {
      var before = value();
      range.value = String(v);
      paint();
      if (value() !== before) { fire(range, "input"); if (commit) fire(range, "change"); }
    }

    if (power) {
      buildPower();
      offs.push(u.on(el, "pointermove", hoverPower));
      offs.push(u.on(el, "pointerleave", function () { el.removeAttribute("data-hover"); ticks.forEach(function (t) { t.removeAttribute("data-hover"); }); }));
      offs.push(u.on(el, "wheel", wheel, { passive: false }));
    }
    offs.push(u.on(range, "input", paint));
    offs.push(u.on(range, "change", function () { u.emit(el, "change", { value: value() }); }));
    offs.push(u.on(range, "pointerdown", function () {
      dragging = true;
      el.setAttribute("data-pressed", "");
      var end = function () {
        dragging = false;
        el.removeAttribute("data-pressed");
        el.removeAttribute("data-dragging");
        offEnd.forEach(function (f) { f(); });
        paint();
      };
      var offEnd = [u.on(window, "pointerup", end), u.on(window, "pointercancel", end),
        u.on(window, "pointermove", function (e) { if (e.buttons) el.setAttribute("data-dragging", ""); })];
      paint();
    }));

    if (valueBox) {
      offs.push(u.on(valueBox, "focus", function () { valueBox.select(); }));
      offs.push(u.on(valueBox.parentElement, "click", function () { valueBox.focus(); }));
      offs.push(u.on(valueBox, "input", function () {
        sizeBox();
        var l = lim(), t = valueBox.value.replace(/[^\d.-]/g, "").trim();
        var v = Math.min(l.max, Math.max(l.min, parseFloat(t || "0") || 0));
        if (l.step >= 1) v = Math.floor(v);
        clearTimeout(debounce);
        debounce = setTimeout(function () { setValue(v, false); }, 250);
      }));
      offs.push(u.on(valueBox, "blur", function () {
        clearTimeout(debounce);
        var l = lim();
        setValue(commitNumber(valueBox.value, l.step, l.prec, l.min, l.max), true);
        valueBox.value = fmt(value());
      }));
      offs.push(u.on(valueBox, "keydown", function (e) {
        var l = lim(), k = e.key, v;
        if (k === "Home") v = l.min;
        else if (k === "End") v = l.max;
        else if (k === "ArrowUp" || k === "ArrowDown") v = Math.min(l.max, Math.max(l.min, value() + (k === "ArrowUp" ? 1 : -1) * l.step * (e.shiftKey ? 10 : 1)));
        else if (k === "Enter" || k === "Escape") { e.preventDefault(); valueBox.blur(); return; }
        else return;
        e.preventDefault();
        clearTimeout(debounce);
        setValue(v, true);
        valueBox.value = fmt(value());
      }));
    }
    if (reset) {
      if (!reset.getAttribute("aria-label")) reset.setAttribute("aria-label", "Reset to default");
      if (!reset.title) reset.title = reset.getAttribute("aria-label");
      offs.push(u.on(reset, "click", function () { if (!isNaN(resetTo)) setValue(resetTo, true); }));
    }

    var ro = new ResizeObserver(placeMarks);
    ro.observe(marks || range);
    steps();
    paint();
    placeMarks();
    return {
      get value() { return value(); },
      setValue: function (v) { setValue(v, true); },
      refresh: function () { steps(); paint(); placeMarks(); },
      destroy: function () {
        clearTimeout(debounce);
        ro.disconnect();
        offs.forEach(function (f) { f(); });
        built.forEach(function (n) { n.remove(); });
        range.style.removeProperty("--k-slider-steps");
      },
    };
  });

  /* ---------- select: native select wrapper with a value label and a clear button ---------- */
  Kube.register("select", function (el, u) {
    var sel = el.querySelector("select");
    if (!sel) return;
    var label = el.querySelector(".k-select__value");
    var clear = el.querySelector(".k-select__clear");
    function sync() {
      var o = sel.options[sel.selectedIndex];
      if (label) label.textContent = o ? o.label : "";
      el.toggleAttribute("data-placeholder", !sel.value);
      if (clear) clear.hidden = !sel.value || sel.disabled;
    }
    var offs = [
      u.on(sel, "change", function () { sync(); u.emit(el, "change", { value: sel.value }); }),
      u.on(sel, "input", sync),
    ];
    if (sel.form) offs.push(u.on(sel.form, "reset", function () { setTimeout(sync); }));
    if (clear) {
      if (!clear.getAttribute("aria-label")) clear.setAttribute("aria-label", "Clear current value");
      offs.push(u.on(clear, "mousedown", function (e) { e.preventDefault(); }));
      offs.push(u.on(clear, "click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!sel.value || !u.emit(el, "clear", { value: sel.value })) return;
        sel.value = "";
        fire(sel, "input");
        fire(sel, "change");
        sel.focus();
      }));
    }
    sync();
    return { sync: sync, destroy: function () { offs.forEach(function (f) { f(); }); } };
  });

  /* ---------- checkbox: indeterminate from an attribute; optional select-all over other boxes ---------- */
  Kube.register("checkbox", function (el, u) {
    if (!el.matches("input[type=checkbox]")) return;
    function setMixed(on) { if (on) el.setAttribute("data-kube-indeterminate", ""); else el.removeAttribute("data-kube-indeterminate"); }
    function sync() { el.indeterminate = u.opt(el, "indeterminate", false); }
    var mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-kube-indeterminate"] });
    // A click clears the native flag; drop the attribute so markup and state agree.
    var offs = [u.on(el, "change", function () { setMixed(false); })];
    var sel = u.opt(el, "controls", "");
    function kids() { return sel ? [].filter.call(document.querySelectorAll(sel), function (k) { return k !== el && !k.disabled; }) : []; }
    function fromKids() {
      var all = kids(), on = all.filter(function (k) { return k.checked; }).length;
      if (!all.length) return;
      el.checked = on === all.length;
      setMixed(on > 0 && on < all.length);
    }
    if (sel) {
      offs.push(u.on(el, "change", function () {
        kids().forEach(function (k) { if (k.checked !== el.checked) { k.checked = el.checked; fire(k, "change"); } });
      }));
      offs.push(u.on(document, "change", function (e) { if (e.target !== el && e.target.matches && e.target.matches(sel)) fromKids(); }));
      fromKids();
    }
    sync();
    return {
      set: setMixed,
      sync: fromKids,
      destroy: function () { mo.disconnect(); offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- field: aria-invalid on the control <-> the k-field__error message ---------- */
  Kube.register("field", function (el, u) {
    var control = el.querySelector("input:not([type=hidden]), select, textarea");
    var error = el.querySelector(".k-field__error");
    if (!control || !error) return;
    if (!error.id) error.id = u.uid("k-field-error");
    var native = u.opt(el, "native", true), touched = false;

    function describe(on) {
      var ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (x) { return x && x !== error.id; });
      if (on) ids.push(error.id);
      if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
      else control.removeAttribute("aria-describedby");
    }
    function message(text) {
      var holder = error.querySelector("[data-kube-message]");
      if (!holder) {
        [].slice.call(error.childNodes).forEach(function (n) { if (n.nodeType === 3) n.remove(); });
        holder = document.createElement("span");
        holder.setAttribute("data-kube-message", "");
        error.appendChild(holder);
      }
      holder.textContent = text;
    }
    function show(text) {
      if (text) message(text);
      var changed = error.hidden || control.getAttribute("aria-invalid") !== "true";
      error.hidden = false;
      control.setAttribute("aria-invalid", "true");
      describe(true);
      if (changed) u.emit(el, "validate", { valid: false, message: error.textContent.trim() });
    }
    function hide() {
      var changed = !error.hidden || control.hasAttribute("aria-invalid");
      error.hidden = true;
      control.removeAttribute("aria-invalid");
      describe(false);
      if (changed) u.emit(el, "validate", { valid: true, message: "" });
    }
    // Native constraint message only when the author wrote none.
    function nativeText() { return error.textContent.trim() && !error.querySelector("[data-kube-message]") ? "" : control.validationMessage; }

    // Either side can be driven by hand: toggling error[hidden] or control[aria-invalid] updates the other.
    var mo = new MutationObserver(function () {
      var invalid = control.getAttribute("aria-invalid") === "true";
      if (invalid && error.hidden) show();
      else if (!invalid && !error.hidden) hide();
    });
    mo.observe(control, { attributes: true, attributeFilter: ["aria-invalid"] });
    var moErr = new MutationObserver(function () {
      if (error.hidden && control.getAttribute("aria-invalid") === "true") hide();
      else if (!error.hidden && control.getAttribute("aria-invalid") !== "true") show();
    });
    moErr.observe(error, { attributes: true, attributeFilter: ["hidden"] });

    var offs = [];
    if (native) {
      offs.push(u.on(control, "invalid", function (e) {
        e.preventDefault(); // replace the browser bubble with the field message
        show(nativeText());
        var first = control.form && control.form.querySelector(":invalid");
        if (first === control) control.focus();
      }));
      offs.push(u.on(control, "input", function () {
        touched = true;
        if (!error.hidden && control.validity.valid) hide();
      }));
      offs.push(u.on(control, "change", function () { touched = true; }));
      offs.push(u.on(control, "blur", function () {
        if (!touched || !control.willValidate) return;
        if (control.validity.valid) hide();
        else show(nativeText());
      }));
    }
    if (control.getAttribute("aria-invalid") === "true" || !error.hidden && error.textContent.trim()) show();
    else if (error.hidden) describe(false);
    return {
      setError: function (text) { show(text); },
      clearError: hide,
      destroy: function () { mo.disconnect(); moErr.disconnect(); offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- tag-input: chips inside a k-input; Enter or comma adds, Backspace removes ---------- */
  var X_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  Kube.register("tag-input", function (el, u) {
    var input = el.querySelector("input");
    if (!input) return;
    var placeholder = input.getAttribute("placeholder") || "";
    var unique = u.opt(el, "unique", true);
    function tags() { return [].slice.call(el.querySelectorAll(".k-tag-input__tag")); }
    function values() { return tags().map(function (t) { return t.getAttribute("data-value"); }); }
    function sync() { if (tags().length) input.removeAttribute("placeholder"); else if (placeholder) input.setAttribute("placeholder", placeholder); }
    function focusTag(i) {
      var all = tags();
      if (all[i]) all[i].focus({ preventScroll: true }); else input.focus({ preventScroll: true });
    }
    function decorate(t) {
      // Author-written chips get the same parts as generated ones.
      t.tabIndex = -1;
      t.setAttribute("role", "group");
      if (!t.getAttribute("data-value")) t.setAttribute("data-value", t.textContent.trim());
      var v = t.getAttribute("data-value");
      if (!t.getAttribute("aria-label")) t.setAttribute("aria-label", v);
      if (!t.querySelector(".k-tag-input__remove")) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "k-tag-input__remove";
        b.tabIndex = -1;
        b.setAttribute("aria-label", "Remove " + v);
        b.innerHTML = X_ICON;
        t.appendChild(b);
      }
    }
    function add(text) {
      var v = String(text).trim();
      if (!v || input.disabled || (unique && values().indexOf(v) >= 0)) return false;
      if (!u.emit(el, "add", { value: v })) return false;
      var t = document.createElement("span");
      t.className = "k-tag-input__tag";
      t.setAttribute("data-value", v);
      var label = document.createElement("span");
      label.className = "k-tag-input__value";
      label.textContent = v;
      t.appendChild(label);
      decorate(t);
      el.insertBefore(t, input);
      sync();
      u.emit(el, "change", { values: values() });
      return true;
    }
    function remove(t) {
      if (input.disabled || !u.emit(el, "remove", { value: t.getAttribute("data-value") })) return;
      t.remove();
      sync();
      input.focus({ preventScroll: true });
      u.emit(el, "change", { values: values() });
    }
    tags().forEach(decorate);
    var offs = [
      u.on(input, "keydown", function (e) {
        if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
        if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
          e.preventDefault();
          if (add(input.value)) input.value = "";
          return;
        }
        // Caret at the start: Backspace or ArrowLeft moves onto the last chip (source).
        if ((e.key === "Backspace" || e.key === "ArrowLeft") && tags().length && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          focusTag(tags().length - 1);
        }
      }),
      u.on(input, "paste", function (e) {
        var text = (e.clipboardData || window.clipboardData).getData("text");
        if (!/[,\n]/.test(text)) return;
        e.preventDefault();
        text.split(/[,\n]/).forEach(add);
      }),
      u.on(el, "keydown", function (e) {
        var t = e.target.closest && e.target.closest(".k-tag-input__tag");
        if (!t || e.target !== t || e.isComposing) return;
        var i = tags().indexOf(t);
        if (e.key === "ArrowLeft") { e.preventDefault(); focusTag(Math.max(0, i - 1)); }
        else if (e.key === "ArrowRight") { e.preventDefault(); focusTag(i + 1); }
        else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); remove(t); }
      }),
      u.on(el, "click", function (e) {
        var r = e.target.closest(".k-tag-input__remove");
        if (r) { e.stopPropagation(); remove(r.closest(".k-tag-input__tag")); return; }
        var t = e.target.closest(".k-tag-input__tag");
        if (t && !input.disabled) { t.focus({ preventScroll: true }); return; }
        if (e.target === el) input.focus();
      }),
    ];
    sync();
    return {
      get values() { return values(); },
      add: add,
      remove: function (v) { tags().forEach(function (t) { if (t.getAttribute("data-value") === v) remove(t); }); },
      destroy: function () { offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- code-input: slots that mirror one real input (paste fills, typing advances) ---------- */
  Kube.register("code-input", function (el, u) {
    var input = el.querySelector("input");
    if (!input) return;
    var length = num(u.opt(el, "length", ""), num(input.getAttribute("maxlength"), 4));
    var allowed = new RegExp(u.opt(el, "pattern", "[0-9]"));
    input.maxLength = length;
    if (!input.hasAttribute("autocomplete")) input.setAttribute("autocomplete", "one-time-code");
    if (input.type === "password") el.classList.add("k-code-input--mask");
    var box = el.querySelector(".k-code-input__slots");
    if (!box) {
      box = document.createElement("div");
      box.className = "k-code-input__slots";
      box.setAttribute("aria-hidden", "true");
      for (var i = 0; i < length; i++) box.appendChild(Object.assign(document.createElement("span"), { className: "k-code-input__slot" }));
      input.after(box);
    }
    var slots = [].slice.call(box.children), done = false;
    function sync() {
      var clean = input.value.split("").filter(function (c) { return allowed.test(c); }).join("").slice(0, length);
      if (clean !== input.value) input.value = clean;
      var active = Math.min(clean.length, length - 1);
      slots.forEach(function (s, i) {
        s.setAttribute("data-filled", String(i < clean.length));
        s.setAttribute("data-active", String(i === active));
        if (i < clean.length) s.setAttribute("data-char", clean[i]); else s.removeAttribute("data-char");
      });
      var full = clean.length === length;
      if (full && !done) u.emit(el, "complete", { value: clean });
      done = full;
    }
    // Keep the caret at the end so typing always fills the next slot.
    function end() { var n = input.value.length; try { input.setSelectionRange(n, n); } catch (e) { /* type=number */ } }
    var offs = [u.on(input, "input", sync), u.on(input, "focus", end), u.on(input, "click", end)];
    sync();
    return {
      get value() { return input.value; },
      clear: function () { input.value = ""; sync(); input.focus(); },
      destroy: function () { offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- shortcut: click, then press a key combination ---------- */
  var APPLE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var KEY_NAMES = {
    Space: "Space", Enter: "Enter", NumpadEnter: "Enter", Tab: "Tab", Escape: "Esc", Backspace: "Backspace",
    Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Comma: ",", Period: ".", Slash: "/",
    Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
  };
  // Physical key (e.code) so the name ignores layout and Shift; modifiers alone return null.
  function keyName(code) {
    var m = /^(?:Key|Digit)(.)$/.exec(code) || /^(F\d{1,2})$/.exec(code);
    if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code);
    return m ? "Num" + m[1] : KEY_NAMES[code] || null;
  }
  function modifiers(e) {
    var out = [];
    if (e.ctrlKey) out.push("Ctrl");
    if (e.altKey) out.push("Alt");
    if (e.shiftKey) out.push("Shift");
    if (e.metaKey) out.push(APPLE ? "Cmd" : "Win");
    return out;
  }
  Kube.register("shortcut", function (el, u) {
    var value = u.opt(el, "value", ""), recording = false;
    var reserved = u.opt(el, "reserved", "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var errorSel = u.opt(el, "error", ""), error = errorSel ? document.querySelector(errorSel) : null;
    var keys = el.querySelector(".k-shortcut__keys");
    if (!keys) keys = el.appendChild(Object.assign(document.createElement("span"), { className: "k-shortcut__keys" }));
    keys.setAttribute("aria-live", "polite");
    function make(tag, cls, text) { return Object.assign(document.createElement(tag), { className: cls, textContent: text }); }
    function show(parts, pending) {
      keys.textContent = "";
      if (!parts.length) keys.appendChild(make("span", "k-shortcut__placeholder", recording ? u.opt(el, "placeholder", "Type a shortcut") : u.opt(el, "empty", "None")));
      parts.forEach(function (p) { keys.appendChild(make("kbd", "k-kbd", p)); });
      if (pending) keys.appendChild(make("span", "k-shortcut__pending", "…"));
    }
    function message(text) {
      if (text) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
      if (error) { error.textContent = text; error.hidden = !text; }
    }
    function split(v) { return v ? v.split("+") : []; }
    function start() {
      if (recording || el.disabled) return;
      recording = true;
      el.setAttribute("data-recording", "");
      show([]);
      el.focus();
    }
    function stop() {
      if (!recording) return;
      recording = false;
      el.removeAttribute("data-recording");
      message("");
      show(split(value));
    }
    function set(v) {
      if (v !== value) {
        if (!u.emit(el, "change", { value: v, previous: value })) return;
        value = v;
        el.setAttribute("data-kube-value", v);
      }
      stop();
    }
    function refuse(combo, reason, fallback) {
      u.emit(el, "invalid", { combo: combo, reason: reason });
      message(u.opt(el, reason + "-text", fallback).split("$1").join(combo));
      show(split(combo));
    }
    function keydown(e) {
      if (!recording) return;
      var mods = modifiers(e), key = keyName(e.code);
      if (!mods.length && e.code === "Tab") { stop(); return; } // let focus move on
      e.preventDefault();
      e.stopPropagation();
      if (!mods.length && e.code === "Escape") { stop(); return; }
      if (!mods.length && (e.code === "Backspace" || e.code === "Delete")) { set(""); return; }
      if (!key) { show(mods, mods.length > 0); return; }
      var combo = mods.concat(key).join("+");
      // Shift alone doesn't count: it only changes the character.
      if (u.opt(el, "modifier", true) && !(e.ctrlKey || e.altKey || e.metaKey)) return refuse(combo, "modifier", "Add Ctrl, Alt or " + (APPLE ? "Cmd" : "Win") + " to $1");
      if (reserved.indexOf(combo.toLowerCase()) >= 0) return refuse(combo, "reserved", "$1 is reserved");
      set(combo);
    }
    // Releasing a modifier updates the live keys; releasing the main key keeps a refused combo on screen.
    function keyup(e) { if (recording && !keyName(e.code)) { var mods = modifiers(e); show(mods, mods.length > 0); } }
    var offs = [u.on(el, "click", start), u.on(el, "keydown", keydown), u.on(el, "keyup", keyup), u.on(el, "blur", stop)];
    show(split(value));
    return {
      get value() { return value; },
      set value(v) { value = v || ""; el.setAttribute("data-kube-value", value); if (!recording) show(split(value)); },
      get recording() { return recording; },
      record: start,
      cancel: stop,
      clear: function () { set(""); },
      destroy: function () { offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- datepicker: month grid, sliding months, keyboard grid, popover ---------- */
  var MONTH_STEP = 242, EXIT_MS = 400;
  var SHORT_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function day(y, m, d) { return new Date(y, m, d); }
  function startOfDay(d) { return day(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parseDay(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : startOfDay(s);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return day(+m[1], m[2] - 1, +m[3]);
    var d = new Date(s);
    return isNaN(d) ? null : startOfDay(d);
  }
  function isoDay(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { return day(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) {
    var last = day(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    return day(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
  }
  function monthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); }
  function localeWeekStart(locale) {
    try {
      var l = new Intl.Locale(locale || navigator.language);
      var info = typeof l.getWeekInfo === "function" ? l.getWeekInfo() : l.weekInfo;
      return info ? info.firstDay % 7 : 0;
    } catch (e) { return 0; }
  }

  Kube.register("datepicker", function (panel, u) {
    var locale = u.opt(panel, "locale", "") || undefined;
    var ws = u.opt(panel, "week-start", "0");
    var weekStart = ws === "locale" ? localeWeekStart(locale) : (parseInt(ws, 10) || 0) % 7;
    var min = parseDay(u.opt(panel, "min", ""));
    var max = parseDay(u.opt(panel, "max", ""));
    var value = parseDay(u.opt(panel, "value", ""));
    var placeholder = u.opt(panel, "placeholder", "Select date...");
    var today = startOfDay(new Date());
    var trigger = panel.id ? document.querySelector('[aria-controls="' + panel.id + '"], [popovertarget="' + panel.id + '"]') : null;
    var timers = [], offs = [], step = 0;

    // Without a locale the weekday row uses fixed English labels (source); keep months and day names English too.
    var fmtLocale = locale || "en-US";
    var monthFmt = new Intl.DateTimeFormat(fmtLocale, { calendar: "gregory", month: "long", year: "numeric" });
    var dayFmt = new Intl.DateTimeFormat(fmtLocale, { calendar: "gregory", weekday: "long", month: "long", day: "numeric", year: "numeric" });
    var longDay = new Intl.DateTimeFormat(fmtLocale, { weekday: "long" });
    var shortDay = new Intl.DateTimeFormat(locale, { weekday: locale && locale.split("-")[0] === "ar" ? "narrow" : "short" });
    var triggerFmt = locale ? new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", year: "2-digit" }) : null;

    function enabled(d) { return (!min || d >= min) && (!max || d <= max); }
    function clampDay(d) { return min && d < min ? min : max && d > max ? max : d; }
    var view = (function (d) { return day(d.getFullYear(), d.getMonth(), 1); })(clampDay(value || parseDay(u.opt(panel, "initial", "")) || today));

    // Skeleton (kept when the author wrote it).
    function make(tag, cls, attrs) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    function chevron(d) {
      var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.5");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      path.setAttribute("d", d);
      svg.appendChild(path);
      return svg;
    }
    var body = panel.querySelector(".k-datepicker__body");
    if (!body) {
      body = make("div", "k-datepicker__body");
      var p = make("button", "k-datepicker__nav", { type: "button", "aria-label": "Previous month" });
      p.appendChild(chevron("M10 3.5 5.5 8l4.5 4.5"));
      var n = make("button", "k-datepicker__nav k-datepicker__nav--next", { type: "button", "aria-label": "Next month" });
      n.appendChild(chevron("M6 3.5 10.5 8 6 12.5"));
      body.appendChild(p);
      body.appendChild(n);
      body.appendChild(make("div", "k-datepicker__range"));
      panel.appendChild(body);
    }
    var prev = body.querySelector(".k-datepicker__nav:not(.k-datepicker__nav--next)");
    var next = body.querySelector(".k-datepicker__nav--next");
    var range = body.querySelector(".k-datepicker__range");

    function buildMonth(first, position) {
      var pane = make("div", "k-datepicker__calendar");
      pane.style.insetInlineStart = position * MONTH_STEP + "px";
      var title = make("p", "k-datepicker__month", { id: u.uid("k-month") });
      title.textContent = monthFmt.format(first);
      var grid = make("div", "k-datepicker__grid", { role: "grid", "aria-labelledby": title.id });
      var head = make("div", "k-datepicker__week", { role: "row" });
      for (var i = 0; i < 7; i++) {
        var wd = (weekStart + i) % 7, sample = day(2026, 1, wd + 1); // 2026-02-01 is a Sunday
        var h = make("span", "k-datepicker__weekday", { role: "columnheader", "aria-label": longDay.format(sample) });
        h.textContent = locale ? shortDay.format(sample) : SHORT_DAYS[wd];
        head.appendChild(h);
      }
      grid.appendChild(head);
      var lead = (first.getDay() - weekStart + 7) % 7;
      var days = day(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      var row;
      for (var c = 0; c < lead + days; c++) {
        if (c % 7 === 0) { row = make("div", "k-datepicker__week", { role: "row" }); grid.appendChild(row); }
        if (c < lead) { row.appendChild(make("span", "k-datepicker__cell", { role: "gridcell" })); continue; }
        var date = day(first.getFullYear(), first.getMonth(), c - lead + 1);
        var b = make("button", "k-datepicker__day", { type: "button", role: "gridcell", tabindex: "-1", "data-date": isoDay(date), "aria-label": dayFmt.format(date) });
        b.textContent = String(date.getDate());
        b.setAttribute("aria-selected", value && date.getTime() === value.getTime() ? "true" : "false");
        if (date.getTime() === today.getTime()) b.setAttribute("aria-current", "date");
        if (!enabled(date)) b.disabled = true;
        row.appendChild(b);
      }
      pane.appendChild(title);
      pane.appendChild(grid);
      return pane;
    }
    function current() { return range.querySelector(".k-datepicker__calendar:not([data-exiting])"); }
    function dayButton(d) { var pane = current(); return pane && pane.querySelector('[data-date="' + isoDay(d) + '"]'); }

    // Body height eases (.25s, CSS) to the tallest month that is not leaving.
    function syncHeight(instant) {
      var h = 0;
      range.querySelectorAll(".k-datepicker__calendar:not([data-exiting])").forEach(function (c) { h = Math.max(h, c.offsetHeight); });
      if (!h) return;
      if (instant) body.style.transition = "none";
      body.style.height = h + "px";
      if (instant) { void body.offsetHeight; body.style.transition = ""; }
    }
    function updateNav() {
      prev.disabled = !!min && !(min < view);
      next.disabled = !!max && !(day(view.getFullYear(), view.getMonth() + 1, 0) < max);
    }
    // Roving tabindex: one day in the visible month is tabbable.
    function rove(target) {
      var pane = current();
      if (!pane) return null;
      var pick = (target && pane.querySelector('[data-date="' + isoDay(target) + '"]:not(:disabled)')) ||
        pane.querySelector('[aria-selected="true"]:not(:disabled)') ||
        pane.querySelector('[aria-current="date"]:not(:disabled)') ||
        pane.querySelector(".k-datepicker__day:not(:disabled)");
      pane.querySelectorAll(".k-datepicker__day").forEach(function (b) { b.tabIndex = b === pick ? 0 : -1; });
      return pick;
    }
    function render() {
      timers.forEach(clearTimeout);
      timers = [];
      step = 0;
      range.textContent = "";
      range.style.setProperty("--k-datepicker-offset", "0px");
      range.appendChild(buildMonth(view, 0));
      syncHeight(true);
      updateNav();
      rove();
    }
    // Slide by whole months: the range moves 242px per step; the old month stays mounted 400ms while it slides out.
    function go(delta, focusDay) {
      if (!delta) return;
      var old = current();
      step += delta > 0 ? 1 : -1; // a jump of a year still slides one step
      view = day(view.getFullYear(), view.getMonth() + delta, 1);
      range.appendChild(buildMonth(view, step));
      range.style.setProperty("--k-datepicker-offset", -step * MONTH_STEP + "px");
      if (old) {
        old.setAttribute("data-exiting", "");
        old.setAttribute("aria-hidden", "true");
        old.inert = true;
        timers.push(setTimeout(function () { old.remove(); }, u.reducedMotion() ? 0 : EXIT_MS));
      }
      syncHeight(false);
      updateNav();
      var b = rove(focusDay);
      if (focusDay && b) b.focus();
      u.emit(panel, "navigate", { month: isoDay(view).slice(0, 7) });
    }
    function moveFocus(d) {
      d = clampDay(d);
      var diff = monthsBetween(view, d);
      if (diff) { go(diff, d); return; }
      var b = rove(d);
      if (b) b.focus();
    }

    function triggerText() {
      if (!trigger) return;
      var label = trigger.querySelector(".k-select__value") || trigger;
      label.textContent = !value ? placeholder
        : triggerFmt ? triggerFmt.format(value)
        : pad(value.getMonth() + 1) + "/" + pad(value.getDate()) + "/" + String(value.getFullYear()).slice(-2);
      trigger.toggleAttribute("data-placeholder", !value);
      var clear = trigger.querySelector(".k-select__clear");
      if (clear) clear.hidden = !value || trigger.getAttribute("aria-disabled") === "true";
    }
    function setValue(d, user) {
      d = parseDay(d);
      if (d && !enabled(d)) return;
      value = d;
      range.querySelectorAll(".k-datepicker__day").forEach(function (b) {
        b.setAttribute("aria-selected", d && b.getAttribute("data-date") === isoDay(d) ? "true" : "false");
      });
      // A value outside the visible month resets the view without sliding, as the source does.
      if (d && monthsBetween(view, d)) { view = day(d.getFullYear(), d.getMonth(), 1); render(); }
      else rove(d);
      triggerText();
      if (user) u.emit(panel, "change", { value: d ? isoDay(d) : null, date: d });
    }

    // Popover: with data-kube="datepicker popover" the overlays popover owns stacking, Escape, outside press,
    // focus return and placement (Kube.position). A bare [popover] panel is placed with Kube.position when the
    // overlays family is loaded, else by place(); both 8px under the trigger, centred (source: bottom, 8, center).
    function place() {
      if (!trigger) return;
      var r = trigger.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      var top = r.bottom + 8, below = true;
      if (top + h > vh - 8 && r.top - 8 - h >= 8) { top = r.top - 8 - h; below = false; }
      var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
      panel.style.top = top + "px";
      panel.style.left = left + "px";
      panel.style.setProperty("--k-origin", r.left + r.width / 2 - left + "px " + (below ? "0px" : h + "px"));
    }
    function managed() { return Kube.get(panel, "popover"); }
    function isPopover() { return panel.hasAttribute("popover") || !!managed(); }
    function isOpen() { var m = managed(); return m ? m.isOpen : isPopover() && panel.matches(":popover-open"); }
    function open() { var m = managed(); if (m) m.open(trigger); else if (isPopover() && !isOpen()) panel.showPopover(); }
    function close() { var m = managed(); if (m) m.close(); else if (isOpen()) panel.hidePopover(); }
    function toggle() { if (isOpen()) close(); else open(); }
    if (!panel.hasAttribute("data-kube-align")) panel.setAttribute("data-kube-align", "center");
    if (!panel.hasAttribute("data-kube-offset")) panel.setAttribute("data-kube-offset", "8");

    offs.push(u.on(prev, "click", function () { go(-1); }));
    offs.push(u.on(next, "click", function () { go(1); }));
    offs.push(u.on(range, "click", function (e) {
      var b = e.target.closest(".k-datepicker__day");
      if (!b || b.disabled) return;
      setValue(b.getAttribute("data-date"), true);
      if (isOpen()) { close(); if (trigger) trigger.focus(); } // the source closes on pick
    }));
    offs.push(u.on(range, "keydown", function (e) {
      var b = e.target.closest(".k-datepicker__day");
      if (!b) return;
      var d = parseDay(b.getAttribute("data-date")), rtl = getComputedStyle(panel).direction === "rtl";
      var col = (d.getDay() - weekStart + 7) % 7, to;
      switch (e.key) {
        case "ArrowLeft": to = addDays(d, rtl ? 1 : -1); break;
        case "ArrowRight": to = addDays(d, rtl ? -1 : 1); break;
        case "ArrowUp": to = addDays(d, -7); break;
        case "ArrowDown": to = addDays(d, 7); break;
        case "Home": to = addDays(d, -col); break;
        case "End": to = addDays(d, 6 - col); break;
        case "PageUp": to = addMonths(d, e.shiftKey ? -12 : -1); break;
        case "PageDown": to = addMonths(d, e.shiftKey ? 12 : 1); break;
        default: return;
      }
      e.preventDefault();
      moveFocus(to);
    }));

    var pos = null;
    function unfollow() { if (pos) pos.destroy(); pos = null; }
    offs.push(u.on(panel, "beforetoggle", function (e) {
      if (e.newState !== "open") return;
      // Runs before the first painted frame of the open panel: size it, then place it.
      requestAnimationFrame(function () {
        syncHeight(true);
        if (managed() || !trigger || pos || !isOpen()) return;
        if (typeof Kube.position === "function") pos = Kube.position(panel, trigger, { side: "bottom", align: "center", offset: 8 });
        else {
          place();
          var offR = u.on(window, "resize", place), offS = u.on(window, "scroll", place, true);
          pos = { destroy: function () { offR(); offS(); } };
        }
      });
    }));
    offs.push(u.on(panel, "toggle", function (e) {
      var opened = e.newState === "open";
      if (trigger) trigger.setAttribute("aria-expanded", String(opened));
      if (opened) {
        syncHeight(true);
        var b = rove(value);
        if (b) b.focus();
      } else {
        unfollow();
        if (trigger && (document.activeElement === document.body || panel.contains(document.activeElement))) trigger.focus();
      }
    }));
    offs.push(unfollow);
    if (trigger) {
      if (isPopover()) {
        if (!trigger.hasAttribute("aria-haspopup")) trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", String(isOpen()));
      }
      // popovertarget and data-kube-open triggers are toggled natively or by the overlays family.
      var manual = !trigger.hasAttribute("popovertarget") && !trigger.hasAttribute("data-kube-open"), wasOpen = false;
      if (manual) {
        // Light dismiss closes the panel on pointerdown; remember that so the click does not reopen it.
        offs.push(u.on(trigger, "pointerdown", function () { wasOpen = isOpen(); }));
        offs.push(u.on(trigger, "click", function () {
          if (wasOpen) { wasOpen = false; return; }
          if (trigger.getAttribute("aria-disabled") !== "true" && isPopover()) toggle();
        }));
      }
      offs.push(u.on(trigger, "keydown", function (e) {
        if (!isPopover()) return;
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isOpen()) { e.preventDefault(); open(); }
        else if (manual && trigger.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); wasOpen = false; toggle(); }
      }));
      var clear = trigger.querySelector(".k-select__clear");
      if (clear) {
        if (!clear.getAttribute("aria-label")) clear.setAttribute("aria-label", "Clear current value");
        offs.push(u.on(clear, "pointerdown", function (e) { e.stopPropagation(); }));
        offs.push(u.on(clear, "click", function (e) { e.preventDefault(); e.stopPropagation(); setValue(null, true); trigger.focus(); }));
      }
    }

    render();
    triggerText();
    return {
      get value() { return value ? isoDay(value) : null; },
      setValue: function (d) { setValue(d, false); },
      next: function () { go(1); },
      prev: function () { go(-1); },
      open: open,
      close: close,
      destroy: function () { timers.forEach(clearTimeout); offs.forEach(function (f) { f(); }); },
    };
  });
})(window.Kube);

/* --- 40-overlays.js --- */
/* Kube overlays: layer stack, anchored positioning, dialog, sheet, popover, hover card, tooltip,
 * toasts, dismissible banners and alerts, image viewer.
 *
 * Behaviors: dialog, sheet, popover, hover-card, tooltip, toaster, banner, alert, image-zoom.
 * API: Kube.layers, Kube.position, Kube.open / Kube.close (+ openDialog, closeDialog), Kube.toast,
 *      Kube.openImage, Kube.dismiss, Kube.hideTooltip.
 * Triggers: data-kube-open="#id" opens a dialog, sheet or popover; data-kube-close closes the nearest one.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var on = util.on;
  var doc = document;
  var HAS_POPOVER = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
  var OVERLAY = '[data-kube~="dialog"], [data-kube~="sheet"], [data-kube~="popover"], dialog, [popover]';
  var OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };

  function now() { return performance.now(); }
  function num(v, d) { return typeof v === "number" && !isNaN(v) ? v : d; }
  function resolve(t) {
    if (typeof t !== "string") return t || null;
    try { return t ? doc.querySelector(t) : null; } catch (e) { return null; }
  }
  function contains(a, b) { return !!(a && b && (a === b || (a.contains && a.contains(b)))); }

  /* ---------- Layers ----------
   * One stack for everything that Escape or an outside press can close: dialogs, sheets, popovers,
   * hover cards, tooltips, and any menu that registers itself. Escape closes the topmost layer only.
   * An outside press closes non-modal layers from the top down, stopping at the layer it landed in.
   *   var layer = Kube.layers.push({ el: menu, anchor: trigger, close: function (reason) {...} });
   *   Kube.layers.remove(layer);
   */
  var stack = [];
  Kube.layers = {
    stack: stack,
    push: function (layer) { stack.push(layer); return layer; },
    remove: function (layer) { var i = stack.indexOf(layer); if (i >= 0) stack.splice(i, 1); },
    top: function () { return stack[stack.length - 1] || null; },
    closeTop: function (reason) { var t = Kube.layers.top(); if (t) t.close(reason || "api"); return !!t; },
  };

  // Bubble phase on window: a field that handles Escape itself (clear, cancel an edit) and calls
  // preventDefault() keeps it. preventDefault() here also stops the native <dialog> close request.
  on(window, "keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
    var top = Kube.layers.top();
    if (!top) return;
    // A bare auto [popover] opened outside the stack (e.g. a plain datepicker panel) sits above every
    // layer: let the browser close it, and keep the layers for the next Escape.
    if (HAS_POPOVER && [].some.call(doc.querySelectorAll(":popover-open"), function (p) {
      return p.getAttribute("popover") !== "manual" && !stack.some(function (l) { return l.el === p; });
    })) return;
    e.preventDefault();
    top.close("escape");
  });

  on(doc, "pointerdown", function (e) {
    var layers = stack.slice();
    for (var i = layers.length - 1; i >= 0; i--) {
      var l = layers[i];
      if (contains(l.el, e.target) || contains(l.anchor, e.target)) break;
      if (l.modal) break; // a modal layer handles presses on its own backdrop
      if (l.outside !== false) l.close("outside");
    }
  }, true);

  /* ---------- Scroll lock with scrollbar compensation ---------- */
  var locks = 0;
  function lockScroll() {
    if (locks++) return;
    var html = doc.documentElement;
    var bar = window.innerWidth - html.clientWidth;
    if (bar > 0 && String(getComputedStyle(html).scrollbarGutter || "").indexOf("stable") < 0) html.style.setProperty("--k-scrollbar-comp", bar + "px");
    html.setAttribute("data-kube-scroll-lock", "");
  }
  function unlockScroll() {
    if (locks === 0 || --locks > 0) return;
    var html = doc.documentElement;
    html.removeAttribute("data-kube-scroll-lock");
    html.style.removeProperty("--k-scrollbar-comp");
  }

  /* ---------- Focus ---------- */
  function focusInto(root) {
    var list = util.focusable(root);
    var auto = root.querySelector("[autofocus]");
    var target = auto && list.indexOf(auto) >= 0 ? auto : list[0];
    if (!target) { if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1"); target = root; }
    target.focus({ preventScroll: true });
  }
  // Keep Tab cycling inside root.
  function trapTab(e, root) {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    var list = util.focusable(root);
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1], active = doc.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
  }
  function restoreFocus(el, trigger) {
    var active = doc.activeElement;
    if (trigger && trigger.isConnected && (!active || active === doc.body || contains(el, active))) trigger.focus({ preventScroll: true });
  }

  function shake(el) {
    el.removeAttribute("data-animate");
    void el.offsetWidth; // restart the animation
    el.setAttribute("data-animate", "shake");
    var off = on(el, "animationend", function (e) { if (e.target === el) { el.removeAttribute("data-animate"); off(); } });
  }

  /* ---------- Kube.position ----------
   * Kube.position(floating, anchor, opts) places a fixed element next to an anchor and keeps it there.
   * anchor: an element, a DOMRect-like object, or { x, y } (a point, for context menus).
   * opts: side "top|right|bottom|left" (bottom), align "start|center|end" (center), offset (6),
   *       alignOffset (0), padding (6, kept clear of the viewport edges), flip (true), shift (true),
   *       arrow (element), arrowPadding (8), hideWhenDetached (false), autoUpdate (true), onPlace(fn).
   * Writes left/top, data-side, data-align, data-detached, --k-origin (transform origin pointing at the
   * anchor), --k-available-width/height (room on the chosen side); positions the arrow along the edge.
   * Returns { update(), destroy(), side, align }.
   */
  Kube.position = function (floating, anchor, opts) {
    opts = opts || {};
    var o = {
      side: opts.side || "bottom", align: opts.align || "center", offset: num(opts.offset, 6), alignOffset: num(opts.alignOffset, 0),
      padding: num(opts.padding, 6), flip: opts.flip !== false, shift: opts.shift !== false, arrow: opts.arrow || null,
      arrowPadding: num(opts.arrowPadding, 8), hideWhenDetached: !!opts.hideWhenDetached,
    };
    var api = { side: o.side, align: o.align, update: update, destroy: destroy };
    var frame = 0, offs = [], ro = null;

    function rectOf(a) {
      if (!a) return null;
      if (a.getBoundingClientRect) return a.isConnected === false ? null : a.getBoundingClientRect();
      var w = a.width || 0, h = a.height || 0, x = a.left != null ? a.left : a.x, y = a.top != null ? a.top : a.y;
      return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
    }
    function snap(v) { var d = window.devicePixelRatio || 1; return Math.round(v * d) / d; }

    function update() {
      frame = 0;
      var a = rectOf(anchor);
      if (!a || !floating.isConnected) return api;
      var html = doc.documentElement, vw = html.clientWidth, vh = html.clientHeight, pad = o.padding;
      var s = floating.style;
      s.position = "fixed"; s.margin = "0"; s.right = "auto"; s.bottom = "auto"; s.left = "0px"; s.top = "0px";
      var w = floating.offsetWidth, h = floating.offsetHeight;

      function main(side) {
        return side === "top" ? a.top - o.offset - h : side === "bottom" ? a.bottom + o.offset : side === "left" ? a.left - o.offset - w : a.right + o.offset;
      }
      function over(side) {
        var c = main(side);
        return side === "top" || side === "left" ? pad - c : c + (side === "bottom" ? h : w) - ((side === "bottom" ? vh : vw) - pad);
      }
      var side = o.side;
      if (o.flip && over(side) > 0 && over(OPPOSITE[side]) < over(side)) side = OPPOSITE[side];
      var vertical = side === "top" || side === "bottom";
      var size = vertical ? w : h, start = vertical ? a.left : a.top, length = vertical ? a.width : a.height;
      var align = o.align;
      if (vertical && align !== "center" && getComputedStyle(floating).direction === "rtl") align = align === "start" ? "end" : "start";
      var cross = align === "start" ? start + o.alignOffset : align === "end" ? start + length - size - o.alignOffset : start + length / 2 - size / 2;
      var limit = (vertical ? vw : vh) - pad - size;
      if (o.shift) cross = limit < pad ? pad : Math.min(Math.max(cross, pad), limit);
      var x = vertical ? cross : main(side), y = vertical ? main(side) : cross;
      s.left = snap(x) + "px";
      s.top = snap(y) + "px";

      var availH = side === "top" ? a.top - o.offset - pad : side === "bottom" ? vh - a.bottom - o.offset - pad : vh - 2 * pad;
      var availW = side === "left" ? a.left - o.offset - pad : side === "right" ? vw - a.right - o.offset - pad : vw - 2 * pad;
      s.setProperty("--k-available-height", Math.max(0, Math.floor(availH)) + "px");
      s.setProperty("--k-available-width", Math.max(0, Math.floor(availW)) + "px");

      var ax = util.clamp(a.left + a.width / 2 - x, 0, w), ay = util.clamp(a.top + a.height / 2 - y, 0, h);
      s.setProperty("--k-origin", side === "top" ? ax + "px " + h + "px" : side === "bottom" ? ax + "px 0px" : side === "left" ? w + "px " + ay + "px" : "0px " + ay + "px");
      floating.setAttribute("data-side", side);
      floating.setAttribute("data-align", o.align);

      if (o.arrow) {
        var as = o.arrow.style;
        o.arrow.setAttribute("data-side", side);
        if (vertical) { as.left = snap(util.clamp(ax - o.arrow.offsetWidth / 2, o.arrowPadding, w - o.arrow.offsetWidth - o.arrowPadding)) + "px"; as.top = ""; }
        else { as.top = snap(util.clamp(ay - o.arrow.offsetHeight / 2, o.arrowPadding, h - o.arrow.offsetHeight - o.arrowPadding)) + "px"; as.left = ""; }
      }

      var detached = a.bottom < 0 || a.top > vh || a.right < 0 || a.left > vw;
      if (o.hideWhenDetached && detached) floating.setAttribute("data-detached", ""); else floating.removeAttribute("data-detached");
      api.side = side;
      api.align = o.align;
      if (opts.onPlace) opts.onPlace(api);
      return api;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    function destroy() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      offs.forEach(function (f) { f(); });
      offs = [];
      if (ro) ro.disconnect();
    }

    if (opts.autoUpdate !== false) {
      offs.push(on(window, "scroll", schedule, { capture: true, passive: true }));
      offs.push(on(window, "resize", schedule));
      if (window.ResizeObserver) {
        ro = new ResizeObserver(schedule);
        ro.observe(floating);
        if (anchor && anchor.nodeType === 1) ro.observe(anchor);
      }
    }
    update();
    return api;
  };

  /* ---------- Dialog and sheet ---------- */
  function setupModal(el, kind) {
    var native = el.tagName === "DIALOG";
    var state = { open: false, trigger: null, layer: null, modal: false, backdrop: null, downOutside: false };
    var offs = [], heightRO = null, dragOff = null;

    function opt(k, d) { return util.opt(el, k, d); }

    function outsideRect(e) {
      var r = el.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    }

    // Returns true when the dialog is closing.
    function request(reason, value) {
      if (!state.open) return false;
      var blockable = reason === "escape" || reason === "outside" || reason === "drag";
      if (blockable && !opt("dismissable", true)) { shake(el); return false; }
      if (!util.emit(el, "close", { reason: reason, value: value })) { if (blockable) shake(el); return false; }
      if (native) el.close(value);
      finish();
      if (!native) hideFallback();
      return true;
    }

    function backdrop() {
      if (state.backdrop) return state.backdrop;
      var b = doc.createElement("div");
      b.className = "k-backdrop" + (kind === "sheet" ? " k-backdrop--blur" : /k-dialog--(confirm|form)/.test(el.className) ? " k-backdrop--dim" : "");
      b.hidden = true;
      el.parentNode.insertBefore(b, el);
      offs.push(on(b, "click", function () { if (opt("outside", true)) request("outside"); else shake(el); }));
      return (state.backdrop = b);
    }

    function hideFallback() {
      el.setAttribute("data-state", "closed");
      if (state.backdrop) state.backdrop.setAttribute("data-state", "closed");
      util.afterMotion(el, 400, function () {
        if (state.open) return;
        el.hidden = true;
        if (state.backdrop) state.backdrop.hidden = true;
      });
    }

    function adopt(trigger) {
      state.open = true;
      state.trigger = trigger || doc.activeElement;
      state.modal = native ? el.matches(":modal") : opt("modal", true);
      if (state.modal) lockScroll();
      state.layer = Kube.layers.push({ el: el, anchor: null, modal: state.modal, outside: opt("outside", true), kind: kind, close: function (r) { request(r); } });
      el.setAttribute("data-state", "open");
      startAutoHeight();
    }

    function open(trigger) {
      if (state.open) return;
      if (!util.emit(el, "open", { trigger: trigger || null })) return;
      var modal = opt("modal", true);
      if (modal) lockScroll(); // measure the scrollbar before the page loses it
      if (native) { if (modal) el.showModal(); else el.show(); }
      else {
        el.hidden = false;
        if (modal) { el.setAttribute("role", el.getAttribute("role") || "dialog"); el.setAttribute("aria-modal", "true"); var b = backdrop(); b.hidden = false; b.setAttribute("data-state", "open"); }
      }
      adopt(trigger);
      if (modal) unlockScroll(); // adopt() took its own lock
      focusInto(el);
    }

    function finish() {
      if (!state.open) return;
      state.open = false;
      Kube.layers.remove(state.layer);
      if (state.modal) unlockScroll();
      stopAutoHeight();
      el.setAttribute("data-state", "closed");
      restoreFocus(el, state.trigger);
      util.afterMotion(el, 400, function () { if (!state.open) util.emit(el, "closed", { value: native ? el.returnValue : undefined }); });
    }

    /* Content-driven height: the first child is measured and the dialog follows it over .3s. */
    function startAutoHeight() {
      if (!opt("auto-height", false) || !window.ResizeObserver || !el.firstElementChild) return;
      el.removeAttribute("data-height-ready");
      heightRO = new ResizeObserver(function () {
        if (!el.firstElementChild) return;
        var cs = getComputedStyle(el);
        el.style.height = el.firstElementChild.offsetHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + "px";
        if (!el.hasAttribute("data-height-ready")) requestAnimationFrame(function () { if (heightRO) el.setAttribute("data-height-ready", ""); });
      });
      heightRO.observe(el.firstElementChild);
    }
    function stopAutoHeight() {
      if (!heightRO) return;
      heightRO.disconnect();
      heightRO = null;
    }

    if (native) {
      // Escape normally arrives through Kube.layers; this catches other close requests (e.g. a back gesture).
      offs.push(on(el, "cancel", function (e) { e.preventDefault(); if (Kube.layers.top() === state.layer) request("escape"); }));
      offs.push(on(el, "close", finish));
      offs.push(on(el, "pointerdown", function (e) { state.downOutside = e.target === el && outsideRect(e); }));
      offs.push(on(el, "click", function (e) {
        var outside = state.downOutside && e.target === el && outsideRect(e);
        state.downOutside = false;
        if (!outside || !state.modal) return;
        if (opt("outside", true)) request("outside"); else shake(el);
      }));
      // Adopt dialogs opened with showModal() directly, and finish ones closed by removing [open].
      var mo = new MutationObserver(function () { if (el.open && !state.open) adopt(null); else if (!el.open && state.open) finish(); });
      mo.observe(el, { attributes: true, attributeFilter: ["open"] });
      offs.push(function () { mo.disconnect(); });
      if (el.open) adopt(null);
    } else if (!el.hasAttribute("data-state")) el.hidden = true;

    offs.push(on(el, "keydown", function (e) { if (state.open && state.modal) trapTab(e, el); }));
    offs.push(on(el, "invalid", function () { shake(el); }, true));
    if (kind === "sheet") dragOff = setupDrag(el, request);

    var api = {
      open: open,
      close: function (value) { request("api", value); },
      toggle: function (trigger) { if (state.open) request("api"); else open(trigger); },
      shake: function () { shake(el); },
      get isOpen() { return state.open; },
      destroy: function () {
        if (state.open) { if (native && el.open) el.close(); else finish(); }
        offs.forEach(function (f) { f(); });
        if (dragOff) dragOff();
        if (state.backdrop) state.backdrop.remove();
      },
    };
    return api;
  }

  /* Drag to dismiss from .k-sheet__grab (or [data-kube-drag-handle]): down for bottom sheets, toward the
     inline end for side sheets. Past 30% of the size, or a flick faster than 0.5px/ms, closes. */
  function setupDrag(el, request) {
    var side = el.classList.contains("k-sheet--side");
    var prop = side ? "--drag-x" : "--drag-y";
    var start = 0, t0 = 0, d = 0, active = false;
    function pos(e) { return side ? e.clientX : e.clientY; }
    var offs = [
      on(el, "pointerdown", function (e) {
        var h = e.target.closest && e.target.closest(".k-sheet__grab, [data-kube-drag-handle]");
        if (!h || !el.contains(h) || e.button !== 0) return;
        active = true; start = pos(e); t0 = now(); d = 0;
        try { h.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        el.removeAttribute("data-drag-release");
        el.setAttribute("data-dragging", "");
        e.preventDefault();
      }),
      on(el, "pointermove", function (e) {
        if (!active) return;
        var raw = pos(e) - start;
        d = raw > 0 ? raw : raw / (1.5 + Math.abs(raw) / 20); // rubber band against the dismiss direction
        el.style.setProperty(prop, d + "px");
      }),
      on(el, "pointerup", release),
      on(el, "pointercancel", release),
      on(el, "lostpointercapture", release),
    ];
    function release() {
      if (!active) return;
      active = false;
      var size = side ? el.offsetWidth : el.offsetHeight;
      var v = d / Math.max(1, now() - t0);
      el.removeAttribute("data-dragging");
      if (d > size * 0.3 || (d > 10 && v > 0.5)) {
        el.setAttribute("data-drag-release", ""); // keep the offset while the exit runs from there
        if (request("drag")) {
          util.afterMotion(el, 400, function () { el.removeAttribute("data-drag-release"); el.style.removeProperty(prop); });
          return;
        }
        el.removeAttribute("data-drag-release");
      }
      el.style.removeProperty(prop); // springs back over .6s
    }
    return function () { offs.forEach(function (f) { f(); }); };
  }

  Kube.register("dialog", function (el) { return setupModal(el, "dialog"); });
  Kube.register("sheet", function (el) { return setupModal(el, "sheet"); });

  /* ---------- Popover ---------- */
  Kube.register("popover", function (el) {
    var state = { open: false, anchor: null, layer: null, pos: null };
    if (HAS_POPOVER) el.setAttribute("popover", "manual"); // light dismiss and Escape go through Kube.layers
    else el.hidden = true;

    function opt(k, d) { return util.opt(el, k, d); }
    function setExpanded(v) { if (state.anchor && state.anchor.setAttribute) state.anchor.setAttribute("aria-expanded", String(v)); }

    function open(anchor) {
      if (state.open) return;
      anchor = anchor || resolve(opt("anchor", "")) || null;
      if (!util.emit(el, "open", { trigger: anchor })) return;
      state.open = true;
      state.anchor = anchor;
      if (HAS_POPOVER) { if (!el.matches(":popover-open")) el.showPopover(); } else el.hidden = false;
      el.setAttribute("data-state", "open");
      setExpanded(true);
      if (anchor) state.pos = Kube.position(el, anchor, { side: opt("side", "bottom"), align: opt("align", "start"), offset: opt("offset", 4), padding: opt("padding", 6) });
      state.layer = Kube.layers.push({ el: el, anchor: anchor, outside: opt("outside", true), kind: "popover", close: function (r) { close(r); } });
      var f = opt("focus", "auto");
      if (f === "first" || (f === "auto" && el.querySelector("input, select, textarea, [contenteditable=true]"))) focusInto(el);
    }

    function close(reason) {
      if (!state.open) return;
      if (!util.emit(el, "close", { reason: reason || "api" })) { shake(el); return; }
      state.open = false;
      Kube.layers.remove(state.layer);
      setExpanded(false);
      el.setAttribute("data-state", "closed");
      var hadFocus = contains(el, doc.activeElement);
      if (HAS_POPOVER) { if (el.matches(":popover-open")) el.hidePopover(); } else el.hidden = true;
      if (hadFocus || reason === "escape") restoreFocus(el, state.anchor);
      var pos = state.pos;
      state.pos = null;
      util.afterMotion(el, 250, function () { if (pos) pos.destroy(); if (!state.open) util.emit(el, "closed", { reason: reason }); });
    }

    // showPopover()/hidePopover() called directly still go through the stack.
    var offToggle = on(el, "toggle", function () {
      var shown = HAS_POPOVER && el.matches(":popover-open");
      if (shown && !state.open) open(null);
      else if (!shown && state.open && HAS_POPOVER) close("api");
    });

    return {
      open: open,
      close: function () { close("api"); },
      toggle: function (anchor) { if (state.open) close("api"); else open(anchor); },
      shake: function () { shake(el); },
      get isOpen() { return state.open; },
      update: function () { if (state.pos) state.pos.update(); },
      destroy: function () { offToggle(); if (state.open) close("api"); },
    };
  });

  /* ---------- Hover card: data-kube="hover-card" data-kube-target="#card" on the trigger ----------
     Opens 200ms after the pointer rests on the trigger (at once on keyboard focus), stays while the
     pointer is over the trigger or the card, closes 100ms after it leaves both. */
  Kube.register("hover-card", function (trigger) {
    var openT = 0, closeT = 0, layer = null, pos = null, isOpen = false;
    function card() { return resolve(util.opt(trigger, "target", "")); }
    function opt(k, d) { return util.opt(trigger, k, d); }
    var c0 = card();
    if (c0 && HAS_POPOVER) c0.setAttribute("popover", "manual");
    if (c0 && !HAS_POPOVER) c0.hidden = true;

    function clear() { clearTimeout(openT); clearTimeout(closeT); }
    function show() {
      clear();
      var c = card();
      if (isOpen || !c) return;
      if (!util.emit(trigger, "open", { card: c })) return;
      isOpen = true;
      if (HAS_POPOVER) c.showPopover(); else c.hidden = false;
      c.setAttribute("data-state", "open");
      trigger.setAttribute("aria-expanded", "true");
      pos = Kube.position(c, trigger, { side: opt("side", "bottom"), align: opt("align", "start"), offset: opt("offset", 6), padding: opt("padding", 15) });
      layer = Kube.layers.push({ el: c, anchor: trigger, kind: "hover-card", close: function (r) { hide(r); } });
    }
    function hide(reason) {
      clear();
      if (!isOpen) return;
      var c = card();
      isOpen = false;
      Kube.layers.remove(layer);
      trigger.setAttribute("aria-expanded", "false");
      if (c) {
        if (reason === "escape" && contains(c, doc.activeElement)) trigger.focus({ preventScroll: true });
        c.setAttribute("data-state", "closed");
        if (HAS_POPOVER) { if (c.matches(":popover-open")) c.hidePopover(); } else c.hidden = true;
      }
      var p = pos;
      pos = null;
      util.afterMotion(c || trigger, 250, function () { if (p) p.destroy(); });
      util.emit(trigger, "close", { reason: reason || "api" });
    }
    function later() { clearTimeout(openT); clearTimeout(closeT); closeT = setTimeout(function () { hide("leave"); }, opt("close-delay", 100)); }
    function enter(e) { if (e.pointerType === "touch") return; clearTimeout(closeT); if (!isOpen) { clearTimeout(openT); openT = setTimeout(show, opt("delay", 200)); } }

    var offs = [
      on(trigger, "pointerenter", enter),
      on(trigger, "pointerleave", function (e) { if (e.pointerType !== "touch") later(); }),
      on(trigger, "focusin", function () { try { if (trigger.matches(":focus-visible")) show(); } catch (err) { show(); } }),
      on(trigger, "focusout", function (e) { var c = card(); if (!contains(c, e.relatedTarget)) later(); }),
      on(doc, "pointerover", function (e) { var c = card(); if (isOpen && contains(c, e.target)) clearTimeout(closeT); }),
      on(doc, "pointerout", function (e) { var c = card(); if (isOpen && contains(c, e.target) && !contains(c, e.relatedTarget) && !contains(trigger, e.relatedTarget)) later(); }),
      on(doc, "focusout", function (e) { var c = card(); if (isOpen && contains(c, e.target) && !contains(c, e.relatedTarget) && !contains(trigger, e.relatedTarget)) later(); }),
    ];
    return { open: show, close: function () { hide("api"); }, destroy: function () { hide("api"); offs.forEach(function (f) { f(); }); } };
  });

  /* ---------- Tooltip: data-kube="tooltip" data-kube-tooltip="Copy link" [data-kube-kbd="Ctrl C"] ----------
     One bubble is shared and created on first use. 200ms open delay, then 0ms for 300ms after any
     tooltip closes (shared skip window). Keyboard focus shows it at once. */
  var tip = { el: null, trigger: null, timer: 0, openedAt: 0, lastClose: -1e9, layer: null, pos: null, suppressed: null };
  var SKIP_WINDOW = 300, CLICK_GUARD = 400;

  function tipBubble() {
    if (tip.el) return tip.el;
    var b = doc.createElement("div");
    b.id = util.uid("k-tooltip");
    b.setAttribute("role", "tooltip");
    if (HAS_POPOVER) b.setAttribute("popover", "manual"); else { b.hidden = true; b.style.zIndex = "70"; }
    doc.body.appendChild(b);
    return (tip.el = b);
  }
  // Label: data-kube-tooltip, else data-kube-text unless the element also copies (copy reads that as its
  // payload), else aria-label.
  function tipText(t) {
    var copies = (t.getAttribute("data-kube") || "").split(/\s+/).indexOf("copy") >= 0;
    return util.opt(t, "tooltip", "") || (copies ? "" : util.opt(t, "text", "")) || t.getAttribute("aria-label") || "";
  }

  function showTip(t, instant) {
    clearTimeout(tip.timer);
    if (tip.trigger === t || !t.isConnected || t.getAttribute("aria-expanded") === "true" || t.disabled) return;
    var text = tipText(t);
    if (!text) return;
    if (tip.trigger) hideTip(true);
    var b = tipBubble();
    var size = util.opt(t, "size", "");
    b.className = "k-tooltip" + (size ? " k-tooltip--" + size : "");
    b.textContent = "";
    var kbd = util.opt(t, "kbd", "");
    if (kbd) {
      var row = doc.createElement("span"), label = doc.createElement("span"), k = doc.createElement("kbd");
      row.className = "k-tooltip__row"; label.className = "k-tooltip__label"; k.className = "k-tooltip__kbd";
      label.textContent = text; k.textContent = kbd;
      row.appendChild(label); row.appendChild(k); b.appendChild(row);
    } else b.textContent = text;
    if (HAS_POPOVER) b.showPopover(); else b.hidden = false;
    tip.trigger = t;
    tip.openedAt = now();
    var ids = (t.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (ids.indexOf(b.id) < 0) t.setAttribute("aria-describedby", ids.concat(b.id).join(" "));
    // Radix tooltip trigger states, distinct from the "open" of a menu trigger.
    t.setAttribute("data-state", instant ? "instant-open" : "delayed-open");
    tip.pos = Kube.position(b, t, { side: util.opt(t, "side", "top"), align: util.opt(t, "align", "center"), offset: util.opt(t, "offset", 5), padding: 15, hideWhenDetached: true });
    tip.layer = Kube.layers.push({ el: b, anchor: t, kind: "tooltip", close: function () { hideTip(); } });
  }

  function hideTip(switching) {
    clearTimeout(tip.timer);
    var t = tip.trigger;
    if (!t) return;
    tip.trigger = null;
    if (!switching) tip.lastClose = now();
    if (HAS_POPOVER) { if (tip.el.matches(":popover-open")) tip.el.hidePopover(); } else tip.el.hidden = true;
    var ids = (t.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (id) { return id && id !== tip.el.id; });
    if (ids.length) t.setAttribute("aria-describedby", ids.join(" ")); else t.removeAttribute("aria-describedby");
    t.setAttribute("data-state", "closed");
    if (tip.pos) tip.pos.destroy();
    tip.pos = null;
    Kube.layers.remove(tip.layer);
  }

  function scheduleTip(t, delay) {
    clearTimeout(tip.timer);
    if (tip.trigger && tip.trigger !== t) { showTip(t, true); return; } // moving between triggers: no delay
    if (delay <= 0 || now() - tip.lastClose < SKIP_WINDOW) { showTip(t, true); return; }
    tip.timer = setTimeout(function () { showTip(t); }, delay);
  }

  Kube.hideTooltip = function () { hideTip(); };
  on(window, "blur", function () { hideTip(); });

  Kube.register("tooltip", function (t) {
    // The native title tooltip would double up.
    if (t.hasAttribute("title")) { if (!tipText(t)) t.setAttribute("data-kube-tooltip", t.getAttribute("title")); t.removeAttribute("title"); }
    function cancel() { clearTimeout(tip.timer); if (tip.trigger === t) hideTip(); }
    var offs = [
      on(t, "pointerenter", function (e) { if (e.pointerType === "touch" || tip.suppressed === t) return; scheduleTip(t, util.opt(t, "delay", 200)); }),
      on(t, "pointerleave", function () { if (tip.suppressed === t) tip.suppressed = null; cancel(); }),
      on(t, "focusin", function () { try { if (t.matches(":focus-visible")) scheduleTip(t, 0); } catch (err) { /* old engine */ } }),
      on(t, "focusout", cancel),
      on(t, "contextmenu", cancel),
      on(t, "click", function () {
        if (tip.trigger === t && now() - tip.openedAt < CLICK_GUARD) return; // the press that revealed it
        tip.suppressed = t; // stays closed until the pointer leaves
        cancel();
      }),
    ];
    return { show: function () { showTip(t); }, hide: cancel, destroy: function () { cancel(); offs.forEach(function (f) { f(); }); } };
  });

  /* ---------- Open / close API and declarative triggers ---------- */
  function instanceOf(el, create) {
    if (!el) return null;
    var names = ["dialog", "sheet", "popover"];
    for (var i = 0; i < names.length; i++) { var inst = Kube.get(el, names[i]); if (inst && inst.open) return inst; }
    if (!create) return null;
    var name = el.classList.contains("k-sheet") ? "sheet" : el.hasAttribute("popover") && el.tagName !== "DIALOG" ? "popover" : "dialog";
    var list = (el.getAttribute("data-kube") || "").split(/\s+/).filter(Boolean);
    if (list.indexOf(name) < 0) el.setAttribute("data-kube", list.concat(name).join(" "));
    Kube.init(el);
    return Kube.get(el, name) || null;
  }

  Kube.open = function (target, trigger) { var i = instanceOf(resolve(target), true); if (i) i.open(trigger || null); return i; };
  Kube.close = function (target, value) { var i = instanceOf(resolve(target), false); if (i) i.close(value); return i; };
  Kube.openDialog = Kube.open;
  Kube.closeDialog = Kube.close;

  on(doc, "click", function (e) {
    if (!e.target.closest) return;
    var t = e.target.closest("[data-kube-open], [popovertarget]");
    if (t && !t.disabled) {
      var sel = t.getAttribute("data-kube-open");
      var target = sel ? resolve(sel) : doc.getElementById(t.getAttribute("popovertarget"));
      var inst = instanceOf(target, sel != null); // plain popovertarget popovers stay native
      if (inst) {
        e.preventDefault();
        var action = sel ? "show" : t.getAttribute("popovertargetaction") || "toggle";
        if (action === "hide") inst.close(); else if (action === "show" && !inst.isOpen) inst.open(t); else if (action === "toggle") inst.toggle(t);
        return;
      }
    }
    var c = e.target.closest("[data-kube-close]");
    if (c) {
      var host = c.closest(OVERLAY);
      var hi = instanceOf(host, false);
      if (hi) { e.preventDefault(); hi.close(c.getAttribute("data-kube-close") || undefined); }
    }
  });

  /* ---------- Toasts ---------- */
  var ICONS = {
    success: '<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8.25l1.75 1.75 3.25-3.75"/>',
    danger: '<circle cx="8" cy="8" r="6.25"/><path d="M8 5v3.5M8 11h.01"/>',
    warning: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3M8 11.5h.01"/>',
    info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.5V11M8 5h.01"/>',
  };
  var CLOSE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  function svg(paths) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"; }

  var GAP = 8, VISIBLE = 3, SUCCESS_MS = 5000, SWIPE_PX = 45, SWIPE_V = 0.11;

  Kube.register("toaster", function (region) {
    region.setAttribute("data-managed", "");
    if (!region.hasAttribute("aria-live")) region.setAttribute("aria-live", "polite");
    if (!region.hasAttribute("aria-label")) region.setAttribute("aria-label", "Notifications");
    var toasts = []; // newest first
    var paused = false, blurred = false;

    function live() { return toasts.filter(function (t) { return !t.leaving; }); }

    function layout() {
      var items = live(), y = 0, front = items[0];
      region.style.setProperty("--front-h", (front ? front.h : 0) + "px");
      region.style.setProperty("--front-w", (front ? front.w : 0) + "px");
      items.forEach(function (t, i) {
        var s = t.el.style;
        s.setProperty("--i", String(Math.min(i, VISIBLE)));
        s.setProperty("--offset", y + "px");
        s.setProperty("--h", t.h + "px");
        s.setProperty("--w", t.w + "px");
        y += t.h + GAP;
        t.el.toggleAttribute("data-behind", i > 0);
        t.el.toggleAttribute("data-hidden", i >= VISIBLE);
      });
      region.style.setProperty("--stack-h", Math.max(0, y - GAP) + "px");
    }

    function measure(t) {
      var s = t.el.style, ph = s.height, pw = s.width;
      s.transition = "none"; s.height = "auto"; s.width = "auto";
      var cs = getComputedStyle(t.el); // fractional and untransformed; offsetWidth would round down and wrap the text
      t.h = parseFloat(cs.height);
      t.w = Math.ceil(parseFloat(cs.width) * 100) / 100;
      s.height = ph; s.width = pw; void t.el.offsetHeight; s.transition = "";
    }

    function setPaused() {
      var p = region.hasAttribute("data-expanded") || blurred;
      if (p === paused) return;
      paused = p;
      toasts.forEach(function (t) { if (p) stopTimer(t); else startTimer(t); });
    }
    function startTimer(t) {
      if (t.leaving || !(t.left > 0) || t.timer || paused || t.swiping) return;
      t.started = now();
      t.timer = setTimeout(function () { dismiss(t, "timeout"); }, t.left);
    }
    function stopTimer(t) {
      if (!t.timer) return;
      clearTimeout(t.timer);
      t.timer = 0;
      t.left -= now() - t.started;
    }

    function render(t, o) {
      var tone = o.tone && o.tone !== "info" ? o.tone : "";
      t.el.className = "k-alert k-toast" + (tone ? " k-alert--" + tone : "");
      t.el.setAttribute("role", tone === "danger" ? "alert" : "status");
      t.el.textContent = "";
      var row = doc.createElement("div");
      row.className = "k-alert__row";
      var iconKey = o.icon === false ? null : ICONS[o.tone || "info"] ? o.tone || "info" : "info";
      if (iconKey && tone !== "inverse") { var ic = doc.createElement("span"); ic.className = "k-alert__icon"; ic.innerHTML = svg(ICONS[iconKey]); row.appendChild(ic); }
      var content = doc.createElement("div");
      content.className = "k-alert__content";
      var title = doc.createElement("div");
      title.className = "k-alert__title";
      title.textContent = o.title || "";
      content.appendChild(title);
      if (o.description) { var d = doc.createElement("div"); d.className = "k-alert__description"; d.textContent = o.description; content.appendChild(d); }
      row.appendChild(content);
      if (o.action && o.action.label) {
        var acts = doc.createElement("div"), b = doc.createElement("button");
        acts.className = "k-alert__actions";
        b.type = "button"; b.className = "k-btn k-btn--sm"; b.textContent = o.action.label;
        b.addEventListener("click", function (e) { if (o.action.onClick) o.action.onClick(e, t.api); if (!e.defaultPrevented) dismiss(t, "action"); });
        acts.appendChild(b); row.appendChild(acts);
      }
      if (o.dismissible !== false) {
        var c = doc.createElement("button");
        c.type = "button"; c.className = "k-alert__close"; c.setAttribute("aria-label", "Close"); c.innerHTML = CLOSE_ICON;
        c.addEventListener("click", function () { dismiss(t, "close"); });
        row.appendChild(c);
      }
      t.el.appendChild(row);
      // Only success toasts without an action leave on their own, unless duration says otherwise.
      var ms = o.duration != null ? o.duration : o.tone === "success" && !o.action ? SUCCESS_MS : 0;
      t.left = ms > 0 && isFinite(ms) ? ms : 0;
    }

    function add(o) {
      o = o || {};
      var existing = o.id != null && toasts.filter(function (x) { return x.id === o.id && !x.leaving; })[0];
      if (existing) {
        stopTimer(existing);
        render(existing, o);
        measure(existing);
        layout();
        startTimer(existing);
        return existing.api;
      }
      var t = { id: o.id != null ? o.id : util.uid("k-toast"), el: doc.createElement("li"), h: 0, left: 0, timer: 0, leaving: false };
      t.api = { id: t.id, el: t.el, dismiss: function () { dismiss(t, "api"); }, update: function (n) { var m = {}; Object.keys(o).forEach(function (k) { m[k] = o[k]; }); Object.keys(n || {}).forEach(function (k) { m[k] = n[k]; }); m.id = t.id; o = m; return add(m); } };
      render(t, o);
      t.el.setAttribute("data-state", "open");
      region.insertBefore(t.el, region.firstChild);
      toasts.unshift(t);
      swipe(t);
      measure(t);
      layout();
      startTimer(t);
      util.emit(region, "toast", { id: t.id, el: t.el });
      return t.api;
    }

    function dismiss(t, reason, swiped) {
      if (!t || t.leaving) return;
      t.leaving = true;
      stopTimer(t);
      if (swiped) t.el.setAttribute("data-swipe-out", ""); else t.el.setAttribute("data-state", "closed");
      var hadFocus = contains(t.el, doc.activeElement);
      layout();
      util.emit(t.el, "dismiss", { id: t.id, reason: reason });
      util.afterMotion(t.el, swiped ? 200 : 300, function () {
        if (hadFocus && contains(t.el, doc.activeElement)) doc.activeElement.blur();
        t.el.remove();
        toasts.splice(toasts.indexOf(t), 1);
        if (!live().length) { region.removeAttribute("data-expanded"); setPaused(); }
      });
    }

    // Swipe toward the inline end to dismiss; the other way resists.
    function swipe(t) {
      var x0 = 0, t0 = 0, dx = 0, active = false;
      t.el.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || t.leaving || (e.target.closest && e.target.closest("button, a, input, textarea, select"))) return;
        active = true; x0 = e.clientX; t0 = now(); dx = 0;
        try { t.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        t.el.setAttribute("data-swiping", "");
        t.swiping = true; stopTimer(t);
      });
      t.el.addEventListener("pointermove", function (e) {
        if (!active) return;
        var raw = e.clientX - x0;
        dx = raw > 0 ? raw : raw / (1.5 + Math.abs(raw) / 20);
        t.el.style.setProperty("--swipe-x", dx + "px");
      });
      function end() {
        if (!active) return;
        active = false; t.swiping = false;
        var v = Math.abs(dx) / Math.max(1, now() - t0);
        t.el.removeAttribute("data-swiping");
        if (dx >= SWIPE_PX || (dx > 0 && v > SWIPE_V)) dismiss(t, "swipe", true);
        else { t.el.style.setProperty("--swipe-x", "0px"); startTimer(t); }
      }
      t.el.addEventListener("pointerup", end);
      t.el.addEventListener("pointercancel", end);
    }

    function expand(v) { if (v && !live().length) v = false; region.toggleAttribute("data-expanded", v); setPaused(); }
    var offs = [
      on(region, "pointerenter", function (e) { if (e.pointerType !== "touch") expand(true); }),
      on(region, "pointerleave", function () { if (!region.contains(doc.activeElement)) expand(false); }),
      on(region, "focusin", function () { expand(true); }),
      on(region, "focusout", function (e) { if (!region.contains(e.relatedTarget) && !region.matches(":hover")) expand(false); }),
      on(window, "blur", function () { blurred = true; setPaused(); }),
      on(window, "focus", function () { blurred = false; setPaused(); }),
      on(doc, "visibilitychange", function () { blurred = doc.hidden; setPaused(); }),
    ];

    return {
      add: add,
      dismiss: function (id) { toasts.slice().forEach(function (t) { if (id == null || t.id === id) dismiss(t, "api"); }); },
      layout: layout,
      destroy: function () { offs.forEach(function (f) { f(); }); toasts.forEach(stopTimer); },
    };
  });

  function toaster() {
    var r = doc.querySelector('[data-kube~="toaster"]');
    if (!r) {
      r = doc.createElement("ol");
      r.className = "k-toaster";
      r.setAttribute("data-kube", "toaster");
      doc.body.appendChild(r);
    }
    if (!Kube.get(r, "toaster")) Kube.init(r);
    return Kube.get(r, "toaster");
  }

  // Kube.toast({ title, description, tone: "info|success|warning|danger|inverse", action: { label, onClick },
  //              duration (ms; 0 = until closed), id (replace in place), icon: false, dismissible: false })
  Kube.toast = function (o) { if (typeof o === "string") o = { title: o }; return toaster().add(o); };
  Kube.toast.dismiss = function (id) { var r = doc.querySelector('[data-kube~="toaster"]'); var i = r && Kube.get(r, "toaster"); if (i) i.dismiss(id); };

  /* ---------- Banner / alert dismissal: collapses its height over .3s, then hides ---------- */
  function collapse(el, done) {
    if (util.reducedMotion()) { el.hidden = true; done(); return; }
    el.style.height = el.offsetHeight + "px";
    void el.offsetHeight;
    el.setAttribute("data-dismissing", "");
    el.style.height = "0px";
    util.afterMotion(el, 300, function () {
      el.hidden = true;
      el.removeAttribute("data-dismissing");
      el.style.height = "";
      done();
    });
  }

  Kube.dismiss = function (el, reason) {
    el = resolve(el);
    if (!el || el.hidden || el.hasAttribute("data-dismissing")) return;
    if (!util.emit(el, "dismiss", { reason: reason || "api" })) return;
    var key = util.opt(el, "remember", "");
    if (key) util.store.set("kube:dismissed:" + key, "1");
    var hadFocus = contains(el, doc.activeElement);
    collapse(el, function () {
      if (hadFocus && contains(el, doc.activeElement)) doc.activeElement.blur();
      util.emit(el, "dismissed", { reason: reason || "api" });
    });
  };

  function setupDismiss(el) {
    var key = util.opt(el, "remember", "");
    if (key && util.store.get("kube:dismissed:" + key)) el.hidden = true;
    return {
      destroy: on(el, "click", function (e) {
        var b = e.target.closest && e.target.closest(".k-banner__close, .k-alert__close, [data-kube-dismiss]");
        if (!b || b.closest('[data-kube~="banner"], [data-kube~="alert"]') !== el) return;
        Kube.dismiss(el, "close");
      }),
    };
  }
  Kube.register("banner", setupDismiss);
  Kube.register("alert", setupDismiss);

  /* ---------- Image viewer: Kube.openImage() and data-kube="image-zoom" ----------
   * Kube.openImage(src, alt, trigger) or Kube.openImage([{ src, alt, caption, transparent }], index, trigger).
   * A full-window stage over the media backdrop: zoom 1 = fit, -/+ by .25 up to 5x, wheel and pinch zoom
   * at the pointer, drag (or Space + drag) to pan, double-click toggles 2x, 0 resets. Arrow keys pan
   * 40px when zoomed, otherwise step through the gallery. Transparent images sit on a checkerboard.
   */
  var viewer = null;
  var ZOOM_MAX = 5, ZOOM_STEP = 0.25, WHEEL = 0.01, PAN_KEY = 40;

  function buildViewer() {
    var v = doc.createElement("dialog");
    v.className = "k-lightbox";
    v.setAttribute("data-kube", "dialog");
    v.setAttribute("data-kube-outside", "false"); // the stage covers the window; presses on it close instead
    v.setAttribute("aria-roledescription", "image viewer");
    var chev = function (d) { return svg('<path d="' + d + '"/>'); };
    v.innerHTML =
      '<div class="k-lightbox__stage"><img class="k-lightbox__img" alt="" draggable="false"></div>' +
      '<div class="k-lightbox__toolbar" role="toolbar" aria-label="Zoom">' +
        '<button class="k-lightbox__tool" type="button" data-zoom="out" aria-label="Zoom out">' + chev("M4 8h8") + "</button>" +
        '<span class="k-lightbox__divider" aria-hidden="true"></span>' +
        '<button class="k-lightbox__tool k-lightbox__percent" type="button" data-zoom="fit" aria-label="Fit to window">100%</button>' +
        '<span class="k-lightbox__divider" aria-hidden="true"></span>' +
        '<button class="k-lightbox__tool" type="button" data-zoom="in" aria-label="Zoom in">' + chev("M4 8h8M8 4v8") + "</button>" +
      "</div>" +
      '<button class="k-lightbox__nav k-lightbox__nav--prev" type="button" data-step="-1" aria-label="Previous image">' + chev("M10 3.5L5.5 8l4.5 4.5") + "</button>" +
      '<button class="k-lightbox__nav k-lightbox__nav--next" type="button" data-step="1" aria-label="Next image">' + chev("M6 3.5l4.5 4.5L6 12.5") + "</button>" +
      '<div class="k-lightbox__footer"><p class="k-lightbox__caption"></p><span class="k-lightbox__count" aria-live="polite"></span></div>' +
      '<button class="k-lightbox__close" type="button" aria-label="Close" data-kube-close>' + CLOSE_ICON + "</button>";
    doc.body.appendChild(v);
    Kube.init(v);

    var stage = v.querySelector(".k-lightbox__stage"), img = v.querySelector("img");
    var st = { items: [], index: 0, s: 1, x: 0, y: 0, space: false, pointers: new Map(), pinch: null, drag: null, moved: false };

    function fitRatio() { return img.naturalWidth ? img.offsetWidth / img.naturalWidth : 1; }
    function clampPan() {
      var r = stage.getBoundingClientRect(), w = img.offsetWidth * st.s, h = img.offsetHeight * st.s;
      var mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
      st.x = util.clamp(st.x, -mx, mx);
      st.y = util.clamp(st.y, -my, my);
    }
    function apply(animate) {
      clampPan();
      img.style.transition = animate === false ? "none" : "";
      img.style.transform = "translate(" + st.x + "px, " + st.y + "px) scale(" + st.s + ")";
      v.toggleAttribute("data-zoomed", st.s > 1);
      v.querySelector(".k-lightbox__percent").textContent = Math.round(st.s * fitRatio() * 100) + "%";
      v.querySelector('[data-zoom="out"]').disabled = st.s <= 1;
      v.querySelector('[data-zoom="in"]').disabled = st.s >= ZOOM_MAX;
    }
    // Zoom to s, keeping the image point under (cx, cy) in place.
    function zoomTo(s, cx, cy, animate) {
      s = util.clamp(s, 1, ZOOM_MAX);
      if (cx != null) {
        var r = img.getBoundingClientRect(), k = s / st.s;
        st.x += (1 - k) * (cx - (r.left + r.width / 2));
        st.y += (1 - k) * (cy - (r.top + r.height / 2));
      }
      if (s === 1) { st.x = 0; st.y = 0; }
      st.s = s;
      apply(animate);
    }
    function show(i) {
      var n = st.items.length;
      st.index = ((i % n) + n) % n;
      var it = st.items[st.index];
      st.s = 1; st.x = 0; st.y = 0;
      img.removeAttribute("data-transparent");
      img.alt = it.alt || "";
      img.src = it.src;
      v.setAttribute("aria-label", it.alt || "Image viewer");
      var cap = v.querySelector(".k-lightbox__caption");
      cap.textContent = it.caption || "";
      cap.hidden = !it.caption;
      v.querySelector(".k-lightbox__count").textContent = n > 1 ? st.index + 1 + " / " + n : "";
      v.toggleAttribute("data-gallery", n > 1);
      if (it.transparent) img.setAttribute("data-transparent", "");
      apply(false);
    }
    // Checkerboard when the image has see-through pixels (sampled on a small canvas; skipped when tainted).
    img.addEventListener("load", function () {
      apply(false);
      var it = st.items[st.index];
      if (!it || it.transparent != null || !/\.(png|webp|gif|svg|avif)(\?|#|$)|^data:image\/(png|webp|gif|svg|avif)|^blob:/i.test(it.src)) return;
      try {
        var c = doc.createElement("canvas"), n = 32;
        c.width = c.height = n;
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0, n, n);
        var px = g.getImageData(0, 0, n, n).data;
        for (var p = 3; p < px.length; p += 4) if (px[p] < 250) { img.setAttribute("data-transparent", ""); break; }
      } catch (e) { /* cross-origin image: no sampling */ }
    });

    stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomTo(st.s * Math.exp(-e.deltaY * WHEEL), e.clientX, e.clientY, false);
    }, { passive: false });
    stage.addEventListener("dblclick", function (e) { zoomTo(st.s > 1 ? 1 : 2, e.clientX, e.clientY); });
    stage.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      st.downOnStage = e.target === stage; // captured clicks target the stage, so remember where it began
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      st.moved = false;
      if (st.pointers.size === 2) {
        var pts = Array.from(st.pointers.values());
        st.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), s: st.s };
        st.drag = null;
      } else st.drag = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y };
    });
    stage.addEventListener("pointermove", function (e) {
      if (!st.pointers.has(e.pointerId)) return;
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pinch && st.pointers.size === 2) {
        var pts = Array.from(st.pointers.values());
        st.moved = true;
        zoomTo(st.pinch.s * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / st.pinch.d, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, false);
      } else if (st.drag && (st.s > 1 || st.space)) {
        var dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { st.moved = true; v.setAttribute("data-dragging", ""); }
        st.x = st.drag.ox + dx; st.y = st.drag.oy + dy;
        apply(false);
      } else if (st.drag && Math.abs(e.clientX - st.drag.x) + Math.abs(e.clientY - st.drag.y) > 3) st.moved = true;
    });
    function lift(e) {
      st.pointers.delete(e.pointerId);
      if (st.pointers.size < 2) st.pinch = null;
      if (!st.pointers.size) { st.drag = null; v.removeAttribute("data-dragging"); }
    }
    stage.addEventListener("pointerup", lift);
    stage.addEventListener("pointercancel", lift);
    // A press on the empty stage (not a drag, not the image) closes, like a backdrop.
    stage.addEventListener("click", function (e) { if (st.downOnStage && !st.moved && e.detail < 2) Kube.close(v); });

    v.addEventListener("click", function (e) {
      var z = e.target.closest && e.target.closest("[data-zoom]"), step = e.target.closest && e.target.closest("[data-step]");
      if (z) zoomTo(z.getAttribute("data-zoom") === "fit" ? 1 : st.s + (z.getAttribute("data-zoom") === "in" ? ZOOM_STEP : -ZOOM_STEP));
      if (step) show(st.index + Number(step.getAttribute("data-step")));
    });
    v.addEventListener("keydown", function (e) {
      if (e.code === "Space" && !(e.target.closest && e.target.closest("button"))) { st.space = true; v.setAttribute("data-pan-ready", ""); e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key, arrows = { ArrowLeft: [PAN_KEY, 0], ArrowRight: [-PAN_KEY, 0], ArrowUp: [0, PAN_KEY], ArrowDown: [0, -PAN_KEY] };
      if (k === "+" || k === "=") zoomTo(st.s + ZOOM_STEP);
      else if (k === "-") zoomTo(st.s - ZOOM_STEP);
      else if (k === "0") zoomTo(1);
      else if (arrows[k] && st.s > 1) { st.x += arrows[k][0]; st.y += arrows[k][1]; apply(); }
      else if ((k === "ArrowLeft" || k === "ArrowRight") && st.items.length > 1) show(st.index + (k === "ArrowRight" ? 1 : -1));
      else return;
      e.preventDefault();
    });
    v.addEventListener("keyup", function (e) { if (e.code === "Space") { st.space = false; v.removeAttribute("data-pan-ready"); } });
    v.addEventListener("kube:closed", function () { img.removeAttribute("src"); });
    on(window, "resize", function () { if (v.open) apply(false); });

    return { el: v, show: function (items, index) { st.items = items; show(index || 0); } };
  }

  function itemFromTrigger(el) {
    var img = el.querySelector("img");
    var fig = el.closest("figure"), cap = fig && fig.querySelector("figcaption");
    var t = el.getAttribute("data-kube-transparent");
    return {
      src: util.opt(el, "src", "") || (img && (img.currentSrc || img.src)) || "",
      alt: img ? img.alt : el.getAttribute("aria-label") || "",
      caption: util.opt(el, "caption", "") || (cap ? cap.textContent.trim() : ""),
      transparent: t === null ? undefined : t !== "false",
    };
  }

  Kube.openImage = function (src, alt, trigger) {
    var items, index = 0;
    if (Array.isArray(src)) { items = src; index = typeof alt === "number" ? alt : 0; }
    else items = [{ src: src, alt: alt || "" }];
    items = items.filter(function (it) { return it && it.src; });
    if (!items.length) return null;
    if (!viewer) viewer = buildViewer();
    viewer.show(items, index);
    Kube.open(viewer.el, trigger || doc.activeElement);
    return viewer.el;
  };

  // data-kube-group="name" links triggers into one gallery, in document order.
  Kube.register("image-zoom", function (el) {
    return {
      destroy: on(el, "click", function (e) {
        var group = util.opt(el, "group", "");
        var els = group ? [].filter.call(doc.querySelectorAll('[data-kube~="image-zoom"]'), function (x) { return x.getAttribute("data-kube-group") === group; }) : [el];
        var items = els.map(itemFromTrigger);
        if (!items[els.indexOf(el)] || !items[els.indexOf(el)].src) return;
        e.preventDefault();
        Kube.openImage(items, els.indexOf(el), el);
      }),
    };
  });
})(window.Kube);

/* --- 50-shell.js --- */
/* Kube app shell behaviors: side-panel, bottom-panel, sidebar, nav-section, nav-list, tabs, page-header, nav-rail,
 * plus Kube.spring. Panel and sidebar sizes are driven frame by frame by a real spring (the source's Motion
 * "duration + bounce" springs), not by CSS transitions; under prefers-reduced-motion every change is instant.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var now = function () { return performance.now(); };
  var isRtl = function (el) { return getComputedStyle(el).direction === "rtl"; };

  /* ---------------------------------------------------------------- spring */

  // Port of Motion's findSpring: damping ratio = 1 - bounce, natural frequency solved with 12 Newton steps so the
  // oscillation envelope falls to 0.001 at `duration`. The animation then ends at exactly `duration` and snaps.
  var SAFE_MIN = 0.001;
  function solveSpring(duration, bounce, velocity) {
    var zeta = util.clamp(1 - bounce, 0.05, 1);
    var d = util.clamp(duration, 0.01, 10);
    var v = velocity || 0;
    var envelope, derivative;
    if (zeta < 1) {
      envelope = function (w) {
        var decay = w * zeta;
        return SAFE_MIN - ((decay - v) / (w * Math.sqrt(1 - zeta * zeta))) * Math.exp(-decay * d);
      };
      derivative = function (w) {
        var delta = w * zeta * d;
        var a = delta * v + v;
        var b = zeta * zeta * w * w * d;
        var g = w * w * Math.sqrt(1 - zeta * zeta);
        var factor = -envelope(w) + SAFE_MIN > 0 ? -1 : 1;
        return (factor * ((a - b) * Math.exp(-delta))) / g;
      };
    } else {
      envelope = function (w) { return -SAFE_MIN + Math.exp(-w * d) * ((w - v) * d + 1); };
      derivative = function (w) { return Math.exp(-w * d) * (d * d * (v - w)); };
    }
    var w = 5 / d;
    for (var i = 1; i < 12; i++) w = w - envelope(w) / derivative(w);
    if (!isFinite(w)) return { stiffness: 100, damping: 10 };
    return { stiffness: w * w, damping: zeta * 2 * w };
  }

  // Kube.spring(from, to, { duration: s, bounce, velocity: units/s }) -> { duration: ms, at(ms) -> value }.
  Kube.spring = function (from, to, opts) {
    opts = opts || {};
    var dur = opts.duration == null ? 0.5 : opts.duration;
    var v0 = -(opts.velocity || 0) / 1000; // per ms, sign as in Motion
    var s = solveSpring(dur, opts.bounce == null ? 0.1 : opts.bounce, v0);
    var zeta = s.damping / (2 * Math.sqrt(s.stiffness));
    var w0 = Math.sqrt(s.stiffness) / 1000;
    var delta = to - from;
    var ms = dur * 1000;
    var curve;
    if (zeta < 1) {
      var wd = w0 * Math.sqrt(1 - zeta * zeta);
      curve = function (t) {
        var env = Math.exp(-zeta * w0 * t);
        return to - env * (((v0 + zeta * w0 * delta) / wd) * Math.sin(wd * t) + delta * Math.cos(wd * t));
      };
    } else {
      curve = function (t) { return to - Math.exp(-w0 * t) * (delta + (v0 + w0 * delta) * t); };
    }
    return { duration: ms, stiffness: s.stiffness, damping: s.damping, at: function (t) { return t >= ms ? to : curve(Math.max(0, t)); } };
  };

  // A value animated by springs; retargeting mid-flight carries the current velocity (5ms sample, as Motion).
  function Motion(value, onChange) { this.value = value; this.onChange = onChange; this.raf = 0; this.curve = null; }
  Motion.prototype.stop = function () { cancelAnimationFrame(this.raf); this.raf = 0; this.curve = null; };
  Motion.prototype.set = function (v) { this.stop(); this.value = v; this.onChange(v); };
  Motion.prototype.animating = function () { return !!this.curve; };
  Motion.prototype.velocity = function () {
    var c = this.curve;
    if (!c) return 0;
    var t = now() - this.start;
    if (t >= c.duration || t <= 0) return 0;
    var prev = Math.max(0, t - 5);
    return ((c.at(t) - c.at(prev)) / (t - prev)) * 1000;
  };
  Motion.prototype.to = function (target, spring, done) {
    var self = this;
    if (util.reducedMotion()) { this.set(target); if (done) done(); return; }
    var vel = this.velocity();
    cancelAnimationFrame(this.raf);
    if (this.value === target && !vel) { this.curve = null; if (done) done(); return; }
    this.curve = Kube.spring(this.value, target, { duration: spring.duration, bounce: spring.bounce, velocity: vel });
    this.start = now();
    var curve = this.curve;
    var tick = function () {
      if (self.curve !== curve) return;
      var t = now() - self.start;
      self.value = curve.at(t);
      var finished = t >= curve.duration;
      if (finished) { self.curve = null; self.raf = 0; }
      self.onChange(self.value);
      if (finished) { if (done) done(); } else self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  var PANEL_SPRING = { duration: 0.5, bounce: 0.1 };   // right / bottom panels and full width
  var SIDEBAR_SPRING = { duration: 0.3, bounce: 0.1 }; // sidebar collapse / expand, peek enter
  var PEEK_EXIT = { duration: 0.2, bounce: 0.1 };

  /* ---------------------------------------------------------------- shared helpers */

  // data-kube-toggle="#id" on any element toggles the side-panel, bottom-panel or sidebar with that id.
  var TOGGLEABLE = ["side-panel", "bottom-panel", "sidebar"];
  function toggleable(target) {
    for (var i = 0; i < TOGGLEABLE.length; i++) { var inst = Kube.get(target, TOGGLEABLE[i]); if (inst && inst.toggle) return inst; }
    return null;
  }
  function query(sel) { try { return sel ? document.querySelector(sel) : null; } catch (e) { return null; } }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-kube-toggle]");
    var target = t && query(t.getAttribute("data-kube-toggle"));
    var inst = target && toggleable(target);
    if (!inst) return;
    e.preventDefault();
    inst.toggle({ source: "trigger" });
  });
  function triggersOf(el) {
    return el.id ? [].slice.call(document.querySelectorAll('[data-kube-toggle="#' + CSS.escape(el.id) + '"]')) : [];
  }
  function syncTriggers(el, open) {
    triggersOf(el).forEach(function (t) {
      t.setAttribute("aria-expanded", String(open));
      if (!t.hasAttribute("aria-controls")) t.setAttribute("aria-controls", el.id);
    });
  }
  // Focus left inside a closing region goes back to the first visible trigger (as the source does for its sidebar).
  function returnFocus(el) {
    var t = triggersOf(el).filter(function (x) { return x.getClientRects().length && !x.closest("[inert]"); })[0];
    if (t) t.focus({ preventScroll: true });
  }

  // Port of the source's resize handle: pointer drag with an unclamped size (the owner decides what a size
  // past the limits means), double-click resets, arrows step by 10px toward or away from the edge, Home/End.
  // edge is the physical edge the handle sits on: "left" | "right" | "top" | "bottom".
  function resizer(handle, o) {
    if (!handle) return function () {};
    var drag = null;
    var horiz = function () { var e = o.edge(); return e === "left" || e === "right"; };
    function sizeAt(e) {
      var edge = o.edge();
      var d = horiz() ? e.clientX - drag.x : e.clientY - drag.y;
      return edge === "right" || edge === "bottom" ? drag.size + d : drag.size - d;
    }
    function finish(e, commit) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (commit && drag.moved) drag.last = sizeAt(e); // the release position counts, as in the source
      var d = drag;
      drag = null;
      handle.removeAttribute("data-resizing");
      if (handle.hasPointerCapture && handle.hasPointerCapture(d.id)) handle.releasePointerCapture(d.id);
      if (o.stop) o.stop();
      if (d.moved && d.last != null) o.end(d.last);
    }
    var offs = [
      util.on(handle, "pointerdown", function (e) {
        if (e.button !== 0 || drag) return;
        e.preventDefault();
        if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, size: o.get(), last: null, moved: false };
        handle.setAttribute("data-resizing", "");
        if (o.start) o.start();
      }),
      util.on(handle, "pointermove", function (e) {
        if (!drag || drag.id !== e.pointerId) return;
        e.preventDefault();
        if (horiz() ? e.clientX !== drag.x : e.clientY !== drag.y) drag.moved = true;
        if (!drag.moved) return;
        drag.last = sizeAt(e);
        o.set(drag.last);
      }),
      util.on(handle, "pointerup", function (e) { finish(e, true); }),
      util.on(handle, "pointercancel", function (e) { finish(e, false); }),
      util.on(handle, "lostpointercapture", function (e) { finish(e, false); }),
      util.on(handle, "dblclick", function (e) { e.preventDefault(); if (o.reset) o.reset(); }),
      util.on(handle, "keydown", function (e) {
        var edge = o.edge(), step = 10, cur = o.get(), min = o.min(), max = o.max(), next = null;
        if (e.key === "Home") next = min;
        else if (e.key === "End") next = max;
        else if (edge === "left" || edge === "right") {
          if (e.key === "ArrowLeft") next = cur + (edge === "left" ? step : -step);
          else if (e.key === "ArrowRight") next = cur + (edge === "right" ? step : -step);
        } else if (e.key === "ArrowUp") next = cur + (edge === "top" ? step : -step);
        else if (e.key === "ArrowDown") next = cur + (edge === "bottom" ? step : -step);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        next = util.clamp(next, min, max);
        o.set(next);
        o.end(next);
      }),
    ];
    return function () { offs.forEach(function (f) { f(); }); };
  }
  function aria(handle, min, max, now) {
    if (!handle) return;
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(now)));
  }
  function observe(targets, fn) {
    if (typeof ResizeObserver !== "function") { var off = util.on(window, "resize", fn); return off; }
    var ro = new ResizeObserver(fn);
    targets.forEach(function (t) { if (t) ro.observe(t); });
    return function () { ro.disconnect(); };
  }

  /* ---------------------------------------------------------------- side-panel */

  // .k-side-panel inside a .k-split. Its slot width is progress x size; the frame keeps the full size at the slot's
  // start edge, so the main column shrinks while the panel's content slides in without reflowing.
  // Size is kept as a 0-1 fraction of [min, max] where max = max(320, split - reserve), as the source stores it.
  Kube.register("side-panel", function (el, u) {
    var split = el.parentElement;
    var frame = el.querySelector(".k-side-panel__frame");
    var handle = el.querySelector(":scope > .k-resizer");
    var MIN = 320;
    var key = u.opt(el, "key", "");
    var reserve = u.opt(el, "reserve", 352);
    var defaultSize = u.opt(el, "default", 600);
    var tbLeft = u.opt(el, "titlebar-left", 0), tbRight = u.opt(el, "titlebar-right", 0);
    var open = el.getAttribute("data-state") === "open";
    var full = false;
    var ratio = null;
    var lastSize = 0;

    function W() { return split.clientWidth; }
    function bounds(w) { var max = Math.max(MIN, w - reserve); return { min: Math.min(MIN, max), max: max }; }
    function clampSize(px, w) { var b = bounds(w); return Math.max(b.min, Math.min(isFinite(px) ? px : 600, b.max)); }
    function toRatio(px, w) { var b = bounds(w), span = b.max - b.min; return span === 0 ? 0 : util.clamp((clampSize(px, w) - b.min) / span, 0, 1); }
    function fromRatio(r, w) { var b = bounds(w); return clampSize(b.min + util.clamp(r, 0, 1) * (b.max - b.min), w); }
    function shellHeight() { var app = el.closest(".k-app"); return (app || document.documentElement).clientHeight; }
    // The source's first-open width: 600 means "document size", max(320, min(height x 1.6, main - 500), min(640, main - 352)).
    function defaultPx(w) {
      return defaultSize === 600 ? Math.max(MIN, Math.min(shellHeight() * 1.6, w - 500), Math.min(640, w - reserve)) : defaultSize;
    }
    function readRatio(w) {
      var s = key ? parseFloat(u.store.get(key)) : NaN;
      if (!isFinite(s)) return toRatio(defaultPx(w), w);
      return s <= 1 ? util.clamp(s, 0, 1) : toRatio(s, w);
    }
    function persist() { if (key && ratio != null) u.store.set(key, String(Math.round(ratio * 1e4) / 1e4)); }

    var progress = new Motion(open ? 1 : 0, render);
    var fullP = new Motion(0, render);
    el.setAttribute("data-kube-driven", "");
    el.inert = !open;

    function render() {
      var w = W();
      if (!w) return;
      if (ratio == null) ratio = readRatio(w);
      var splitSize = fromRatio(ratio, w);
      var narrow = w - splitSize < MIN; // the main column would drop under 320px: take the whole split
      var f = narrow ? 1 : util.clamp(fullP.value, 0, 1);
      var size = splitSize + (w - splitSize) * f;
      var p = util.clamp(progress.value, 0, 1); // the source clamps progress, so the width never overshoots
      var shown = p * size;
      lastSize = splitSize;
      el.style.width = shown + "px";
      el.style.setProperty("--k-panel-open-w", size + "px");
      el.toggleAttribute("data-shown", shown > 0.01 || open);
      el.setAttribute("data-mode", f > 0.999 ? "full" : "split");
      el.toggleAttribute("data-covering", open && shown >= w - 0.5);
      var b = bounds(w);
      aria(handle, b.min, b.max, splitSize);
      if (frame) frame.style.clipPath = tbLeft || tbRight ? clip(w, shown, size) : "";
    }
    // Titlebar controls drawn over the panel's top toolbar band (window buttons, a header toolbar) stay visible:
    // that band is cut where they overlap, as the source's clip polygon does. Insets are physical px.
    function clip(w, shown, size) {
      var rtl = isRtl(el);
      var left = rtl ? 0 : w - shown, right = left + shown;
      var c = Math.min(shown, Math.max(0, tbLeft - left));
      var l = Math.max(c, shown - Math.max(0, tbRight - (w - right)));
      var off = rtl ? shown - size : 0; // the frame is anchored at the inline start, which is the right edge in RTL
      var T = "var(--toolbar, 46px)";
      c -= off; l -= off;
      return "polygon(" + c + "px 0, " + l + "px 0, " + l + "px " + T + ", 100% " + T + ", 100% 100%, 0 100%, 0 " + T + ", " + c + "px " + T + ")";
    }

    function setOpen(next, opts) {
      opts = opts || {};
      if (next === open) return true;
      if (!u.emit(el, next ? "open" : "close", { source: opts.source || "api" })) return false;
      var hadFocus = !next && el.contains(document.activeElement);
      open = next;
      el.setAttribute("data-state", open ? "open" : "closed");
      el.inert = !open;
      syncTriggers(el, open);
      if (!open && full) { full = false; fullP.to(0, PANEL_SPRING); }
      if (opts.animate === false) progress.set(open ? 1 : 0);
      else progress.to(open ? 1 : 0, PANEL_SPRING);
      if (hadFocus) returnFocus(el);
      return true;
    }

    var offResize = resizer(handle, {
      edge: function () { return isRtl(el) ? "right" : "left"; },
      get: function () { return lastSize; },
      min: function () { return bounds(W()).min; },
      max: function () { return bounds(W()).max; },
      start: function () { el.setAttribute("data-resizing", ""); },
      stop: function () { el.removeAttribute("data-resizing"); },
      set: function (e) {
        var w = W(), b = bounds(w);
        var keep = e >= MIN * 0.5; // the source closes while dragged under half the minimum, reopens above it
        if (keep !== open) setOpen(keep, { source: "drag" });
        var toFull = keep && e > b.max && w - e < MIN * 0.5;
        if (toFull !== full) {
          full = toFull;
          if (full) progress.set(1);
          fullP.to(full ? 1 : 0, PANEL_SPRING);
        }
        if (keep && !full) ratio = toRatio(e, w);
        render();
        u.emit(el, "resize", { width: lastSize, ratio: ratio, full: full, final: false });
      },
      end: function (e) {
        if (e < MIN * 0.5 || full) return;
        persist();
        u.emit(el, "resize", { width: lastSize, ratio: ratio, full: false, final: true });
      },
      reset: function () {
        var w = W();
        ratio = toRatio(defaultPx(w), w);
        persist();
        render();
        u.emit(el, "resize", { width: lastSize, ratio: ratio, full: full, final: true });
      },
    });
    var offObserve = observe([split], render);
    syncTriggers(el, open);
    render();

    return {
      open: function (o) { return setOpen(true, o); },
      close: function (o) { return setOpen(false, o); },
      toggle: function (o) { return setOpen(!open, o); },
      isOpen: function () { return open; },
      width: function () { return lastSize; },
      setWidth: function (px) { var w = W(); ratio = toRatio(px, w); persist(); render(); },
      destroy: function () {
        progress.stop(); fullP.stop(); offResize(); offObserve();
        el.removeAttribute("data-kube-driven"); el.removeAttribute("data-shown"); el.removeAttribute("data-mode"); el.removeAttribute("data-covering");
        el.style.removeProperty("width"); el.style.removeProperty("--k-panel-open-w");
        if (frame) frame.style.clipPath = "";
      },
    };
  });

  /* ---------------------------------------------------------------- bottom-panel */

  // .k-bottom-panel inside a .k-split--vertical: the same mechanism on the block axis. Height is progress x size
  // and opacity follows progress (as in the source); the size is kept in px within max(160, min(h, 50% of the area)).
  Kube.register("bottom-panel", function (el, u) {
    var host = el.parentElement;
    var handle = el.querySelector(":scope > .k-resizer");
    var key = u.opt(el, "key", "");
    var def = u.opt(el, "default", 280);
    var open = el.getAttribute("data-state") === "open";
    var stored = key ? parseFloat(u.store.get(key)) : NaN;
    var size = isFinite(stored) ? stored : def;
    var shownSize = 0;

    function maxH() { return Math.max(160, host.clientHeight * 0.5); }
    function clampH(h) { return isFinite(h) ? Math.max(160, Math.min(h, host.clientHeight * 0.5)) : def; }
    var progress = new Motion(open ? 1 : 0, render);
    el.setAttribute("data-kube-driven", "");
    el.inert = !open;

    function render() {
      if (!host.clientHeight) return;
      var h = clampH(size), p = progress.value;
      shownSize = h;
      el.style.height = util.clamp(p, 0, 1) * h + "px";
      el.style.opacity = String(util.clamp(p, 0, 1));
      el.style.setProperty("--k-bottom-open-h", h + "px");
      el.toggleAttribute("data-shown", p > 0.001 || open);
      aria(handle, 160, maxH(), h);
    }
    function setOpen(next, opts) {
      opts = opts || {};
      if (next === open) return true;
      if (!u.emit(el, next ? "open" : "close", { source: opts.source || "api" })) return false;
      var hadFocus = !next && el.contains(document.activeElement);
      open = next;
      el.setAttribute("data-state", open ? "open" : "closed");
      el.inert = !open;
      syncTriggers(el, open);
      if (opts.animate === false) progress.set(open ? 1 : 0); else progress.to(open ? 1 : 0, PANEL_SPRING);
      if (hadFocus) returnFocus(el);
      return true;
    }
    var offResize = resizer(handle, {
      edge: function () { return "top"; },
      get: function () { return shownSize; },
      min: function () { return 160; },
      max: maxH,
      start: function () { el.setAttribute("data-resizing", ""); },
      stop: function () { el.removeAttribute("data-resizing"); },
      set: function (e) {
        if (e < 80) { setOpen(false, { source: "drag" }); return; } // the source closes under half of 160
        size = clampH(e);
        render();
        u.emit(el, "resize", { height: shownSize, final: false });
      },
      end: function (e) {
        if (e < 80) return;
        size = clampH(e);
        if (key) u.store.set(key, String(Math.round(size)));
        u.emit(el, "resize", { height: shownSize, final: true });
      },
      reset: function () { size = clampH(def); if (key) u.store.set(key, String(Math.round(size))); render(); },
    });
    var offObserve = observe([host], render);
    syncTriggers(el, open);
    render();
    return {
      open: function (o) { return setOpen(true, o); },
      close: function (o) { return setOpen(false, o); },
      toggle: function (o) { return setOpen(!open, o); },
      isOpen: function () { return open; },
      height: function () { return shownSize; },
      destroy: function () {
        progress.stop(); offResize(); offObserve();
        el.removeAttribute("data-kube-driven"); el.removeAttribute("data-shown");
        ["height", "opacity", "--k-bottom-open-h"].forEach(function (p) { el.style.removeProperty(p); });
      },
    };
  });

  /* ---------------------------------------------------------------- sidebar */

  // .k-sidebar: resizable (240..min(520, window - 240), stored px, 340 by default as in the source), collapses with a
  // 0.3s spring (content fades and slides 16px), becomes an overlay drawer with a scrim under the breakpoint, and
  // can peek (show as a floating popover while collapsed) from any [data-kube-peek="#id"] area; opening while
  // peeking pins it and the popover "settles" into the docked column.
  Kube.register("sidebar", function (el, u) {
    var app = el.closest(".k-app") || el.parentElement;
    var inner = el.querySelector(".k-sidebar__inner");
    var handle = el.querySelector(":scope > .k-resizer");
    if (!inner) return {};
    var key = u.opt(el, "key", "");
    var def = u.opt(el, "default", 340);
    var bp = u.opt(el, "breakpoint", 768);
    function clampW(w) { return isFinite(w) ? Math.max(240, Math.min(w, 520, window.innerWidth - 240)) : Math.max(def, 240); }
    var stored = key ? parseFloat(u.store.get(key)) : NaN;
    var width = clampW(isFinite(stored) ? stored : def);
    var storedOpen = key ? u.store.get(key + ":open") : null;
    var docked = storedOpen === null ? el.getAttribute("data-state") !== "collapsed" : storedOpen === "true";
    var narrow = app.clientWidth > 0 && app.clientWidth < bp;
    var open = narrow ? false : docked;
    var peeking = false, settling = false;
    var progress = new Motion(open ? 1 : 0, render);
    var peekP = new Motion(0, render), peekOff = new Motion(1.5, render);
    var scrim = document.createElement("div");
    scrim.className = "k-sidebar__scrim";
    scrim.setAttribute("aria-hidden", "true");
    el.insertAdjacentElement("afterend", scrim);
    el.setAttribute("data-kube-driven", "");

    function apply() {
      el.setAttribute("data-state", open ? "open" : "collapsed");
      el.inert = !open && !peeking;
      el.toggleAttribute("data-drawer", narrow);
      syncTriggers(el, open);
    }
    function render() {
      el.style.setProperty("--sidebar-width", width + "px");
      var full = inner.offsetWidth;
      var p = util.clamp(progress.value, 0, 1);
      el.style.width = (peeking ? 0 : p * full) + "px";
      var dir = isRtl(el) ? 1 : -1;
      if (peeking) {
        inner.style.opacity = String(util.clamp(peekP.value, 0, 1));
        inner.style.transform = "translateX(" + 4 * peekOff.value * dir + "px)";
      } else if (settling) {
        inner.style.opacity = ""; inner.style.transform = "";
      } else {
        inner.style.opacity = String(p);
        inner.style.transform = p >= 1 ? "" : "translateX(" + (1 - p) * 4 * 4 * dir + "px)";
      }
      el.toggleAttribute("data-shown", peeking || settling || p > 0.001 || open);
      scrim.style.opacity = narrow ? String(p) : "0";
      scrim.toggleAttribute("data-shown", narrow && (open || p > 0.001));
      aria(handle, 240, Math.min(520, window.innerWidth - 240), width);
    }

    function setOpen(next, opts) {
      opts = opts || {};
      if (next && peeking) return pin();
      if (next === open) return true;
      if (!u.emit(el, next ? "open" : "close", { source: opts.source || "api", drawer: narrow })) return false;
      var hadFocus = !next && el.contains(document.activeElement);
      open = next;
      if (!narrow) { docked = next; if (key) u.store.set(key + ":open", String(next)); }
      apply();
      if (opts.animate === false) progress.set(open ? 1 : 0); else progress.to(open ? 1 : 0, SIDEBAR_SPRING);
      render(); // data-shown first, so the drawer content can take focus
      if (narrow && open) { var f = util.focusable(inner)[0]; if (f) f.focus({ preventScroll: true }); }
      if (hadFocus) returnFocus(el);
      return true;
    }

    // Peek: hover a peek area for 100ms while collapsed; leave both the area and the sidebar for 100ms to close.
    var peekTimer = 0;
    function peek() {
      if (open || narrow || peeking) return;
      if (!u.emit(el, "peek", { peeking: true })) return;
      peeking = true;
      el.setAttribute("data-peek", "");
      apply();
      if (peekP.value === 0) peekOff.set(1.5);
      peekP.to(1, SIDEBAR_SPRING);
      peekOff.to(0, SIDEBAR_SPRING);
    }
    function unpeek() {
      if (!peeking) return;
      u.emit(el, "peek", { peeking: false });
      var hadFocus = el.contains(document.activeElement);
      peekOff.to(0.75, PEEK_EXIT);
      peekP.to(0, PEEK_EXIT, function () {
        if (peekP.value !== 0) return;
        peeking = false;
        el.removeAttribute("data-peek");
        apply();
        render();
      });
      if (hadFocus) returnFocus(el);
    }
    // Pin while peeking: the docked width springs open under the popover, which settles in 0.12s (the source's
    // _Settling keyframes: margin, radius, fill and shadow go from popover to docked).
    function pin() {
      if (!u.emit(el, "open", { source: "peek", drawer: false })) return false;
      peekP.stop(); peekOff.stop();
      peeking = false;
      settling = true;
      el.removeAttribute("data-peek");
      el.setAttribute("data-settling", "");
      open = docked = true;
      if (key) u.store.set(key + ":open", "true");
      apply();
      progress.set(0);
      var ended = 0;
      var settle = function () { if (++ended < 2) return; settling = false; el.removeAttribute("data-settling"); render(); };
      if (util.reducedMotion()) ended = 1;
      else util.afterMotion(inner, 120, settle);
      progress.to(1, SIDEBAR_SPRING, settle);
      return true;
    }
    function inPeekZone(target) {
      return target && target.closest && (el.contains(target) || target.closest('[data-kube-peek="#' + (el.id ? CSS.escape(el.id) : "\u0000") + '"]'));
    }
    var offs = [
      util.on(document, "pointerover", function (e) {
        if (e.pointerType === "touch") return;
        if (inPeekZone(e.target)) {
          clearTimeout(peekTimer);
          if (!peeking && !open && !narrow && !el.contains(e.target)) peekTimer = setTimeout(peek, 100);
        } else if (peeking || peekTimer) {
          clearTimeout(peekTimer);
          peekTimer = peeking ? setTimeout(unpeek, 100) : 0;
        }
      }),
      util.on(document, "keydown", function (e) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (peeking) { unpeek(); return; }
        if (narrow && open) { e.preventDefault(); setOpen(false, { source: "escape" }); }
      }),
      util.on(document, "focusin", function (e) {
        if (peeking && !inPeekZone(e.target)) unpeek();
      }),
      util.on(scrim, "click", function () { setOpen(false, { source: "scrim" }); }),
      // Drawer: keep Tab inside while it is open.
      util.on(el, "keydown", function (e) {
        if (e.key !== "Tab" || !narrow || !open) return;
        var f = util.focusable(inner);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }),
    ];
    var offResize = resizer(handle, {
      edge: function () { return isRtl(el) ? "left" : "right"; },
      get: function () { return width; },
      min: function () { return 240; },
      max: function () { return Math.min(520, window.innerWidth - 240); },
      start: function () { el.setAttribute("data-resizing", ""); },
      stop: function () { el.removeAttribute("data-resizing"); },
      set: function (e) { width = clampW(e); render(); u.emit(el, "resize", { width: width, final: false }); },
      end: function (e) { width = clampW(e); if (key) u.store.set(key, String(Math.round(width))); u.emit(el, "resize", { width: width, final: true }); },
      reset: function () { width = clampW(def); if (key) u.store.set(key, String(Math.round(width))); render(); },
    });
    function checkNarrow() {
      var n = app.clientWidth > 0 && app.clientWidth < bp;
      if (n !== narrow) {
        narrow = n;
        if (peeking) { peekP.set(0); peeking = false; el.removeAttribute("data-peek"); }
        open = narrow ? false : docked;
        progress.set(open ? 1 : 0);
        apply();
      }
      render();
    }
    var offObserve = observe([app], checkNarrow);
    apply();
    render();

    return {
      open: function (o) { return setOpen(true, o); },
      close: function (o) { if (peeking) { unpeek(); return true; } return setOpen(false, o); },
      toggle: function (o) { return peeking ? pin() : setOpen(!open, o); },
      isOpen: function () { return open; },
      peek: peek,
      unpeek: unpeek,
      width: function () { return width; },
      setWidth: function (px) { width = clampW(px); if (key) u.store.set(key, String(Math.round(width))); render(); },
      destroy: function () {
        progress.stop(); peekP.stop(); peekOff.stop(); clearTimeout(peekTimer);
        offs.forEach(function (f) { f(); }); offResize(); offObserve();
        scrim.remove();
        ["data-kube-driven", "data-shown", "data-peek", "data-settling", "data-drawer"].forEach(function (a) { el.removeAttribute(a); });
        el.style.removeProperty("width");
        inner.style.opacity = ""; inner.style.transform = "";
      },
    };
  });

  /* ---------------------------------------------------------------- nav-section */

  // .k-nav-section with a .k-nav-section__toggle (or a button title): toggles aria-expanded (the CSS animates
  // the body: 0.3s --ease-enter on height and opacity, as the source), makes the collapsed body inert, optional persistence.
  Kube.register("nav-section", function (el, u) {
    var toggle = el.querySelector(":scope > .k-nav-section__title > .k-nav-section__toggle, :scope > button.k-nav-section__title");
    var body = el.querySelector(":scope > .k-nav-section__body");
    if (!toggle || !body) return {};
    var key = u.opt(el, "key", "");
    if (!body.id) body.id = u.uid("k-nav-section");
    toggle.setAttribute("aria-controls", body.id);
    function set(expanded, emit) {
      toggle.setAttribute("aria-expanded", String(expanded));
      body.inert = !expanded;
      if (key) u.store.set(key, String(expanded));
      if (emit) u.emit(el, "toggle", { expanded: expanded });
    }
    var stored = key ? u.store.get(key) : null;
    set(stored === null ? toggle.getAttribute("aria-expanded") !== "false" : stored === "true", false);
    var off = u.on(toggle, "click", function () { set(toggle.getAttribute("aria-expanded") === "false", true); });
    return {
      expand: function () { set(true, true); },
      collapse: function () { set(false, true); },
      toggle: function () { set(toggle.getAttribute("aria-expanded") === "false", true); },
      destroy: function () { off(); body.inert = false; },
    };
  });

  /* ---------------------------------------------------------------- nav-list */

  // Roving focus over the rows and section toggles inside el: one Tab stop (the current row, else the first),
  // ArrowUp/Down, Home/End. A row's hover actions are reachable with Tab (only the focused row's) or ArrowRight.
  var NAV_ITEMS = ".k-nav-row, .k-nav-section__toggle, button.k-nav-section__title";
  Kube.register("nav-list", function (el, u) {
    // Only inert inside the list counts (a collapsed section); a closed drawer around it must not empty the list.
    function usable(x) { var i = x.closest("[inert]"); return !x.disabled && x.getAttribute("aria-disabled") !== "true" && !(i && el.contains(i)) && x.getClientRects().length > 0; }
    function items() { return [].filter.call(el.querySelectorAll(NAV_ITEMS), usable); }
    function actionsOf(item) {
      var host = item.closest(".k-nav-item") || item.closest(".k-nav-section__title");
      return host ? [].slice.call(host.querySelectorAll(".k-nav-item__actions button, .k-nav-section__actions button")) : [];
    }
    var stop = null;
    function setStop(target) {
      stop = target;
      [].forEach.call(el.querySelectorAll(NAV_ITEMS), function (x) { x.tabIndex = x === target ? 0 : -1; });
      [].forEach.call(el.querySelectorAll(".k-nav-item__actions button, .k-nav-section__actions button"), function (b) { b.tabIndex = -1; });
      if (target) actionsOf(target).forEach(function (b) { b.tabIndex = 0; });
    }
    function refresh() {
      var list = items();
      if (stop && list.indexOf(stop) >= 0) return setStop(stop);
      setStop(list.filter(function (x) { return x.matches('[aria-current="page"], [aria-current="true"]'); })[0] || list[0] || null);
    }
    var offs = [
      util.on(el, "focusin", function (e) {
        var item = e.target.closest(NAV_ITEMS);
        if (item && el.contains(item)) setStop(item);
      }),
      util.on(el, "keydown", function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        var item = e.target.closest(NAV_ITEMS);
        var inAction = !item && e.target.closest(".k-nav-item__actions, .k-nav-section__actions");
        if (inAction && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          var acts = actionsOf(stop || e.target), i = acts.indexOf(e.target);
          var back = (e.key === "ArrowLeft") !== isRtl(el);
          if (back && i === 0 && stop) stop.focus(); else if (acts[i + (back ? -1 : 1)]) acts[i + (back ? -1 : 1)].focus();
          e.preventDefault();
          return;
        }
        if (!item) return;
        var list = items(), at = list.indexOf(item), next = null;
        if (e.key === "ArrowDown") next = list[Math.min(list.length - 1, at + 1)];
        else if (e.key === "ArrowUp") next = list[Math.max(0, at - 1)];
        else if (e.key === "Home") next = list[0];
        else if (e.key === "End") next = list[list.length - 1];
        else if (e.key === (isRtl(el) ? "ArrowLeft" : "ArrowRight")) next = actionsOf(item)[0] || null;
        if (!next) return;
        e.preventDefault();
        next.focus();
      }),
      util.on(el, "kube:toggle", function () { requestAnimationFrame(refresh); }),
    ];
    var mo = new MutationObserver(function () { refresh(); });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-expanded", "inert", "disabled"] });
    refresh();
    return {
      refresh: refresh,
      destroy: function () {
        offs.forEach(function (f) { f(); });
        mo.disconnect();
        [].forEach.call(el.querySelectorAll(NAV_ITEMS + ", .k-nav-item__actions button, .k-nav-section__actions button"), function (x) { x.removeAttribute("tabindex"); });
      },
    };
  });

  /* ---------------------------------------------------------------- tabs */

  // .k-tabs[role=tablist]: selection follows focus (ArrowLeft/Right, Home/End, RTL-aware), Delete or middle-click
  // closes, close and open animate the tab's width (0.2s cubic-bezier(1/3, 2/3, 2/3, 1)); drag past 6px to reorder,
  // neighbors slide in 150ms; Space/Enter picks a tab up for keyboard reordering; double-click or F2 renames.
  var TAB_EASE = "cubic-bezier(.333, .667, .667, 1)";
  var LAYOUT_EASE = "cubic-bezier(.23, 1, .32, 1)";
  Kube.register("tabs", function (el, u) {
    var renamable = u.opt(el, "rename", false);
    var reorderable = u.opt(el, "reorder", true);
    var live = document.createElement("span");
    live.className = "k-tabs__live";
    live.setAttribute("aria-live", "assertive");
    el.appendChild(live);
    var moving = false;

    function tabs() { return [].slice.call(el.querySelectorAll(":scope > .k-tab")).filter(function (t) { return !t.hasAttribute("data-closing"); }); }
    function btn(tab) { return tab && tab.querySelector(".k-tab__btn"); }
    function label(tab) { var l = tab.querySelector(".k-tab__label"); return (l ? l.textContent : btn(tab).getAttribute("aria-label") || "").trim(); }
    function movable(tab) { return reorderable && tab && !tab.classList.contains("k-tab--leading"); }
    function selected() { return tabs().filter(function (t) { return btn(t).getAttribute("aria-selected") === "true"; })[0] || null; }
    function select(tab, opts) {
      opts = opts || {};
      if (!tab) return;
      var prev = selected();
      tabs().forEach(function (t) {
        var b = btn(t), on = t === tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        var panel = query(b.getAttribute("aria-controls") ? "#" + CSS.escape(b.getAttribute("aria-controls")) : "");
        if (panel) panel.hidden = !on;
      });
      if (opts.focus) btn(tab).focus({ preventScroll: true });
      if (tab.scrollIntoView) tab.scrollIntoView({ behavior: util.reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "nearest" });
      if (prev !== tab) u.emit(tab, "select", { tab: tab, index: tabs().indexOf(tab) });
    }
    function animateWidth(tab, from, to, done) {
      if (util.reducedMotion() || typeof tab.animate !== "function") { if (done) done(); return; }
      tab.style.overflow = "hidden";
      var a = tab.animate([from, to], { duration: 200, easing: TAB_EASE });
      a.onfinish = a.oncancel = function () { tab.style.overflow = ""; if (done) done(); };
    }
    function close(tab) {
      if (!tab || !tab.querySelector(".k-tab__close") || tab.hasAttribute("data-closing")) return false;
      if (!u.emit(tab, "close", { tab: tab })) return false;
      var list = tabs(), i = list.indexOf(tab);
      var wasSelected = btn(tab).getAttribute("aria-selected") === "true";
      var hadFocus = tab.contains(document.activeElement);
      var next = list[i + 1] || list[i - 1] || null;
      var w = tab.getBoundingClientRect().width;
      tab.setAttribute("data-closing", "");
      tab.inert = true;
      if (wasSelected && next) select(next);
      if (hadFocus) { var s = selected() || tabs()[0]; if (s) btn(s).focus({ preventScroll: true }); }
      animateWidth(tab, { maxWidth: w + "px", minWidth: w + "px" }, { maxWidth: "0px", minWidth: "0px" }, function () {
        tab.remove();
        mo.takeRecords();
      });
      return true;
    }
    function opened(tab) {
      var b = btn(tab);
      if (!b) return;
      b.setAttribute("role", "tab");
      if (!b.hasAttribute("aria-selected")) b.setAttribute("aria-selected", "false");
      b.tabIndex = b.getAttribute("aria-selected") === "true" ? 0 : -1;
      var min = getComputedStyle(tab).minWidth;
      // As in the source, a selected new tab is scrolled into view once its width has grown.
      animateWidth(tab, { maxWidth: "0px", minWidth: "0px" }, { maxWidth: "240px", minWidth: min }, function () {
        if (b.getAttribute("aria-selected") === "true" && tab.scrollIntoView) tab.scrollIntoView({ behavior: util.reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "nearest" });
      });
      if (b.getAttribute("aria-selected") === "true") select(tab);
    }
    // FLIP: run mutate(), then slide every moved tab (except `skip`) from where it was.
    function flip(mutate, skip) {
      var list = tabs(), before = list.map(function (t) { return t.getBoundingClientRect().left; });
      moving = true;
      mutate();
      mo.takeRecords();
      moving = false;
      if (util.reducedMotion()) return;
      list.forEach(function (t, i) {
        if (t === skip || typeof t.animate !== "function") return;
        var dx = before[i] - t.getBoundingClientRect().left;
        if (Math.abs(dx) > 0.5) t.animate([{ transform: "translateX(" + dx + "px)" }, { transform: "none" }], { duration: 150, easing: LAYOUT_EASE });
      });
    }
    // Move `tab` one slot toward dir (+1 = later in the strip) by moving its neighbor, so focus and capture stay put.
    function step(tab, dir) {
      var list = tabs(), i = list.indexOf(tab), other = list[i + dir];
      if (!movable(other)) return false;
      flip(function () { if (dir > 0) el.insertBefore(other, tab); else el.insertBefore(other, tab.nextSibling); }, tab);
      return true;
    }
    function say(text) { live.textContent = text; }

    // Pointer reordering (the source activates its tab drag after 6px).
    var press = null;
    function onMove(e) {
      if (!press || e.pointerId !== press.id) return;
      var tab = press.tab;
      if (!press.dragging) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
        press.dragging = true;
        press.start = tabs().indexOf(tab);
        press.grab = e.clientX - tab.getBoundingClientRect().left;
        tab.setAttribute("data-dragging", "");
        el.setAttribute("data-reordering", "");
      }
      e.preventDefault();
      var natural = function () { tab.style.translate = ""; var l = tab.getBoundingClientRect().left; return l; };
      var left = natural();
      var x = e.clientX - press.grab;
      var list = tabs(), i = list.indexOf(tab), center = x + tab.offsetWidth / 2;
      var rtl = isRtl(el);
      var after = list[i + (rtl ? -1 : 1)], before = list[i + (rtl ? 1 : -1)];
      var mid = function (t) { var r = t.getBoundingClientRect(); return r.left + r.width / 2; };
      if (after && movable(after) && center > mid(after)) { step(tab, rtl ? -1 : 1); left = natural(); }
      else if (before && movable(before) && center < mid(before)) { step(tab, rtl ? 1 : -1); left = natural(); }
      tab.style.translate = x - left + "px 0";
    }
    function endPress(e, cancel) {
      if (!press || (e && e.pointerId !== press.id)) return;
      var p = press;
      press = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (!p.dragging) return;
      var tab = p.tab;
      if (cancel) flip(function () { var ref = tabs().filter(function (t) { return t !== tab; })[p.start] || live; el.insertBefore(tab, ref); });
      var off = parseFloat(tab.style.translate) || 0;
      tab.style.translate = "";
      if (off && !util.reducedMotion() && typeof tab.animate === "function") tab.animate([{ transform: "translateX(" + off + "px)" }, { transform: "none" }], { duration: 150, easing: LAYOUT_EASE });
      tab.removeAttribute("data-dragging");
      el.removeAttribute("data-reordering");
      var to = tabs().indexOf(tab);
      if (!cancel && to !== p.start) u.emit(tab, "reorder", { tab: tab, from: p.start, to: to });
      // A drag is not a click.
      var swallow = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(function () { el.removeEventListener("click", swallow, { capture: true }); }, 0);
    }
    function onUp(e) { endPress(e, false); }
    function onCancel(e) { endPress(e, true); }

    // Keyboard reordering, following the sortable-list convention the source uses elsewhere (dnd-kit keyboard sensor).
    var held = null;
    function drop(cancel) {
      var h = held;
      held = null;
      h.tab.removeAttribute("data-dragging");
      if (cancel) {
        flip(function () { var ref = tabs().filter(function (t) { return t !== h.tab; })[h.start] || live; el.insertBefore(h.tab, ref); });
        btn(h.tab).focus({ preventScroll: true });
        say("Moved back to position " + (h.start + 1) + ".");
        return;
      }
      var to = tabs().indexOf(h.tab);
      say("Dropped at position " + (to + 1) + " of " + tabs().length + ".");
      if (to !== h.start) u.emit(h.tab, "reorder", { tab: h.tab, from: h.start, to: to });
    }

    // Rename in place.
    function rename(tab) {
      var l = tab && tab.querySelector(".k-tab__label");
      if (!l || tab.hasAttribute("data-renaming") || !(renamable || tab.hasAttribute("data-kube-renamable"))) return;
      var prev = l.textContent;
      var input = document.createElement("input");
      input.className = "k-tab__rename";
      input.value = prev;
      input.setAttribute("aria-label", "Rename tab");
      tab.setAttribute("data-renaming", "");
      tab.style.minWidth = Math.max(160, tab.getBoundingClientRect().width) + "px";
      tab.appendChild(input);
      input.focus();
      input.select();
      var done = false;
      function finish(save, refocus) {
        if (done) return;
        done = true;
        var v = input.value.trim();
        if (save && v && v !== prev && u.emit(tab, "rename", { tab: tab, value: v, previous: prev })) {
          l.textContent = v;
          var c = tab.querySelector(".k-tab__close");
          if (c && c.getAttribute("aria-label")) c.setAttribute("aria-label", c.getAttribute("aria-label").split(prev).join(v));
        }
        input.remove();
        tab.removeAttribute("data-renaming");
        tab.style.minWidth = "";
        if (refocus) btn(tab).focus({ preventScroll: true });
      }
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
      });
      input.addEventListener("blur", function () { finish(true, false); });
      input.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    }

    var offs = [
      util.on(el, "click", function (e) {
        var c = e.target.closest(".k-tab__close");
        if (c && el.contains(c)) { close(c.closest(".k-tab")); return; }
        var b = e.target.closest(".k-tab__btn");
        if (b && el.contains(b)) { var t = b.closest(".k-tab"); t.classList.remove("k-tab--preview"); select(t); }
      }),
      util.on(el, "mousedown", function (e) { if (e.button === 1 && e.target.closest(".k-tab")) e.preventDefault(); }),
      util.on(el, "auxclick", function (e) {
        var t = e.button === 1 && e.target.closest(".k-tab");
        if (t && el.contains(t)) { e.preventDefault(); close(t); }
      }),
      util.on(el, "dblclick", function (e) {
        var b = e.target.closest(".k-tab__btn");
        if (b && el.contains(b)) rename(b.closest(".k-tab"));
      }),
      util.on(el, "pointerdown", function (e) {
        var b = e.target.closest(".k-tab__btn");
        if (e.button !== 0 || !b || press || held) return;
        var t = b.closest(".k-tab");
        if (!movable(t) || t.hasAttribute("data-renaming")) return;
        press = { id: e.pointerId, x: e.clientX, y: e.clientY, tab: t, dragging: false };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
      }),
      util.on(document, "keydown", function (e) { if (press && press.dragging && e.key === "Escape") { e.preventDefault(); endPress({ pointerId: press.id }, true); } }),
      util.on(el, "keydown", function (e) {
        var b = e.target.closest(".k-tab__btn");
        if (!b || !el.contains(b) || e.altKey || e.ctrlKey || e.metaKey) return;
        var tab = b.closest(".k-tab"), rtl = isRtl(el);
        if (held) {
          e.preventDefault();
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            var dir = (e.key === "ArrowRight") !== rtl ? 1 : -1;
            if (step(tab, dir)) { b.focus({ preventScroll: true }); say("Position " + (tabs().indexOf(tab) + 1) + " of " + tabs().length + "."); }
          } else if (e.key === " " || e.key === "Enter" || e.key === "Tab") drop(false);
          else if (e.key === "Escape") drop(true);
          return;
        }
        if (e.shiftKey) return;
        if ((e.key === " " || e.key === "Enter") && movable(tab)) {
          e.preventDefault();
          held = { tab: tab, start: tabs().indexOf(tab) };
          tab.setAttribute("data-dragging", "");
          say("Picked up " + label(tab) + ". Use the arrow keys to move it, Space to drop, Escape to cancel.");
          return;
        }
        if (e.key === "F2") { e.preventDefault(); rename(tab); return; }
        if (e.key === "Delete") { if (close(tab)) e.preventDefault(); return; }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
        var list = tabs().filter(function (t) { return !btn(t).disabled; }), at = list.indexOf(tab), to;
        if (e.key === "Home") to = 0;
        else if (e.key === "End") to = list.length - 1;
        else to = (at + ((e.key === "ArrowRight") !== rtl ? 1 : -1) + list.length) % list.length;
        e.preventDefault();
        select(list[to], { focus: true });
      }),
      util.on(el, "keyup", function (e) { if (e.key === " " && e.target.closest(".k-tab__btn")) e.preventDefault(); }),
      util.on(el, "focusout", function (e) { if (held && !el.contains(e.relatedTarget)) drop(false); }),
    ];
    var mo = new MutationObserver(function (records) {
      if (moving) return;
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) { if (n.nodeType === 1 && n.classList.contains("k-tab") && n.parentNode === el) opened(n); });
      });
    });
    mo.observe(el, { childList: true });
    var first = selected() || tabs()[0];
    tabs().forEach(function (t) { var b = btn(t); if (b) { b.setAttribute("role", "tab"); b.tabIndex = t === first ? 0 : -1; } });

    return {
      select: function (t) { select(typeof t === "number" ? tabs()[t] : t); },
      close: close,
      add: function (tab, o) { el.insertBefore(tab, live); if (o && o.select) { mo.takeRecords(); opened(tab); select(tab); } },
      rename: rename,
      tabs: tabs,
      destroy: function () {
        offs.forEach(function (f) { f(); });
        mo.disconnect();
        endPress(press ? { pointerId: press.id } : null, true);
        live.remove();
      },
    };
  });

  /* ---------------------------------------------------------------- page-header */

  function scrollParent(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  // .k-page-header: data-scrolled on the header and data-page-scrolled on the .k-app once its scroller leaves the
  // top (scrollTop > 0, as the source). The app uses it to fill the main toolbar and drop the top fade.
  Kube.register("page-header", function (el, u) {
    var sel = u.opt(el, "scroller", "");
    var sc = (sel && (el.closest(sel) || query(sel))) || scrollParent(el);
    var target = sc === document.scrollingElement || sc === document.documentElement ? window : sc;
    var app = el.closest(".k-app");
    var last = null;
    function update() {
      var s = sc.scrollTop > 0;
      if (s === last) return;
      last = s;
      el.toggleAttribute("data-scrolled", s);
      if (app) app.toggleAttribute("data-page-scrolled", s);
      u.emit(el, "scrolled", { scrolled: s });
    }
    var off = u.on(target, "scroll", update, { passive: true });
    update();
    return { destroy: function () { off(); el.removeAttribute("data-scrolled"); if (app) app.removeAttribute("data-page-scrolled"); } };
  });

  /* ---------------------------------------------------------------- nav-rail */

  // .k-rail: each .k-rail__mark[data-kube-jump="#heading"] scrolls to its heading on click; pressing and moving
  // scrubs (the mark under the pointer becomes the target, the document follows instantly, neighbors grow);
  // aria-current follows the headings in view. data-bookmarked on a mark shows the bookmark dot (CSS).
  // data-kube-preview="#card" on a mark: that card shows beside the rail, 150ms after the pointer rests on the mark
  // (the source's delay), at once while moving between marks, scrubbing or on keyboard focus; it closes when the
  // pointer leaves the rail, the focus leaves it, or on Escape.
  Kube.register("nav-rail", function (el, u) {
    var marks = function () { return [].slice.call(el.querySelectorAll(".k-rail__mark")); };
    var targetOf = function (m) { return query(m.getAttribute("data-kube-jump")); };
    var scrub = null, suppress = false, pressed = null;
    var card = null, pos = null, wait = 0;
    function previewOf(m) { return m ? query(m.getAttribute("data-kube-preview")) : null; }
    function hidePreview() {
      clearTimeout(wait);
      if (card) { card.hidden = true; card.removeAttribute("data-state"); }
      if (pos) pos.destroy();
      card = pos = null;
    }
    function showPreview(m) {
      clearTimeout(wait);
      var c = previewOf(m);
      if (c === card) return;
      hidePreview();
      if (!c) return;
      card = c;
      c.hidden = false;
      c.setAttribute("data-state", "open");
      // The card goes on the side of the rail that faces the content: left of a rail at the right edge.
      var r = el.getBoundingClientRect(), side = r.left + r.width / 2 > document.documentElement.clientWidth / 2 ? "left" : "right";
      pos = Kube.position(c, m, { side: side, align: "center", offset: 0, padding: 8 });
    }
    function jump(m, behavior) {
      var t = targetOf(m);
      if (!t) return;
      t.scrollIntoView({ behavior: behavior, block: "start" });
      u.emit(m, "jump", { mark: m, target: t });
    }
    // Keep the mark visible inside a rail that scrolls (the source's helper).
    function reveal(m) {
      var top = m.offsetTop;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + m.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + m.offsetHeight - el.clientHeight + 1;
    }
    function setScrub(m) {
      var list = marks(), at = list.indexOf(m);
      list.forEach(function (x, i) {
        x.toggleAttribute("data-scrub-target", x === m);
        var d = Math.abs(i - at);
        if (d >= 1 && d <= 3) x.setAttribute("data-neighbor-distance", String(d)); else x.removeAttribute("data-neighbor-distance");
      });
      reveal(m);
      showPreview(m);
    }
    function markAt(clientY) {
      var r = el.getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width / 2, Math.max(r.top, Math.min(clientY, r.bottom - 1)));
      return hit && hit.closest && hit.closest(".k-rail__mark");
    }
    function endScrub(e) {
      if (!scrub || (e && e.pointerId !== scrub.id)) return;
      if (el.hasPointerCapture && el.hasPointerCapture(scrub.id)) el.releasePointerCapture(scrub.id);
      suppress = scrub.moved;
      scrub = null;
      el.removeAttribute("data-scrubbing");
      marks().forEach(function (x) { x.removeAttribute("data-scrub-target"); x.removeAttribute("data-neighbor-distance"); });
      setTimeout(function () { suppress = false; }, 0);
      // Released off the rail: its pointerleave came during the scrub and was held.
      if (!el.matches(":hover")) hidePreview();
    }
    var offs = [
      util.on(el, "click", function (e) {
        // Pointer capture retargets a mouse click to the rail itself: fall back to the pressed mark.
        var m = e.target.closest(".k-rail__mark") || pressed;
        pressed = null;
        if (!m || suppress) return;
        jump(m, util.reducedMotion() ? "auto" : "smooth");
      }),
      util.on(el, "pointerdown", function (e) {
        var m = e.target.closest(".k-rail__mark");
        if (e.button !== 0 || !m) return;
        pressed = m;
        scrub = { id: e.pointerId, mark: m, moved: false };
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        el.setAttribute("data-scrubbing", "");
        setScrub(m);
      }),
      util.on(el, "pointermove", function (e) {
        if (!scrub || e.pointerId !== scrub.id) return;
        if (e.buttons % 2 === 0) { endScrub(e); return; }
        var m = markAt(e.clientY);
        if (m && m !== scrub.mark && el.contains(m)) { scrub.mark = m; scrub.moved = true; setScrub(m); jump(m, "auto"); }
      }),
      util.on(el, "pointerup", endScrub),
      util.on(el, "pointercancel", endScrub),
      util.on(el, "lostpointercapture", endScrub),
      util.on(el, "pointerover", function (e) {
        var m = e.target.closest(".k-rail__mark");
        if (!m || e.pointerType === "touch" || scrub) return;
        if (card) showPreview(m);
        else { clearTimeout(wait); wait = setTimeout(function () { showPreview(m); }, 150); }
      }),
      util.on(el, "pointerleave", function () { if (!scrub) hidePreview(); }),
      util.on(el, "focusin", function (e) {
        var m = e.target.closest(".k-rail__mark");
        if (!m) return;
        try { if (m.matches(":focus-visible")) showPreview(m); } catch (err) { showPreview(m); }
      }),
      util.on(el, "focusout", function (e) { if (!el.contains(e.relatedTarget)) hidePreview(); }),
      util.on(document, "keydown", function (e) { if (e.key === "Escape" && card) hidePreview(); }),
    ];
    var io = null;
    if (typeof IntersectionObserver === "function") {
      var visible = new Set();
      var scroller = query(u.opt(el, "scroller", ""));
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) visible.add(en.target); else visible.delete(en.target); });
        if (!visible.size) return;
        marks().forEach(function (m) { var t = targetOf(m); if (t && visible.has(t)) m.setAttribute("aria-current", "true"); else m.removeAttribute("aria-current"); });
      }, { root: scroller || null });
      marks().forEach(function (m) { var t = targetOf(m); if (t) io.observe(t); });
    }
    return {
      destroy: function () { offs.forEach(function (f) { f(); }); if (io) io.disconnect(); endScrub(); hidePreview(); },
    };
  });
})(window.Kube);

/* --- 60-composer.js --- */
/* Composer and conversation behaviors.
 *
 *   <div class="k-composer" data-kube="composer">                       autogrow, Enter to send, files, busy/stop
 *   <div class="k-composer-drawer" data-kube="composer-drawer">         per-item reveal behind the composer
 *   <div class="k-composer-drawer k-composer-drawer--tray"
 *        data-kube="composer-drawer composer-tray">                     "/" command tray with filtering
 *   <span class="k-composer-chip" data-kube="attachment-chip">          remove with exit, upload progress
 *   <canvas class="k-waveform" data-kube="waveform">                    live dictation waveform
 *   <div class="k-message" data-kube="message">                         copy / react / other actions
 *   <div class="k-thread" data-kube="thread">                           stick to bottom, jump, entrance, swipe timestamps
 *   <div class="k-suggestion-list" data-kube="suggestion-list">         suggest / dismiss with exit
 *   <div class="k-steps" data-kube="steps">                             workflow steps disclosure
 *
 * Helpers: Kube.stream(el, text), Kube.sendMorph(from, message), Kube.react(message, glyph),
 *          Kube.highlightMessage(message).
 * Timings come from the shipped app: drawer 150ms on --ease-enter-snappy, near-bottom 96px, words 70ms apart,
 * send morph 600ms + 200ms receipt, waveform 60px/s with a bar every 5px.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var SNAPPY = "cubic-bezier(.23, 1, .32, 1)";
  var EXIT = "cubic-bezier(.8, 0, .4, 1)";
  var DRAWER_MS = 150;
  var NEAR_BOTTOM = 96;
  var STROKE = ' fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var ICON = {
    send: '<svg viewBox="0 0 16 16" stroke-width="1.75"' + STROKE + '><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
    stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 16 16" stroke-width="1.5"' + STROKE + '><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>',
    close: '<svg viewBox="0 0 16 16" stroke-width="2"' + STROKE + '><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    expand: '<svg viewBox="0 0 16 16" stroke-width="1.5"' + STROKE + '><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/></svg>',
    collapse: '<svg viewBox="0 0 16 16" stroke-width="1.5"' + STROKE + '><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5L14 2M6.5 9.5L2 14"/></svg>',
  };

  function reduced() { return util.reducedMotion(); }
  function $(root, sel) { return root.querySelector(sel); }
  function all(root, sel) { return [].slice.call(root.querySelectorAll(sel)); }
  function listeners() {
    var offs = [];
    return {
      on: function (t, type, fn, o) { offs.push(util.on(t, type, fn, o)); },
      off: function () { offs.splice(0).forEach(function (f) { f(); }); },
    };
  }

  // Fade and shrink (150ms), then fold the inline size so neighbours close the gap (150ms); removes el.
  function collapseOut(el) {
    return new Promise(function (resolve) {
      function done() { el.remove(); resolve(el); }
      el.inert = true;
      if (reduced() || !el.animate || !el.parentElement) return done();
      var gap = parseFloat(getComputedStyle(el.parentElement).columnGap) || 0;
      var w = el.getBoundingClientRect().width;
      el.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.96)" }],
        { duration: DRAWER_MS, easing: EXIT, fill: "forwards" }).finished
        .then(function () {
          el.style.flex = "none";
          return el.animate([{ width: w + "px", minWidth: "0px", marginInlineEnd: "0px" }, { width: "0px", minWidth: "0px", marginInlineEnd: -gap + "px" }],
            { duration: DRAWER_MS, easing: SNAPPY, fill: "forwards" }).finished;
        })
        .then(done, done);
    });
  }

  // The composer input is a <textarea> or a contenteditable rich field (.k-composer__input--rich).
  function isRich(input) { return input.getAttribute("contenteditable") === "true" || input.isContentEditable; }
  function textOf(input) { return isRich(input) ? input.innerText.replace(/\n$/, "") : input.value; }
  function setText(input, text) { if (isRich(input)) input.textContent = text; else input.value = text; }

  function makeChip(name) {
    var c = document.createElement("span");
    c.className = "k-composer-chip";
    c.setAttribute("data-kube", "attachment-chip");
    c.innerHTML = '<span class="k-composer-chip__icon">' + ICON.file + '</span><span class="k-composer-chip__name"></span>' +
      '<button class="k-composer-remove" type="button">' + ICON.close + "</button>";
    $(c, ".k-composer-chip__name").textContent = name;
    $(c, "button").setAttribute("aria-label", "Remove " + name);
    return c;
  }

  /* ------------------------------------------------------------------ Composer */

  // Options: data-kube-layout="auto" (single-line pill until the draft wraps, has a line break or attachments),
  // data-kube-drop-label, data-kube-stop-label. Events: kube:submit {text, files, attachments} (cancel to keep
  // the draft), kube:stop, kube:files {files, source} (cancel to handle them yourself), kube:layout {layout},
  // kube:expand {expanded}, kube:dictation-start / kube:dictation-stop {waveform}.
  Kube.register("composer", function (el, u) {
    var input = $(el, ".k-composer__input");
    if (!input) return {};
    var row = $(el, ".k-composer__attachments");
    var send = $(el, ".k-composer__send");
    var expandBtn = $(el, "[data-composer-expand]");
    var dictateBtn = $(el, "[data-composer-dictate]");
    var dict = $(el, ".k-composer__dictation");
    var waveCanvas = dict && $(dict, "canvas");
    var autoLayout = u.opt(el, "layout", "") === "auto";
    var rich = isRich(input);
    var grows = !(window.CSS && CSS.supports("field-sizing", "content"));
    var fileOf = new WeakMap();
    var busy = !!send && send.getAttribute("data-state") === "stop";
    var idle = send && !busy ? { html: send.innerHTML, label: send.getAttribute("aria-label") || "Send" } : { html: ICON.send, label: "Send" };
    var composing = false, wrapped = false, expanded = el.hasAttribute("data-expanded"), depth = 0, lastWidth = -1;
    var L = listeners();

    function chips() { return row ? [].slice.call(row.children) : []; }
    function readyChips() { return chips().filter(function (c) { return !/^(uploading|error|removing)$/.test(c.getAttribute("data-state") || ""); }); }
    function hasContent() { return textOf(input).trim() !== "" || readyChips().length > 0; }
    function isSingle() { return el.classList.contains("k-composer--single-line"); }
    function overflowing() { return input.scrollWidth > input.clientWidth + 1; }

    // Source rule: multiline once attachments show, the draft has a break, or the text overflows one line;
    // an overflow switch sticks until the draft is emptied (or the width changes while empty).
    function layout() {
      if (!autoLayout || composing) return;
      var v = textOf(input);
      if (!v) wrapped = false;
      else if (isSingle() && overflowing()) wrapped = true;
      var single = !wrapped && v.indexOf("\n") < 0 && chips().length === 0;
      if (single && !isSingle()) {
        el.classList.add("k-composer--single-line");
        if (v && overflowing()) { wrapped = true; single = false; }
      }
      el.classList.toggle("k-composer--single-line", single);
      if (single !== (el.getAttribute("data-layout") === "single-line")) {
        el.setAttribute("data-layout", single ? "single-line" : "multiline");
        u.emit(el, "layout", { layout: single ? "single-line" : "multiline" });
      }
    }

    function sync() {
      // A cleared contenteditable keeps a stray <br>; empty it so :empty shows the placeholder.
      if (rich && !textOf(input).trim() && !$(input, ".k-token") && input.firstChild) input.replaceChildren();
      layout();
      if (grows && !rich) { input.style.height = "auto"; input.style.height = input.scrollHeight + "px"; }
      if (send) send.disabled = !busy && !hasContent();
      if (expandBtn) {
        var lh = parseFloat(getComputedStyle(input).lineHeight) || 20;
        expandBtn.hidden = !(expanded || (!isSingle() && (textOf(input).indexOf("\n") >= 0 || input.scrollHeight >= lh * 5)));
      }
    }

    function files() { return chips().map(function (c) { return fileOf.get(c); }).filter(Boolean); }

    function clear() {
      setText(input, "");
      chips().forEach(function (c) { c.remove(); });
      wrapped = false;
      if (expanded) setExpanded(false, true);
      sync();
    }

    function submit() {
      if (busy || !hasContent()) return false;
      if (!u.emit(el, "submit", { text: textOf(input), html: rich ? input.innerHTML : undefined, tokens: rich ? all(input, ".k-token").map(function (t) { return t.getAttribute("data-value") || t.textContent; }) : [], files: files(), attachments: readyChips() })) return false;
      clear();
      return true;
    }

    function setBusy(on) {
      busy = !!on;
      if (send) {
        if (busy) {
          send.setAttribute("data-state", "stop");
          send.setAttribute("aria-busy", "true");
          send.setAttribute("aria-label", u.opt(el, "stop-label", "Stop"));
          send.innerHTML = ICON.stop;
        } else {
          send.removeAttribute("data-state");
          send.removeAttribute("aria-busy");
          send.setAttribute("aria-label", idle.label);
          send.innerHTML = idle.html;
        }
      }
      sync();
    }

    function setExpanded(on, quiet) {
      expanded = !!on;
      el.toggleAttribute("data-expanded", expanded);
      if (expandBtn) {
        expandBtn.setAttribute("aria-pressed", String(expanded));
        expandBtn.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
        expandBtn.innerHTML = expanded ? ICON.collapse : ICON.expand;
      }
      if (!quiet) { input.focus(); sync(); u.emit(el, "expand", { expanded: expanded }); }
    }

    function addFiles(list, source) {
      var arr = [].slice.call(list || []);
      if (!arr.length || !u.emit(el, "files", { files: arr, source: source }) || !row) return [];
      var made = arr.map(function (f) { var c = makeChip(f.name || "file"); fileOf.set(c, f); row.appendChild(c); return c; });
      sync();
      return made;
    }

    function wave() { return waveCanvas && Kube.get(waveCanvas, "waveform"); }
    function setDictating(on) {
      on = !!on;
      if (on === el.hasAttribute("data-dictating")) return;
      if (!u.emit(el, on ? "dictation-start" : "dictation-stop", { waveform: wave() })) return;
      el.toggleAttribute("data-dictating", on);
      if (dictateBtn) dictateBtn.setAttribute("aria-pressed", String(on));
      var w = wave();
      if (w) { if (on) w.start(); else w.stop(); }
    }

    L.on(input, "input", sync);
    L.on(input, "compositionstart", function () { composing = true; });
    L.on(input, "compositionend", function () { composing = false; sync(); });
    L.on(input, "keydown", function (e) {
      if (e.key !== "Enter" || e.defaultPrevented || composing || e.isComposing || e.keyCode === 229) return;
      var mod = e.metaKey || e.ctrlKey;
      if (e.shiftKey || e.altKey || (expanded && !mod)) return; // a line break
      e.preventDefault();
      submit();
    });
    L.on(input, "paste", function (e) {
      var f = e.clipboardData && e.clipboardData.files;
      if (f && f.length) { e.preventDefault(); addFiles(f, "paste"); return; }
      if (!rich || !e.clipboardData) return;
      e.preventDefault(); // rich field: paste as plain text, never foreign markup
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });

    // Inline tokens (rich field only). A token can carry a ghost completion hint: Tab accepts it into the
    // token, any other edit drops it.
    function hints() { return all(input, ".k-token__hint"); }
    function dropHints() {
      hints().forEach(function (h) { var t = h.previousElementSibling; if (t) t.removeAttribute("data-has-hint"); h.remove(); });
    }
    function caretAfter(node) {
      var sel = window.getSelection();
      if (!sel) return;
      var r = document.createRange();
      r.setStartAfter(node);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function insertToken(label, opts) {
      if (!rich) return null;
      var o = opts || {};
      dropHints();
      var t = document.createElement("span");
      t.className = "k-token";
      t.contentEditable = "false";
      t.textContent = label;
      if (o.value) t.setAttribute("data-value", o.value);
      var sel = window.getSelection();
      var range = sel && sel.rangeCount && input.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
      if (range) { range.deleteContents(); range.insertNode(t); } else input.appendChild(t);
      var tail = t;
      if (o.hint) {
        var h = document.createElement("span");
        h.className = "k-token__hint";
        h.contentEditable = "false";
        h.setAttribute("aria-hidden", "true");
        h.textContent = o.hint;
        t.setAttribute("data-has-hint", "");
        t.after(h);
        tail = h;
      }
      var space = document.createTextNode(" ");
      tail.after(space);
      input.focus();
      caretAfter(space);
      sync();
      return t;
    }
    if (rich) {
      L.on(input, "keydown", function (e) {
        if (e.key !== "Tab" || e.shiftKey || !hints().length) return;
        e.preventDefault();
        hints().forEach(function (h) {
          var t = h.previousElementSibling;
          if (t) { t.textContent += h.textContent; t.removeAttribute("data-has-hint"); }
          h.remove();
        });
      });
      L.on(input, "beforeinput", dropHints);
    }
    if (send) L.on(send, "click", function () {
      if (!busy) return void submit();
      if (u.emit(el, "stop", {})) setBusy(false);
    });
    if (expandBtn) {
      L.on(expandBtn, "pointerdown", function (e) { e.preventDefault(); }); // keep the caret in the draft
      L.on(expandBtn, "click", function () { setExpanded(!expanded); });
    }
    if (dictateBtn) L.on(dictateBtn, "click", function () { setDictating(!el.hasAttribute("data-dictating")); });
    if (dict) L.on(dict, "click", function (e) { if (e.target.closest("[data-composer-dictate-stop]")) setDictating(false); });
    L.on(el, "keydown", function (e) {
      if (e.key === "Escape" && el.hasAttribute("data-dictating")) { e.preventDefault(); setDictating(false); }
    });

    // Drag and drop: only file drags light the surface; nested enters are counted.
    function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, "Files") >= 0; }
    function setDrag(on) {
      if (!on) return void el.removeAttribute("data-drag-active");
      if (!el.hasAttribute("data-drop-label")) el.setAttribute("data-drop-label", u.opt(el, "drop-label", "Drop files to attach"));
      el.setAttribute("data-drag-active", "");
    }
    L.on(el, "dragenter", function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDrag(true); });
    L.on(el, "dragover", function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    L.on(el, "dragleave", function (e) { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; setDrag(false); } });
    L.on(el, "drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      addFiles(e.dataTransfer.files, "drop");
    });

    var mo = row && new MutationObserver(sync);
    if (mo) mo.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    var ro = window.ResizeObserver && new ResizeObserver(function () {
      var w = el.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      if (!textOf(input).trim()) wrapped = false;
      sync();
    });
    if (ro) ro.observe(el);
    sync();

    return {
      get value() { return textOf(input); },
      setValue: function (text) { setText(input, text == null ? "" : String(text)); sync(); },
      focus: function () { input.focus(); },
      submit: submit,
      clear: clear,
      setBusy: setBusy,
      isBusy: function () { return busy; },
      addFiles: function (list) { return addFiles(list, "api"); },
      attach: function (chip, file) { if (file) fileOf.set(chip, file); if (row) row.appendChild(chip); sync(); return chip; },
      files: files,
      insertToken: insertToken,
      setExpanded: function (on) { setExpanded(on); },
      setDictating: setDictating,
      sync: sync,
      destroy: function () { L.off(); if (mo) mo.disconnect(); if (ro) ro.disconnect(); },
    };
  });

  /* ------------------------------------------------------------------ Composer drawer */

  // Items are .k-composer-drawer__item children, addressed by element or data-item name. Opening a hidden
  // drawer unhides it first; it hides again 150ms after its last item closes. Events: kube:drawer-open,
  // kube:drawer-close {item}.
  Kube.register("composer-drawer", function (el, u) {
    var timers = new Map();
    function items() { return [].filter.call(el.children, function (c) { return c.classList.contains("k-composer-drawer__item"); }); }
    function find(x) { return typeof x === "string" ? items().filter(function (i) { return i.getAttribute("data-item") === x; })[0] : x; }
    function isOpen(i) { return i.getAttribute("data-state") === "open"; }
    function anyOpen() { return items().some(isOpen); }
    function mark(i, open) {
      i.setAttribute("data-state", open ? "open" : "closed");
      i.inert = !open;
      i.setAttribute("aria-hidden", String(!open));
    }
    items().forEach(function (i) { mark(i, isOpen(i)); });
    if (!anyOpen()) el.hidden = true;

    function set(x, open) {
      var item = find(x);
      if (!item) return Promise.resolve(null);
      clearTimeout(timers.get(item));
      if (open && el.hidden) { el.hidden = false; void el.offsetHeight; } // commit the closed frame first
      var changed = isOpen(item) !== open;
      mark(item, open);
      if (changed) u.emit(el, open ? "drawer-open" : "drawer-close", { item: item });
      return new Promise(function (resolve) {
        timers.set(item, setTimeout(function () {
          timers.delete(item);
          if (!open && !anyOpen()) el.hidden = true;
          resolve(item);
        }, reduced() ? 0 : DRAWER_MS));
      });
    }

    return {
      show: function (x) { return set(x, true); },
      hide: function (x) { return set(x, false); },
      toggle: function (x, force) { var i = find(x); return set(i, force === undefined ? !(i && isOpen(i)) : !!force); },
      remove: function (x) { var i = find(x); return set(i, false).then(function (it) { if (it) it.remove(); return it; }); },
      isOpen: function (x) { var i = find(x); return !!i && isOpen(i); },
      items: items,
      destroy: function () { timers.forEach(clearTimeout); timers.clear(); },
    };
  });

  /* ------------------------------------------------------------------ Command tray */

  // On a tray drawer (with composer-drawer). Opens while the stack's input holds the trigger ("/") and no
  // space; filters role="option" rows by data-value and text; arrows move, Enter/Tab choose, Escape closes.
  // Focus stays in the input (aria-activedescendant). Options: data-kube-trigger, data-kube-input (selector).
  // Events: kube:command {value, option, query} (cancel to keep the draft; otherwise the input is set to the
  // option's data-insert, or cleared), kube:tray-open, kube:tray-close.
  // ponytail: own listbox logic; the menus family had no listbox runtime when this was written.
  Kube.register("composer-tray", function (el, u) {
    var stack = el.closest(".k-composer-stack") || el.parentElement;
    var sel = u.opt(el, "input", "");
    var input = sel ? document.querySelector(sel) : stack && $(stack, ".k-composer__input");
    var list = $(el, '[role="listbox"]');
    var item = $(el, ".k-composer-drawer__item");
    if (!input || !list || !item) return {};
    var trigger = u.opt(el, "trigger", "/");
    var empty = $(el, ".k-composer-tray__empty");
    var open = false, active = -1, dismissed = null;
    var L = listeners();
    if (!list.id) list.id = util.uid("k-tray");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-autocomplete", "list");
    function options() { return all(list, '[role="option"]'); }
    options().forEach(function (o) { if (!o.id) o.id = util.uid("k-opt"); o.setAttribute("aria-selected", "false"); });

    function drawer() { return Kube.get(el, "composer-drawer"); }
    function others() { return stack ? all(stack, ".k-composer-drawer").filter(function (d) { return d !== el; }) : []; }
    function visible() { return options().filter(function (o) { return !o.hidden; }); }
    function query() {
      var v = textOf(input);
      return v.indexOf(trigger) === 0 && !/\s/.test(v) ? v.slice(trigger.length).toLowerCase() : null;
    }
    function reveal(o) {
      var r = o.getBoundingClientRect(), b = list.getBoundingClientRect();
      if (r.top < b.top) list.scrollTop -= b.top - r.top;
      else if (r.bottom > b.bottom) list.scrollTop += r.bottom - b.bottom;
    }
    function setActive(i) {
      var opts = visible();
      active = opts.length ? (i + opts.length) % opts.length : -1;
      options().forEach(function (o) { o.setAttribute("aria-selected", String(o === opts[active])); });
      if (active < 0) return void input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-activedescendant", opts[active].id);
      reveal(opts[active]);
    }
    function filter(q) {
      var n = 0;
      options().forEach(function (o) {
        var hit = ((o.getAttribute("data-value") || "") + " " + o.textContent).toLowerCase().indexOf(q) >= 0;
        o.hidden = !hit;
        if (hit) n++;
      });
      if (empty) empty.hidden = n > 0;
      return n;
    }
    function show() {
      if (open) return;
      open = true;
      others().forEach(function (d) { d.hidden = true; }); // the tray replaces the drawer while open
      var d = drawer();
      if (d) d.show(item); else { el.hidden = false; item.setAttribute("data-state", "open"); }
      u.emit(el, "tray-open", {});
    }
    function hide() {
      if (!open) return;
      open = false;
      input.removeAttribute("aria-activedescendant");
      var d = drawer();
      (d ? d.hide(item) : Promise.resolve()).then(function () {
        if (open) return;
        others().forEach(function (o) { o.hidden = !$(o, '.k-composer-drawer__item[data-state="open"]'); });
      });
      u.emit(el, "tray-close", {});
    }
    function update() {
      var q = query();
      if (textOf(input) !== dismissed) dismissed = null;
      if (q === null || dismissed !== null) return hide();
      if (!filter(q) && !empty) return hide();
      show();
      setActive(0);
    }
    function choose(o) {
      if (!o) return;
      var detail = { value: o.getAttribute("data-value") || o.textContent.trim(), option: o, query: query() };
      hide();
      if (u.emit(el, "command", detail)) {
        setText(input, o.getAttribute("data-insert") || "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // Rich field: data-token turns the choice into an inline token (data-hint adds a ghost completion).
        var composer = input.closest(".k-composer");
        var api = composer && Kube.get(composer, "composer");
        if (api && api.insertToken && o.hasAttribute("data-token")) {
          api.insertToken(o.getAttribute("data-token") || trigger + detail.value, { value: detail.value, hint: o.getAttribute("data-hint") || "" });
          return;
        }
      }
      input.focus();
    }

    L.on(input, "input", update);
    L.on(input, "blur", hide);
    L.on(input, "keydown", function (e) {
      if (!open || e.isComposing || e.keyCode === 229) return;
      var opts = visible();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(active + (e.key === "ArrowDown" ? 1 : -1)); }
      else if (e.key === "Home" || e.key === "End") { if (!opts.length) return; e.preventDefault(); setActive(e.key === "Home" ? 0 : opts.length - 1); }
      else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (!opts[active]) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        choose(opts[active]);
      } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismissed = textOf(input); hide(); }
    }, true); // capture: runs before the composer's Enter-to-send
    L.on(list, "pointerdown", function (e) { e.preventDefault(); });
    L.on(list, "pointermove", function (e) {
      var o = e.target.closest('[role="option"]');
      var i = o ? visible().indexOf(o) : -1;
      if (i >= 0 && i !== active) setActive(i);
    });
    L.on(list, "click", function (e) { choose(e.target.closest('[role="option"]')); });

    return {
      open: function () { textOf(input).indexOf(trigger) === 0 ? update() : (show(), setActive(0)); },
      close: hide,
      update: update,
      isOpen: function () { return open; },
      destroy: function () { L.off(); },
    };
  });

  /* ------------------------------------------------------------------ Attachment chip */

  // On .k-composer-chip or .k-composer-tile. Its .k-composer-remove removes it (fade, then the row closes
  // up) and keeps focus in the composer. Events: kube:remove {item} (cancelable). API: remove(),
  // setProgress(0-100), ready(), error(message).
  Kube.register("attachment-chip", function (el, u) {
    var L = listeners();
    function meta() {
      var m = $(el, ".k-composer-chip__meta");
      if (m || !el.classList.contains("k-composer-chip")) return m;
      m = document.createElement("span");
      m.className = "k-composer-chip__meta";
      var host = $(el, ".k-composer-chip__stack");
      if (host) host.appendChild(m); else el.insertBefore(m, $(el, ".k-composer-remove"));
      return m;
    }
    function remove(fromUser) {
      if (el.getAttribute("data-state") === "removing") return Promise.resolve(el);
      if (!u.emit(el, "remove", { item: el })) return Promise.resolve(null);
      var c = el.closest(".k-composer");
      var input = c && $(c, ".k-composer__input");
      if (input && fromUser && el.contains(document.activeElement)) input.focus({ preventScroll: true });
      el.setAttribute("data-state", "removing");
      return collapseOut(el);
    }
    L.on(el, "pointerdown", function (e) { if (e.target.closest(".k-composer-remove")) e.preventDefault(); }); // no focus steal
    L.on(el, "click", function (e) {
      var b = e.target.closest(".k-composer-remove");
      if (!b || !el.contains(b)) return;
      e.preventDefault();
      e.stopPropagation();
      remove(true);
    });
    return {
      remove: function () { return remove(false); },
      setProgress: function (p) {
        p = util.clamp(+p || 0, 0, 100);
        el.setAttribute("data-state", "uploading");
        el.setAttribute("aria-busy", "true");
        el.style.setProperty("--k-progress", String(p / 100));
        var m = meta();
        if (m) m.textContent = Math.round(p) + "%";
      },
      ready: function () {
        el.removeAttribute("data-state");
        el.removeAttribute("aria-busy");
        el.style.removeProperty("--k-progress");
        var m = $(el, ".k-composer-chip__meta");
        if (m) m.textContent = "";
      },
      error: function (message) {
        el.setAttribute("data-state", "error");
        el.removeAttribute("aria-busy");
        el.style.removeProperty("--k-progress");
        var m = meta();
        if (m) m.textContent = message || "Failed";
      },
      destroy: function () { L.off(); },
    };
  });

  /* ------------------------------------------------------------------ Waveform */

  // Port of the source's composer waveform: a history of 2px bars every 5px scrolling left at 60px/s, faded
  // over 20px at both ends at 45% alpha; with data-mode="text" it blends (220ms, ease-out cubic) into six
  // centered bars weighted .64-1. Input is RMS: from connect(analyser), setLevel(rms), or the built-in demo.
  var WEIGHTS = [.64, .88, 1, 1, .82, .58];
  function pulse(t) {
    return t < 0 ? 0 : t < .18 ? .5 - .5 * Math.cos(Math.PI * t / .18) : t < .23 ? 1 : t < .53 ? .5 + .5 * Math.cos(Math.PI * (t - .23) / .3) : 0;
  }
  function mapLevel(rms) { return Math.pow(Math.min(1, Math.max(0, rms - .006) / .154), .6); }
  // Demo voice: about 3.2 syllables a second inside phrases with short pauses, RMS .008 to .11.
  function demoLevel(t) {
    if (Math.sin(t * 1.1) + .6 * Math.sin(t * .43 + 1.3) < -.5) return .002;
    var syl = Math.pow(Math.max(0, Math.sin(t * Math.PI * 6.4)), 1.6);
    return .008 + .1 * syl * (.55 + .45 * Math.abs(Math.sin(t * 1.9) * Math.sin(t * 7.7 + .4)));
  }

  function Compact() { this.levels = [0, 0, 0, 0, 0, 0]; this.audio = [0, 0, 0, 0, 0, 0]; this.input = 0; this.inputAt = -Infinity; this.elapsed = 0; }
  Compact.prototype.receive = function (v, t) { if (isFinite(v)) { this.input = util.clamp(v, 0, 1); this.inputAt = t; } };
  Compact.prototype.advance = function (dt, now, still) {
    var r = util.clamp(dt, 0, 1 / 15);
    this.elapsed += r;
    var lvl = now - this.inputAt <= .3 ? this.input : 0;
    for (var e = 0; e < 6; e++) {
      var mod = still ? .8 : .72 + .28 * Math.sin(this.elapsed * (4.6 + e * .71) + e * 1.67);
      var target = util.clamp(lvl * WEIGHTS[e] * mod, 0, 1);
      this.audio[e] += (target - this.audio[e]) * (1 - Math.exp(-r / (target > this.audio[e] ? .04 : .16)));
      this.levels[e] = Math.max(this.audio[e], still ? 0 : pulse(this.elapsed * 2 - e * .055));
    }
  };

  function Wave() {
    this.compact = new Compact();
    this.history = new Array(85).fill(0);
    this.phase = 0; this.level = 0; this.envelope = 0;
    this.blend = 0; this.blendFrom = 0; this.blendTarget = 0; this.blendElapsed = 220;
  }
  Wave.prototype.receive = function (rms) {
    this.level = rms < .0025 ? 0 : Math.min(1, rms * 8);
    this.compact.receive(mapLevel(rms), performance.now() / 1000);
  };
  Wave.prototype.advance = function (ms, text, capturing, still) {
    var i = util.clamp(ms, 0, 100), a = text ? 1 : 0;
    if (a !== this.blendTarget) { this.blendFrom = this.blend; this.blendTarget = a; this.blendElapsed = 0; }
    this.blendElapsed = Math.min(220, this.blendElapsed + i);
    this.blend = still ? a : this.blendFrom + (a - this.blendFrom) * (1 - Math.pow(1 - this.blendElapsed / 220, 3));
    if (!capturing) return;
    this.compact.advance(i / 1000, performance.now() / 1000, still);
    this.envelope += (this.level - this.envelope) * (1 - Math.exp(-i / (this.level > this.envelope ? 35 : 90)));
    for (this.phase += i * 60 / 1000; this.phase >= 5; this.phase -= 5) { this.history.push(this.level); this.history.shift(); }
  };
  function bar(ctx, x, y, w, h) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 1); else ctx.rect(x, y, w, h); ctx.fill(); }
  Wave.prototype.draw = function (cv, still) {
    var ctx = cv.getContext("2d"), w = cv.clientWidth, h = cv.clientHeight;
    if (!ctx || !w || !h) return;
    var need = Math.ceil(w / 5) + 2;
    if (need > this.history.length) this.history = new Array(need - this.history.length).fill(0).concat(this.history);
    var s = (window.devicePixelRatio || 1) * (cv.getBoundingClientRect().width / w);
    if (cv.width !== Math.round(w * s) || cv.height !== Math.round(h * s)) { cv.width = Math.round(w * s); cv.height = Math.round(h * s); }
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(cv).color;
    var pattern = [.3, .5, 1, .7, .4, .7], shift = still ? 0 : this.phase;
    for (var e = 0; e < this.history.length; e++) {
      var x = w - 2 - e * 5 - shift;
      var l = still ? this.envelope * pattern[e % 6] : this.history[this.history.length - 1 - e] || 0;
      var d = Math.min(1, Math.max(0, Math.min(x, w - x - 2)) / 20);
      ctx.globalAlpha = (1 - this.blend) * .45 * (l === 0 ? .5 : 1) * d * d * (3 - 2 * d);
      var bh = 2 + l * (h * .88 - 2);
      bar(ctx, Math.round(x * s) / s, (h - bh) / 2, 2, bh);
    }
    for (var k = 0; k < 6; k++) {
      var ch = 3 + this.compact.levels[k] * (Math.min(h, 20) - 3);
      ctx.globalAlpha = this.blend;
      bar(ctx, (w - 27) / 2 + k * 5, (h - ch) / 2, 2, ch);
    }
    ctx.globalAlpha = 1;
  };

  // Options: data-kube-source="demo" (default; synthetic voice) | "none", data-kube-autostart.
  // API: start(), stop(), connect(analyserNode), disconnect(), setLevel(rms | null), setMode("waveform" | "text").
  Kube.register("waveform", function (el, u) {
    var model = new Wave(), raf = 0, last = 0, running = false, analyser = null, buf = null, manual = null;
    var demo = u.opt(el, "source", "demo") === "demo";
    function sample(now) {
      var rms = 0;
      if (manual != null) rms = manual;
      else if (analyser) {
        if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        for (var k = 0, sum = 0; k < buf.length; k++) sum += buf[k] * buf[k];
        rms = Math.sqrt(sum / buf.length);
      } else if (demo) rms = demoLevel(now / 1000);
      model.receive(rms);
    }
    function frame(now) {
      raf = 0;
      var dt = last ? now - last : 16;
      last = now;
      if (running) sample(now);
      model.advance(dt, el.getAttribute("data-mode") === "text", running, reduced());
      model.draw(el, reduced());
      if (running || model.blendElapsed < 220) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    var api = {
      start: function () { running = true; kick(); },
      stop: function () { running = false; kick(); },
      connect: function (node) { analyser = node || null; },
      disconnect: function () { analyser = null; },
      setLevel: function (rms) { manual = rms == null ? null : +rms; },
      setMode: function (mode) { el.setAttribute("data-mode", mode === "text" ? "text" : "waveform"); kick(); },
      isRunning: function () { return running; },
      destroy: function () { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    };
    if (u.opt(el, "autostart", false)) api.start(); else kick();
    return api;
  });

  /* ------------------------------------------------------------------ Message */

  // Clicks on [data-action] inside the turn: "copy" copies the content or bubble text (unless the button runs
  // the actions family's copy behavior), shows data-state="done" for 1.3s and emits kube:copy {ok, text};
  // "react" toggles data-reaction (kube:react {reaction}, cancelable); "reaction-pill" toggles aria-pressed
  // and the count (kube:react {reaction, pressed, count}); "reply-ref" highlights the turn whose id is in
  // data-target (kube:reply-ref {target}); anything else emits kube:action {action, button}. The action row
  // itself is revealed by CSS on hover and focus.
  Kube.register("message", function (el, u) {
    var timers = [];
    var off = u.on(el, "click", function (e) {
      var b = e.target.closest("[data-action]");
      if (!b || !el.contains(b) || b.disabled) return;
      var act = b.getAttribute("data-action");
      if (act === "copy") {
        if (Kube.get(b, "copy")) return;
        var src = $(el, ".k-message__content") || $(el, ".k-message__bubble");
        var text = src ? src.innerText.trim() : "";
        var copy = Kube.copy || function (t) { return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; }); };
        copy(text, b).then(function (ok) {
          u.emit(el, "copy", { ok: ok, text: text });
          if (!ok) return;
          var label = b.getAttribute("aria-label");
          b.setAttribute("data-state", "done");
          b.setAttribute("aria-label", "Copied");
          timers.push(setTimeout(function () { b.removeAttribute("data-state"); if (label !== null) b.setAttribute("aria-label", label); }, 1300));
        });
      } else if (act === "reply-ref") {
        var target = document.getElementById((b.getAttribute("data-target") || "").replace(/^#/, ""));
        if (u.emit(el, "reply-ref", { target: target }) && target) Kube.highlightMessage(target);
      } else if (act === "reaction-pill") {
        var pressed = b.getAttribute("aria-pressed") !== "true";
        var count = $(b, ".k-reaction-pill__count");
        var n = (count ? parseInt(count.textContent, 10) || 0 : 0) + (pressed ? 1 : -1);
        if (!u.emit(el, "react", { reaction: b.getAttribute("data-reaction"), pressed: pressed, count: n })) return;
        b.setAttribute("aria-pressed", String(pressed));
        if (count) count.textContent = n > 0 ? String(n) : "";
        var lab = b.getAttribute("aria-label");
        if (lab) b.setAttribute("aria-label", lab.replace(/(, \d+)?$/, n > 0 ? ", " + n : ""));
        if (n <= 0 && !b.hasAttribute("data-keep")) b.remove();
      } else if (act === "react") {
        var glyph = b.getAttribute("data-reaction") || b.textContent.trim();
        var cur = $(el, ".k-reaction");
        var next = cur && cur.getAttribute("data-reaction") === glyph ? null : glyph;
        if (u.emit(el, "react", { reaction: next })) Kube.react(el, next);
      } else u.emit(el, "action", { action: act, button: b });
    });
    return { destroy: function () { off(); timers.forEach(clearTimeout); } };
  });

  // Kube.react(message, glyph, {label, pending}) puts one reaction under the turn and plays the enter
  // (rise to -38.72px at 1.67x over .4s, settle .45s after .65s); a falsy glyph removes it.
  Kube.react = function (message, glyph, options) {
    var o = options || {};
    var row = $(message, ".k-message__reactions");
    if (!glyph) { if (row) row.remove(); return null; }
    if (!row) {
      row = document.createElement("div");
      row.className = "k-message__reactions";
      row.setAttribute("aria-live", "polite");
      message.insertBefore(row, $(message, ".k-message__actions"));
    }
    row.innerHTML = '<div class="k-reaction" role="img"><span class="k-reaction__bg" aria-hidden="true"></span><span class="k-reaction__glyph" aria-hidden="true"></span></div>';
    var r = row.firstChild;
    r.setAttribute("aria-label", o.label || "Reacted " + glyph);
    r.setAttribute("data-reaction", glyph);
    r.lastChild.textContent = glyph;
    if (o.pending) r.classList.add("k-reaction--pending");
    if (!reduced()) {
      r.setAttribute("data-enter", "");
      r.addEventListener("animationend", function f(e) {
        if (e.animationName !== "k-reaction-settle") return;
        r.removeAttribute("data-enter");
        r.removeEventListener("animationend", f);
      });
    }
    return r;
  };

  // Kube.highlightMessage(message): scroll the quoted turn into view (24px margin) and flash its 2px ring
  // (primary -> 30% over 1.2s ease-out), as when a reply reference is followed.
  var highlightTimers = new WeakMap();
  Kube.highlightMessage = function (message) {
    if (!message) return;
    message.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    message.removeAttribute("data-highlight");
    void message.offsetWidth; // restart the flash
    message.setAttribute("data-highlight", "");
    clearTimeout(highlightTimers.get(message));
    highlightTimers.set(message, setTimeout(function () { message.removeAttribute("data-highlight"); }, 2000));
  };

  /* ------------------------------------------------------------------ Workflow steps */

  // <div class="k-steps" data-kube="steps">: the .k-steps__title button toggles data-expanded (body height,
  // chevron, header rule, 300ms --ease-move); the collapsed body is inert. Events: kube:steps-toggle
  // {expanded}. API: toggle(force), add(text, status) -> entry (fades down 6px while data-streaming is set),
  // setStatus(entry, status) with status "done" | "running" | "pending" | "error".
  Kube.register("steps", function (el, u) {
    var title = $(el, ".k-steps__title");
    var body = $(el, ".k-steps__body");
    var list = $(el, ".k-steps__list");
    if (!title || !body) return {};
    if (!body.id) body.id = util.uid("k-steps");
    title.setAttribute("aria-controls", body.id);
    function set(on) {
      el.setAttribute("data-expanded", String(on));
      title.setAttribute("aria-expanded", String(on));
      body.inert = !on;
    }
    set(el.getAttribute("data-expanded") === "true");
    var off = u.on(title, "click", function () {
      var on = el.getAttribute("data-expanded") !== "true";
      set(on);
      u.emit(el, "steps-toggle", { expanded: on });
    });
    function setStatus(entry, status) { entry.setAttribute("data-status", status || "done"); }
    return {
      toggle: function (force) { set(force === undefined ? el.getAttribute("data-expanded") !== "true" : !!force); },
      add: function (text, status) {
        if (!list) return null;
        var li = document.createElement("li");
        li.className = "k-steps__entry";
        li.innerHTML = '<span class="k-steps__indicator" aria-hidden="true"></span><span class="k-steps__text"></span>';
        li.lastChild.textContent = text;
        setStatus(li, status);
        list.appendChild(li);
        return li;
      },
      setStatus: setStatus,
      destroy: off,
    };
  });

  /* ------------------------------------------------------------------ Streaming text */

  // Kube.stream(target, text, {mode, interval, end}) appends text to a turn word by word: each word (with
  // its trailing space) is wrapped once in .k-word-arrival--response, 70ms apart; a blank line starts a
  // new paragraph. A typing indicator in the turn is swapped out. mode "draft" adds all words at once with
  // .k-word-arrival and min(i * 30, 120)ms delays (dictation). Calls on one turn queue in order; end: false
  // keeps data-streaming for the next chunk. Returns a Promise<boolean> with cancel().
  var queues = new WeakMap();
  Kube.stream = function (target, text, options) {
    var o = options || {};
    var msg = target.closest(".k-message") || target;
    var cancelled = false;
    var run = (queues.get(msg) || Promise.resolve()).then(function () { return cancelled ? false : play(); });
    queues.set(msg, run);
    run.cancel = function () { cancelled = true; };
    return run;

    function play() {
      var content = target.classList.contains("k-message__content") ? target : $(msg, ".k-message__content");
      if (!content) {
        content = document.createElement("div");
        content.className = "k-message__content";
        msg.insertBefore(content, $(msg, ".k-message__actions"));
      }
      var typing = $(msg, ".k-typing");
      if (typing) typing.remove();
      msg.removeAttribute("data-typing");
      msg.setAttribute("data-streaming", "");
      var p = content.lastElementChild && content.lastElementChild.tagName === "P" ? content.lastElementChild : null;
      var queue = [];
      String(text == null ? "" : text).split(/\n{2,}/).forEach(function (para, k) {
        if (k > 0) queue.push(null);
        (para.match(/\s*\S+\s*/g) || []).forEach(function (w) { queue.push(w); });
      });
      var draft = o.mode === "draft", gap = o.interval != null ? o.interval : 70, n = 0;
      function word(w) {
        if (w === null) { p = null; return; }
        if (!p) { p = document.createElement("p"); content.appendChild(p); }
        var s = document.createElement("span");
        s.className = draft ? "k-word-arrival" : "k-word-arrival--response";
        if (draft) s.style.animationDelay = Math.min(n * 30, 120) + "ms";
        n++;
        s.textContent = w;
        p.appendChild(s);
      }
      return new Promise(function (resolve) {
        function finish(ok) { if (o.end !== false) msg.removeAttribute("data-streaming"); resolve(ok); }
        if (draft) { queue.forEach(word); return finish(true); }
        var i = 0;
        (function tick() {
          if (cancelled) return finish(false);
          if (i >= queue.length) return finish(true);
          var w = queue[i++];
          word(w);
          setTimeout(tick, w === null ? 0 : gap);
        })();
      });
    }
  };

  /* ------------------------------------------------------------------ Send morph */

  var hasLinear = !!(window.CSS && CSS.supports("animation-timing-function", "linear(0, 1)"));
  // A damped spring (mass 1) sampled into a linear() easing over the animation's duration.
  function spring(k, zeta, ms) {
    if (!hasLinear) return SNAPPY;
    var w0 = Math.sqrt(k), pts = [];
    for (var s = 0; s <= 40; s++) {
      var t = s / 40 * ms / 1000, x;
      if (zeta < 1) {
        var wd = w0 * Math.sqrt(1 - zeta * zeta);
        x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + zeta * w0 / wd * Math.sin(wd * t));
      } else x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      pts.push(s === 40 ? 1 : +x.toFixed(4));
    }
    return "linear(" + pts.join(", ") + ")";
  }

  // The bubble's fill starts as wide as the composer and its left edge (with the text) slides in.
  function stretch(body, extra, timing) {
    var bg = document.createElement("span");
    bg.className = "k-send-morph__bg";
    bg.setAttribute("aria-hidden", "true");
    bg.style.background = getComputedStyle(body).backgroundColor;
    var text = document.createElement("span");
    text.className = "k-send-morph__text";
    while (body.firstChild) text.appendChild(body.firstChild);
    var fill = body.style.backgroundColor;
    body.style.backgroundColor = "transparent";
    body.classList.add("k-send-morph");
    body.append(text, bg);
    var t = { duration: timing.duration, easing: timing.easing, fill: "both" };
    var a = bg.animate([{ left: -extra + "px" }, { left: "0px" }], t);
    var b = text.animate([{ translate: -extra + "px 0px" }, { translate: "0px 0px" }], t);
    var restored = false;
    function undo() {
      if (restored) return;
      restored = true;
      a.cancel();
      b.cancel();
      bg.remove();
      while (text.firstChild) body.insertBefore(text.firstChild, text);
      text.remove();
      body.style.backgroundColor = fill;
      body.classList.remove("k-send-morph");
    }
    a.onfinish = undo;
    return undo;
  }

  // Kube.sendMorph(from, message, options): call right after appending the sent turn, with the composer
  // (or its rect captured in kube:submit). The bubble flies from the composer's end edge on a spring
  // (stiffness 140, damping set for a 3px overshoot), squishes to (1 - 18d/w, 1 - 4d/h) at a third, and its
  // fill narrows from the composer width in 190ms. Resolves after 600ms + 200ms receipt. Skipped under
  // reduced motion. options: {squishXPx, squishYPx, overshootPx, durationMs, receiptDelayMs}.
  Kube.sendMorph = function (from, message, options) {
    var o = Object.assign({ squishXPx: 18, squishYPx: 4, overshootPx: 3, durationMs: 600, receiptDelayMs: 200 }, options);
    var body = message.classList.contains("k-message__bubble") ? message : $(message, ".k-message__bubble") || message;
    var row = body.closest(".k-message") || message;
    if (reduced() || !body.animate || !from) return Promise.resolve(false);
    var t = from.getBoundingClientRect ? from.getBoundingClientRect() : from;
    var i = body.getBoundingClientRect();
    if (!i.width || !i.height) return Promise.resolve(false);
    var dx = t.right - i.right, dy = Math.min(t.top, t.bottom - i.height) - i.top;
    var dist = Math.hypot(dx, dy), ratio = dist === 0 ? 0 : Math.min(o.overshootPx / dist, .99);
    var ln = -Math.log(ratio), zeta = ratio === 0 ? 1 : ln / Math.hypot(Math.PI, ln);
    var d = Math.min(1, Math.max(i.width, i.height) / 360);
    var fx = Math.max(.5, 1 - o.squishXPx * d / i.width), fy = Math.max(.5, 1 - o.squishYPx * d / i.height);
    var dur = o.durationMs, inOut = "cubic-bezier(.65, 0, .35, 1)";
    row.setAttribute("data-send-morph", "");
    var origin = body.style.transformOrigin;
    body.style.transformOrigin = "100% 100%";
    var anims = [
      body.animate([{ translate: dx + "px " + dy + "px" }, { translate: "0px 0px" }], { duration: dur, easing: spring(140, zeta, dur) }),
      body.animate([
        { transform: "scale(1)", offset: 0, easing: inOut },
        { transform: "scale(" + fx + ", " + fy + ")", offset: 1 / 3, easing: "cubic-bezier(.19, 0, .48, 1)" },
        { transform: "scale(1)", offset: .9, easing: inOut },
        { transform: "scale(1)", offset: 1 },
      ], { duration: dur, easing: "linear" }),
    ];
    var extra = Math.max(0, t.width - i.width);
    var undo = extra > 1 ? stretch(body, extra, { duration: 190 / 600 * dur, easing: "cubic-bezier(.73, .42, .54, 1)" }) : function () {};
    return new Promise(function (resolve) {
      setTimeout(function () {
        anims.forEach(function (a) { a.cancel(); });
        undo();
        body.style.transformOrigin = origin;
        row.removeAttribute("data-send-morph");
        resolve(true);
      }, dur + o.receiptDelayMs);
    });
  };

  /* ------------------------------------------------------------------ Thread */

  // Needs .k-thread__scroll > .k-thread__column; optional .k-thread__dock and .k-thread__jump inside.
  // Follows the bottom while within 96px of it (content growth keeps it pinned); the jump button shows
  // otherwise. New .k-message rows get data-enter (rise 8px, 300ms); a new user turn re-pins. A sideways
  // trackpad swipe reveals .k-message__timestamp columns. Events: kube:follow {following}.
  // API: scrollToLatest(smooth), isFollowing(), setTyping(on) -> the typing turn (feed it to Kube.stream).
  Kube.register("thread", function (el, u) {
    var scroller = $(el, ".k-thread__scroll"), column = $(el, ".k-thread__column");
    if (!scroller || !column) return {};
    var dock = $(el, ".k-thread__dock");
    var jump = $(el, ".k-thread__jump");
    var following = true, settleUntil = 0;
    var L = listeners();

    function distance() { return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop; }
    function setFollowing(on) {
      if (on !== following) { following = on; u.emit(el, "follow", { following: on }); }
      if (!jump) return;
      jump.setAttribute("data-state", following ? "hidden" : "visible");
      jump.tabIndex = following ? -1 : 0;
      jump.setAttribute("aria-hidden", String(following));
    }
    function pin() { scroller.scrollTop = scroller.scrollHeight; }
    function scrollToLatest(smooth) {
      setFollowing(true);
      var soft = smooth !== false && !reduced();
      if (soft) settleUntil = performance.now() + 700;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: soft ? "smooth" : "auto" });
    }

    L.on(scroller, "scroll", function () {
      var near = distance() <= NEAR_BOTTOM;
      if (!near && performance.now() < settleUntil) return; // our own smooth scroll is still travelling
      setFollowing(near);
    });
    if (jump) L.on(jump, "click", function () { scrollToLatest(true); });

    var ro = new ResizeObserver(function () {
      if (following) pin();
      if (dock) el.style.setProperty("--k-thread-dock", dock.offsetHeight + "px");
    });
    ro.observe(scroller);
    ro.observe(column);
    if (dock) ro.observe(dock);

    var mo = new MutationObserver(function (records) {
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1 || !n.classList.contains("k-message") || n.hasAttribute("data-send-morph")) return;
          if (n.classList.contains("k-message--user")) setFollowing(true);
          if (reduced()) return;
          n.setAttribute("data-enter", "");
          n.addEventListener("animationend", function f(e) {
            if (e.target !== n) return;
            n.removeAttribute("data-enter");
            n.removeEventListener("animationend", f);
          });
        });
      });
      if (following) pin();
    });
    mo.observe(column, { childList: true });

    // Swipe-to-reveal timestamps, ported from the source's wheel handler: axis lock after 12px of
    // disagreement, a gesture ends after 150ms without wheel events, a nested sideways scroller wins,
    // and the reveal resets on pointer movement, a press, blur, or 50px of vertical scroll.
    var swipe = null, axis = "vertical", acc = 0, lastWheel = -1, locked = false;
    function reset() {
      axis = "vertical";
      acc = 0;
      if (!swipe) return;
      swipe = null;
      scroller.removeAttribute("data-timestamp-swiping");
      scroller.style.removeProperty("--k-reveal");
    }
    function end() { locked = locked || swipe != null; reset(); }
    L.on(scroller, "wheel", function (e) {
      if (e.ctrlKey || e.metaKey || (e.deltaX === 0 && e.deltaY === 0)) return;
      if (swipe) { swipe.x = e.clientX; swipe.y = e.clientY; }
      var fresh = lastWheel < 0 || e.timeStamp - lastWheel > 150;
      lastWheel = e.timeStamp;
      if (fresh) { acc = 0; locked = false; }
      if (e.defaultPrevented || locked) return;
      for (var n = e.target; n && n !== scroller; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth && /^(auto|scroll)$/.test(getComputedStyle(n).overflowX)) return void end();
      }
      var kx = 1, ky = 1;
      if (e.deltaMode === 2) { kx = scroller.clientWidth; ky = scroller.clientHeight; }
      else if (e.deltaMode === 1) kx = ky = parseFloat(getComputedStyle(scroller).lineHeight) || 16;
      var h = e.deltaX * kx, g = e.deltaY * ky;
      acc = Math.max(0, acc + (axis === "horizontal" ? Math.abs(g) - Math.abs(h) : (swipe ? Math.abs(h) : h) - Math.abs(g)));
      if (acc >= 12) { axis = axis === "horizontal" ? "vertical" : "horizontal"; acc = 0; }
      if (axis !== "horizontal" || Math.abs(g) >= Math.abs(h)) return;
      if (!swipe) {
        if (h <= 0) return;
        var ts = $(scroller, ".k-message__timestamp");
        var dist = ts ? ts.offsetWidth : 0;
        if (!dist) return;
        reset();
        swipe = { distance: dist, offset: 0, x: e.clientX, y: e.clientY, top: scroller.scrollTop };
        axis = "horizontal";
      }
      swipe.offset = util.clamp(swipe.offset + h, 0, swipe.distance);
      scroller.setAttribute("data-timestamp-swiping", "");
      scroller.style.setProperty("--k-reveal", String(swipe.offset / swipe.distance));
      e.preventDefault();
    }, { passive: false });
    L.on(scroller, "scroll", function () { if (swipe && Math.abs(scroller.scrollTop - swipe.top) > 50) end(); }, true);
    function moved(e) { if (swipe && (e.movementX || e.movementY || e.clientX !== swipe.x || e.clientY !== swipe.y)) end(); }
    L.on(window, "pointermove", moved, { capture: true, passive: true });
    L.on(window, "pointerdown", end, true);
    L.on(window, "blur", function () { locked = false; end(); });

    function setTyping(on) {
      var t = [].filter.call(column.children, function (c) { return c.hasAttribute("data-typing"); })[0];
      if (!on) { if (t) t.remove(); return null; }
      if (t) return t;
      t = document.createElement("div");
      t.className = "k-message k-message--assistant";
      t.setAttribute("data-typing", "");
      t.innerHTML = '<span class="k-typing" role="status" aria-label="Responding"><span class="k-typing__dot"></span><span class="k-typing__dot"></span><span class="k-typing__dot"></span></span>';
      column.appendChild(t);
      return t;
    }

    if (dock) el.style.setProperty("--k-thread-dock", dock.offsetHeight + "px");
    pin();
    setFollowing(true);

    return {
      scrollToLatest: scrollToLatest,
      isFollowing: function () { return following; },
      setTyping: setTyping,
      destroy: function () { L.off(); ro.disconnect(); mo.disconnect(); reset(); },
    };
  });

  /* ------------------------------------------------------------------ Suggestion list */

  // Clicking a card emits kube:suggest {text, item}. Its .k-suggestion__dismiss emits kube:dismiss {text,
  // item, id} (cancelable), moves focus to a neighbour and folds the card out. With data-kube-remember="key",
  // dismissed data-id values are stored and stay hidden on the next visit. API: reset() forgets them.
  Kube.register("suggestion-list", function (el, u) {
    var key = u.opt(el, "remember", "");
    var storeKey = "kube:dismissed:" + key;
    var gone = [];
    if (key) {
      try { gone = JSON.parse(util.store.get(storeKey) || "[]"); } catch (e) { gone = []; }
      [].slice.call(el.children).forEach(function (c) { if (gone.indexOf(c.getAttribute("data-id")) >= 0) c.remove(); });
    }
    var off = u.on(el, "click", function (e) {
      var b = e.target.closest(".k-suggestion__dismiss, .k-suggestion");
      if (!b || !el.contains(b) || b.disabled) return;
      var item = b;
      while (item.parentElement !== el) item = item.parentElement;
      var label = $(item, ".k-suggestion__label");
      var text = label ? label.textContent.trim() : "";
      if (b.classList.contains("k-suggestion")) return void u.emit(el, "suggest", { text: text, item: item });
      var id = item.getAttribute("data-id");
      if (!u.emit(el, "dismiss", { text: text, item: item, id: id })) return;
      if (key && id) { gone.push(id); util.store.set(storeKey, JSON.stringify(gone)); }
      var next = item.nextElementSibling || item.previousElementSibling;
      var card = next && $(next, ".k-suggestion");
      if (card) card.focus({ preventScroll: true });
      collapseOut(item);
    });
    return {
      reset: function () { gone = []; if (key) util.store.set(storeKey, "[]"); },
      destroy: off,
    };
  });
})(window.Kube);

/* --- 70-content.js --- */
/* Kube content & data display: codeblock (copy, wrap, preview/source), copy-inline, carousel,
 * table (keyboard scroll, copy, expand), avatar-group, and the Kube.previewBlock dialog.
 * Timings and rules follow the reverse-read app: copy feedback 2000ms (inline 1000ms), wrap is
 * one persisted preference for every block, carousel steps to the next card edge.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;

  /* ---------------------------------------------------------------- clipboard */

  // Resolves true when the text (and optional HTML flavor) reached the clipboard. Plain text goes
  // through Kube.copy (actions family), which also handles the execCommand fallback inside dialogs.
  function writeClipboard(text, html, el) {
    var c = navigator.clipboard;
    if (c && html && typeof ClipboardItem === "function" && c.write) {
      return c.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]).then(function () { return true; }, function () { return Kube.copy(text, el); });
    }
    return Kube.copy(text, el);
  }

  // Copy feedback shared by every copy button here: aria-busy/aria-disabled while the write is
  // pending, then data-copied and an aria-label of "Copied" for `ms`; clicks are ignored meanwhile.
  // getData() returns a string or { text, html }. Returns a remover.
  function copyButton(btn, getData, ms, onDone) {
    var label = btn.getAttribute("aria-label");
    var busy = false, timer = 0;
    function set(copied) {
      if (copied) {
        btn.setAttribute("data-copied", "");
        if (label !== null) btn.setAttribute("aria-label", btn.getAttribute("data-kube-copied-label") || "Copied");
      } else {
        btn.removeAttribute("data-copied");
        if (label !== null) btn.setAttribute("aria-label", label);
      }
    }
    var off = util.on(btn, "click", function (e) {
      e.stopPropagation();
      if (busy || btn.hasAttribute("data-copied") || btn.disabled) return;
      var d = getData();
      if (typeof d === "string") d = { text: d };
      busy = true;
      btn.setAttribute("aria-busy", "true");
      btn.setAttribute("aria-disabled", "true");
      writeClipboard(d.text, d.html, btn).then(function (ok) {
        busy = false;
        btn.removeAttribute("aria-busy");
        btn.removeAttribute("aria-disabled");
        if (ok) {
          set(true);
          timer = setTimeout(function () { set(false); }, ms);
        }
        util.emit(btn, "copy", { ok: ok, text: d.text });
        if (onDone) onDone(ok);
      });
    });
    return function () { off(); clearTimeout(timer); set(false); };
  }

  /* ---------------------------------------------------------------- codeblock */

  var WRAP_KEY = "kube.codeblock.wrap";
  var wrapGroup = new Set(); // blocks that share the persisted wrap preference

  function sourceOf(block) {
    return block.querySelector(".k-codeblock__source") || block.querySelector(".k-codeblock__body");
  }

  // data-kube="codeblock" on .k-codeblock. Buttons inside: [data-copy], [data-wrap], [data-preview-toggle].
  // Options: data-kube-copy-text (copy this instead of the body text), data-kube-wrap-persist (true: one
  // stored preference for every block on the page; false: this block only).
  Kube.register("codeblock", function (el, u) {
    var offs = [];
    var copyBtn = el.querySelector("[data-copy]");
    var wrapBtn = el.querySelector("[data-wrap]");
    var toggleBtn = el.querySelector("[data-preview-toggle]");
    var persist = u.opt(el, "wrap-persist", true);

    if (copyBtn) {
      offs.push(copyButton(copyBtn, function () {
        var t = el.getAttribute("data-kube-copy-text");
        if (t !== null) return t;
        var src = sourceOf(el);
        return src ? src.textContent : "";
      }, u.opt(el, "copied-ms", 2000)));
    }

    function applyWrap(on) {
      el.classList.toggle("k-codeblock--wrap", on);
      if (!wrapBtn) return;
      wrapBtn.setAttribute("aria-pressed", String(on));
      wrapBtn.setAttribute("aria-label", on ? "Disable word wrap" : "Enable word wrap");
    }
    var api = {
      setWrap: function (on) {
        on = !!on;
        if (persist) {
          util.store.set(WRAP_KEY, on ? "1" : "0");
          wrapGroup.forEach(function (b) { b.apply(on); });
        } else applyWrap(on);
        u.emit(el, "wrap", { wrap: on });
      },
    };
    var member = { apply: applyWrap };
    if (wrapBtn) {
      if (persist) { wrapGroup.add(member); applyWrap(util.store.get(WRAP_KEY) === "1"); }
      else applyWrap(el.classList.contains("k-codeblock--wrap"));
      offs.push(u.on(wrapBtn, "click", function () { api.setWrap(!el.classList.contains("k-codeblock--wrap")); }));
    }

    // Preview <-> source (LaTeX and other rendered blocks): one node is shown, the other is inert.
    var preview = el.querySelector(".k-codeblock__preview");
    var source = el.querySelector(".k-codeblock__source");
    if (preview && source) {
      var labelEl = toggleBtn && (toggleBtn.querySelector("[data-label]") || toggleBtn);
      api.showSource = function (on) {
        on = !!on;
        el.setAttribute("data-source-visible", String(on));
        source.hidden = !on;
        source.inert = !on;
        preview.inert = on;
        preview.toggleAttribute("data-hidden", on);
        if (toggleBtn) {
          labelEl.textContent = on ? toggleBtn.getAttribute("data-kube-preview-label") || "Show preview" : "Show source";
          toggleBtn.setAttribute("aria-pressed", String(on));
        }
        u.emit(el, "sourcetoggle", { sourceVisible: on });
      };
      api.showSource(u.opt(el, "source-visible", false));
      if (toggleBtn) {
        // Keep focus where it is (the source keeps mousedown from moving it to the button).
        offs.push(u.on(toggleBtn, "mousedown", function (e) { e.preventDefault(); }));
        offs.push(u.on(toggleBtn, "click", function () { api.showSource(el.getAttribute("data-source-visible") !== "true"); }));
      }
    }

    api.destroy = function () { offs.forEach(function (off) { off(); }); wrapGroup.delete(member); };
    return api;
  });

  /* ---------------------------------------------------------------- copy-inline */

  // data-kube="copy-inline" on .k-copy-inline: a text button whose label crossfades to "Copied" in the
  // success color for 1000ms. Options: data-kube-text (what to copy; default the label text),
  // data-kube-copied-ms (1000).
  Kube.register("copy-inline", function (el, u) {
    var label = el.querySelector(".k-copy-inline__label");
    if (!label) {
      label = document.createElement("span");
      label.className = "k-copy-inline__label";
      while (el.firstChild) label.appendChild(el.firstChild);
      el.appendChild(label);
    }
    var done = el.querySelector(".k-copy-inline__done");
    var made = !done;
    if (made) {
      done = document.createElement("span");
      done.className = "k-copy-inline__done";
      done.textContent = el.getAttribute("data-kube-copied-label") || "Copied";
      el.appendChild(done);
    }
    function aria() {
      var on = el.hasAttribute("data-copied");
      label.setAttribute("aria-hidden", String(on));
      done.setAttribute("aria-hidden", String(!on));
    }
    aria();
    var mo = new MutationObserver(aria);
    mo.observe(el, { attributes: true, attributeFilter: ["data-copied"] });
    var off = copyButton(el, function () {
      var t = el.getAttribute("data-kube-text");
      return t !== null ? t : label.textContent.trim();
    }, u.opt(el, "copied-ms", 1000));
    return { destroy: function () { off(); mo.disconnect(); if (made) done.remove(); } };
  });

  /* ---------------------------------------------------------------- carousel */

  var EDGE = 1; // px tolerance, as in the app

  function rtlOf(el) { return getComputedStyle(el).direction === "rtl"; }
  function offsetIn(r, box, rtl) { return rtl ? box.right - r.right : r.left - box.left; }

  // data-kube="carousel" on .k-carousel (with .k-carousel__track and optional __btn--prev / __btn--next).
  // Arrows step to the next card whose leading edge is past the track's start; at either end the arrow
  // gets aria-disabled (it stays focusable only while focused). Arrow keys on the track step too;
  // Home/End jump to the ends. Events: kube:carouselchange { canPrev, canNext }.
  Kube.register("carousel", function (el, u) {
    var track = el.querySelector(".k-carousel__track");
    if (!track) return {};
    var prev = el.querySelector(".k-carousel__btn--prev");
    var next = el.querySelector(".k-carousel__btn--next");
    if (!track.id) track.id = u.uid("k-carousel");
    var name = el.getAttribute("aria-label") || track.getAttribute("aria-label");
    if (!track.hasAttribute("tabindex")) track.tabIndex = 0;
    if (!track.hasAttribute("aria-label")) track.setAttribute("aria-label", name || "Cards");
    [[prev, "Previous cards"], [next, "Next cards"]].forEach(function (p) {
      if (!p[0]) return;
      p[0].setAttribute("aria-controls", track.id);
      if (!p[0].hasAttribute("aria-label")) p[0].setAttribute("aria-label", p[1] + (name ? " in " + name : ""));
    });

    function items() { return [].filter.call(track.children, function (c) { return c.getClientRects().length > 0; }); }
    function start() { var n = parseFloat(getComputedStyle(track).scrollPaddingInlineStart); return isFinite(n) ? n : 0; }
    // The card to bring to the start edge for a step in `dir` (1 next, -1 previous).
    function target(dir) {
      var list = items(), box = track.getBoundingClientRect(), rtl = rtlOf(track), s = start();
      if (dir < 0) list = list.slice().reverse();
      for (var i = 0; i < list.length; i++) {
        var o = offsetIn(list[i].getBoundingClientRect(), box, rtl);
        if (dir > 0 ? o > s + EDGE : o < s - EDGE) return list[i];
      }
      return null;
    }
    var state = { canPrev: null, canNext: null };
    function update() {
      var list = items(), box = track.getBoundingClientRect(), rtl = rtlOf(track);
      var canPrev = false, canNext = false;
      if (list.length) {
        var first = offsetIn(list[0].getBoundingClientRect(), box, rtl);
        var lr = list[list.length - 1].getBoundingClientRect();
        canPrev = first < start() - EDGE && !!target(-1);
        canNext = offsetIn(lr, box, rtl) + lr.width > track.clientWidth + EDGE && !!target(1);
      }
      if (canPrev === state.canPrev && canNext === state.canNext) return;
      state = { canPrev: canPrev, canNext: canNext };
      [[prev, canPrev], [next, canNext]].forEach(function (p) {
        if (!p[0]) return;
        p[0].setAttribute("aria-disabled", String(!p[1]));
        p[0].tabIndex = p[1] ? 0 : -1;
      });
      el.setAttribute("data-can-prev", String(canPrev));
      el.setAttribute("data-can-next", String(canNext));
      u.emit(el, "carouselchange", { canPrev: canPrev, canNext: canNext });
    }
    function go(dir) {
      var t = target(dir);
      if (!t) return false;
      // scrollIntoView would also scroll the page vertically; scroll the track only.
      var box = track.getBoundingClientRect(), rtl = rtlOf(track);
      var delta = offsetIn(t.getBoundingClientRect(), box, rtl) - start();
      track.scrollBy({ left: rtl ? -delta : delta, behavior: u.reducedMotion() ? "auto" : "smooth" });
      return true;
    }
    function toEnd(end) {
      var rtl = rtlOf(track);
      var max = track.scrollWidth - track.clientWidth;
      track.scrollTo({ left: end ? (rtl ? -max : max) : 0, behavior: u.reducedMotion() ? "auto" : "smooth" });
    }

    var raf = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    function observe() { if (!ro) return; ro.disconnect(); ro.observe(track); [].forEach.call(track.children, function (c) { ro.observe(c); }); }
    var mo = new MutationObserver(function () { observe(); schedule(); });
    mo.observe(track, { childList: true });
    observe();
    var offs = [
      u.on(track, "scroll", update, { passive: true }),
      u.on(window, "resize", schedule),
      u.on(track, "keydown", function (e) {
        if (e.target !== track || e.altKey || e.ctrlKey || e.metaKey) return;
        var rtl = rtlOf(track);
        var k = e.key;
        if (k === "ArrowRight" || k === "ArrowLeft") {
          if (go((k === "ArrowRight") !== rtl ? 1 : -1)) e.preventDefault();
        } else if (k === "Home" || k === "End") { e.preventDefault(); toEnd(k === "End"); }
      }),
    ];
    [[prev, -1], [next, 1]].forEach(function (p) {
      if (p[0]) offs.push(u.on(p[0], "click", function () { if (p[0].getAttribute("aria-disabled") !== "true") go(p[1]); }));
    });
    update();
    return {
      prev: function () { return go(-1); },
      next: function () { return go(1); },
      update: update,
      destroy: function () { offs.forEach(function (off) { off(); }); if (ro) ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); },
    };
  });

  /* ---------------------------------------------------------------- block preview dialog */

  var CLOSE_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

  // Opens `content` (a node, moved in; clone it first to keep the original) in a modal preview.
  // Options: label (dialog name), closeLabel, opener (gets aria-expanded and focus back), className
  // (extra classes on the scrolling body, e.g. "k-prose"). Returns { dialog, close }.
  Kube.previewBlock = function (content, options) {
    var o = options || {};
    var host = (o.opener && o.opener.closest(".k-root")) || document.body;
    var dlg = document.createElement("dialog");
    dlg.className = "k-block-preview";
    dlg.setAttribute("aria-label", o.label || "Preview");
    var close = document.createElement("button");
    close.type = "button";
    close.className = "k-block-preview__close";
    close.setAttribute("aria-label", o.closeLabel || "Close preview");
    close.innerHTML = CLOSE_SVG;
    var body = document.createElement("div");
    body.className = "k-block-preview__body" + (o.className ? " " + o.className : "");
    body.setAttribute("role", "region");
    body.setAttribute("aria-label", o.label || "Preview");
    body.tabIndex = 0;
    body.appendChild(content);
    dlg.appendChild(close);
    dlg.appendChild(body);
    host.appendChild(dlg);
    function shut() { if (dlg.open) dlg.close(); }
    close.addEventListener("click", shut);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(); });
    dlg.addEventListener("close", function () {
      dlg.remove();
      if (o.opener) { o.opener.setAttribute("aria-expanded", "false"); if (o.opener.isConnected) o.opener.focus(); }
      util.emit(o.opener || document, "previewclose", {});
    });
    if (o.opener) { o.opener.setAttribute("aria-expanded", "true"); o.opener.setAttribute("aria-haspopup", "dialog"); }
    dlg.showModal();
    body.focus();
    return { dialog: dlg, close: shut };
  };

  /* ---------------------------------------------------------------- table */

  function cellText(c) { return c.textContent.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"); }

  // Markdown for a table: header row (the first thead row, or the first row), separator, body rows.
  // Row-label rows (.k-table__row-label) become a bold one-cell row.
  function tableMarkdown(table) {
    var rows = [].slice.call(table.rows);
    if (!rows.length) return "";
    var width = Math.max.apply(null, rows.map(function (r) { return [].reduce.call(r.cells, function (n, c) { return n + (c.colSpan || 1); }, 0); }));
    var line = function (cells) {
      while (cells.length < width) cells.push("");
      return "| " + cells.join(" | ") + " |";
    };
    var out = [];
    rows.forEach(function (r, i) {
      var cells = r.classList.contains("k-table__row-label") ? ["**" + cellText(r.cells[0]) + "**"] : [].map.call(r.cells, cellText);
      out.push(line(cells));
      if (i === 0) out.push(line([].map.call(r.cells, function (c) {
        var a = c.getAttribute("align") || (c.classList.contains("k-table__num") ? "right" : "");
        return a === "right" ? "---:" : a === "center" ? ":---:" : "---";
      })));
    });
    return out.join("\n");
  }

  // data-kube="table" on .k-table-block (a wrapper holding the scroller and .k-block-actions) or on
  // .k-table-scroll itself. While the table overflows, the scroller becomes a labelled, focusable region
  // (unless you set those yourself) and gets data-overflowing; ArrowLeft/Right scroll 40px, Alt+Arrow
  // one viewport. Buttons inside: [data-table-copy] (Markdown + HTML), [data-table-expand] (preview).
  // Options: data-kube-label ("Scrollable table"), data-kube-preview-label ("Table preview").
  Kube.register("table", function (el, u) {
    var sc = el.classList.contains("k-table-scroll") ? el : el.querySelector(".k-table-scroll");
    var table = el.querySelector("table");
    if (!sc || !table) return {};
    var authored = { role: sc.hasAttribute("role"), tab: sc.hasAttribute("tabindex"), label: sc.hasAttribute("aria-label") };
    var label = u.opt(el, "label", "Scrollable table");
    var last = null;
    function update() {
      var over = sc.scrollWidth > sc.clientWidth + 1;
      if (over === last) return;
      last = over;
      sc.setAttribute("data-overflowing", String(over));
      if (!authored.role) { if (over) sc.setAttribute("role", "region"); else sc.removeAttribute("role"); }
      if (!authored.tab) { if (over) sc.tabIndex = 0; else sc.removeAttribute("tabindex"); }
      if (!authored.label) { if (over) sc.setAttribute("aria-label", label); else sc.removeAttribute("aria-label"); }
      u.emit(el, "overflow", { overflow: over });
    }
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (ro) { ro.observe(sc); ro.observe(table); }
    var offs = [
      u.on(window, "resize", update),
      u.on(sc, "keydown", function (e) {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (sc.scrollWidth <= sc.clientWidth) return;
        e.preventDefault();
        sc.scrollBy({ left: (e.key === "ArrowLeft" ? -1 : 1) * (e.altKey ? sc.clientWidth : 40) });
      }),
    ];
    var copyBtn = el.querySelector("[data-table-copy]");
    if (copyBtn) offs.push(copyButton(copyBtn, function () { return { text: tableMarkdown(table), html: table.outerHTML }; }, 2000));
    var expandBtn = el.querySelector("[data-table-expand]");
    if (expandBtn) {
      expandBtn.setAttribute("aria-haspopup", "dialog");
      expandBtn.setAttribute("aria-expanded", "false");
      offs.push(u.on(expandBtn, "click", function () {
        var prose = el.closest(".k-prose");
        Kube.previewBlock(table.cloneNode(true), {
          label: u.opt(el, "preview-label", "Table preview"),
          closeLabel: "Close table preview",
          opener: expandBtn,
          className: prose ? "k-prose" : "",
        });
      }));
    }
    update();
    return {
      update: update,
      markdown: function () { return tableMarkdown(table); },
      destroy: function () {
        offs.forEach(function (off) { off(); });
        if (ro) ro.disconnect();
        sc.removeAttribute("data-overflowing");
        if (!authored.role) sc.removeAttribute("role");
        if (!authored.tab) sc.removeAttribute("tabindex");
        if (!authored.label) sc.removeAttribute("aria-label");
      },
    };
  });

  /* ---------------------------------------------------------------- avatars */

  // "+N" text for an overflow avatar: compact, lowercase, no decimals (1200 -> "1k").
  Kube.avatarCount = function (n) {
    return new Intl.NumberFormat("en", { notation: "compact", compactDisplay: "short", maximumFractionDigits: 0 }).format(n).toLowerCase();
  };

  // Fill an overflow avatar: a raised "+" and the count, with data-letter-count for the font scale.
  function fillCount(av, n) {
    var t = Kube.avatarCount(n);
    av.classList.add("k-avatar--count");
    av.setAttribute("data-letter-count", String(t.length));
    av.innerHTML = '<span class="k-avatar__plus" aria-hidden="true">+</span>';
    av.appendChild(document.createTextNode(t));
  }

  // data-kube="avatar-group" on .k-avatar-group. Option data-kube-max: show that many avatars and
  // replace the rest with one "+N" avatar. Without it, an existing .k-avatar--count just gets its
  // data-letter-count. API: setMax(n), update().
  Kube.register("avatar-group", function (el, u) {
    var max = u.opt(el, "max", 0);
    var made = null;
    function update() {
      var all = [].filter.call(el.children, function (c) { return c.classList.contains("k-avatar") && c !== made && !c.hasAttribute("data-kube-count"); });
      var authoredCount = all.filter(function (c) { return c.classList.contains("k-avatar--count"); });
      var people = all.filter(function (c) { return authoredCount.indexOf(c) < 0; });
      authoredCount.forEach(function (c) {
        var n = parseInt(c.textContent.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(n) && !c.querySelector(".k-avatar__plus")) fillCount(c, n);
      });
      var hidden = max > 0 && people.length > max ? people.length - max : 0;
      people.forEach(function (p, i) { p.hidden = hidden > 0 && i >= max; });
      if (hidden) {
        if (!made) {
          made = document.createElement("span");
          made.className = "k-avatar";
          made.setAttribute("aria-hidden", "true");
          made.setAttribute("data-kube-count", "");
          var ref = people[0];
          made.style.setProperty("--k-avatar-size", ref ? getComputedStyle(ref).getPropertyValue("--k-avatar-size") : "");
          el.appendChild(made);
        }
        fillCount(made, hidden);
      } else if (made) { made.remove(); made = null; }
      u.emit(el, "avatarcount", { shown: people.length - hidden, hidden: hidden });
    }
    update();
    return {
      update: update,
      setMax: function (n) { max = n; update(); },
      destroy: function () {
        if (made) made.remove();
        [].forEach.call(el.children, function (c) { if (c.classList.contains("k-avatar")) c.hidden = false; });
      },
    };
  });
})(window.Kube);

/* --- 75-media.js --- */
/* Kube media & content extras: image, audio, video, marquee, pager, truncate-middle, doc, find,
 * overflow-row, and Kube.highlight(root, query). Markup and classes: src/css/75-media.css, 95-layout.css. */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var on = util.on;

  // One rAF per burst of observer callbacks: keeps layout work out of the ResizeObserver delivery loop.
  function batched(fn) {
    var raf = 0;
    var run = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; fn(); }); };
    run.cancel = function () { cancelAnimationFrame(raf); raf = 0; };
    return run;
  }

  /* ---------- image: fade the full image in once decoded ---------- */

  Kube.register("image", function (el, u) {
    var img = el.querySelector(":scope > img:not(.k-image__placeholder)");
    if (!img) return {};
    function done() { img.setAttribute("data-loaded", ""); el.removeAttribute("data-state"); u.emit(el, "load", { img: img }); }
    function fail() { el.setAttribute("data-state", "error"); u.emit(el, "error", { img: img }); }
    var offs = [on(img, "load", done), on(img, "error", fail)];
    if (img.complete) { if (img.naturalWidth) done(); else if (img.currentSrc || img.getAttribute("src")) fail(); }
    return { destroy: function () { offs.forEach(function (f) { f(); }); } };
  });

  /* ---------- audio / video: one wiring for both ---------- */

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  // Controls are found by data-media="play | current | duration | remaining | skip | speed | mute | fullscreen"
  // and the .k-scrubber; the root gets data-state (idle | playing | paused) and data-muted.
  function wireMedia(root, media, u) {
    var all = function (name) { return [].slice.call(root.querySelectorAll('[data-media="' + name + '"]')); };
    var scrub = root.querySelector(".k-scrubber");
    var speeds = String(u.opt(root, "speeds", "1,1.25,1.5,2,0.75")).split(",").map(Number).filter(function (n) { return n > 0; });
    var started = false, dragging = false, raf = 0;
    var dur = function () { return isFinite(media.duration) ? media.duration : u.opt(root, "duration", 0); };

    function setState() {
      root.dataset.state = !media.paused ? "playing" : started ? "paused" : "idle";
      root.toggleAttribute("data-muted", media.muted);
      all("play").forEach(function (b) { b.setAttribute("aria-label", media.paused ? "Play" : "Pause"); });
      all("mute").forEach(function (b) { b.setAttribute("aria-label", media.muted ? "Unmute" : "Mute"); });
    }
    function render() {
      var d = dur(), t = media.currentTime;
      all("current").forEach(function (e) { e.textContent = fmt(t); });
      all("duration").forEach(function (e) { e.textContent = fmt(d); });
      all("remaining").forEach(function (e) { e.textContent = "-" + fmt(d - t); });
      all("speed").forEach(function (e) { e.textContent = media.playbackRate + "x"; });
      if (!scrub) return;
      scrub.style.setProperty("--k-scrub", d ? u.clamp(t / d, 0, 1) : 0);
      scrub.setAttribute("aria-valuemax", String(Math.round(d)));
      scrub.setAttribute("aria-valuenow", String(Math.round(t)));
      scrub.setAttribute("aria-valuetext", fmt(t) + " of " + fmt(d));
    }
    function tick() { render(); raf = media.paused ? 0 : requestAnimationFrame(tick); }
    function seek(t) {
      var d = dur();
      if (!d) return;
      media.currentTime = u.clamp(t, 0, d);
      render();
      u.emit(root, "seek", { time: media.currentTime, media: media });
    }
    function toggle() {
      if (media.paused) {
        started = true;
        var p = media.play();
        if (p && p.catch) p.catch(function (err) { setState(); u.emit(root, "error", { error: err, media: media }); });
      } else media.pause();
    }
    function ratio(e) {
      var r = scrub.getBoundingClientRect();
      var x = r.width ? (e.clientX - r.left) / r.width : 0;
      if (getComputedStyle(scrub).direction === "rtl") x = 1 - x;
      return u.clamp(x, 0, 1);
    }
    function preview(e) {
      var d = dur();
      if (!d || dragging) { scrub.removeAttribute("data-preview"); return; }
      var h = ratio(e), p = media.currentTime / d;
      scrub.style.setProperty("--k-scrub-preview-start", Math.min(h, p));
      scrub.style.setProperty("--k-scrub-preview-width", Math.abs(h - p));
      scrub.setAttribute("data-preview", h >= p ? "forward" : "backward");
    }

    if (scrub) {
      scrub.setAttribute("role", "slider");
      if (!scrub.hasAttribute("tabindex")) scrub.tabIndex = 0;
      if (!scrub.hasAttribute("aria-label")) scrub.setAttribute("aria-label", "Seek");
      scrub.setAttribute("aria-valuemin", "0");
    }
    var offs = [
      on(root, "click", function (e) {
        var b = e.target.closest && e.target.closest("[data-media]");
        if (!b || !root.contains(b)) return;
        var kind = b.getAttribute("data-media");
        if (kind === "play") toggle();
        else if (kind === "skip") seek(media.currentTime + parseFloat(b.getAttribute("data-media-skip") || "10"));
        else if (kind === "mute") media.muted = !media.muted;
        else if (kind === "speed") media.playbackRate = speeds[(speeds.indexOf(media.playbackRate) + 1) % speeds.length] || 1;
        else if (kind === "fullscreen") {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
        }
      }),
    ];
    ["play", "pause", "ended", "volumechange"].forEach(function (type) {
      offs.push(on(media, type, function () {
        setState();
        if (type === "play") { cancelAnimationFrame(raf); tick(); }
        if (type === "play" || type === "pause") u.emit(root, type, { media: media });
      }));
    });
    ["timeupdate", "durationchange", "loadedmetadata", "ratechange", "seeked"].forEach(function (type) { offs.push(on(media, type, render)); });
    if (scrub) {
      offs.push(
        on(scrub, "pointerdown", function (e) {
          if (e.button !== 0) return;
          dragging = true;
          scrub.setPointerCapture(e.pointerId);
          scrub.removeAttribute("data-preview");
          seek(ratio(e) * dur());
          e.preventDefault();
          scrub.focus({ preventScroll: true });
        }),
        on(scrub, "pointermove", function (e) { if (dragging) seek(ratio(e) * dur()); else preview(e); }),
        on(scrub, "pointerup", function () { dragging = false; }),
        on(scrub, "pointercancel", function () { dragging = false; }),
        on(scrub, "pointerleave", function () { if (!dragging) scrub.removeAttribute("data-preview"); }),
        on(scrub, "keydown", function (e) {
          var d = dur(), t = media.currentTime, k = e.key, rtl = getComputedStyle(scrub).direction === "rtl";
          var step = u.opt(root, "step", 5);
          if (k === "ArrowRight" || k === "ArrowLeft") seek(t + ((k === "ArrowRight") !== rtl ? step : -step));
          else if (k === "ArrowUp") seek(t + step);
          else if (k === "ArrowDown") seek(t - step);
          else if (k === "PageUp") seek(t + d / 10);
          else if (k === "PageDown") seek(t - d / 10);
          else if (k === "Home") seek(0);
          else if (k === "End") seek(d);
          else if (k === " " || k === "k") toggle();
          else return;
          e.preventDefault();
        })
      );
    }
    setState();
    render();
    return {
      media: media,
      play: function () { if (media.paused) toggle(); },
      pause: function () { media.pause(); },
      toggle: toggle,
      seek: seek,
      destroy: function () { cancelAnimationFrame(raf); offs.forEach(function (f) { f(); }); },
    };
  }

  Kube.register("audio", function (el, u) {
    var media = el.querySelector("audio");
    if (!media) throw new Error("audio: no <audio> inside");
    return wireMedia(el, media, u);
  });

  Kube.register("video", function (el, u) {
    var media = el.querySelector("video");
    if (media) return wireMedia(el, media, u);
    // An iframe embed: the play overlay only reveals it (the embed brings its own controls).
    el.dataset.state = "idle";
    return {
      destroy: on(el, "click", function (e) {
        if (!e.target.closest || !e.target.closest('[data-media="play"]')) return;
        el.dataset.state = "playing";
        el.classList.remove("k-video--click-through");
        u.emit(el, "play", { media: null });
      }),
    };
  });

  /* ---------- marquee ---------- */

  Kube.register("marquee", function (el, u) {
    var track = el.querySelector(".k-marquee__track");
    var content = track && track.querySelector(".k-marquee__content");
    if (!content) throw new Error("marquee: needs .k-marquee__clip > .k-marquee__track > .k-marquee__content");
    var once = el.classList.contains("k-marquee--once");
    var clone = null;
    function measure() {
      var fs = parseFloat(getComputedStyle(el).fontSize) || 14;
      var cw = content.getBoundingClientRect().width, vw = el.getBoundingClientRect().width;
      var over = vw > 0 && cw > vw + 0.5;
      el.toggleAttribute("data-overflowing", over);
      if (over && !once && !clone) {
        clone = content.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        [].forEach.call(clone.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
        clone.removeAttribute("id");
        track.appendChild(clone);
      } else if (!over && clone) { clone.remove(); clone = null; }
      if (!over) return;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      // Loop: one copy plus the gap, so the clone lands where the original began. Once: just the overflow.
      var dist = once ? cw - vw + 1.14286 * fs : cw + gap;
      el.style.setProperty("--k-marquee-distance", dist.toFixed(1) + "px");
      el.style.setProperty("--k-marquee-duration", (dist / (u.opt(el, "speed", 2) * fs)).toFixed(2) + "s");
    }
    var schedule = batched(measure);
    var ro = new ResizeObserver(schedule);
    ro.observe(el);
    ro.observe(content);
    var offFonts = document.fonts ? on(document.fonts, "loadingdone", schedule) : function () {};
    measure();
    return {
      pause: function () { el.setAttribute("data-paused", ""); },
      play: function () { el.removeAttribute("data-paused"); },
      update: measure,
      destroy: function () { ro.disconnect(); offFonts(); schedule.cancel(); if (clone) clone.remove(); },
    };
  });

  /* ---------- pager ---------- */

  // Page numbers to show: first, last, current +/- siblings; a gap only where it hides two or more pages.
  function pageItems(page, total, sib) {
    var out = [], lo = Math.max(2, page - sib), hi = Math.min(total - 1, page + sib);
    if (lo === 3) lo = 2;
    if (hi === total - 2) hi = total - 1;
    out.push(1);
    if (lo > 2) out.push(0);
    for (var i = lo; i <= hi; i++) out.push(i);
    if (hi < total - 1) out.push(0);
    if (total > 1) out.push(total);
    return out;
  }

  Kube.register("pager", function (el, u) {
    var total = Math.max(1, Math.floor(u.opt(el, "total", 1)));
    var page = 1, sib = Math.max(0, Math.floor(u.opt(el, "siblings", 1)));
    var list = el.querySelector(".k-pager__list");
    var prev = el.querySelector('[data-pager="prev"]'), next = el.querySelector('[data-pager="next"]');
    var count = el.querySelector(".k-pager__count");
    var full = list && !el.classList.contains("k-pager--compact");
    function setDisabled(b, off) {
      if (!b) return;
      if (b.tagName === "BUTTON") b.disabled = off; else b.setAttribute("aria-disabled", String(off));
    }
    function render() {
      setDisabled(prev, page <= 1);
      setDisabled(next, page >= total);
      if (count) {
        count.textContent = page + " / " + total;
        count.setAttribute("aria-label", "Page " + page + " of " + total);
      }
      if (!full) return;
      var hadFocus = el.contains(document.activeElement) && document.activeElement.hasAttribute("data-page");
      [].forEach.call(list.querySelectorAll("[data-pager-item]"), function (n) { n.remove(); });
      var before = next ? next.closest("li") : null;
      pageItems(page, total, sib).forEach(function (n) {
        var li = document.createElement("li");
        li.setAttribute("data-pager-item", "");
        if (n === 0) { li.className = "k-pager__gap"; li.setAttribute("aria-hidden", "true"); li.textContent = "…"; }
        else {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "k-pager__btn";
          b.setAttribute("data-page", String(n));
          b.setAttribute("aria-label", "Page " + n);
          if (n === page) b.setAttribute("aria-current", "page");
          b.textContent = String(n);
          li.appendChild(b);
        }
        list.insertBefore(li, before && before.parentNode === list ? before : null);
      });
      if (hadFocus) { var cur = list.querySelector('[aria-current="page"]'); if (cur) cur.focus(); }
    }
    function go(n) {
      n = u.clamp(Math.floor(n) || 1, 1, total);
      if (n === page) return false;
      if (!u.emit(el, "page", { page: n, previous: page, total: total })) return false;
      page = n;
      render();
      return true;
    }
    page = u.clamp(Math.floor(u.opt(el, "page", 1)), 1, total);
    render();
    var off = on(el, "click", function (e) {
      var t = e.target.closest && e.target.closest("[data-pager], [data-page]");
      if (!t || !el.contains(t) || t.disabled || t.getAttribute("aria-disabled") === "true") return;
      var dir = t.getAttribute("data-pager");
      if (t.tagName === "A") e.preventDefault();
      go(dir === "prev" ? page - 1 : dir === "next" ? page + 1 : +t.getAttribute("data-page"));
    });
    return {
      get page() { return page; },
      get total() { return total; },
      go: go,
      setTotal: function (n) { total = Math.max(1, Math.floor(n) || 1); page = Math.min(page, total); render(); },
      destroy: off,
    };
  });

  /* ---------- truncate-middle: "report-final-…-v2.pdf" ---------- */

  var seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  function graphemes(s) { return seg ? Array.from(seg.segment(s), function (x) { return x.segment; }) : Array.from(s); }

  // Longest "head…tail" that fits; the tail keeps the extension plus one character (source algorithm).
  // A name without an extension truncates at the end.
  function middle(s, fits) {
    var dot = s.lastIndexOf(".");
    var ext = dot > 0 && dot < s.length - 1 && !/\s/.test(s.slice(dot)) ? s.slice(dot) : "";
    var g = graphemes(s), keep = ext ? graphemes(ext).length + 1 : 0;
    var tail = ext ? g.slice(-keep).join("") : "";
    var best = ext, first = (g[0] || "") + "…" + ext;
    if (fits("…" + tail)) best = "…" + tail; else if (fits(first)) best = first;
    var lo = ext ? keep + 1 : 1, hi = g.length - 1;
    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var n = ext ? Math.max(keep, Math.floor(mid / 2)) : 0;
      var cand = g.slice(0, mid - n).join("") + "…" + (n > 0 ? g.slice(-n).join("") : "");
      if (fits(cand)) { best = cand; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }
  Kube.truncateMiddle = middle;

  Kube.register("truncate-middle", function (el, u) {
    var name = u.opt(el, "name", el.textContent.trim());
    var ownTitle = el.hasAttribute("title");
    var doc = el.ownerDocument;
    var full = doc.createElement("span"), shown = doc.createElement("span"), probe = doc.createElement("span"), sr = doc.createElement("span");
    var text = doc.createTextNode("");
    full.className = "k-filename__full";
    shown.className = "k-filename__display";
    probe.className = "k-filename__probe";
    sr.className = "k-filename__sr";
    full.setAttribute("aria-hidden", "true");
    shown.setAttribute("aria-hidden", "true");
    probe.setAttribute("aria-hidden", "true");
    probe.appendChild(text);
    var range = doc.createRange();
    var lastW = -1, lastF = -1;
    function setName(n) {
      name = n;
      full.setAttribute("data-name", n);
      sr.textContent = n;
      if (!ownTitle) el.title = n;
      update(true);
    }
    function update(force) {
      var w = el.getBoundingClientRect().width, f = full.getBoundingClientRect().width;
      if (!force && w === lastW && f === lastF) return;
      lastW = w; lastF = f;
      var out = w <= 0 || f <= w + 0.5 ? name : middle(name, function (s) {
        text.data = s;
        range.selectNodeContents(probe);
        return range.getBoundingClientRect().width <= w;
      });
      text.data = "";
      if (shown.textContent !== out) shown.textContent = out;
      el.toggleAttribute("data-truncated", out !== name);
    }
    el.textContent = "";
    el.setAttribute("data-truncate", "");
    el.append(full, shown, probe, sr);
    var ro = new ResizeObserver(function () { update(false); });
    ro.observe(el);
    ro.observe(full);
    var refit = function () { update(true); };
    var offFonts = doc.fonts ? on(doc.fonts, "loadingdone", refit) : function () {};
    setName(name);
    return {
      get name() { return name; },
      set: setName,
      destroy: function () {
        ro.disconnect(); offFonts();
        el.removeAttribute("data-truncate"); el.removeAttribute("data-truncated");
        if (!ownTitle) el.removeAttribute("title");
        el.textContent = name;
      },
    };
  });

  /* ---------- doc: editable document surface ---------- */

  var BLOCK = "p, h1, h2, h3, h4, li, blockquote, .k-doc__task";
  Kube.register("doc", function (el, u) {
    var docPh = u.opt(el, "placeholder", "Start writing…");
    var blockPh = u.opt(el, "block-placeholder", "Write here…");
    var headingPh = u.opt(el, "heading-placeholder", "Heading");
    if (!el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "true");
    if (!el.hasAttribute("role")) el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    // Checkboxes and handles are controls, not text.
    function fence() { [].forEach.call(el.querySelectorAll(".k-doc__check, .k-doc__handle"), function (n) { n.setAttribute("contenteditable", "false"); }); }
    function empty(b) { return !b.textContent.replace(/​/g, "").trim() && !b.querySelector("img, hr, video, iframe, input:not(.k-doc__check input)"); }
    function ensureBlock() {
      if (el.firstElementChild) return;
      el.innerHTML = "<p><br></p>";
      var sel = window.getSelection();
      if (document.activeElement === el && sel) { var r = document.createRange(); r.setStart(el.firstChild, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    }
    function update() {
      [].forEach.call(el.querySelectorAll("[data-placeholder]"), function (n) { n.removeAttribute("data-placeholder"); });
      var kids = el.children;
      if (kids.length === 1 && empty(kids[0])) { kids[0].setAttribute("data-placeholder", docPh); return; }
      if (document.activeElement !== el && !el.contains(document.activeElement)) return;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return;
      var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      var b = node && node.closest(BLOCK);
      if (!b || !el.contains(b) || !empty(b)) return;
      var ph = /^H[1-4]$/.test(b.tagName) ? headingPh : blockPh;
      if (ph) b.setAttribute("data-placeholder", ph);
    }
    fence();
    ensureBlock();
    update();
    var offs = [
      on(el, "input", function () { ensureBlock(); fence(); update(); }),
      on(el, "focus", update),
      on(el, "blur", update),
      on(document, "selectionchange", function () {
        var s = window.getSelection();
        if (s && s.anchorNode && (el.contains(s.anchorNode) || el.querySelector("[data-placeholder]"))) update();
      }),
      // Reflect checkbox state in markup so the saved HTML keeps it.
      on(el, "change", function (e) {
        var box = e.target;
        if (box.type !== "checkbox") return;
        box.toggleAttribute("checked", box.checked);
        var li = box.closest("li");
        if (li) li.setAttribute("data-checked", String(box.checked));
        u.emit(el, "task", { item: li, checked: box.checked });
      }),
    ];
    return {
      // The content without placeholder attributes.
      html: function () {
        var c = el.cloneNode(true);
        [].forEach.call(c.querySelectorAll("[data-placeholder]"), function (n) { n.removeAttribute("data-placeholder"); });
        return c.innerHTML;
      },
      destroy: function () { offs.forEach(function (f) { f(); }); },
    };
  });

  /* ---------- find in page: Kube.highlight(root, query) ---------- */

  // Paints every match of query under root with the CSS Highlight API ("k-find"), the current one as
  // "k-find-current", scrolls it into view and emits kube:find on root. One find session per page:
  // a new call clears the previous one. Matches do not span element boundaries.
  var session = null;
  Kube.highlight = function (root, query, opts) {
    opts = opts || {};
    if (session) session.clear();
    var api = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
    var ranges = [];
    var q = String(query || "");
    var cs = !!opts.caseSensitive;
    if (q) {
      var needle = cs ? q : q.toLocaleLowerCase();
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentElement;
          return p && !p.closest("script, style, noscript, textarea, [hidden], [aria-hidden='true'], .k-find") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        var hay = cs ? n.data : n.data.toLocaleLowerCase();
        for (var i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
          var r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          ranges.push(r);
        }
      }
    }
    var current = api ? new Highlight() : null;
    if (api) {
      var every = new Highlight();
      ranges.forEach(function (r) { every.add(r); });
      CSS.highlights.set("k-find", every);
      CSS.highlights.set("k-find-current", current);
    }
    var ctrl = {
      query: q,
      count: ranges.length,
      index: -1,
      ranges: ranges,
      go: function (i) {
        if (!ranges.length) return;
        ctrl.index = ((i % ranges.length) + ranges.length) % ranges.length;
        var r = ranges[ctrl.index];
        if (current) { current.clear(); current.add(r); }
        if (opts.flash) { root.classList.remove("k-find-flash"); void root.offsetWidth; root.classList.add("k-find-flash"); }
        var host = r.startContainer.parentElement;
        if (host && opts.scroll !== false) host.scrollIntoView({ block: "center", inline: "nearest", behavior: util.reducedMotion() ? "auto" : "smooth" });
        util.emit(root, "find", { query: q, count: ranges.length, index: ctrl.index, range: r });
      },
      next: function () { ctrl.go(ctrl.index + 1); },
      prev: function () { ctrl.go(ctrl.index - 1); },
      clear: function () {
        if (session !== ctrl) return;
        session = null;
        if (api) { CSS.highlights.delete("k-find"); CSS.highlights.delete("k-find-current"); }
        root.classList.remove("k-find-flash");
      },
    };
    session = ctrl;
    if (ranges.length && opts.current !== false) ctrl.go(0);
    else util.emit(root, "find", { query: q, count: 0, index: -1, range: null });
    return ctrl;
  };

  // Find bar: <div class="k-find" data-kube="find" data-kube-target="#doc"> input, .k-find__count, [data-find=prev|next].
  Kube.register("find", function (el, u) {
    var input = el.querySelector("input");
    var count = el.querySelector(".k-find__count");
    var sel = u.opt(el, "target", "");
    var flash = u.opt(el, "flash", false);
    var ctrl = null;
    if (!input) throw new Error("find: no input inside");
    function target() { return (sel && document.querySelector(sel)) || document.body; }
    function label() {
      if (!count) return;
      count.textContent = !input.value ? "" : ctrl && ctrl.count ? ctrl.index + 1 + " of " + ctrl.count : "No results";
    }
    function run() {
      if (ctrl) ctrl.clear();
      ctrl = input.value ? Kube.highlight(target(), input.value, { flash: flash }) : null;
      label();
    }
    function step(d) { if (ctrl && ctrl.count) { if (d > 0) ctrl.next(); else ctrl.prev(); label(); } }
    var offs = [
      on(input, "input", run),
      on(input, "keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; run(); }
      }),
      on(el, "click", function (e) {
        var b = e.target.closest && e.target.closest("[data-find]");
        if (b && el.contains(b)) step(b.getAttribute("data-find") === "prev" ? -1 : 1);
      }),
    ];
    if (input.value) run();
    return {
      get controller() { return ctrl; },
      run: run,
      destroy: function () { offs.forEach(function (f) { f(); }); if (ctrl) ctrl.clear(); },
    };
  });

  /* ---------- overflow-row: "+N" more menu ---------- */

  Kube.register("overflow-row", function (el, u) {
    var rows = Math.max(1, Math.floor(u.opt(el, "rows", 1)));
    var more = el.querySelector(":scope > [data-overflow-more]");
    var menuId = more && (more.getAttribute("aria-controls") || more.getAttribute("data-kube-target"));
    var menu = menuId ? document.getElementById(menuId) : null;
    var source = new WeakMap();
    var hidden = [], lastKey = "";
    // Lines, not distinct tops: items of different heights on one centered line still overlap vertically.
    var lines = function (list) {
      var n = 0, bottom = -Infinity;
      list.map(function (c) { return c.getBoundingClientRect(); }).sort(function (a, b) { return a.top - b.top; }).forEach(function (r) {
        if (r.top >= bottom - 0.5) { n++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom);
      });
      return n;
    };
    var shown = function () { return [].filter.call(el.children, function (c) { return !c.hasAttribute("data-overflow-hidden") && c.getClientRects().length; }); };

    function layout() {
      mo.disconnect();
      var kids = [].filter.call(el.children, function (c) { return c !== more; });
      var items = kids.filter(function (c) { return !c.hasAttribute("data-overflow-end"); });
      items.forEach(function (c) { c.removeAttribute("data-overflow-hidden"); });
      el.removeAttribute("data-has-overflow");
      hidden = [];
      if (lines(shown()) > rows) {
        el.setAttribute("data-has-overflow", "");
        for (var i = items.length - 1; i >= 0 && lines(shown()) > rows; i--) {
          items[i].setAttribute("data-overflow-hidden", "");
          hidden.unshift(items[i]);
        }
      }
      var key = hidden.length + ":" + hidden.map(function (c) { return c.textContent; }).join("|");
      if (key !== lastKey) {
        lastKey = key;
        if (more) {
          var slot = more.querySelector("[data-overflow-count]");
          var txt = "+" + hidden.length;
          if (slot) slot.textContent = txt; else if (!more.children.length) more.textContent = txt;
          more.setAttribute("aria-label", hidden.length + " more");
        }
        fill();
        u.emit(el, "overflow", { hidden: hidden.slice() });
      }
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    }
    function fill() {
      if (!menu) return;
      menu.textContent = "";
      hidden.forEach(function (c) {
        var item = document.createElement("div");
        item.className = "k-menu__item";
        item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
        if (c.disabled || c.getAttribute("aria-disabled") === "true") item.setAttribute("aria-disabled", "true");
        var label = document.createElement("span");
        label.className = "k-menu__label";
        label.textContent = c.getAttribute("aria-label") || c.textContent.trim();
        item.appendChild(label);
        source.set(item, c);
        menu.appendChild(item);
      });
    }
    var schedule = batched(layout);
    var mo = new MutationObserver(schedule);
    var ro = new ResizeObserver(schedule);
    ro.observe(el);
    var offs = [];
    // A chosen row stands in for the hidden item: click it (links navigate, buttons run).
    if (menu) offs.push(on(menu, "kube:select", function (e) {
      var item = e.target.closest && e.target.closest(".k-menu__item");
      var src = item && source.get(item);
      if (src) src.click();
    }));
    layout();
    return {
      get hidden() { return hidden.slice(); },
      update: layout,
      destroy: function () {
        ro.disconnect(); mo.disconnect(); schedule.cancel();
        offs.forEach(function (f) { f(); });
        [].forEach.call(el.children, function (c) { c.removeAttribute("data-overflow-hidden"); });
        el.removeAttribute("data-has-overflow");
      },
    };
  });
})(window.Kube);

/* --- 76-dev.js --- */
/* Kube developer surfaces: Kube.ansi (SGR parser), ansi, terminal, diff, editor, chart.
 * Reverse-read behaviors: the output panel follows new lines with requestAnimationFrame scrollToBottom
 * while the reader is at the end; diffs expand collapsed regions up, down or whole, switch between
 * unified and split, and copy a line; charts move a tooltip with the pointer, dim the other series
 * and toggle series from the legend. Everything is built with DOM nodes and textContent, never HTML.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var ESC = String.fromCharCode(27);

  /* ---------------------------------------------------------------- Kube.ansi */

  var NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  // CSI (params + final byte), OSC (ended by BEL or ESC \), charset designations, then any other 2-byte escape.
  var SEQ = /\x1b(?:\[([0-?]*)[ -\/]*([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -\/]+[0-~]|[@-_])/g;
  var CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g; // keeps \t and \n
  var URL_RE = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

  function freshState() {
    return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, hidden: false, strike: false };
  }

  // 0-15 -> a palette class; 16-231 the 6x6x6 cube; 232-255 the gray ramp (xterm values).
  function color256(n) {
    if (n < 8) return { c: NAMES[n] };
    if (n < 16) return { c: "bright-" + NAMES[n - 8] };
    if (n > 231) { var g = 8 + (n - 232) * 10; return { rgb: "rgb(" + g + ", " + g + ", " + g + ")" }; }
    var steps = [0, 95, 135, 175, 215, 255], i = n - 16;
    return { rgb: "rgb(" + steps[Math.floor(i / 36)] + ", " + steps[Math.floor(i / 6) % 6] + ", " + steps[i % 6] + ")" };
  }

  function sgr(params, st) {
    var codes = params === "" ? [0] : params.split(/[;:]/).map(function (v) { return v === "" ? 0 : parseInt(v, 10); });
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c === 0) { var f = freshState(); Object.keys(f).forEach(function (k) { st[k] = f[k]; }); }
      else if (c === 1) st.bold = true;
      else if (c === 2) st.dim = true;
      else if (c === 3) st.italic = true;
      else if (c === 4) st.underline = true;
      else if (c === 7) st.inverse = true;
      else if (c === 8) st.hidden = true;
      else if (c === 9) st.strike = true;
      else if (c === 21 || c === 22) { st.bold = false; st.dim = false; }
      else if (c === 23) st.italic = false;
      else if (c === 24) st.underline = false;
      else if (c === 27) st.inverse = false;
      else if (c === 28) st.hidden = false;
      else if (c === 29) st.strike = false;
      else if (c >= 30 && c <= 37) st.fg = { c: NAMES[c - 30] };
      else if (c === 39) st.fg = null;
      else if (c >= 40 && c <= 47) st.bg = { c: NAMES[c - 40] };
      else if (c === 49) st.bg = null;
      else if (c >= 90 && c <= 97) st.fg = { c: "bright-" + NAMES[c - 90] };
      else if (c >= 100 && c <= 107) st.bg = { c: "bright-" + NAMES[c - 100] };
      else if (c === 38 || c === 48) {
        var col = null;
        if (codes[i + 1] === 5 && codes.length > i + 2) { col = color256(util.clamp(codes[i + 2], 0, 255)); i += 2; }
        else if (codes[i + 1] === 2 && codes.length > i + 4) {
          col = { rgb: "rgb(" + [codes[i + 2], codes[i + 3], codes[i + 4]].map(function (v) { return util.clamp(v | 0, 0, 255); }).join(", ") + ")" };
          i += 4;
        } else break; // malformed: ignore the rest, as terminals do
        if (c === 38) st.fg = col; else st.bg = col;
      }
    }
  }

  function luminance(rgb) {
    var c = rgb.match(/\d+/g).map(function (v) { v = v / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function textWithLinks(s, links) {
    if (!links) return document.createTextNode(s);
    var frag = document.createDocumentFragment(), last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = m[0];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = m[0];
      frag.appendChild(a);
      last = URL_RE.lastIndex;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    return frag;
  }

  function piece(s, st, links) {
    var cls = [], style = "", fg = st.fg, bg = st.bg;
    if (st.inverse) {
      var t = fg; fg = bg; bg = t;
      if (!fg && !bg) cls.push("ansi-inverse");
      else {
        if (!fg) style += "color: var(--k-term-bg);";
        if (!bg) style += "background-color: var(--k-term-fg);";
      }
    }
    // On a 256/truecolor ground, default, black or white text is picked from the ground's luminance.
    if (bg && bg.rgb && (!fg || /^(bright-)?(black|white)$/.test(fg.c || ""))) fg = { rgb: luminance(bg.rgb) > 0.179 ? "#0d0d0d" : "#ffffff" };
    if (fg) { if (fg.c) cls.push("ansi-" + fg.c + "-fg"); else style += "color: " + fg.rgb + ";"; }
    if (bg) { if (bg.c) cls.push("ansi-" + bg.c + "-bg"); else style += "background-color: " + bg.rgb + ";"; }
    if (st.bold) cls.push("ansi-bold");
    if (st.dim) cls.push("ansi-dim");
    if (st.italic) cls.push("ansi-italic");
    if (st.underline) cls.push("ansi-underline");
    if (st.strike) cls.push("ansi-strike");
    if (st.hidden) cls.push("ansi-hidden");
    var content = textWithLinks(s, links);
    if (!cls.length && !style) return content;
    var span = document.createElement("span");
    if (cls.length) span.className = cls.join(" ");
    if (style) span.style.cssText = style;
    span.appendChild(content);
    return span;
  }

  // One run of text (no line handling) -> { fragment, state }. The state carries SGR attributes across calls.
  function render(text, state, links) {
    var st = state || freshState();
    var frag = document.createDocumentFragment(), last = 0, m;
    function emit(s) { s = s.replace(CONTROL, ""); if (s) frag.appendChild(piece(s, st, links)); }
    SEQ.lastIndex = 0;
    while ((m = SEQ.exec(text))) {
      emit(text.slice(last, m.index));
      if (m[2] === "m") sgr(m[1], st);
      last = SEQ.lastIndex;
    }
    emit(text.slice(last));
    return { fragment: frag, state: st };
  }

  // Split on newlines; a carriage return inside a line keeps what follows it (progress bars), but the
  // attributes set before it still apply. Returns [{ text, cr }] where cr means "overwrite the line".
  function splitLines(text, st) {
    return String(text).replace(/\r\n/g, "\n").split("\n").map(function (line) {
      var cr = line.lastIndexOf("\r");
      if (cr < 0) return { text: line, cr: false };
      render(line.slice(0, cr), st);
      return { text: line.slice(cr + 1), cr: true };
    });
  }

  // Literal escapes typed into HTML ("\x1b[", "\e[", "\033[", "\u001b[") -> the ESC character.
  function unescapeLiteral(s) { return s.replace(/\\(?:x1b|e|033|u001b)(?=[\[\]])/gi, ESC); }

  Kube.ansi = {
    state: freshState,
    render: function (text, state, opts) { return render(String(text), state, opts && opts.links); },
    // Whole text with newlines -> fragment (newlines kept as text, for a <pre>).
    toFragment: function (text, opts) {
      var st = (opts && opts.state) || freshState(), links = opts && opts.links;
      var frag = document.createDocumentFragment();
      splitLines(text, st).forEach(function (l, i) {
        if (i) frag.appendChild(document.createTextNode("\n"));
        frag.appendChild(render(l.text, st, links).fragment);
      });
      return frag;
    },
    strip: function (text) {
      return String(text).replace(SEQ, "").replace(/\r\n/g, "\n").split("\n").map(function (l) { return l.slice(l.lastIndexOf("\r") + 1); }).join("\n").replace(CONTROL, "");
    },
    unescape: unescapeLiteral,
  };

  /* ---------------------------------------------------------------- ansi */

  // Renders the element's raw text (with real ESC characters, or literal escapes with data-kube-escapes)
  // as ansi-* spans. Options: data-kube-escapes (false), data-kube-links (false). API: set(text), append(text).
  Kube.register("ansi", function (el) {
    var escapes = util.opt(el, "escapes", false), links = util.opt(el, "links", false);
    var st = freshState();
    function prep(t) { return escapes ? unescapeLiteral(t) : t; }
    function set(text) { st = freshState(); el.replaceChildren(Kube.ansi.toFragment(prep(text), { state: st, links: links })); }
    function append(text) { el.appendChild(Kube.ansi.toFragment(prep(text), { state: st, links: links })); }
    set(el.textContent);
    return { set: set, append: append, destroy: function () {} };
  });

  /* ---------------------------------------------------------------- terminal */

  var JUMP_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4"/></svg>';

  // Follows output while the reader is at the end; scrolling up stops following and shows the jump
  // button (with a dot once new output arrives). Options: data-kube-scrollback (lines kept, 5000),
  // data-kube-escapes (render the initial text as ANSI), data-kube-links, data-kube-label ("Terminal output"),
  // data-kube-jump-label ("Jump to bottom"). API: write(text), writeln(text), clear(), scrollToBottom(smooth),
  // isFollowing(). Event: kube:follow { following }.
  Kube.register("terminal", function (el) {
    var viewport = el.querySelector(".k-terminal__viewport");
    var screen = el.querySelector(".k-terminal__screen");
    if (!viewport || !screen) return {};
    var limit = util.opt(el, "scrollback", 5000), links = util.opt(el, "links", false);
    var st = freshState(), following = true, pinned = false, raf = 0, offs = [];

    if (!viewport.hasAttribute("tabindex")) viewport.tabIndex = 0;
    if (!viewport.hasAttribute("role")) viewport.setAttribute("role", "log");
    if (!viewport.hasAttribute("aria-label") && !viewport.hasAttribute("aria-labelledby")) viewport.setAttribute("aria-label", util.opt(el, "label", "Terminal output"));

    var jump = el.querySelector(".k-terminal__jump");
    if (!jump) {
      jump = document.createElement("button");
      jump.type = "button";
      jump.className = "k-terminal__jump";
      jump.innerHTML = JUMP_ICON;
      jump.appendChild(document.createTextNode(util.opt(el, "jump-label", "Jump to bottom")));
      el.appendChild(jump);
      offs.push(function () { jump.remove(); });
    }
    jump.tabIndex = -1;

    var cursor = screen.querySelector(".k-terminal__cursor");

    function atEnd() { return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4; }
    function setFollowing(v) {
      el.setAttribute("data-following", String(v));
      jump.tabIndex = v ? -1 : 0;
      if (v) jump.removeAttribute("data-new");
      if (v !== following) { following = v; util.emit(el, "follow", { following: v }); }
    }
    function scrollToBottom(smooth) {
      var animate = smooth && !util.reducedMotion();
      pinned = animate; // a smooth scroll passes through "not at the end"; do not stop following on the way
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: animate ? "smooth" : "auto" });
      setFollowing(true);
    }
    // Coalesce bursts of output into one scroll per frame, as the source does.
    function queueFollow() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; if (following) viewport.scrollTop = viewport.scrollHeight; });
    }

    function lines() { return screen.querySelectorAll(".k-terminal__line"); }
    function current() {
      var all = lines();
      if (all.length) return all[all.length - 1];
      return newLine();
    }
    function newLine() {
      var l = document.createElement("div");
      l.className = "k-terminal__line";
      screen.appendChild(l);
      return l;
    }
    function clearLine(l) { [].slice.call(l.childNodes).forEach(function (n) { if (n !== cursor) n.remove(); }); }
    function write(text) {
      splitLines(String(text), st).forEach(function (l, i) {
        var line = i ? newLine() : current();
        if (l.cr) clearLine(line);
        line.appendChild(render(l.text, st, links).fragment);
      });
      if (cursor) current().appendChild(cursor);
      var all = lines();
      for (var n = all.length - limit; n > 0; n--) all[n - 1].remove();
    }

    if (util.opt(el, "escapes", false) || !screen.querySelector(".k-terminal__line")) {
      var raw = screen.textContent;
      screen.replaceChildren();
      write(util.opt(el, "escapes", false) ? unescapeLiteral(raw) : raw);
    } else if (cursor) {
      current().appendChild(cursor);
    }

    offs.push(util.on(viewport, "scroll", function () {
      if (pinned) { if (atEnd()) pinned = false; return; }
      setFollowing(atEnd());
    }, { passive: true }));
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (type) { offs.push(util.on(viewport, type, function () { pinned = false; }, { passive: true })); });
    offs.push(util.on(jump, "click", function () { scrollToBottom(true); viewport.focus({ preventScroll: true }); }));
    var mo = new MutationObserver(function () {
      if (following) queueFollow();
      else jump.setAttribute("data-new", "");
    });
    mo.observe(screen, { childList: true, subtree: true, characterData: true });
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(function () { if (following) queueFollow(); }) : null;
    if (ro) ro.observe(viewport);
    scrollToBottom(false);

    return {
      write: write,
      writeln: function (text) { write(String(text) + "\n"); },
      clear: function () { screen.replaceChildren(); st = freshState(); write(""); },
      scrollToBottom: scrollToBottom,
      isFollowing: function () { return following; },
      destroy: function () {
        mo.disconnect();
        if (ro) ro.disconnect();
        cancelAnimationFrame(raf);
        offs.forEach(function (f) { f(); });
      },
    };
  });

  /* ---------------------------------------------------------------- diff */

  var COPY_ICONS =
    '<svg data-icon="copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>' +
    '<svg data-icon="done" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7"/></svg>';

  // Unified lines are the source of truth; split is rebuilt from them. Options: data-kube-step (lines per
  // expand up/down, 20), data-kube-copy (copy-line button, true), data-kube-copy-label ("Copy line").
  // API: setMode("unified" | "split"), expand(fold, "up" | "down" | "all"), toggle(collapsed).
  // Events: kube:modechange { mode }, kube:expand { count, remaining }, kube:toggle { collapsed }, kube:copy { ok, text }.
  Kube.register("diff", function (el) {
    var body = el.querySelector(".k-diff__body");
    var list = body && body.querySelector(".k-diff__lines");
    if (!list) return {};
    var step = Math.max(1, util.opt(el, "step", 20)), offs = [], split = null, foldSeq = 0;
    var mode = el.getAttribute("data-mode") === "split" ? "split" : "unified";

    [].forEach.call(list.querySelectorAll(".k-diff__fold"), function (f) { f.setAttribute("data-fold-id", String(++foldSeq)); });

    function hiddenAfter(fold) {
      var out = [];
      for (var n = fold.nextElementSibling; n && n.hidden && n.classList.contains("k-diff__line"); n = n.nextElementSibling) out.push(n);
      return out;
    }
    function expand(fold, dir) {
      var lines = hiddenAfter(fold);
      var take = dir === "all" || lines.length <= step ? lines : dir === "up" ? lines.slice(-step) : lines.slice(0, step);
      take.forEach(function (l) { l.hidden = false; });
      var remaining = lines.length - take.length;
      if (!remaining) fold.remove();
      else {
        if (dir === "down") list.insertBefore(fold, lines[take.length]);
        var count = fold.querySelector("[data-count]");
        if (count) count.textContent = String(remaining);
      }
      util.emit(el, "expand", { count: take.length, remaining: remaining });
      return remaining;
    }

    function cell(line, side) {
      var c = document.createElement("div");
      c.className = "k-diff__cell";
      if (!line) { c.setAttribute("data-type", "empty"); return c; }
      var t = line.getAttribute("data-type");
      c.setAttribute("data-type", t === "add" || t === "del" ? t : "ctx");
      c.setAttribute("data-num", line.getAttribute(side === "old" ? "data-old" : "data-new") || "");
      var sign = line.querySelector(".k-diff__sign"), code = line.querySelector(".k-diff__code");
      c.appendChild(sign ? sign.cloneNode(true) : document.createElement("span")).className = "k-diff__sign";
      c.appendChild(code ? code.cloneNode(true) : document.createElement("span")).className = "k-diff__code";
      return c;
    }
    function buildSplit() {
      var out = document.createElement("div");
      out.className = "k-diff__lines";
      var dels = [], adds = [];
      function row(a, b) {
        var r = document.createElement("div");
        r.className = "k-diff__row";
        r.appendChild(a);
        if (b) r.appendChild(b);
        out.appendChild(r);
      }
      function flush() {
        for (var i = 0, n = Math.max(dels.length, adds.length); i < n; i++) row(cell(dels[i], "old"), cell(adds[i], "new"));
        dels = []; adds = [];
      }
      [].forEach.call(list.children, function (item) {
        if (item.hidden) return;
        if (item.classList.contains("k-diff__line")) {
          var t = item.getAttribute("data-type");
          if (t === "del") { if (adds.length) flush(); dels.push(item); return; }
          if (t === "add") { adds.push(item); return; }
          flush();
          row(cell(item, "old"), cell(item, "new"));
        } else {
          flush();
          row(item.cloneNode(true));
        }
      });
      flush();
      if (!split) {
        split = document.createElement("div");
        split.className = "k-diff__split";
        split.tabIndex = -1;
        body.after(split);
      }
      split.replaceChildren(out);
    }
    function setMode(m) {
      mode = m === "split" ? "split" : "unified";
      el.setAttribute("data-mode", mode);
      if (mode === "split") buildSplit();
      body.hidden = mode === "split";
      if (split) split.hidden = mode !== "split";
      [].forEach.call(el.querySelectorAll("[data-diff-mode]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-diff-mode") === mode)); });
    }

    var toggleBtn = el.querySelector(".k-diff__toggle");
    function toggle(collapsed) {
      if (collapsed === undefined) collapsed = !el.hasAttribute("data-collapsed");
      el.toggleAttribute("data-collapsed", collapsed);
      if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(!collapsed));
      util.emit(el, "toggle", { collapsed: collapsed });
    }
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(!el.hasAttribute("data-collapsed")));

    offs.push(util.on(el, "click", function (e) {
      var t = e.target.closest ? e.target : e.target.parentElement;
      var modeBtn = t.closest("[data-diff-mode]");
      if (modeBtn && el.contains(modeBtn)) { if (modeBtn.getAttribute("data-diff-mode") !== mode) { setMode(modeBtn.getAttribute("data-diff-mode")); util.emit(el, "modechange", { mode: mode }); } return; }
      if (toggleBtn && t.closest(".k-diff__toggle") === toggleBtn) { toggle(); return; }
      var btn = t.closest("[data-expand]");
      var fold = btn && btn.closest(".k-diff__fold");
      if (!fold) return;
      var orig = list.querySelector('.k-diff__fold[data-fold-id="' + fold.getAttribute("data-fold-id") + '"]');
      if (!orig) return;
      var dir = btn.getAttribute("data-expand");
      var left = expand(orig, dir);
      if (mode === "split") buildSplit();
      // Keep keyboard focus on the same control, or on the diff once the region is gone.
      var scope = mode === "split" ? split : list;
      var again = left && scope.querySelector('.k-diff__fold[data-fold-id="' + fold.getAttribute("data-fold-id") + '"] [data-expand="' + dir + '"]');
      if (again) again.focus({ preventScroll: true });
      else {
        if (!body.hasAttribute("tabindex")) body.tabIndex = -1;
        (mode === "split" ? split : body).focus({ preventScroll: true });
      }
    }));

    // One copy button, moved onto whichever line the pointer is over.
    if (util.opt(el, "copy", true)) {
      var copyLabel = util.opt(el, "copy-label", "Copy line");
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "k-diff__copy";
      copy.hidden = true;
      copy.setAttribute("aria-label", copyLabel);
      copy.innerHTML = COPY_ICONS;
      var host = null, timer = 0;
      offs.push(util.on(el, "pointerover", function (e) {
        if (e.pointerType === "touch") return;
        var row = e.target.closest && e.target.closest(".k-diff__line, .k-diff__cell:not([data-type=empty])");
        if (!row || row === host || !el.contains(row)) return;
        host = row;
        clearTimeout(timer);
        copy.removeAttribute("data-copied");
        copy.setAttribute("aria-label", copyLabel);
        row.appendChild(copy);
        copy.hidden = false;
      }));
      offs.push(util.on(el, "pointerleave", function () { copy.hidden = true; host = null; }));
      offs.push(util.on(copy, "click", function (e) {
        e.stopPropagation();
        var code = host && host.querySelector(".k-diff__code");
        if (!code || copy.hasAttribute("data-copied")) return;
        var text = code.textContent;
        Promise.resolve(Kube.copy ? Kube.copy(text, copy) : false).then(function (ok) {
          if (ok) {
            copy.setAttribute("data-copied", "");
            copy.setAttribute("aria-label", "Copied");
            timer = setTimeout(function () { copy.removeAttribute("data-copied"); copy.setAttribute("aria-label", copyLabel); }, 1300);
          }
          util.emit(el, "copy", { ok: ok, text: text });
        });
      }));
      offs.push(function () { clearTimeout(timer); copy.remove(); });
    }

    // Hunk and fold rows stay pinned to the visible width while long lines scroll sideways.
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(function () { el.style.setProperty("--k-diff-viewport", body.clientWidth + "px"); }) : null;
    if (ro) ro.observe(body);

    setMode(mode);

    return {
      setMode: setMode,
      expand: function (fold, dir) { var r = expand(fold, dir || "all"); if (mode === "split") buildSplit(); return r; },
      toggle: toggle,
      destroy: function () { if (ro) ro.disconnect(); offs.forEach(function (f) { f(); }); if (split) split.remove(); body.hidden = false; },
    };
  });

  /* ---------------------------------------------------------------- editor */

  // Marks the line that holds the caret (or a click in a read-only view) with data-active.
  // Event: kube:activeline { line, index } (1-based).
  Kube.register("editor", function (el) {
    var content = el.querySelector(".k-editor__content");
    if (!content) return {};
    var active = content.querySelector(".k-editor__line[data-active]");
    function lineOf(node) {
      if (!node) return null;
      if (node === content) return null;
      var e = node.nodeType === 1 ? node : node.parentElement;
      var l = e && e.closest(".k-editor__line");
      return l && content.contains(l) ? l : null;
    }
    function update() {
      var sel = document.getSelection();
      if (!sel || !sel.rangeCount || !content.contains(sel.focusNode)) return;
      var node = sel.focusNode === content ? content.children[Math.min(sel.focusOffset, content.children.length - 1)] : sel.focusNode;
      var l = lineOf(node);
      if (!l) return;
      [].forEach.call(content.querySelectorAll(".k-editor__line[data-active]"), function (x) { if (x !== l) x.removeAttribute("data-active"); });
      if (l === active && l.hasAttribute("data-active")) return;
      active = l;
      l.setAttribute("data-active", "");
      var all = content.querySelectorAll(".k-editor__line");
      util.emit(el, "activeline", { line: l, index: [].indexOf.call(all, l) + 1 });
    }
    var off = util.on(document, "selectionchange", update);
    return { destroy: off };
  });

  /* ---------------------------------------------------------------- chart */

  // Tooltip that follows the pointer over [data-x] columns (every [data-value] mark inside, one row each)
  // or over a lone [data-value] mark; arrow keys walk the columns when the plot has focus.
  // Legend buttons [data-series] toggle a series (aria-pressed) and dim the others while hovered.
  // Marks: data-series, data-label, data-value; column title data-x. Events: kube:series { series, visible },
  // kube:tooltip { target } (null when it closes).
  Kube.register("chart", function (el) {
    var plot = el.querySelector(".k-chart__plot");
    if (!plot) return {};
    var offs = [], current = null, keyboard = false;
    var tip = el.querySelector(".k-chart__tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "k-chart__tooltip";
      el.appendChild(tip);
      offs.push(function () { tip.remove(); });
    }
    tip.setAttribute("aria-hidden", "true");
    if (!plot.hasAttribute("tabindex") && plot.querySelector("[data-x]")) plot.setAttribute("tabindex", "0");

    function cols() { return [].slice.call(plot.querySelectorAll("[data-x]")); }
    function marksOf(target) {
      var marks = target.hasAttribute("data-x") ? [].slice.call(target.querySelectorAll("[data-value]")) : [target];
      return marks.filter(function (m) { return !m.hasAttribute("data-off"); });
    }
    function fill(target) {
      var title = target.getAttribute("data-x") || target.getAttribute("data-title");
      tip.replaceChildren();
      if (title) {
        var h = document.createElement("div");
        h.className = "k-chart__tooltip-title";
        h.textContent = title;
        tip.appendChild(h);
      }
      marksOf(target).forEach(function (m) {
        var row = document.createElement("div");
        row.className = "k-chart__tooltip-row";
        var dot = document.createElement("span");
        dot.className = "k-chart__marker";
        var s = m.getAttribute("data-series") || (m.closest("[data-series]") || m).getAttribute("data-series");
        if (s) dot.setAttribute("data-series", s);
        var seq = m.getAttribute("data-seq");
        if (seq) dot.setAttribute("data-seq", seq);
        var label = document.createElement("span");
        label.className = "k-chart__tooltip-label";
        label.textContent = m.getAttribute("data-label") || "";
        var value = document.createElement("span");
        value.className = "k-chart__tooltip-value";
        value.textContent = m.getAttribute("data-value");
        row.append(dot, label, value);
        tip.appendChild(row);
      });
    }
    // Pointer offset 12px; flip to the other side of the pointer near the right or bottom edge.
    function place(x, y) {
      var w = el.clientWidth, h = el.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = x + 12 + tw > w ? x - 12 - tw : x + 12;
      var top = y + 12 + th > h ? y - 12 - th : y + 12;
      tip.style.transform = "translate(" + Math.round(util.clamp(left, 0, Math.max(0, w - tw))) + "px, " + Math.round(Math.max(0, top)) + "px)";
    }
    function show(target, x, y) {
      if (target !== current) {
        if (current) current.removeAttribute("data-active");
        current = target;
        if (target.hasAttribute("data-x")) target.setAttribute("data-active", "");
        fill(target);
        util.emit(el, "tooltip", { target: target });
      }
      tip.setAttribute("data-open", "");
      place(x, y);
    }
    function hide() {
      if (!current) return;
      current.removeAttribute("data-active");
      current = null;
      tip.removeAttribute("data-open");
      util.emit(el, "tooltip", { target: null });
    }
    function targetOf(node) {
      if (!node || !node.closest) return null;
      var t = node.closest("[data-x]") || node.closest("[data-value]");
      return t && plot.contains(t) && !t.hasAttribute("data-off") ? t : null;
    }

    offs.push(util.on(plot, "pointermove", function (e) {
      keyboard = false;
      tip.removeAttribute("aria-live");
      var t = targetOf(e.target);
      if (!t) { hide(); return; }
      var r = el.getBoundingClientRect();
      show(t, e.clientX - r.left, e.clientY - r.top);
    }));
    offs.push(util.on(plot, "pointerleave", hide));
    offs.push(util.on(plot, "keydown", function (e) {
      var list = cols();
      if (!list.length) return;
      var i = current ? list.indexOf(current) : -1;
      var next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i < 0 ? list.length - 1 : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : null;
      if (e.key === "Escape") { hide(); return; }
      if (next === null) return;
      e.preventDefault();
      keyboard = true;
      tip.setAttribute("aria-live", "polite");
      var col = list[util.clamp(next, 0, list.length - 1)];
      var box = col.getBoundingClientRect(), r = el.getBoundingClientRect();
      show(col, box.left - r.left + box.width / 2, box.top - r.top);
    }));
    offs.push(util.on(plot, "blur", function () { if (keyboard) hide(); }));

    // Legend: toggle a series; hovering an item dims the other series.
    function marks(series) { return plot.querySelectorAll('[data-series="' + series + '"]'); }
    offs.push(util.on(el, "click", function (e) {
      var item = e.target.closest && e.target.closest("button.k-chart__legend-item[data-series]");
      if (!item || !el.contains(item)) return;
      var visible = item.getAttribute("aria-pressed") === "false";
      item.setAttribute("aria-pressed", String(visible));
      [].forEach.call(marks(item.getAttribute("data-series")), function (m) { m.toggleAttribute("data-off", !visible); });
      if (current) fill(current);
      util.emit(el, "series", { series: item.getAttribute("data-series"), visible: visible });
    }));
    function dim(series) {
      [].forEach.call(el.querySelectorAll(".k-chart__plot [data-series], .k-chart__legend-item[data-series]"), function (m) {
        m.toggleAttribute("data-dimmed", series !== null && m.getAttribute("data-series") !== series);
      });
    }
    offs.push(util.on(el, "pointerover", function (e) {
      var item = e.target.closest && e.target.closest(".k-chart__legend-item[data-series]");
      dim(item && el.contains(item) ? item.getAttribute("data-series") : null);
    }));
    offs.push(util.on(el, "pointerleave", function () { dim(null); }));

    return { hide: hide, destroy: function () { hide(); dim(null); offs.forEach(function (f) { f(); }); } };
  });
})(window.Kube);

/* --- 80-motion.js --- */
/* Kube loading & motion: height, disclosure, transition (enter / exit), number-roll, plus the
 * Kube.enter / exit / setNumber / setProgress / loading / replay helpers. Timings come from the CSS
 * custom properties in 80-loading.css, so a theme that retunes them retunes the script too.
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var supports = function (q) { return !!(window.CSS && CSS.supports && CSS.supports(q)); };

  // "0.4s" / "400ms" -> 400
  function toMs(v, fallback) {
    v = String(v || "").trim();
    if (!v) return fallback;
    var n = parseFloat(v);
    if (isNaN(n)) return fallback;
    return /ms$/.test(v) ? n : n * 1000;
  }
  function cssMs(el, prop, fallback) { return toMs(getComputedStyle(el).getPropertyValue(prop), fallback); }
  function wait(el, ms) { return new Promise(function (done) { util.afterMotion(el, ms, done); }); }
  function list(x) { return x && typeof x.length === "number" && !x.nodeType ? [].slice.call(x) : [x]; }

  /* ---------------------------------------------------------------- height */

  // .k-height follows the measured height of its first child. As in the source: measure once per frame,
  // ignore changes under 0.5px, and enable the transition one frame after the first measurement.
  Kube.register("height", function (el) {
    var inner = el.firstElementChild;
    if (!inner || typeof ResizeObserver !== "function") return {};
    var last = -1, raf = 0, readyRaf = 0, ready = false;
    function measure() {
      raf = 0;
      var h = inner.offsetHeight || inner.scrollHeight;
      if (!isFinite(h) || Math.abs(h - last) < 0.5) return;
      last = h;
      el.style.setProperty("--k-height", h + "px");
      if (ready) return;
      cancelAnimationFrame(readyRaf);
      readyRaf = requestAnimationFrame(function () { ready = true; el.setAttribute("data-height-ready", ""); });
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(measure); }
    var ro = new ResizeObserver(schedule);
    ro.observe(inner);
    schedule();
    return {
      destroy: function () {
        ro.disconnect();
        cancelAnimationFrame(raf);
        cancelAnimationFrame(readyRaf);
        el.style.removeProperty("--k-height");
        el.removeAttribute("data-height-ready");
      },
    };
  });

  /* ---------------------------------------------------------------- disclosure */

  // <details class="k-disclosure" data-kube="disclosure">: CSS animates ::details-content where
  // interpolate-size exists; elsewhere this animates the <details> height on summary clicks.
  var interpolateSize = supports("interpolate-size: allow-keywords");
  Kube.register("disclosure", function (el, u) {
    if (el.tagName !== "DETAILS" || (interpolateSize && !u.opt(el, "force", false))) return {};
    var summary = el.querySelector(":scope > summary");
    if (!summary || typeof el.animate !== "function") return {};
    el.setAttribute("data-disclosure-driver", "script");
    var anim = null;
    function closedHeight() {
      var cs = getComputedStyle(el);
      var box = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce(function (s, k) { return s + parseFloat(cs[k]); }, 0);
      var sm = getComputedStyle(summary);
      return summary.offsetHeight + parseFloat(sm.marginTop) + parseFloat(sm.marginBottom) + box;
    }
    function finish() {
      if (el.hasAttribute("data-closing")) el.open = false;
      el.removeAttribute("data-closing");
      el.style.overflow = "";
      anim = null;
    }
    var off = u.on(summary, "click", function (e) {
      if (u.reducedMotion()) return; // native, instant toggle
      e.preventDefault();
      var opening = !el.open || el.hasAttribute("data-closing");
      var from = el.getBoundingClientRect().height;
      if (anim) { anim.onfinish = null; anim.cancel(); }
      el.style.overflow = "hidden";
      var to;
      if (opening) {
        el.removeAttribute("data-closing");
        el.open = true;
        to = el.getBoundingClientRect().height;
      } else {
        el.setAttribute("data-closing", "");
        to = closedHeight();
      }
      anim = el.animate([{ height: from + "px" }, { height: to + "px" }], {
        duration: cssMs(el, "--duration-relaxed", 300),
        easing: "ease",
      });
      anim.onfinish = finish;
    });
    return {
      destroy: function () {
        off();
        if (anim) anim.cancel();
        finish();
        el.removeAttribute("data-disclosure-driver");
      },
    };
  });

  /* ---------------------------------------------------------------- enter / exit */

  // Enter: .k-transition from --k-from-* to rest (400ms ease; 500ms --ease-enter with --rise), or
  // .k-presence shown. Works with or without @starting-style. Resolves when the motion ends.
  // options: { delay: ms, stagger: ms } (stagger: a Kube addition, capped at five steps).
  Kube.enter = function (target, options) {
    var o = options || {};
    return Promise.all(list(target).map(function (el, i) {
      el.inert = false;
      if (el.classList.contains("k-presence")) {
        el.removeAttribute("data-hidden");
        return wait(el, cssMs(el, "--duration-basic", 150)).then(function () { return el; });
      }
      el.classList.add("k-transition");
      var delay = (o.delay || 0) + (o.stagger ? Math.min(i, 4) * o.stagger : 0);
      if (delay) el.style.setProperty("--k-enter-delay", delay + "ms");
      el.removeAttribute("data-exiting");
      el.setAttribute("data-entering", "");
      void el.offsetWidth; // commit the starting state
      el.removeAttribute("data-entering");
      return wait(el, cssMs(el, "--k-enter-duration", 400) + delay).then(function () { return el; });
    }));
  };

  // Exit: .k-transition to --k-from-* (200ms ease; 300ms --ease-exit with --rise), or .k-presence hidden.
  // The element leaves the tab order at once. Resolves with the element(s): Kube.exit(el).then((el) => el.remove()).
  // options: { remove: true } removes it for you.
  Kube.exit = function (target, options) {
    var o = options || {};
    var many = list(target);
    return Promise.all(many.map(function (el) {
      el.inert = true;
      var done;
      if (el.classList.contains("k-presence")) {
        el.setAttribute("data-hidden", "");
        done = wait(el, cssMs(el, "--duration-basic", 150));
      } else {
        el.classList.add("k-transition");
        el.setAttribute("data-exiting", "");
        done = wait(el, cssMs(el, "--k-exit-duration", 200));
      }
      return done.then(function () { if (o.remove) el.remove(); return el; });
    })).then(function (els) { return many.length === 1 && target.nodeType ? els[0] : els; });
  };

  // data-kube="transition" on a list: children added later enter with Kube.enter, so they animate even
  // without @starting-style. data-kube-stagger="40" staggers children added together (Kube addition).
  Kube.register("transition", function (el, u) {
    var stagger = u.opt(el, "stagger", 0);
    var mo = new MutationObserver(function (records) {
      var added = [];
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) { if (n.nodeType === 1 && n.parentNode === el) added.push(n); });
      });
      if (added.length) Kube.enter(added, { stagger: stagger });
    });
    mo.observe(el, { childList: true });
    return { destroy: function () { mo.disconnect(); } };
  });

  /* ---------------------------------------------------------------- number-roll */

  var DIGITS = "0123456789";
  function isDigit(c) { return c >= "0" && c <= "9"; }
  function column(d) {
    var col = document.createElement("span");
    col.className = "k-digits__col";
    col.setAttribute("aria-hidden", "true");
    var stack = document.createElement("span");
    stack.className = "k-digits__stack";
    stack.style.setProperty("--k-digit", d);
    DIGITS.split("").forEach(function (c) { var s = document.createElement("span"); s.textContent = c; stack.appendChild(s); });
    col.appendChild(stack);
    return col;
  }

  // Renders n (a number, or an already formatted string) into .k-digits. Columns are matched from the
  // right, as in the source, so a reused column rolls (.3s cubic-bezier(.16, 1, .3, 1)) and a new
  // leading column appears at its value. options: Intl.NumberFormat options; data-kube-locale or lang.
  Kube.setNumber = function (el, n, options) {
    var locale = el.getAttribute("data-kube-locale") || (el.closest("[lang]") || document.documentElement).getAttribute("lang") || undefined;
    var text = typeof n === "string" ? n : new Intl.NumberFormat(locale, options).format(n);
    var chars = Array.from(text);
    var count = chars.filter(isDigit).length;
    var sr = el.querySelector(":scope > .k-digits__sr");
    if (!sr) { sr = document.createElement("span"); sr.className = "k-digits__sr"; el.insertBefore(sr, el.firstChild); }
    sr.textContent = text;
    // Keep reused columns in place (moving a node would cancel its transition); rebuild everything else.
    [].slice.call(el.children).forEach(function (c) { if (c !== sr && !c.classList.contains("k-digits__col")) c.remove(); });
    var cols = [].slice.call(el.querySelectorAll(":scope > .k-digits__col"));
    cols.splice(0, Math.max(0, cols.length - count)).forEach(function (c) { c.remove(); });
    var fresh = count - cols.length, k = 0, seen = 0;
    chars.forEach(function (c) {
      var anchor = cols[k] || null;
      if (isDigit(c)) {
        if (seen++ >= fresh) { cols[k++].firstChild.style.setProperty("--k-digit", c); return; }
        el.insertBefore(column(c), anchor);
      } else {
        var sep = document.createElement("span");
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = c;
        el.insertBefore(sep, anchor);
      }
    });
    el.setAttribute("data-kube-value", typeof n === "string" ? n : String(n));
  };

  // data-kube="number-roll" data-kube-value="1284": renders on mount and rolls whenever the value changes.
  Kube.register("number-roll", function (el) {
    var last = null;
    function render() {
      var v = el.getAttribute("data-kube-value");
      if (v === null || v === last) return;
      last = v;
      var num = parseFloat(v);
      Kube.setNumber(el, isNaN(num) || String(num) !== v.trim() ? v : num);
      last = el.getAttribute("data-kube-value");
    }
    render();
    var mo = new MutationObserver(render);
    mo.observe(el, { attributes: true, attributeFilter: ["data-kube-value"] });
    return { destroy: function () { mo.disconnect(); } };
  });

  /* ---------------------------------------------------------------- progress */

  // Bar (.k-progress, --k-progress 0..1) or donut (.k-donut, --k-progress 0..100). v is 0..1;
  // null makes it indeterminate. Keeps aria-valuenow, a "N% ..." aria-label and the row's value in sync.
  Kube.setProgress = function (el, v) {
    var donut = el.classList.contains("k-donut");
    var indeterminate = v === null || v === undefined || isNaN(v);
    el.classList.toggle(donut ? "k-donut--indeterminate" : "k-progress--indeterminate", indeterminate);
    var row = el.closest(".k-progress-row");
    var out = row && row.querySelector(".k-progress-row__value");
    if (indeterminate) {
      el.style.removeProperty("--k-progress");
      el.removeAttribute("aria-valuenow");
      if (out) out.textContent = "";
      return;
    }
    v = util.clamp(+v, 0, 1);
    var pct = Math.round(v * 100);
    var lang = (el.closest("[lang]") || document.documentElement).getAttribute("lang") || undefined;
    var label = new Intl.NumberFormat(lang, { style: "percent" }).format(pct / 100);
    el.style.setProperty("--k-progress", donut ? v * 100 : v);
    if (el.getAttribute("role") === "progressbar") {
      if (!el.hasAttribute("aria-valuemin")) el.setAttribute("aria-valuemin", "0");
      if (!el.hasAttribute("aria-valuemax")) el.setAttribute("aria-valuemax", "100");
      el.setAttribute("aria-valuenow", pct);
    }
    var aria = el.getAttribute("aria-label");
    if (aria && /\d+(\.\d+)?\s?%/.test(aria)) el.setAttribute("aria-label", aria.replace(/\d+(\.\d+)?\s?%/, label));
    if (out) out.textContent = label;
  };

  /* ---------------------------------------------------------------- delayed loaders */

  // Kube.loading(el, promise | true | false): el is a .k-delay loader (or .k-delay--fade). It stays hidden,
  // shows after 400ms (.k-delay) or fades in after --k-delay, 1s (.k-delay--fade), and hides when every
  // pending piece of work has settled; work that ends first never shows it. Returns the promise.
  // options: { region } gets aria-busy while work is pending. Emits kube:loading { state }.
  var loaders = new WeakMap();
  Kube.loading = function (el, work, options) {
    var s = loaders.get(el);
    if (!s) loaders.set(el, (s = { count: 0, timer: 0, region: null }));
    function state(v) {
      if (el.getAttribute("data-delay-state") === v) return;
      el.setAttribute("data-delay-state", v);
      util.emit(el, "loading", { state: v });
    }
    function start() {
      if (s.count++ > 0) return;
      s.region = (options && options.region) || null;
      if (s.region) s.region.setAttribute("aria-busy", "true");
      state("waiting");
      var delay = el.classList.contains("k-delay--fade") ? cssMs(el, "--k-delay", 1000) : 400;
      s.timer = setTimeout(function () { state("visible"); }, delay);
    }
    function stop() {
      if (s.count === 0 || --s.count > 0) return;
      clearTimeout(s.timer);
      if (s.region) s.region.removeAttribute("aria-busy");
      state("done");
    }
    if (work === true) { start(); return Promise.resolve(); }
    if (work === false) { stop(); return Promise.resolve(); }
    start();
    return Promise.resolve(work).finally(stop);
  };

  /* ---------------------------------------------------------------- replay */

  // Restart the CSS animations of el and its subtree (fill-on-mount donuts, shimmer-once, pop, entrance).
  Kube.replay = function (el) {
    var els = [el].concat([].slice.call(el.querySelectorAll("*")));
    var prev = els.map(function (e) { var v = e.style.animationName; e.style.animationName = "none"; return v; });
    void el.offsetWidth;
    els.forEach(function (e, i) { e.style.animationName = prev[i]; });
  };

  /* ---------------------------------------------------------------- flash */

  // Kube.flash(el[, ms]): restart the changed-value flash on el (adds .k-flash, sets data-flash for ms,
  // default 3000). Returns el.
  var flashTimers = new WeakMap();
  Kube.flash = function (el, ms) {
    clearTimeout(flashTimers.get(el));
    el.classList.add("k-flash");
    el.removeAttribute("data-flash");
    el.style.setProperty("--k-flash-duration", (ms || 3000) + "ms"); // the CSS animation follows the timer
    void el.offsetWidth; // restart the animation when it is already running
    el.setAttribute("data-flash", "");
    flashTimers.set(el, setTimeout(function () { el.removeAttribute("data-flash"); }, ms || 3000));
    return el;
  };

  // data-kube="flash": flash whenever the element's text changes (a live counter, a total, a status).
  Kube.register("flash", function (el, u) {
    var last = el.textContent;
    var mo = new MutationObserver(function () {
      if (el.textContent === last) return;
      last = el.textContent;
      Kube.flash(el, u.opt(el, "duration", 3000));
      u.emit(el, "flash", { value: last });
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return { destroy: function () { mo.disconnect(); clearTimeout(flashTimers.get(el)); el.removeAttribute("data-flash"); } };
  });
})(window.Kube);

/* --- 90-surfaces.js --- */
/* Kube surfaces & scroll behavior: scroll-fade, sticky-header, dropzone, snap-x.
 * CSS does the work wherever the engine can (scroll-driven animations, ::scroll-button); these
 * behaviors set the same data attributes where it cannot, and add what CSS has no way to know
 * (overflow events, files, peeking menus).
 */
(function (Kube) {
  "use strict";

  var util = Kube.util;
  var supports = function (q) { return !!(window.CSS && CSS.supports && CSS.supports(q)); };
  var scrollTimeline = supports("animation-timeline: scroll()");
  var nativeScrollButtons = supports("selector(::scroll-button(*))");

  function setAttr(el, name, value) {
    value = String(value);
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  // Scroll position of a scroller, with a 1px tolerance so sub-pixel layouts never show a stray fade.
  function edges(sc) {
    var y = sc.scrollHeight > sc.clientHeight + 1;
    var x = sc.scrollWidth > sc.clientWidth + 1;
    var left = Math.abs(sc.scrollLeft); // negative in RTL
    return {
      overflow: x || y,
      up: sc.scrollTop > 1,
      down: y && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1,
      start: left > 1,
      end: x && left + sc.clientWidth < sc.scrollWidth - 1,
    };
  }

  // Calls fn(edges) after size or content changes (once per frame) and, unless onScroll is false, on scroll.
  function trackEdges(sc, fn, onScroll) {
    var raf = 0;
    function update() { raf = 0; fn(edges(sc)); }
    function schedule() { if (!raf) raf = requestAnimationFrame(update); }
    var ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    // Watch the scroller and each child: a row that grows changes scrollHeight but not the scroller's box.
    function observe() {
      if (!ro) return;
      ro.disconnect();
      ro.observe(sc);
      [].forEach.call(sc.children, function (c) { ro.observe(c); });
    }
    var mo = new MutationObserver(function (records) {
      if (records.some(function (r) { return r.type === "childList" && r.target === sc; })) observe();
      schedule();
    });
    mo.observe(sc, { childList: true, subtree: true, characterData: true });
    var offScroll = onScroll === false ? function () {} : util.on(sc, "scroll", update, { passive: true });
    var offResize = util.on(window, "resize", schedule);
    observe();
    update();
    return {
      update: update,
      destroy: function () { offScroll(); offResize(); if (ro) ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); },
    };
  }

  /* ---------------------------------------------------------------- scroll-fade */

  // Peek: cut max-height through the middle of the last item that fits, so half a row shows below the edge.
  function peekHeight(sc, selector, base) {
    sc.style.maxHeight = base;
    var limit = sc.clientHeight;
    if (sc.scrollHeight <= limit + 1) return;
    var box = sc.getBoundingClientRect();
    var scale = sc.offsetHeight ? box.height / sc.offsetHeight : 1; // a scaled-in popover reports scaled rects
    if (!(scale > 0)) return;
    var cut = 0;
    [].forEach.call(sc.querySelectorAll(selector), function (item) {
      var r = item.getBoundingClientRect();
      var mid = (r.top - box.top + r.height / 2) / scale - sc.clientTop + sc.scrollTop;
      if (r.height > 0 && mid <= limit) cut = Math.max(cut, mid);
    });
    if (!(cut > 0)) return;
    // cut is measured in the padding box; max-height applies to the content box or the border box.
    var cs = getComputedStyle(sc);
    cut += cs.boxSizing === "border-box"
      ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      : -(parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
    sc.style.maxHeight = cut + "px";
  }

  var PEEK_ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

  function scrollFade(el, force) {
    // k-text-fade: one label, no scrolling; drop the fade when the text fits.
    if (el.classList.contains("k-text-fade")) {
      var fit = function () { setAttr(el, "data-overflowing", el.scrollWidth > el.clientWidth + 1); };
      var ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
      var mo = new MutationObserver(fit);
      if (ro) ro.observe(el);
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      fit();
      return { update: fit, destroy: function () { if (ro) ro.disconnect(); mo.disconnect(); } };
    }

    var host = el.closest(".k-scroll-shade") || el;
    var sc = el.classList.contains("k-scroll-shade") ? el.querySelector(".k-scroll-shade__viewport") : el;
    if (!sc) return {};
    var peekOpt = util.opt(el, "peek", null);
    var peek = peekOpt === null || peekOpt === "false" ? null : peekOpt === "" || peekOpt === "true" ? PEEK_ITEMS : peekOpt;
    // Where CSS scroll timelines draw the fades, only data-has-overflow is kept (resize and content
    // changes, no scroll listener): Chromium holds the last ramp value when a scroller stops
    // overflowing after it was scrolled, and the CSS turns the ramp off on data-has-overflow="false".
    var script = force || !scrollTimeline;
    // Forced in an engine with scroll timelines: turn the CSS ramp off so the attributes drive the fade.
    if (script && scrollTimeline) host.setAttribute("data-scroll-driver", "script");
    var baseMax = sc.style.maxHeight;
    var lastOverflow = null;
    var tracker = trackEdges(sc, function (e) {
      if (peek) { peekHeight(sc, peek, baseMax); e = edges(sc); }
      setAttr(host, "data-has-overflow", e.overflow);
      if (script) {
        setAttr(host, "data-can-scroll-up", e.up);
        setAttr(host, "data-can-scroll-down", e.down);
        setAttr(host, "data-can-scroll-start", e.start);
        setAttr(host, "data-can-scroll-end", e.end);
      }
      if (e.overflow !== lastOverflow) { lastOverflow = e.overflow; util.emit(host, "overflow", { overflow: e.overflow }); }
    }, script || !!peek);
    return {
      update: tracker.update,
      destroy: function () {
        tracker.destroy();
        if (peek) sc.style.maxHeight = baseMax;
        host.removeAttribute("data-scroll-driver");
      },
    };
  }

  // data-kube="scroll-fade" on .k-scroll-fade, .k-scroll-shade (or its viewport) or .k-text-fade.
  Kube.register("scroll-fade", function (el, u) { return scrollFade(el, u.opt(el, "force", false)); });
  // Manual use (elements without data-kube, virtual lists): always runs the script path.
  Kube.scrollFade = function (el) { return scrollFade(el, true); };

  /* ---------------------------------------------------------------- sticky-header */

  function scrollParent(el) {
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(auto|scroll|overlay|hidden)/.test(getComputedStyle(p).overflowY)) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Always tracks data-scrolled (and kube:scrolled), which pages use to restyle their header.
  // The hairline itself follows CSS scroll(nearest) where supported, unless data-kube-force is set.
  Kube.register("sticky-header", function (el, u) {
    var sc = scrollParent(el);
    var target = sc === document.scrollingElement || sc === document.documentElement ? window : sc;
    if (scrollTimeline && u.opt(el, "force", false)) el.setAttribute("data-scroll-driver", "script");
    var last = null;
    function update() {
      var scrolled = sc.scrollTop > 0;
      if (scrolled === last) return;
      last = scrolled;
      el.setAttribute("data-scrolled", scrolled);
      u.emit(el, "scrolled", { scrolled: scrolled });
    }
    var off = u.on(target, "scroll", update, { passive: true });
    update();
    return { destroy: function () { off(); el.removeAttribute("data-scroll-driver"); } };
  });

  /* ---------------------------------------------------------------- dropzone */

  function accepts(file, accept) {
    if (!accept) return true;
    var name = (file.name || "").toLowerCase();
    var type = (file.type || "").toLowerCase();
    return accept.split(",").some(function (a) {
      a = a.trim().toLowerCase();
      if (!a) return false;
      if (a.charAt(0) === ".") return name.slice(-a.length) === a;
      if (a.slice(-2) === "/*") return type.indexOf(a.slice(0, -1)) === 0;
      return type === a;
    });
  }

  function dragHasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && [].indexOf.call(t, "Files") >= 0;
  }

  // Options: data-kube-accept (".png,image/*"), data-kube-multiple (true), data-kube-max-size (bytes),
  // data-kube-click (true: a click on the zone's background opens the picker).
  // Any [data-kube-pick] inside opens the picker; without one the zone itself becomes a focusable button.
  Kube.register("dropzone", function (el, u) {
    var input = el.querySelector('input[type="file"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      input.tabIndex = -1;
      el.appendChild(input);
      input.setAttribute("data-kube-created", "");
    }
    var accept = u.opt(el, "accept", input.accept || "");
    var multiple = u.opt(el, "multiple", input.hasAttribute("data-kube-created") ? true : input.multiple);
    var maxSize = u.opt(el, "max-size", 0);
    var clickOpens = u.opt(el, "click", true);
    if (accept) input.accept = accept;
    input.multiple = multiple;
    var madeFocusable = false;
    if (!el.querySelector("[data-kube-pick]") && !el.hasAttribute("tabindex")) {
      el.tabIndex = 0;
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      madeFocusable = true;
    }
    setAttr(el, "data-drag-over", false);

    var depth = 0;
    function active(on) {
      if (el.getAttribute("data-drag-over") === String(on)) return;
      el.setAttribute("data-drag-over", on);
      u.emit(el, "dragstate", { active: on });
    }
    function deliver(list, source) {
      var ok = [], rejected = [];
      [].forEach.call(list || [], function (f) {
        (accepts(f, accept) && (!maxSize || f.size <= maxSize) ? ok : rejected).push(f);
      });
      if (!multiple && ok.length > 1) rejected = rejected.concat(ok.splice(1));
      if (ok.length || rejected.length) u.emit(el, "drop", { files: ok, rejected: rejected, source: source });
    }
    function pick() { input.click(); }

    var offs = [
      // dragenter / dragleave also fire for every child crossed, so count them.
      u.on(el, "dragenter", function (e) { if (!dragHasFiles(e)) return; e.preventDefault(); depth++; active(true); }),
      u.on(el, "dragover", function (e) { if (!dragHasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }),
      u.on(el, "dragleave", function (e) { if (!dragHasFiles(e)) return; if (--depth <= 0) { depth = 0; active(false); } }),
      u.on(el, "drop", function (e) {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        active(false);
        deliver(e.dataTransfer.files, "drop");
      }),
      u.on(input, "change", function () { deliver(input.files, "picker"); input.value = ""; }),
      u.on(el, "click", function (e) {
        if (e.target === input) return;
        if (e.target.closest("[data-kube-pick]")) { pick(); return; }
        if (clickOpens && !e.target.closest("button, a[href], input, select, textarea, label, [role='button']:not(.k-dropzone)")) pick();
      }),
      u.on(el, "keydown", function (e) {
        if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        pick();
      }),
    ];
    return {
      open: pick,
      destroy: function () {
        offs.forEach(function (off) { off(); });
        if (input.hasAttribute("data-kube-created")) input.remove();
        if (madeFocusable) { el.removeAttribute("tabindex"); el.removeAttribute("role"); }
      },
    };
  });

  /* ---------------------------------------------------------------- snap-x */

  // Previous / next buttons for .k-snap-x--buttons where ::scroll-button() is missing.
  // Options: data-kube-prev-label, data-kube-next-label, data-kube-force (use these even with native buttons).
  Kube.register("snap-x", function (el, u) {
    if (nativeScrollButtons && !u.opt(el, "force", false)) return {};
    var frame = el.parentElement;
    if (!frame || !frame.classList.contains("k-snap-frame")) {
      frame = document.createElement("div");
      frame.className = "k-snap-frame";
      el.parentNode.insertBefore(frame, el);
      frame.appendChild(el);
      frame.setAttribute("data-kube-created", "");
    }
    if (!el.id) el.id = u.uid("k-snap");
    el.setAttribute("data-scroll-buttons", "script");
    function button(dir, label, glyph) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "k-snap-frame__button";
      b.setAttribute("data-dir", dir);
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-controls", el.id);
      b.textContent = glyph;
      frame.appendChild(b);
      return b;
    }
    var prev = button("prev", u.opt(el, "prev-label", "Previous"), "‹");
    var next = button("next", u.opt(el, "next-label", "Next"), "›");
    function go(dir) {
      var rtl = getComputedStyle(el).direction === "rtl";
      el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.85 }); // one page, like ::scroll-button
    }
    var offs = [
      u.on(prev, "click", function () { go(-1); }),
      u.on(next, "click", function () { go(1); }),
    ];
    var tracker = trackEdges(el, function (e) {
      prev.disabled = !e.start;
      next.disabled = !e.end;
      setAttr(el, "data-can-scroll-start", e.start);
      setAttr(el, "data-can-scroll-end", e.end);
    });
    return {
      destroy: function () {
        tracker.destroy();
        offs.forEach(function (off) { off(); });
        prev.remove();
        next.remove();
        el.removeAttribute("data-scroll-buttons");
        if (frame.hasAttribute("data-kube-created")) { frame.parentNode.insertBefore(el, frame); frame.remove(); }
      },
    };
  });
})(window.Kube);
