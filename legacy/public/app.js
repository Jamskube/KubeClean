// KubeClean UI
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const CATS = [
  ['system', 'Windows', 'monitor'],
  ['browsers', 'Navigateurs', 'globe'],
  ['apps', 'Applications', 'app-window'],
  ['dev', 'Outils de dev', 'code-xml'],
  ['projects', 'Projets : dossiers de compilation', 'folder-code'],
];
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
const nInt = new Intl.NumberFormat('fr-BE');
const fmt = (b) => b >= 1e9 ? `${nf.format(b / 1e9)} Go` : b >= 1e6 ? `${nf.format(b / 1e6)} Mo` : b >= 1e3 ? `${nf.format(b / 1e3)} Ko` : `${b} o`;

let data = null;          // last scan result
const selected = new Set();
const sizeOf = new Map(); // id -> bytes
const titleOf = new Map();

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'k-icon'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `kube/icons/kube-icons.svg#${name}`);
  s.append(u); return s;
};
const setProg = (el, v) => { if (window.Kube?.setProgress) Kube.setProgress(el, v); else el.style.setProperty('--k-progress', v ?? 0); };
const toast = (o) => window.Kube?.toast ? Kube.toast(o) : console.log(o.title, o.description || '');

// ---------- disk ----------
function showDisk(d) {
  const used = d.total - d.free;
  $('diskText').textContent = `${d.drive.replace(/\\$/, '')} ${fmt(d.free)} libres sur ${fmt(d.total)}`;
  setProg($('diskBar'), used / d.total);
  $('diskPct').textContent = `${Math.round((used / d.total) * 100)} %`;
  $('diskLabel').textContent = `${fmt(d.free)} libres`;
}

// ---------- selection ----------
function updateTotals() {
  let sel = 0;
  for (const id of selected) sel += sizeOf.get(id) || 0;
  $('cleanLabel').textContent = sel ? `Nettoyer ${fmt(sel)}` : 'Nettoyer';
  $('cleanBtn').disabled = !sel;
  for (const [cat] of CATS) {
    const box = document.querySelector(`[data-all="${cat}"]`);
    if (!box) continue;
    const ids = [...document.querySelectorAll(`input[data-cat="${cat}"]`)].map((i) => i.value);
    const n = ids.filter((id) => selected.has(id)).length;
    box.checked = n === ids.length && n > 0;
    box.indeterminate = n > 0 && n < ids.length;
  }
}
function toggle(id, on) { on ? selected.add(id) : selected.delete(id); updateTotals(); }

// ---------- rendering ----------
function row(cat, item, nameCell, badge) {
  sizeOf.set(item.id, item.size); titleOf.set(item.id, item.title || item.path);
  if (item.default) selected.add(item.id);
  return h('tr', {},
    h('td', { class: 'kc-check' }, h('input', {
      type: 'checkbox', class: 'k-checkbox', value: item.id, 'data-cat': cat, 'aria-label': item.title || item.path,
      checked: item.default, onchange: (e) => toggle(item.id, e.target.checked),
    })),
    h('td', {}, nameCell),
    h('td', {}, badge),
    h('td', { class: 'k-table__num' }, fmt(item.size)));
}
const name = (title, hint) => h('div', { class: 'kc-name' }, h('span', { class: 'kc-name__title' }, title), hint ? h('span', { class: 'kc-name__hint' }, hint) : null);
const badge = (text, tone) => h('span', { class: `k-badge${tone ? ` k-badge--${tone}` : ''}` }, text);

function section(cat, label, ico, rows, total, empty) {
  const all = h('input', {
    type: 'checkbox', class: 'k-checkbox', 'data-all': cat, 'aria-label': `Tout sélectionner : ${label}`,
    onchange: (e) => { for (const i of document.querySelectorAll(`input[data-cat="${cat}"]`)) { i.checked = e.target.checked; e.target.checked ? selected.add(i.value) : selected.delete(i.value); } updateTotals(); },
  });
  return h('section', { class: 'kc-section', id: `cat-${cat}`, 'aria-labelledby': `h-${cat}` },
    h('div', { class: 'kc-section__head' }, h('h2', { class: 'kc-section__title', id: `h-${cat}` }, label), h('span', { class: 'kc-section__total' }, fmt(total))),
    rows.length
      ? h('div', { class: 'k-table-scroll', role: 'region', tabindex: '0', 'aria-label': label },
          h('table', { class: 'k-table' },
            h('thead', {}, h('tr', {}, h('th', { class: 'kc-check' }, all), h('th', {}, 'Élément'), h('th', {}, ''), h('th', { class: 'k-table__num' }, 'Taille'))),
            h('tbody', {}, rows)))
      : null,
    empty ? h('p', { class: 'kc-empty' }, empty) : null);
}

function render(res) {
  data = res; selected.clear(); sizeOf.clear(); titleOf.clear();
  showDisk(res.disk);
  const content = $('content'); content.replaceChildren();
  const nav = $('nav'); nav.replaceChildren();
  let grand = 0;
  for (const [cat, label, ico] of CATS) {
    let rows = [], total = 0, empty = '';
    if (cat === 'projects') {
      for (const p of res.projects) {
        total += p.size;
        const idle = p.idleDays == null ? 'activité inconnue' : p.idleDays === 0 ? "modifié aujourd'hui" : `inactif depuis ${p.idleDays} j`;
        rows.push(row(cat, { ...p, title: `${p.project.split('\\').pop()} / ${p.path.split('\\').pop()}` },
          name(`${p.project.split('\\').pop()} / ${p.path.split('\\').pop()}`, `${p.path} · ${idle}`),
          badge(p.kind, p.default ? null : 'warning')));
      }
      if (!rows.length) empty = 'Aucun dossier de compilation trouvé dans les dossiers de projets (config.json).';
      else empty = `Cochés d'office : projets inactifs depuis au moins ${res.projectIdleDays} jours. Ils se réinstallent avec npm install, cargo build, pip install…`;
    } else {
      const rules = res.rules.filter((r) => r.cat === cat);
      const found = rules.filter((r) => r.size > 0).sort((a, b) => b.size - a.size);
      for (const r of found) {
        total += r.size;
        const what = `${nInt.format(r.count)} ${r.count > 1 ? 'éléments' : 'élément'}`;
        rows.push(row(cat, r, name(r.title, `${r.hint} · ${what}`), r.default ? badge('Sûr', 'success') : badge('À vérifier', 'warning')));
      }
      const nothing = rules.length - found.length;
      if (nothing) empty = `${nothing} ${nothing > 1 ? 'autres règles' : 'autre règle'} sans rien à nettoyer.`;
    }
    grand += total;
    content.append(section(cat, label, ico, rows, total, empty));
    nav.append(h('a', { class: 'k-nav-row k-nav-row--sm', href: `#cat-${cat}` },
      h('span', { class: 'k-nav-row__icon' }, icon(ico)),
      h('span', { class: 'k-nav-row__label' }, label.split(' :')[0]),
      h('span', { class: 'k-nav-row__meta' }, total ? fmt(total) : '—')));
  }
  $('subtitle').textContent = `${fmt(grand)} récupérables · ${fmt(res.disk.free)} libres sur ${res.disk.drive.replace(/\\$/, '')}`;
  updateTotals();
}

// ---------- scan ----------
function scan() {
  $('scanBtn').disabled = true; $('cleanBtn').disabled = true;
  $('status').hidden = false; $('statusLabel').textContent = 'Analyse…'; setProg($('statusBar'), 0); $('statusPct').textContent = '';
  const es = new EventSource(`/api/scan?t=${encodeURIComponent(TOKEN)}`);
  const end = () => { es.close(); $('scanBtn').disabled = false; $('status').hidden = true; };
  es.addEventListener('progress', (e) => {
    const p = JSON.parse(e.data);
    setProg($('statusBar'), p.done / p.total);
    $('statusLabel').textContent = `Analysé : ${p.label}`;
    $('statusPct').textContent = `${p.done}/${p.total}`;
  });
  es.addEventListener('result', (e) => { end(); render(JSON.parse(e.data)); });
  es.addEventListener('failure', (e) => { end(); toast({ title: "L'analyse a échoué", description: JSON.parse(e.data).message, tone: 'danger' }); });
  es.onerror = () => { if (es.readyState !== EventSource.CLOSED) { end(); toast({ title: 'Connexion perdue avec KubeClean', tone: 'danger' }); } };
}

// ---------- clean ----------
function askClean() {
  const ids = [...selected];
  let total = 0;
  const list = $('confirmList'); list.replaceChildren();
  for (const id of ids.sort((a, b) => (sizeOf.get(b) || 0) - (sizeOf.get(a) || 0))) {
    total += sizeOf.get(id) || 0;
    list.append(h('li', {}, `${titleOf.get(id)} : ${fmt(sizeOf.get(id) || 0)}`));
  }
  $('confirmDesc').textContent = `${ids.length} ${ids.length > 1 ? 'éléments' : 'élément'}, environ ${fmt(total)}. Les fichiers ouverts sont laissés en place. La suppression est définitive, sans passer par la corbeille.`;
  $('confirm').showModal();
}
async function doClean() {
  $('confirm').close();
  const ids = [...selected];
  $('cleanBtn').disabled = true; $('scanBtn').disabled = true;
  $('status').hidden = false; $('statusLabel').textContent = 'Nettoyage…'; setProg($('statusBar'), null); $('statusPct').textContent = '';
  try {
    const r = await fetch('/api/clean', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': TOKEN }, body: JSON.stringify({ ids }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || r.status);
    const gain = Math.max(out.diskFreeGain, 0);
    toast({
      title: `${fmt(out.freed)} supprimés`,
      description: `Espace libre gagné sur le disque : ${fmt(gain)}.` + (out.skipped ? ` ${nInt.format(out.skipped)} ${out.skipped > 1 ? 'éléments laissés' : 'élément laissé'} (ouverts ou protégés).` : ''),
      tone: 'success', duration: 9000,
    });
  } catch (e) {
    toast({ title: 'Le nettoyage a échoué', description: String(e.message || e), tone: 'danger' });
  } finally {
    $('status').hidden = true; $('scanBtn').disabled = false;
    scan(); // always re-measure after cleaning
  }
}

$('scanBtn').addEventListener('click', scan);
$('cleanBtn').addEventListener('click', askClean);
$('confirmOk').addEventListener('click', doClean);
$('confirmCancel').addEventListener('click', () => $('confirm').close());
setInterval(() => fetch('/api/ping', { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => {}), 5000);
fetch('/api/ping', { method: 'POST', headers: { 'X-Token': TOKEN } }).catch(() => {});
scan();
