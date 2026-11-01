// KubeClean engine: scan and clean. Rule model observed in AVG TuneUp's gf2engine
// (root paths with wildcards, mask / exclude mask, recursion depth, olderThan),
// reimplemented from scratch with stricter safety.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const DAY = 86400000;

// ---------- small helpers ----------
export const expandEnv = (p) =>
  p.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m).replace(/[\\/]+/g, path.sep);
const key = (p) => path.resolve(p).toLowerCase();
export const isUnder = (child, parent) => {
  const c = key(child), p = key(parent);
  return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};
const globRe = (g) =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
export const maskTest = (list) => {
  if (!list || !list.length) return null;
  const res = (Array.isArray(list) ? list : list.split(';')).map((s) => s.trim()).filter(Boolean).map(globRe);
  return (name) => res.some((r) => r.test(name));
};
const readdirSafe = (d) => fsp.readdir(d, { withFileTypes: true }).catch(() => []);
const lstatSafe = (p) => fsp.lstat(p).catch(() => null);
// Newest of write, creation and change time: a file just extracted from an old
// archive keeps an old mtime but has a fresh birthtime, so it is not "old".
export const itemTime = (st) => Math.max(st.mtimeMs, st.birthtimeMs || 0, st.ctimeMs || 0);
// Junctions and symlinks are never followed nor deleted through (the
// "Local Settings" junction double-counted AppData during the first survey).
const isLink = (st) => st.isSymbolicLink();

// ---------- path resolution ("User Data/*/Cache") ----------
export async function resolvePaths(pattern) {
  const full = expandEnv(pattern);
  if (/%[^%]+%/.test(full)) return []; // unknown variable: rule does not apply
  const parts = full.split(path.sep);
  let bases = [parts[0] + path.sep];
  for (const seg of parts.slice(1)) {
    if (!seg) continue;
    const next = [];
    for (const b of bases) {
      if (/[*?]/.test(seg)) {
        const re = globRe(seg);
        for (const d of await readdirSafe(b))
          if (d.isDirectory() && !d.isSymbolicLink() && re.test(d.name)) next.push(path.join(b, d.name));
      } else next.push(path.join(b, seg));
    }
    bases = next;
  }
  const out = [];
  for (const b of bases) {
    const st = await lstatSafe(b);
    if (st && st.isDirectory() && !isLink(st)) out.push(b);
  }
  return out;
}

// ---------- measuring ----------
export async function treeStat(p) {
  const st = await lstatSafe(p);
  if (!st || isLink(st)) return { size: 0, newest: 0, files: 0 };
  if (!st.isDirectory()) return { size: st.size, newest: itemTime(st), files: 1 };
  const acc = { size: 0, newest: itemTime(st), files: 0 };
  const ents = (await readdirSafe(p)).filter((d) => !d.isSymbolicLink());
  for (const s of await Promise.all(ents.map((d) => treeStat(path.join(p, d.name))))) {
    acc.size += s.size; acc.files += s.files; if (s.newest > acc.newest) acc.newest = s.newest;
  }
  return acc;
}

async function walkFiles(dir, depth, o, out) {
  const ents = await readdirSafe(dir);
  const files = [];
  for (const d of ents) {
    if (d.isSymbolicLink()) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (depth > 0 && !o.excludeDirs.some((x) => key(x) === key(p))) await walkFiles(p, depth - 1, o, out);
    } else if (d.isFile()) {
      if (o.mask && !o.mask(d.name)) continue;
      if ((o.exclude && o.exclude(d.name)) || (o.globalEx && o.globalEx(d.name))) continue;
      files.push(p);
    }
  }
  for (const [i, st] of (await Promise.all(files.map(lstatSafe))).entries()) {
    if (!st || isLink(st)) continue;
    if (o.cutoff && itemTime(st) > o.cutoff) continue;
    out.push({ path: files[i], size: st.size });
  }
}

// ---------- rules ----------
export async function scanRule(rule, { globalExclude = [], now = Date.now() } = {}) {
  const cutoff = rule.olderThanDays ? now - rule.olderThanDays * DAY : 0;
  const roots = [];
  for (const p of rule.paths || []) roots.push(...(await resolvePaths(p)));
  const items = [];

  if (rule.kind === 'files') {
    const o = {
      mask: maskTest(rule.mask), exclude: maskTest(rule.exclude), globalEx: maskTest(globalExclude),
      excludeDirs: (rule.excludeDirs || []).map(expandEnv), cutoff,
    };
    for (const r of roots) await walkFiles(r, rule.depth ?? 50, o, items);
  } else if (rule.kind === 'children') {
    const cands = [];
    for (const r of roots)
      for (const d of await readdirSafe(r)) {
        if (d.isSymbolicLink()) continue;
        const p = path.join(r, d.name);
        const s = await treeStat(p);
        if (s.size > 0 && (!cutoff || s.newest <= cutoff)) cands.push({ path: p, size: s.size, dir: d.isDirectory() });
      }
    // a parent and its own children can both match (overlapping patterns): keep the parent only
    cands.sort((a, b) => a.path.length - b.path.length);
    for (const c of cands) if (!items.some((i) => isUnder(c.path, i.path))) items.push(c);
  } else if (rule.kind === 'recycleBin') {
    const sid = await userSid();
    if (sid) {
      const bin = path.join(process.env.SystemDrive || 'C:', '$Recycle.Bin', sid);
      const s = await treeStat(bin);
      if (s.size > 0) items.push({ path: bin, size: s.size, recycle: true });
      roots.push(bin);
    }
  }
  return { roots, cutoff, items };
}

let sidCache;
async function userSid() {
  if (sidCache !== undefined) return sidCache;
  try {
    const { stdout } = await run('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    sidCache = (stdout.match(/S-1-5-[\d-]+/) || [null])[0];
  } catch { sidCache = null; }
  return sidCache;
}

// ---------- project build folders ----------
const has = async (dir, names) => {
  for (const n of names) if (await lstatSafe(path.join(dir, n))) return true;
  return false;
};
const hasExt = async (dir, re) => (await readdirSafe(dir)).some((d) => d.isFile() && re.test(d.name));
const JS = ['package.json'];
export const ARTIFACTS = {
  node_modules: { label: 'Node', ok: (p) => has(p, JS) },
  '.next': { label: 'Next.js', ok: (p) => has(p, JS) },
  '.nuxt': { label: 'Nuxt', ok: (p) => has(p, JS) },
  '.svelte-kit': { label: 'SvelteKit', ok: (p) => has(p, JS) },
  '.turbo': { label: 'Turbo', ok: (p) => has(p, JS) },
  '.parcel-cache': { label: 'Parcel', ok: (p) => has(p, JS) },
  '.angular': { label: 'Angular', ok: (p) => has(p, JS) },
  target: { label: 'Rust / Maven', ok: (p) => has(p, ['Cargo.toml', 'pom.xml']) },
  '.venv': { label: 'Python', inside: ['pyvenv.cfg'] },
  venv: { label: 'Python', inside: ['pyvenv.cfg'] },
  '.gradle': { label: 'Gradle', ok: (p) => has(p, ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts']) },
  build: { label: 'Gradle', ok: (p) => has(p, ['build.gradle', 'build.gradle.kts']) },
  obj: { label: '.NET', ok: (p) => hasExt(p, /\.(cs|fs|vb)proj$/i) },
};
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'appdata', '$recycle.bin', 'program files', 'program files (x86)', 'windows']);

async function isArtifact(dir, name) {
  const a = ARTIFACTS[name];
  if (!a) return null;
  const project = path.dirname(dir);
  if (a.inside ? await has(dir, a.inside) : await a.ok(project)) return a.label;
  return null;
}

// last activity of a project = newest file outside its build folders (depth 3)
async function projectActivity(dir, depth = 3) {
  let newest = 0;
  for (const d of await readdirSafe(dir)) {
    if (d.isSymbolicLink() || ARTIFACTS[d.name] || d.name === '.git') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (depth > 0) newest = Math.max(newest, await projectActivity(p, depth - 1)); }
    else { const st = await lstatSafe(p); if (st) newest = Math.max(newest, st.mtimeMs); }
  }
  return newest;
}

export async function scanProjects(roots, { maxDepth = 8, now = Date.now() } = {}) {
  const found = [];
  async function walk(dir, depth) {
    for (const d of await readdirSafe(dir)) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue;
      const p = path.join(dir, d.name);
      const label = await isArtifact(p, d.name);
      if (label) { found.push({ path: p, kind: label, project: path.dirname(p) }); continue; }
      if (SKIP_DIRS.has(d.name.toLowerCase()) || (d.name.startsWith('.') && d.name !== '.')) continue;
      if (depth > 0) await walk(p, depth - 1);
    }
  }
  const seen = new Set();
  for (const r of roots) {
    const real = expandEnv(r);
    const st = await lstatSafe(real);
    if (!st || !st.isDirectory() || isLink(st) || seen.has(key(real))) continue;
    seen.add(key(real));
    await walk(real, maxDepth);
  }
  const out = [];
  for (const f of found) {
    const [s, act] = await Promise.all([treeStat(f.path), projectActivity(f.project)]);
    if (s.size === 0) continue;
    out.push({ ...f, size: s.size, idleDays: act ? Math.floor((now - act) / DAY) : null });
  }
  return out;
}

// ---------- cleaning ----------
async function pruneEmptyDirs(dir, root, o) {
  for (const d of await readdirSafe(dir)) {
    if (!d.isDirectory() || d.isSymbolicLink()) continue;
    const p = path.join(dir, d.name);
    if (o.excludeDirs.some((x) => key(x) === key(p))) continue;
    await pruneEmptyDirs(p, root, o);
    const st = await lstatSafe(p);
    if (st && (!o.cutoff || itemTime(st) <= o.cutoff)) await fsp.rmdir(p).catch(() => {}); // fails if not empty: fine
  }
}

// An item is deleted only if it is still strictly inside one of the roots its rule
// resolved during the scan, is not a link, and still matches what the scan measured.
export async function cleanItems(entry) {
  const { rule, roots, cutoff, items } = entry;
  const res = { freed: 0, deleted: 0, skipped: 0, errors: [] };
  if (rule.kind === 'recycleBin') {
    const before = (await treeStat(items[0].path)).size;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'], { windowsHide: true }).catch(() => {});
    const after = (await treeStat(items[0].path)).size;
    res.freed = Math.max(0, before - after); res.deleted = before > after ? 1 : 0; res.skipped = after > 0 ? 1 : 0;
    return res;
  }
  for (const it of items) {
    const st = await lstatSafe(it.path);
    if (!roots.some((r) => isUnder(it.path, r)) || !st || isLink(st)) { res.skipped++; continue; }
    if (rule.kind === 'files') {
      if (cutoff && itemTime(st) > cutoff) { res.skipped++; continue; } // touched since the scan
      try { await fsp.unlink(it.path); res.freed += st.size; res.deleted++; }
      catch (e) { res.skipped++; if (res.errors.length < 5) res.errors.push(`${e.code}: ${it.path}`); }
    } else {
      const before = (await treeStat(it.path)).size;
      try { await fsp.rm(it.path, { recursive: true, force: true, maxRetries: 2 }); } catch (e) { if (res.errors.length < 5) res.errors.push(`${e.code}: ${it.path}`); }
      const left = (await treeStat(it.path)).size; // measured, not assumed
      res.freed += Math.max(0, before - left);
      if (left === 0 && !(await lstatSafe(it.path))) res.deleted++; else res.skipped++;
    }
  }
  if (rule.kind === 'files') {
    const o = { excludeDirs: (rule.excludeDirs || []).map(expandEnv), cutoff };
    for (const r of roots) await pruneEmptyDirs(r, r, o);
  }
  return res;
}

export async function diskInfo(drive = (process.env.SystemDrive || 'C:') + path.sep) {
  const s = await fsp.statfs(drive);
  return { drive, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}
