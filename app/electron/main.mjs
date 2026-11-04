// Electron main: window, app:// protocol, and the bridge to the Rust core.
// All file-system work happens in kubeclean-core.exe; this file only relays.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', 'dist');
const MAC = process.platform === 'darwin';
// KC_PLATFORM=darwin with KC_MOCK: the Mac interface on the fake core, for captures on Windows
const PLATFORM = (process.env.KC_MOCK && process.env.KC_PLATFORM) || process.platform;
const CORE_NAME = MAC ? 'kubeclean-core' : 'kubeclean-core.exe';
const CORE = app.isPackaged
  ? path.join(process.resourcesPath, CORE_NAME)
  : path.join(here, '..', '..', 'core', 'target', 'release', CORE_NAME);
const ORIGIN = 'app://kubeclean';
const METHODS = new Set(['hello', 'drives', 'scan', 'cancel', 'items', 'clean', 'settings.get', 'settings.set', 'ignore.add', 'ignore.remove', 'history']);

if (!app.requestSingleInstanceLock()) app.quit(); // two engines cleaning the same disk: never
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win = null;

// ---------- core process ----------
let core = null;
const pending = new Map();
const methods = new Map(); // id -> method, to know whether a scan is still running
let nextId = 0;
let stopping = false; // engine killed on purpose to end a stuck scan

function startCore() {
  // KC_MOCK=1: fake core for UI work (scripts/mock-core.mjs), touches no file
  const p = process.env.KC_MOCK
    ? spawn(process.execPath, [path.join(here, '..', 'scripts', 'mock-core.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    : spawn(CORE, ['--data-dir', app.getPath('userData')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.event) return win?.webContents.send('core-event', m);
    const h = pending.get(m.id);
    pending.delete(m.id);
    methods.delete(m.id);
    h?.(m.error !== undefined ? { error: m.error } : { result: m.result });
  });
  const gone = (why) => {
    if (core !== p) return;
    core = null;
    const killed = stopping;
    stopping = false;
    for (const h of pending.values()) h({ error: killed ? 'analyse annulée' : `le moteur s'est arrêté (${why})` });
    pending.clear();
    methods.clear();
    if (!killed) win?.webContents.send('core-event', { event: 'core-exit', data: why });
  };
  p.on('exit', (code) => gone(`code ${code}`));
  p.on('error', (e) => gone(e.message));
  return p;
}

function call(method, params) {
  core ??= startCore();
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    methods.set(id, method);
    core.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n');
  });
}

// ---------- IPC (only from our own page) ----------
const fromApp = (e) => e.senderFrame?.url.startsWith(ORIGIN + '/');
const isAbs = (p) => typeof p === 'string' && path.isAbsolute(p) && !p.split(/[\\/]/).includes('..');

ipcMain.handle('core', (e, method, params) => {
  if (!fromApp(e) || !METHODS.has(method)) return { error: 'appel refusé' };
  // a folder read can block in the kernel (macOS waits on its permission prompt) and never see the
  // cancel flag: a scan changes nothing on disk, so ending the engine is safe. Never during a clean.
  if (method === 'cancel') {
    const scans = [...methods].filter(([, m]) => m === 'scan').map(([id]) => id); // only the scans running now
    setTimeout(() => {
      const running = [...methods.values()];
      if (core && scans.some((id) => methods.has(id)) && !running.includes('clean')) { stopping = true; core.kill('SIGKILL'); }
    }, 3000);
  }
  return call(method, params);
});
ipcMain.handle('reveal', (e, p) => {
  if (fromApp(e) && isAbs(p) && fs.existsSync(p)) shell.showItemInFolder(p);
});
// unpackaged, app.getVersion() is Electron's own version: read ours from package.json
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
ipcMain.handle('app-version', () => APP_VERSION);
ipcMain.handle('pick-folder', async (e) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Dossier de projets' });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- window ----------
// Mica (Windows 11 22H2+, build 22621), dark theme only, like Doku: the DWM paints it
// under the transparent chrome (title bar, sidebar); content panes stay opaque.
const MICA_OK = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
const mica = () => MICA_OK && nativeTheme.shouldUseDarkColors && !process.env.KC_MOCK;
// macOS: the sidebar vibrancy material in both themes, under the same transparent chrome
// Mac preview on Windows: acrylic blurs the desktop like macOS vibrancy does
const material = () => (mica() ? 'mica' : PLATFORM === 'darwin' && MICA_OK ? 'acrylic' : 'none');
const backdrop = () => (PLATFORM === 'darwin' ? 'glass' : mica() ? 'mica' : 'none');
// the caption buttons sit straight on the header under Mica, and in the Mac preview (KC_PLATFORM=darwin)
// whose glass header a solid button strip would interrupt
const overlay = () => {
  const dark = nativeTheme.shouldUseDarkColors;
  const clear = mica() || PLATFORM === 'darwin';
  return { color: clear ? '#00000000' : dark ? '#212121' : '#ededed', symbolColor: dark ? '#ffffff' : '#000000', height: 44 };
};

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 880, minHeight: 560,
    title: 'KubeClean',
    icon: path.join(DIST, 'icon.png'),
    ...(MAC
      // traffic lights centred in the 44px title bar
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 15 }, vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
      // set before the first show: applied later, the DWM can keep an opaque backdrop
      : { backgroundColor: overlay().color, backgroundMaterial: material(), titleBarStyle: 'hidden', titleBarOverlay: overlay() }),
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (!MAC) win.removeMenu(); // macOS keeps its app menu: Quit, Copy, Paste
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (!cleaning) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Continuer le nettoyage', 'Quitter quand même'], defaultId: 0, cancelId: 0,
      title: 'Nettoyage en cours', message: 'Un nettoyage est en cours.',
      detail: "Quitter l'arrête proprement : ce qui reste est laissé en place, rien n'est abîmé.",
    });
    if (choice === 0) e.preventDefault();
  });
  win.loadURL(`${ORIGIN}/index.html`);
}

let cleaning = false;
ipcMain.on('cleaning', (e, on) => { if (fromApp(e)) cleaning = !!on; });
// the page owns the theme choice; the native window buttons follow it
ipcMain.on('theme', (e, t) => { if (fromApp(e) && ['system', 'light', 'dark'].includes(t)) nativeTheme.themeSource = t; });
ipcMain.handle('backdrop', () => backdrop());
// not secret, and read by the preload before the frame URL is final
ipcMain.on('platform', (e) => { e.returnValue = PLATFORM; });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url);
    const file = path.join(DIST, decodeURIComponent(pathname));
    const rel = path.relative(DIST, file);
    if (host !== 'kubeclean' || rel.startsWith('..') || path.isAbsolute(rel)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  nativeTheme.on('updated', () => {
    if (!win) return;
    if (!MAC) {
      win.setBackgroundMaterial(material());
      win.setBackgroundColor(overlay().color);
      win.setTitleBarOverlay(overlay());
    }
    win.webContents.send('backdrop', backdrop());
  });
  // the default macOS menu is in English: same roles, French labels
  if (MAC) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'KubeClean', submenu: [{ role: 'about', label: 'À propos de KubeClean' }, { type: 'separator' }, { role: 'hide', label: 'Masquer KubeClean' }, { role: 'hideOthers', label: 'Masquer les autres' }, { role: 'unhide', label: 'Tout afficher' }, { type: 'separator' }, { role: 'quit', label: 'Quitter KubeClean' }] },
    { label: 'Édition', submenu: [{ role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' }, { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Fenêtre', submenu: [{ role: 'minimize', label: 'Réduire' }, { role: 'zoom', label: 'Zoom' }, { type: 'separator' }, { role: 'close', label: 'Fermer la fenêtre' }] },
  ]));
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => core?.stdin.end()); // the core cancels and exits when stdin closes
