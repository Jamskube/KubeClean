// node selftest.mjs : exits non-zero if any safety or matching rule breaks.
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maskTest, isUnder, resolvePaths, scanRule, cleanItems, scanProjects } from './engine.mjs';

const T = await fsp.mkdtemp(path.join(os.tmpdir(), 'kubeclean-test-'));
const j = (...p) => path.join(T, ...p);
const write = async (p, data = 'x') => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, data); };
const exists = (p) => fsp.lstat(p).then(() => true, () => false);
const FUTURE = Date.now() + 30 * 86400000; // "now" for scans: every file is 30 days old

try {
  // pure helpers
  const m = maskTest('*.dmp;thumbcache_*.db');
  assert.ok(m('a.DMP') && m('thumbcache_32.db') && !m('a.dmpx'));
  assert.ok(isUnder('C:\\a\\b\\c', 'C:\\a\\b') && !isUnder('C:\\a\\bc', 'C:\\a\\b') && !isUnder('C:\\a\\b', 'C:\\a\\b'));

  // wildcard segments
  await write(j('ud', 'Default', 'Cache', 'f1'), '1234');
  await write(j('ud', 'Profile 1', 'Cache', 'f2'), '12');
  await write(j('ud', 'Other', 'nocache.txt'));
  const rp = await resolvePaths(j('ud', '*', 'Cache'));
  assert.equal(rp.length, 2);

  // a junction pointing outside the cleaned tree: never listed, never deleted through
  await write(j('outside', 'keep.txt'), 'precious');
  await write(j('tmp', 'old.log'), 'old');
  await write(j('tmp', 'sub', 'old2.tmp'), 'old');
  await write(j('tmp', 'fresh.txt'), 'new');
  await write(j('tmp', 'skipme', 'x.bin'), 'x');
  await fsp.utimes(j('tmp', 'fresh.txt'), new Date(FUTURE), new Date(FUTURE)); // touched "after" now
  await fsp.symlink(j('outside'), j('tmp', 'link'), 'junction');

  const rule = { id: 't', kind: 'files', paths: [j('tmp')], depth: 10, olderThanDays: 7, exclude: '*.tmp', excludeDirs: [j('tmp', 'skipme')] };
  const scan = await scanRule(rule, { now: FUTURE });
  const names = scan.items.map((i) => path.basename(i.path)).sort();
  assert.deepEqual(names, ['old.log'], 'only old.log: fresh is new, .tmp excluded, skipme excluded, link not followed');

  const r = await cleanItems({ rule, ...scan });
  assert.equal(r.deleted, 1);
  assert.equal(r.freed, 3, 'freed is the measured size of what was unlinked');
  assert.ok(!(await exists(j('tmp', 'old.log'))) && (await exists(j('tmp', 'fresh.txt'))));
  assert.ok(await exists(j('outside', 'keep.txt')), 'junction target survives');

  // children: a whole folder that contains a junction, removed recursively
  await write(j('sessions', 's1', 'big.bin'), '0123456789');
  await fsp.symlink(j('outside'), j('sessions', 's1', 'link'), 'junction');
  await fsp.symlink(j('outside'), j('sessions', 'toplink'), 'junction');
  const crule = { id: 'c', kind: 'children', paths: [j('sessions')], olderThanDays: 3 };
  const cscan = await scanRule(crule, { now: FUTURE });
  assert.deepEqual(cscan.items.map((i) => path.basename(i.path)), ['s1'], 'top-level junction is not an item');
  const cr = await cleanItems({ rule: crule, ...cscan });
  assert.equal(cr.deleted, 1);
  assert.ok(!(await exists(j('sessions', 's1'))));
  assert.ok(await exists(j('outside', 'keep.txt')), 'rm through a nested junction kept its target');
  assert.ok(await exists(j('sessions', 'toplink')), 'top-level junction untouched');

  // overlapping children patterns keep the parent only
  await write(j('g', 'caches', 'mod', 'files', 'a', 'x.jar'), 'jar');
  const orule = { id: 'o', kind: 'children', paths: [j('g', 'caches', '*'), j('g', 'caches', 'mod', 'files')], olderThanDays: 3 };
  const oscan = await scanRule(orule, { now: FUTURE });
  assert.deepEqual(oscan.items.map((i) => path.relative(T, i.path)), [path.join('g', 'caches', 'mod', 'files')]);

  // an item outside the scanned roots is refused even if handed to cleanItems
  await write(j('victim', 'v.txt'), 'v');
  const bad = await cleanItems({ rule, roots: [j('tmp')], cutoff: 0, items: [{ path: j('victim', 'v.txt'), size: 1 }] });
  assert.equal(bad.deleted, 0);
  assert.ok(await exists(j('victim', 'v.txt')));

  // project build folders: marker required
  await write(j('proj', 'web', 'package.json'), '{}');
  await write(j('proj', 'web', 'node_modules', 'lib', 'i.js'), 'js');
  await write(j('proj', 'docs', 'target', 'notes.md'), 'not rust');
  await write(j('proj', 'rs', 'Cargo.toml'), '');
  await write(j('proj', 'rs', 'target', 'debug', 'a.exe'), 'bin');
  await write(j('proj', 'py', '.venv', 'pyvenv.cfg'), 'home=x');
  await write(j('proj', 'py2', '.venv', 'random.txt'), 'x');
  const arts = await scanProjects([j('proj')], { now: FUTURE });
  const got = arts.map((a) => `${path.basename(a.project)}/${path.basename(a.path)}`).sort();
  assert.deepEqual(got, ['py/.venv', 'rs/target', 'web/node_modules']);
  const idle = Object.fromEntries(arts.map((a) => [path.basename(a.project), a.idleDays]));
  assert.ok(idle.web >= 29 && idle.rs >= 29, 'idle days computed from project files');
  assert.equal(idle.py, null, 'a project with no own files has unknown activity (never pre-ticked)');

  console.log('selftest OK');
} finally {
  await fsp.rm(T, { recursive: true, force: true });
}
