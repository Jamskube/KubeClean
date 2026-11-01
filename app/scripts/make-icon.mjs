// Renders build/icon.png (1024 px) and public/icon.png (256 px): the kit's
// broom-sparkles glyph on a rounded dark tile. Run: node scripts/make-icon.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const sprite = fs.readFileSync(path.join(app, 'public', 'kube', 'icons', 'kube-icons.svg'), 'utf8');
const glyph = sprite.match(/<symbol id="broom-sparkles"[^>]*>([\s\S]*?)<\/symbol>/)[1];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a2e"/><stop offset="1" stop-color="#0f0f11"/></linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#bg)"/>
  <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#glow)"/>
  <rect x="40" y="40" width="944" height="944" rx="216" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="8"/>
  <g transform="translate(224 224) scale(24)" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;
fs.mkdirSync(path.join(app, 'build'), { recursive: true });
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
const page = path.join(app, 'build', 'icon-src.html');
fs.writeFileSync(page, html);

const driver = `
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, backgroundColor: '#00000000', frame: false, webPreferences: { offscreen: true } });
  await w.loadFile(${JSON.stringify(page)});
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(${JSON.stringify(path.join(app, 'build', 'icon.png'))}, img.toPNG());
  fs.writeFileSync(${JSON.stringify(path.join(app, 'public', 'icon.png'))}, img.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  app.quit();
});
`;
const driverPath = path.join(app, 'build', 'icon-driver.mjs');
fs.writeFileSync(driverPath, driver);
const electron = path.join(app, 'node_modules', 'electron', 'dist', 'electron.exe');
spawn(electron, [driverPath], { stdio: 'inherit' }).on('exit', (c) => {
  fs.rmSync(driverPath, { force: true });
  fs.rmSync(page, { force: true });
  console.log(c === 0 ? 'icon written: build/icon.png, public/icon.png' : `electron exited ${c}`);
  process.exit(c ?? 0);
});
