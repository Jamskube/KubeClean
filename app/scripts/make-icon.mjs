// Décline le modèle 13 en PNG et ICO multi-résolution pour Windows.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const source = fs.readFileSync(path.join(app, 'build', 'icon-master.png')).toString('base64');
fs.mkdirSync(path.join(app, 'build'), { recursive: true });
// Le motif détouré repose sur une tuile blanche uniforme, au contour géométrique net.
const html = `<!doctype html><html><head><style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}img{display:block;width:1024px;height:1024px;background:#fff;clip-path:inset(5.3% round 17%)}</style></head><body><img src="data:image/png;base64,${source}" /></body></html>`;
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
  const pixels = img.toBitmap();
  let minimum = 255;
  for (let y = 464; y < 560; y++) for (let x = 464; x < 560; x++) {
    const i = (y * 1024 + x) * 4;
    minimum = Math.min(minimum, pixels[i], pixels[i + 1], pixels[i + 2]);
    if (pixels[i + 3] !== 255) throw new Error('La tuile doit être opaque au centre.');
  }
  if (minimum < 253) throw new Error('Une tache subsiste au centre : niveau de blanc ' + minimum + '/255.');
  console.log('Centre vérifié : blanc ' + minimum + '–255, opaque.');
  fs.writeFileSync(${JSON.stringify(path.join(app, 'build', 'icon.png'))}, img.toPNG());
  fs.writeFileSync(${JSON.stringify(path.join(app, 'public', 'icon.png'))}, img.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = sizes.map((size) => img.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[i].length;
  });
  fs.writeFileSync(${JSON.stringify(path.join(app, 'build', 'icon.ico'))}, Buffer.concat([header, ...frames]));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
`;
const driverPath = path.join(app, 'build', 'icon-driver.mjs');
fs.writeFileSync(driverPath, driver);
const electron = path.join(app, 'node_modules', 'electron', 'dist', 'electron.exe');
spawn(electron, ['--force-device-scale-factor=1', driverPath], { stdio: 'inherit' }).on('exit', (c) => {
  fs.rmSync(driverPath, { force: true });
  fs.rmSync(page, { force: true });
  console.log(c === 0 ? 'Icônes générées : build/icon.png, build/icon.ico, public/icon.png' : `Electron terminé avec le code ${c}`);
  process.exit(c ?? 0);
});
