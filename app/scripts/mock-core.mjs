// Fake kubeclean-core for UI work: same JSON-lines protocol, same shapes,
// deterministic fake data, NO file-system access. Started by electron/main.mjs
// when KC_MOCK=1. A "clean" here deletes nothing anywhere.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'core', 'rules', 'default.json'), 'utf8')).rules.filter((r) => !r.disabled);
const USER = 'C:\\Users\\nico';
const DAY = 86_400_000;
const now = Date.now();
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scaled = (ms) => sleep(Math.max(0, ms * (Number(process.env.KC_MOCK_SPEED) || 1)));

// deterministic pseudo-random per string
const h = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return (x >>> 0) / 4294967296; };
const MB = 1024 * 1024;
const sizeFor = (r) => {
  if (r.kind === 'oldDownloads') return downloadsFor(r).reduce((n, d) => n + d[1], 0);
  const big = { chromeCache: 6500, claudeSessions: 5300, npmCache: 4700, diagTraces: 3600, wslCrashes: 1800, teamsCache: 900, edgeCache: 420, gradleCaches: 1400, cargoCache: 800, vscodeWorkspaces: 160, userTemp: 240, thumbCache: 8, d3dShaders: 26, werReports: 0, inetCache: 0.03, recycleBin: 296, adminWindowsTemp: 120, adminWer: 13, adminDelivery: 0, adminComponents: 0, playwright: 1100, pipUv: 650, nodeCompile: 3 };
  return Math.round((big[r.id] ?? (h(r.id) < 0.45 ? 0 : h(r.id) * 300)) * MB * (WORST && r.id === 'npmCache' ? 90 : 1));
};
const names = ['a9f3c1.bin', 'cache_0001', 'index-dir', 'f_000a2c', 'data_3', 'Code Cache', 'GPUCache', 'old_v2.log', 'session-7f.jsonl', 'tmp8812.tmp'];

const PROJECTS = [
  ['Desktop\\SoundNodes\\Audience_Project\\admin-svelte\\node_modules', 'Node', 103 * MB, 2],
  ['Desktop\\SoundNodes\\Audience_Project\\mobile\\android\\.gradle', 'Gradle', 62 * MB, 10],
  ['Desktop\\UNIVERS6T\\website\\univers6t_site\\node_modules', 'Node', 206 * MB, 0],
  ['Desktop\\UNIVERS6T\\website\\univers6t_site\\.svelte-kit', 'SvelteKit', 11 * MB, 0],
  ['dev\\visual-check-lab\\node_modules', 'Node', 24 * MB, 125],
  ['Desktop\\KubeClean\\core\\target', 'Rust / Maven', 632 * MB, 0],
  ['PycharmProjects\\scraper\\.venv', 'Python venv', 410 * MB, 48],
  ['PycharmProjects\\scraper\\__pycache__', 'Python', 2 * MB, 48],
  ['source\\repos\\Invoicer\\obj', '.NET', 88 * MB, 201],
  ['source\\repos\\Invoicer\\bin', '.NET', 140 * MB, 201],
];
const LARGE = [
  ['Desktop\\SoundNodes\\Audience_Project\\data\\negatives\\demand.zip', 7.36e9, 216],
  ['Documents\\ChatGPT\\GLobe\\public\\maps\\world.pmtiles', 3.75e9, 53],
  ['Desktop\\DESKTOP\\Python\\model_mixage_voix\\Elements\\Acapella Pack 2021.rar', 3.16e9, 403],
  ['Desktop\\SoundNodes\\Audience_Project\\backups\\pre_panel_manager_2026-05-27.sql.gz', 1.42e9, 158],
  ['npu-models\\qwen7b-qnn\\context_0_ctx_qnn.bin', 0.83e9, 99],
  ['Videos\\Captures\\demo-final.mp4', 2.1e9, 12],
  ['Documents\\Archives\\photos-2024.zip', 1.9e9, 300],
  ['Desktop\\ISO\\Win11_24H2_French_arm64.iso', 6.2e9, 77],
];
const DOWNLOADS = [
  ['Downloads\\VSCodeUserSetup-arm64-1.96.exe', 110 * MB, 140], ['Downloads\\node-v22.20.0-arm64.msi', 32 * MB, 95],
  ['Downloads\\rapport-final (3).pdf', 4 * MB, 210], ['Downloads\\IMG_20250102_WA0007.jpg', 2 * MB, 300],
  ['Downloads\\dataset.csv', 480 * MB, 120], ['Downloads\\Figma Setup 124.6.5.exe', 90 * MB, 101],
];

// mask / exclude of the rule, as the engine applies them (installers vs old downloads)
const exts = (m) => (m ?? '').split(';').filter(Boolean).map((x) => x.replace('*', '').toLowerCase());
const downloadsFor = (r) => DOWNLOADS.filter(([p]) => { const hit = (m) => exts(m).some((e) => p.toLowerCase().endsWith(e)); return (!r.mask || hit(r.mask)) && !(r.exclude && hit(r.exclude)); });
const item = (p, size, idleDays, label, isDir, def) => ({ path: `${USER}\\${p}`, size, newest: now - (idleDays ?? 0) * DAY, isDir, label: label ?? null, idleDays: idleDays ?? null, default: def });
function itemsFor(r, limit = 5) {
  if (r.kind === 'projects') return PROJECTS.map(([p, label, size, idle]) => item(p, size, idle, label, true, idle >= settings.projectIdleDays));
  if (r.kind === 'largeFiles') return LARGE.map(([p, size, idle]) => item(p, size, idle, null, false, false)).sort((a, b) => b.size - a.size);
  if (r.kind === 'oldDownloads') return downloadsFor(r).map(([p, size, idle]) => item(p, size, idle, null, false, false)).sort((a, b) => b.size - a.size);
  if (r.kind === 'recycleBin') return [{ path: 'Corbeille', size: sizeFor(r), newest: 0, isDir: true, label: '3', idleDays: null, default: true }];
  const n = countFor(r);
  const total = sizeFor(r);
  const out = [];
  for (let i = 0; i < Math.min(n, limit); i++) {
    const frac = Math.pow(0.72, i) * 0.28;
    out.push(item(`AppData\\Local\\${r.title.split(' ')[0].replace(/[^A-Za-z]/g, '') || 'App'}\\${names[i % names.length]}${i >= names.length ? i : ''}`, Math.round(total * frac), 3 + Math.round(h(r.id + i) * 60), null, i % 3 === 0, true));
  }
  return out;
}
const countFor = (r) => (sizeFor(r) === 0 ? 0 : r.kind === 'projects' ? PROJECTS.length : r.kind === 'largeFiles' ? LARGE.length : r.kind === 'oldDownloads' ? downloadsFor(r).length : r.kind === 'recycleBin' ? 3 : WORST && r.id === 'thumbCache' ? 1 : Math.max(1, Math.round(h(r.id) * 5800 * (WORST ? 830 : 1))));
const RUNNING = ['chrome.exe', 'explorer.exe', 'msedge.exe'];

// KC_MOCK_DATA=worst: realistic worst case for UI stress tests (break-ui). Deep client paths,
// long French file names, a 1.2 TB virtual disk, a near-full system drive, six drives,
// a single old download, a year of history. Dev only, like the rest of this file.
const WORST = process.env.KC_MOCK_DATA === 'worst';
if (WORST) {
  PROJECTS.splice(0, PROJECTS.length,
    ['Documents\\Clients\\Northwind Industries Holdings\\2026\\Migration plateforme e-commerce\\frontend-nextjs-storefront-v3\\node_modules', 'Node', 2.9e9, 2184],
    ['dev\\x\\target', 'Rust / Maven', 47.3e9, 0],
    ['source\\repos\\Aleksandra.Wiśniewska-Kowalczyk.PortailFournisseurs.Api\\obj', '.NET', 1 * MB, 1],
    ['dev\\monorepo\\packages\\@northwind\\design-system-tokens-generator\\.turbo', 'Turborepo', 0.4e9, 14],
  );
  LARGE.splice(0, LARGE.length,
    ['Hyper-V\\Virtual Hard Disks\\Windows Server 2025 Datacenter Evaluation (copie de sauvegarde avant migration).vhdx', 1.24e12, 640],
    ['Videos\\Enregistrement réunion équipe produit - revue trimestrielle Q3 2026 (version finale corrigée) (2).mp4', 38.4e9, 31],
    ['Documents\\a.zip', 0.52e9, 1],
  );
  DOWNLOADS.splice(0, DOWNLOADS.length, ['Downloads\\Facture_2025-001284_Northwind-Industries-Holdings_bartholomew.fitzgerald.pdf', 1 * MB, 91]);
}


function summary(r) {
  const perItem = ['projects', 'largeFiles', 'oldDownloads'].includes(r.kind);
  const items = itemsFor(r, perItem ? 1000 : 5);
  const size = perItem ? items.reduce((a, i) => a + i.size, 0) : sizeFor(r);
  return {
    id: r.id, cat: r.cat, title: r.title, hint: r.hint ?? '', kind: r.kind, perItem, toRecycle: ['largeFiles', 'oldDownloads'].includes(r.kind),
    needsAdmin: r.kind === 'elevated', default: !!r.default, size, count: perItem ? items.length : countFor(r),
    sizeKnown: !(r.kind === 'elevated' && (r.task === 'componentStore' || r.task === 'deliveryOptimization')),
    blockedBy: (r.apps ?? []).filter((a) => RUNNING.includes(a.toLowerCase())).map((a) => a.replace(/\.exe$/i, '')),
    items,
  };
}

let drives = [{ root: 'C:\\', total: 511e9, free: 58.4e9 }, { root: 'G:\\', total: 1000e9, free: 200.2e9 }];
if (WORST) drives = [{ root: 'C:\\', total: 2000e9, free: 1.2e9 }, { root: 'D:\\', total: 4000e9, free: 3871e9 }, { root: 'E:\\', total: 64e9, free: 0 }, { root: 'F:\\', total: 256e9, free: 255.9e9 }, { root: 'G:\\', total: 1000e9, free: 200.2e9 }, { root: 'Z:\\', total: 16000e9, free: 9200e9 }];
let settings = { projectRoots: ['%USERPROFILE%/Desktop', '%USERPROFILE%/Documents', '%USERPROFILE%/PycharmProjects', '%USERPROFILE%/source', '%USERPROFILE%/dev'], projectIdleDays: 14, largeFileMinMb: 500, downloadsOlderThanDays: 90, ignore: [`${USER}\\Desktop\\KubeClean\\core\\target`] };
let history = [
  { at: now - 31 * DAY, freed: 18.2e9, diskGain: 17.9e9, deleted: 48210, skipped: 12, recycled: 0, byCat: { browsers: 6.1e9, dev: 9.3e9, system: 2.8e9 } },
  { at: now - 19 * DAY, freed: 4.1e9, diskGain: 4.0e9, deleted: 9012, skipped: 3, recycled: 1, byCat: { browsers: 1.1e9, apps: 1.9e9, files: 1.1e9 } },
  { at: now - 8 * DAY, freed: 11.6e9, diskGain: 11.2e9, deleted: 22044, skipped: 30, recycled: 0, byCat: { dev: 7.6e9, projects: 3.0e9, system: 1.0e9 } },
  { at: now - 2 * DAY, freed: 2.3e9, diskGain: 2.2e9, deleted: 3302, skipped: 0, recycled: 0, byCat: { browsers: 2.3e9 } },
];
if (WORST) history = Array.from({ length: 60 }, (_, i) => ({ at: now - (365 - i * 6) * DAY, freed: (i % 7 === 0 ? 120e9 : 0.3e9 + h('w' + i) * 9e9), diskGain: i === 59 ? -0.2e9 : (i % 7 === 0 ? 118e9 : 0.3e9 + h('w' + i) * 8.6e9), deleted: Math.round(h('d' + i) * 4_800_000), skipped: i === 59 ? 1 : 0, recycled: i === 59 ? 1 : 0, byCat: { dev: 2e9, browsers: 1e9, apps: 0.5e9, projects: 0.2e9, files: 0.1e9, system: 0.05e9, admin: 0.01e9 } }));
let scans = null;
let busy = false;
let cancelled = false;

// applications : [nom, éditeur, version, taille Mo, données Mo, dernière ouverture (jours, null = aucune trace), installée (jours), plantages, blocages, ouverte, composant]
const MAC_MOCK = process.env.KC_PLATFORM === 'darwin';
const APPS_SRC = MAC_MOCK ? [
  ['Google Chrome', null, '131.0', 640, 2100, 0, 400, 0, 0, true],
  ['Spotify', null, '1.2.50', 310, 4200, 3, 600, 4, 1],
  ['Zoom', null, '6.2.0', 220, 180, 210, 500],
  ['Adobe Acrobat Reader', null, '24.004', 980, 90, 260, 720],
  ['Slack', null, '4.41', 380, 1200, 12, 300, 1, 0],
  ['Microsoft Teams', null, '24295', 1300, 2900, 400, 800, 2, 3],
  ['Visual Studio Code', null, '1.95', 590, 780, 1, 365],
  ['VLC', null, '3.0.21', 180, 2, 130, 900],
  ['Telegram', null, '11.4', 210, 1600, 30, 200],
  ['Figma', null, '124.6', 420, 310, null, 95],
] : [
  ['Google Chrome', 'Google LLC', '131.0.6778.86', 507, 0, 0, 400, 0, 0, true],
  ['Spotify', 'Spotify AB', '1.2.50', 448, 0, 6, 600, 3, 1],
  ['Zoom Workplace', 'Zoom Video Communications', '6.2.0', 310, 0, 210, 500],
  ['Adobe Acrobat (64-bit)', 'Adobe', '24.004', 1280, 0, 260, 720],
  ['Discord', 'Discord Inc.', '1.0.9170', 119, 0, 20, 300, 1, 0],
  ['Microsoft Teams classic', 'Microsoft Corporation', '1.7.00', 1300, 0, 400, 800, 2, 4],
  ['Steam', 'Valve Corporation', '2.10.91', 1840, 0, 27, 900],
  ['VLC media player', 'VideoLAN', '3.0.21', 180, 0, 130, 900],
  ['pgAdmin 4 version 9.11', 'The pgAdmin Development Team', '9.11', 793, 0, 204, 220],
  ['Microsoft Visual C++ 2015-2022 Redistributable (x64)', 'Microsoft Corporation', '14.40', 42, 0, null, 500, 0, 0, false, true],
  ['Telegram Desktop', 'Telegram FZ-LLC', '5.8', 202, 0, null, 150],
  ['WhatsApp', null, '2.2450', 360, 120, 2, 300, 0, 0, false, false, 'store'],
  ['Solitaire & Casual Games', null, '4.21', 81, 4, null, 900, 0, 0, false, false, 'store'],
];
let APPS = APPS_SRC.map(([name, publisher, version, mb, data, used, inst, crashes = 0, hangs = 0, running = false, system = false, kind]) => ({
  id: MAC_MOCK ? `/Applications/${name}.app` : kind === 'store' ? `appx:${name.replace(/\W/g, '')}_1.0.0.0_arm64__8wekyb3d8bbwe` : `reg:1:{${name.replace(/\W/g, '')}}`,
  name, publisher, version, size: mb * MB, data: data * MB, installed: now - inst * DAY, lastUsed: used == null ? null : now - used * DAY,
  crashes, hangs, kind: MAC_MOCK ? 'mac' : kind ?? 'app', icon: null, running, system,
}));
if (WORST) APPS = [...APPS, { id: 'reg:1:{long}', name: 'Northwind Industries Holdings — Portail Fournisseurs (édition entreprise, déploiement par machine) x64 FR', publisher: 'Northwind Industries Holdings International Software Division', version: '2026.10.31.4471-preview+build.88213', size: 1.24e12, data: 0, installed: now - 2000 * DAY, lastUsed: now - 1900 * DAY, crashes: 148, hangs: 37, kind: 'app', icon: null, running: false, system: false }];
let STARTUP = MAC_MOCK ? [
  { id: '~/Library/LaunchAgents/com.spotify.webhelper.plist', name: 'com.spotify.webhelper', command: '/Applications/Spotify.app/Contents/MacOS/SpotifyWebHelper', enabled: true, editable: true, scope: 'user', icon: null },
  { id: '/Library/LaunchAgents/us.zoom.updater.plist', name: 'us.zoom.updater', command: '/Library/Application Support/zoom.us/ZoomUpdater', enabled: true, editable: true, scope: 'machine', icon: null },
  { id: '/Library/LaunchAgents/com.adobe.ARMDCHelper.plist', name: 'com.adobe.ARMDCHelper', command: '/Library/Application Support/Adobe/ARMDC/ARMDCHelper', enabled: false, editable: true, scope: 'machine', icon: null },
  { id: '/Library/LaunchDaemons/com.microsoft.autoupdate.helper.plist', name: 'com.microsoft.autoupdate.helper', command: '/Library/Application Support/Microsoft/MAU2.0/Microsoft AutoUpdate.app/Contents/MacOS/Microsoft Update Assistant.app', enabled: true, editable: false, scope: 'machine', icon: null },
] : [
  { id: 'run:Spotify', name: 'Spotify', command: `"${USER}\\AppData\\Roaming\\Spotify\\Spotify.exe" --autostart --minimized`, enabled: true, editable: true, scope: 'user', icon: null },
  { id: 'run:Discord', name: 'Discord', command: `"${USER}\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe`, enabled: true, editable: true, scope: 'user', icon: null },
  { id: 'run:Steam', name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', enabled: false, editable: true, scope: 'user', icon: null },
  { id: 'folder:Send to OneNote.lnk', name: 'Send to OneNote', command: `${USER}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Send to OneNote.lnk`, enabled: true, editable: true, scope: 'user', icon: null },
  { id: 'hklm:SecurityHealth', name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe', enabled: true, editable: false, scope: 'machine', icon: null },
];
let UPDATES = MAC_MOCK ? null : [
  { id: 'Spotify.Spotify', name: 'Spotify', version: '1.2.50', available: '1.2.52' },
  { id: 'VideoLAN.VLC', name: 'VLC media player', version: '3.0.21', available: '3.0.23' },
  { id: 'Git.Git', name: 'Git', version: '2.52.0', available: '2.56.0.4' },
  { id: 'Microsoft.VisualStudioCode', name: 'Microsoft Visual Studio Code (User)', version: '1.94.0', available: '1.95.1' },
];

// cartographie factice : chaque dossier se partage la taille que son parent lui a donnée
const SPACE_SEP = MAC_MOCK ? '/' : '\\';
const SPACE_HOME = MAC_MOCK ? '/Users/nico' : USER;
const spaceKnown = new Map([[SPACE_HOME, 260e9], [MAC_MOCK ? '/Applications' : 'C:\\', MAC_MOCK ? 38e9 : 452e9], ['G:\\', 800e9]]);
const DIRS = ['AppData', 'Desktop', 'Documents', 'Videos', 'Pictures', 'Downloads', 'Music', '.cargo', '.gradle', 'node_modules', 'Projets', 'Sauvegardes', 'Library', 'Caches', 'Steam', 'Jeux'];
const FILES = ['film-vacances.mkv', 'sauvegarde-2025.zip', 'Windows11.vhdx', 'photos-2024.tar', 'dataset.parquet', 'notes.md', 'rapport.pdf'];
function spaceList(p) {
  const total = spaceKnown.get(p) ?? 1e9;
  const depth = p.split(SPACE_SEP).filter(Boolean).length;
  const n = WORST ? 400 : 5 + Math.floor(h(p) * 12);
  const ws = Array.from({ length: n }, (_, i) => Math.pow(h(p + i), 1.6) + 0.01);
  const sum = ws.reduce((a, b) => a + b, 0);
  const entries = ws.map((w, i) => {
    const dir = depth < 6 && i % 4 !== 3;
    const name = dir ? DIRS[Math.floor(h(p + 'd' + i) * DIRS.length)] + (i >= DIRS.length ? ` ${i}` : '') : FILES[Math.floor(h(p + 'f' + i) * FILES.length)].replace('.', `-${i}.`);
    const path = p.endsWith(SPACE_SEP) ? p + name : p + SPACE_SEP + name;
    const size = Math.round((total * w) / sum);
    if (dir) spaceKnown.set(path, size);
    return { name, path, size, files: dir ? Math.round(size / 2e6) + 1 : 1, isDir: dir, package: MAC_MOCK && dir && name === 'Library' };
  }).filter((e, i, a) => a.findIndex((x) => x.path === e.path) === i).sort((a, b) => b.size - a.size);
  const shown = entries.slice(0, 150), tail = entries.slice(150);
  return { path: p, size: entries.reduce((n, e) => n + e.size, 0), files: entries.reduce((a, e) => a + e.files, 0), entries: shown, rest: tail.reduce((a, e) => a + e.size, 0), restCount: tail.length };
}

const LIB = '/Users/nico/Library';
let LEFTOVERS = [
  { id: 'com.skype.skype', size: 1.9e9, paths: [LIB + '/Application Support/com.skype.skype', LIB + '/Caches/com.skype.skype', LIB + '/Preferences/com.skype.skype.plist'] },
  { id: 'com.tinyspeck.slackmacgap', size: 840e6, paths: [LIB + '/Containers/com.tinyspeck.slackmacgap'] },
  { id: 'org.videolan.vlc', size: 12e6, paths: [LIB + '/Preferences/org.videolan.vlc.plist', LIB + '/Saved Application State/org.videolan.vlc.savedState'] },
];
const appMethods = {
  async space({ path: p }) {
    if (!p) return { roots: MAC_MOCK ? [{ label: 'Dossier personnel', path: SPACE_HOME }, { label: 'Applications', path: '/Applications' }] : [{ label: 'Dossier personnel', path: SPACE_HOME }, { label: 'C:', path: 'C:\\' }, { label: 'G:', path: 'G:\\' }] };
    if (busy) throw new Error('une analyse ou un nettoyage est déjà en cours');
    busy = true; cancelled = false;
    try {
      const l = spaceList(p);
      const steps = Math.min(l.entries.length, 12);
      for (let i = 0; i < steps; i++) {
        await scaled(spaceKnown.has(p + '#vu') ? 5 : 160);
        if (cancelled) throw new Error('analyse annulée');
        send({ event: 'progress', data: { phase: 'space', done: i + 1, total: steps, label: l.entries[i].name } });
      }
      spaceKnown.set(p + '#vu', 1);
      return l;
    } finally { busy = false; }
  },
  async 'apps.leftovers'() {
    if (!MAC_MOCK) throw new Error('disponible sur macOS seulement');
    await scaled(1200);
    return LEFTOVERS;
  },
  async 'apps.trashLeftovers'({ ids }) {
    const gone = LEFTOVERS.filter((g) => ids.includes(g.id));
    if (!gone.length) throw new Error('rien à envoyer à la Corbeille : actualise la liste');
    await scaled(600);
    LEFTOVERS = LEFTOVERS.filter((g) => !ids.includes(g.id)); // factice : rien n'est déplacé
    return { removed: gone.reduce((n, g) => n + g.paths.length, 0), left: [] };
  },
  apps: async () => { await scaled(900); return { apps: APPS, tracking: true }; },
  startup: async () => { await scaled(150); return STARTUP; },
  async 'startup.set'({ id, enabled }) {
    const s = STARTUP.find((x) => x.id === id);
    if (!s) throw new Error('élément introuvable');
    if (!s.editable) throw new Error('élément commun à tous les utilisateurs : à régler depuis le Gestionnaire des tâches');
    STARTUP = STARTUP.map((x) => (x.id === id ? { ...x, enabled } : x));
    return { enabled };
  },
  async 'apps.uninstall'({ id }) {
    const a = APPS.find((x) => x.id === id);
    if (!a) throw new Error('appli introuvable : actualise la liste');
    if (MAC_MOCK && a.running) throw new Error(`${a.name} est ouverte : quitte-la d'abord`);
    await scaled(700);
    APPS = APPS.filter((x) => x.id !== id); // factice : rien n'est désinstallé nulle part
    return MAC_MOCK ? { removed: 6, left: [] } : a.kind === 'store' ? { removed: true } : { launched: true };
  },
  async 'apps.reset'({ id }) {
    const a = APPS.find((x) => x.id === id);
    if (!MAC_MOCK || !a) throw new Error('réinitialisation disponible sur macOS seulement');
    if (a.running) throw new Error(`${a.name} est ouverte : quitte-la d'abord`);
    await scaled(500);
    APPS = APPS.map((x) => (x.id === id ? { ...x, data: 0 } : x));
    return { removed: 4, left: [] };
  },
  async updates() {
    if (!UPDATES) throw new Error("pas de gestionnaire de mises à jour commun sur macOS : l'App Store et chaque appli s'en chargent");
    await scaled(1500);
    return UPDATES;
  },
  async 'updates.install'({ id }) {
    if (!UPDATES?.some((u) => u.id === id)) throw new Error('mise à jour inconnue : actualise la liste');
    await scaled(2500);
    if (id === 'Git.Git') throw new Error('Le programme d’installation a échoué avec le code de sortie 1603');
    UPDATES = UPDATES.filter((u) => u.id !== id);
    return { updated: true };
  },
};

const methods = {
  hello: async () => ({ version: '0.1.0-mock', dataDir: 'C:\\mock', drives }),
  drives: async () => drives,
  cancel: async () => { cancelled = true; return true; },
  async scan() {
    if (busy) throw new Error('une analyse ou un nettoyage est déjà en cours');
    busy = true; cancelled = false;
    try {
      const out = [];
      for (let i = 0; i < RULES.length; i++) {
        await scaled(140 + h(RULES[i].id) * 260);
        if (cancelled && !process.env.KC_MOCK_STALL) throw new Error('analyse annulée'); // STALL : lecture bloquée qui ne voit pas l'annulation
        const s = summary(RULES[i]);
        out.push(s);
        send({ event: 'progress', data: { phase: 'scan', done: i + 1, total: RULES.length, label: s.title } });
        send({ event: 'rule', data: s });
      }
      scans = out;
      return { rules: out, drives, at: Date.now(), settings };
    } finally { busy = false; }
  },
  async items({ rule, offset = 0, limit = 200 }) {
    const r = RULES.find((x) => x.id === rule);
    if (!r || !scans) throw new Error('règle inconnue ou analyse périmée');
    const all = itemsFor(r, 1000).map((it, index) => ({ ...it, index }));
    return { total: all.length, items: all.slice(offset, offset + Math.min(limit, 1000)) };
  },
  async clean({ picks }) {
    if (busy) throw new Error('une analyse ou un nettoyage est déjà en cours');
    if (!scans) throw new Error('aucune analyse récente : relance une analyse');
    busy = true;
    const mine = scans; scans = null;
    try {
      const rep = { freed: 0, deleted: 0, skipped: 0, recycled: 0, diskGain: 0, byRule: {}, tasks: [], elevation: null };
      for (let n = 0; n < picks.length; n++) {
        const s = mine.find((x) => x.id === picks[n].rule);
        if (!s) continue;
        send({ event: 'progress', data: { phase: 'clean', done: n, total: picks.length, label: s.title, freed: rep.freed } });
        await scaled(250 + Math.min(1200, s.size / 8e6));
        if (s.needsAdmin) { rep.tasks.push({ task: s.id, ok: true, error: null, stats: { freed: s.size, deleted: 40, skipped: 0 } }); rep.freed += s.size; continue; }
        const chosen = s.perItem ? s.items.filter((_, i) => (picks[n].all ? !picks[n].except?.includes(i) : picks[n].only?.includes(i))) : null;
        const freed = chosen ? chosen.reduce((a, i) => a + i.size, 0) : s.size;
        const st = { freed, deleted: chosen ? chosen.length : Math.round(s.count * 0.97), skipped: chosen ? 0 : Math.round(s.count * 0.03) };
        if (s.toRecycle) rep.recycled += st.deleted;
        rep.freed += st.freed; rep.deleted += st.deleted; rep.skipped += st.skipped;
        rep.byRule[s.id] = st;
      }
      send({ event: 'progress', data: { phase: 'clean', done: picks.length, total: picks.length, label: 'Mesure du disque', freed: rep.freed } });
      await scaled(500);
      rep.diskGain = Math.round(rep.freed * 0.97);
      drives = drives.map((d, i) => (i === 0 ? { ...d, free: d.free + rep.diskGain } : d));
      const byCat = {};
      for (const s of mine) if (rep.byRule[s.id]) byCat[s.cat] = (byCat[s.cat] ?? 0) + rep.byRule[s.id].freed;
      if (rep.tasks.length) byCat.admin = rep.tasks.reduce((a, t) => a + t.stats.freed, 0);
      history = [...history, { at: Date.now(), freed: rep.freed, diskGain: rep.diskGain, deleted: rep.deleted, skipped: rep.skipped, recycled: rep.recycled, byCat }];
      return rep;
    } finally { busy = false; }
  },
  'settings.get': async () => settings,
  'settings.set': async (s) => (settings = { ...settings, ...s }),
  'ignore.add': async ({ path: p }) => { if (!/^[A-Za-z]:\\/.test(p)) throw new Error('chemin invalide'); if (!settings.ignore.includes(p)) settings.ignore = [...settings.ignore, p]; return settings; },
  'ignore.remove': async ({ path: p }) => { settings.ignore = settings.ignore.filter((x) => x.toLowerCase() !== p.toLowerCase()); return settings; },
  history: async () => history,
  ...appMethods,
};

send({ event: 'ready', data: { version: '0.1.0-mock' } });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch (e) { return send({ event: 'error', data: `requête illisible : ${e.message}` }); }
  const m = methods[req.method];
  if (!m) return send({ id: req.id, error: `méthode inconnue : ${req.method}` });
  try { send({ id: req.id, result: await m(req.params ?? {}) }); } catch (e) { send({ id: req.id, error: e.message }); }
}).on('close', () => process.exit(0));
