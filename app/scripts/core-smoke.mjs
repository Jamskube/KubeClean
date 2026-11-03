// Analyse RÉELLE par le moteur, sans interface : vérifie le protocole et les règles de la
// plateforme. Lecture seule : n'appelle jamais `clean`.
// Usage (depuis app/) : node scripts/core-smoke.mjs <moteur> [dossier de données]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const [core, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-smoke-'))] = process.argv.slice(2);
if (!core) {
  console.error('Usage : node scripts/core-smoke.mjs <moteur> [dossier de données]');
  process.exit(2);
}
const p = spawn(core, ['--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (id, method) => p.stdin.write(JSON.stringify({ id, method, params: {} }) + '\n');
let ok = false;
const timer = setTimeout(() => { console.error('Délai dépassé : analyse non terminée en 5 min'); p.kill(); }, 300_000);

readline.createInterface({ input: p.stdout }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.event === 'ready') { send(1, 'hello'); send(2, 'scan'); }
  else if (m.id === 1) console.log('hello', JSON.stringify(m.result));
  else if (m.id === 2) {
    clearTimeout(timer);
    if (m.error) console.error('Analyse en échec :', m.error);
    else {
      const mo = (b) => (b / 1e6).toFixed(1).padStart(9);
      for (const r of m.result.rules) {
        console.log(`${r.cat.padEnd(9)} ${r.id.padEnd(18)} ${String(r.count).padStart(7)} élém. ${mo(r.size)} Mo${r.sizeKnown ? '' : ' (taille inconnue)'}${r.blockedBy.length ? ' · ouvert : ' + r.blockedBy.join(', ') : ''}`);
      }
      console.log(`${m.result.rules.length} règles · ${mo(m.result.rules.reduce((a, r) => a + r.size, 0))} Mo repérés`);
      ok = m.result.rules.length > 0;
    }
    p.stdin.end(); // le moteur s'arrête quand stdin se ferme
  }
});
p.on('exit', (code) => process.exit(ok && code === 0 ? 0 : 1));
