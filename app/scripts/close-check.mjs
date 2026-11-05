// KC_MOCK=1 KC_MOCK_SPEED=3 npx electron scripts/close-check.mjs electron/main.mjs
// ferme la fenêtre en pleine analyse, puis garde le processus 3 s en vie (comme macOS pendant l'arrêt) :
// rend 3 si une exception non rattrapée survient
import { app, BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e.message); process.exit(3); });
await import(pathToFileURL(process.argv.at(-1)).href);
let held = false;
app.on('before-quit', (e) => { if (held) return; held = true; e.preventDefault(); setTimeout(() => { console.log('aucune exception'); app.exit(0); }, 3000); });
app.whenReady().then(() => setTimeout(() => { console.log('fermeture'); BrowserWindow.getAllWindows()[0].close(); }, 2500));
