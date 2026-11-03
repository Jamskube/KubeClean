// Screenshot harness. Runs the app on the MOCK core (never touches the disk),
// walks a list of steps, saves PNGs. Usage (from app/):
//   node scripts/shot.mjs out-dir [steps...]
// Steps (comma or space separated): a view name (dashboard, clean, projects,
// files, history, settings) → click its nav row, wait, shoot; "wait:scan" → wait
// until the first scan is done; "click:<css selector>"; "theme:light|dark";
// "sleep:<ms>"; "shot:<name>"; "size:WxH"; "doclean" → open confirm via the
// primary header button, confirm it (MOCK ONLY: nothing is deleted), wait for
// the result view. Default steps: wait:scan dashboard clean projects files
// history settings.
// « assert:<expression JS sans espace> » : échoue avec un code non nul si faux.
// « hover:<sélecteur> », « key:Escape », « scroll:<pixels> » : interactions de la coque.
// « fill:<sélecteur>=<texte> » : saisie dans un champ (sans espace dans l’étape).
// « css:<fichier> » : injecte une feuille (ex. un faux bureau derrière le verre, KC_PLATFORM=darwin).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const out = path.resolve(process.argv[2] ?? path.join(app, 'shots'));
const steps = (process.argv.slice(3).join(' ').trim() || 'wait:scan dashboard clean projects files history settings').split(/[\s,]+/);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'userdata'), { recursive: true });

// KC_REAL=1 runs the real engine instead of the mock: scan and navigation only,
// the "doclean" step is refused (nothing on this machine is ever cleaned by the harness).
const REAL = !!process.env.KC_REAL;
const driver = `
const REAL = ${REAL};
import { app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const OUT = ${JSON.stringify(out)};
const STEPS = ${JSON.stringify(steps)};
app.setPath('userData', path.join(OUT, 'userdata'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  wc.on('console-message', (e) => { if (e.level >= 2) console.log('[console]', e.message); });
  wc.once('did-finish-load', async () => {
    const js = (s) => wc.executeJavaScript(s);
    let n = 0;
    const shot = async (name) => { await wait(250); fs.writeFileSync(path.join(OUT, String(++n).padStart(2, '0') + '-' + name + '.png'), (await wc.capturePage()).toPNG()); console.log('shot', name); };
    const until = async (expr, ms = 60000) => { for (let t = 0; t < ms; t += 200) { if (await js(expr)) return true; await wait(200); } throw new Error('Délai dépassé : ' + expr); };
    try {
      await wait(800);
      for (const step of STEPS) {
        const [k, v] = step.includes(':') ? [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)] : [step, ''];
        if (k === 'wait' && v === 'scan') { await until("document.querySelector('.k-app')?.dataset.scanned === 'true'", REAL ? 300000 : 60000); await wait(900); }
        else if (k === 'click') { console.log('click', v, await js('(() => { const el = document.querySelector(' + JSON.stringify(v) + '); if (!el) return false; el.click(); return true; })()')); await wait(700); }
        else if (k === 'theme') { nativeTheme.themeSource = v; await js('document.documentElement.setAttribute("data-theme", ' + JSON.stringify(v) + ')'); await wait(500); }
        else if (k === 'sleep') await wait(Number(v));
        else if (k === 'fill') {
          const cut = v.lastIndexOf('=');
          const selector = v.slice(0, cut), value = v.slice(cut + 1);
          await js('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) throw new Error("Champ introuvable"); el.focus(); el.select(); })()');
          await wc.insertText(value); await wait(300);
        }
        else if (k === 'hover') {
          const point = await js('(() => { const el = document.querySelector(' + JSON.stringify(v) + '); if (!el) throw new Error("Élément introuvable"); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()');
          wc.sendInputEvent({ type: 'mouseMove', ...point }); await wait(700);
        }
        else if (k === 'key') { const keyCode = v.replace(/^Arrow/, ''); wc.sendInputEvent({ type: 'keyDown', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode }); await wait(500); }
        else if (k === 'scroll') { await js('document.querySelector(".k-pane__scroll").scrollTop = ' + Number(v)); await wait(500); }
        else if (k === 'assert') { if (!await js(v)) throw new Error('Assertion échouée : ' + v); console.log('assert ok', v); }
        else if (k === 'probe') console.log('probe', await js(\`(() => { const col = document.querySelector('.kc-column'); const app = document.querySelector('.k-app'); return JSON.stringify({ view: app?.dataset.view, busy: app?.dataset.busy, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className), colOpacity: col && getComputedStyle(col).opacity, colCount: document.querySelectorAll('.kc-column').length, overlays: [...document.querySelectorAll('.kc-running, .k-scrim, [data-kube-scroll-lock]')].map((e) => e.className) }); })()\`));
        else if (k === 'shot') await shot(v);
        else if (k === 'css') { await wc.insertCSS(fs.readFileSync(v, 'utf8')); await wait(300); }
        else if (k === 'size') { const [w, h] = v.split('x').map(Number); win.setSize(w, h); await wait(600); }
        else if (k === 'doclean' && REAL) console.log('doclean refused: real engine');
        else if (k === 'doclean') {
          console.log('open confirm', await js("(() => { const b = document.querySelector('[data-action=\\"clean\\"]'); if (!b || b.disabled) return false; b.click(); return true; })()"));
          await wait(900); await shot('confirm');
          console.log('confirm', await js("(() => { const b = document.querySelector('dialog[open] [data-action=\\"confirm\\"]'); if (!b) return false; b.click(); return true; })()"));
          await wait(1500); await shot('cleaning');
          await until("document.querySelector('.k-app')?.dataset.view === 'result'", 120000); await wait(1200); await shot('result');
        }
        else { console.log('nav', k, await js("(() => { const b = document.querySelector('button[data-rail-view=\\"" + k + "\\"]'); if (!b) return false; b.click(); return true; })()")); await wait(900); await shot(k); }
      }
    } catch (e) { console.error('Erreur du harnais', e); app.exit(1); return; }
    app.quit();
  });
});
await import(pathToFileURL(${JSON.stringify(path.join(app, 'electron', 'main.mjs'))}).toString());
`;
const driverPath = path.join(out, 'userdata', 'driver.mjs');
fs.writeFileSync(driverPath, driver);
const electron = path.join(app, 'node_modules', 'electron', 'dist', 'electron.exe');
const p = spawn(electron, ['--force-device-scale-factor=1', driverPath], { stdio: 'inherit', env: { ...process.env, ...(REAL ? {} : { KC_MOCK: '1', KC_MOCK_SPEED: process.env.KC_MOCK_SPEED ?? '0.3' }) } });
p.on('exit', (c) => { console.log('done, shots in', out); process.exit(c ?? 0); });
