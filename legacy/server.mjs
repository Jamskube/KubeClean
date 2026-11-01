// KubeClean: local server on 127.0.0.1 + Edge app window. node server.mjs [--no-open]
import http from 'node:http';
import { promises as fsp, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRule, scanProjects, cleanItems, diskInfo, expandEnv } from './engine.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const TOKEN = randomBytes(24).toString('hex');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

let lastScan = new Map(); // id -> { rule, roots, cutoff, items }
let busy = false;
let lastPing = 0;

const readJson = async (f) => JSON.parse(await fsp.readFile(path.join(ROOT, f), 'utf8'));
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function scan(emit) {
  const { rules, globalExclude } = await readJson('rules.json');
  const cfg = await readJson('config.json');
  const total = rules.length + 1;
  let done = 0;
  const tick = (label) => emit('progress', { done: ++done, total, label });
  const map = new Map();
  const ruleOut = await Promise.all(rules.map(async (rule) => {
    const r = await scanRule(rule, { globalExclude }).catch(() => ({ roots: [], cutoff: 0, items: [] }));
    map.set(rule.id, { rule, ...r });
    tick(rule.title);
    const size = r.items.reduce((s, i) => s + i.size, 0);
    const top = [...r.items].sort((a, b) => b.size - a.size).slice(0, 5).map((i) => ({ path: i.path, size: i.size }));
    return { id: rule.id, cat: rule.cat, title: rule.title, hint: rule.hint, default: !!rule.default, size, count: r.items.length, top };
  }));
  const roots = cfg.projectRoots.map(expandEnv);
  const arts = await scanProjects(roots, { maxDepth: cfg.maxDepth ?? 8 });
  tick('Projets');
  const projects = arts.sort((a, b) => b.size - a.size).map((a, n) => {
    const id = `art:${n}`;
    map.set(id, { rule: { id, kind: 'dir' }, roots, cutoff: 0, items: [{ path: a.path, size: a.size }] });
    return { id, path: a.path, project: a.project, kind: a.kind, size: a.size, idleDays: a.idleDays,
      default: a.idleDays != null && a.idleDays >= (cfg.projectIdleDays ?? 14) };
  });
  lastScan = map;
  return { rules: ruleOut, projects, disk: await diskInfo(), projectIdleDays: cfg.projectIdleDays ?? 14 };
}

async function clean(ids) {
  const before = await diskInfo();
  const out = { freed: 0, deleted: 0, skipped: 0, errors: [], perId: {} };
  for (const id of ids) {
    const entry = lastScan.get(id);
    if (!entry || !entry.items.length) continue;
    const r = await cleanItems(entry);
    out.perId[id] = r;
    out.freed += r.freed; out.deleted += r.deleted; out.skipped += r.skipped;
    out.errors.push(...r.errors.slice(0, 2));
  }
  lastScan = new Map(); // a clean always needs a fresh scan
  const after = await diskInfo();
  return { ...out, diskFreeGain: after.free - before.free, disk: after };
}

const server = http.createServer(async (req, res) => {
  const port = server.address().port;
  // DNS-rebinding guard: only our exact origin
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: 'host' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (url.pathname.startsWith('/api/')) {
    const tok = req.headers['x-token'] || url.searchParams.get('t');
    if (tok !== TOKEN) return send(res, 401, { error: 'token' });
    lastPing = Date.now();
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true });

    if (url.pathname === '/api/scan' && req.method === 'GET') {
      if (busy) return send(res, 409, { error: 'busy' });
      busy = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const emit = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
      try { emit('result', await scan(emit)); } catch (e) { emit('failure', { message: String(e.message || e) }); }
      finally { busy = false; res.end(); }
      return;
    }

    if (url.pathname === '/api/clean' && req.method === 'POST') {
      if (busy) return send(res, 409, { error: 'busy' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'type' });
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1e6) return send(res, 413, { error: 'size' }); }
      let ids;
      try { ids = JSON.parse(body).ids; } catch { return send(res, 400, { error: 'json' }); }
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return send(res, 400, { error: 'ids' });
      busy = true;
      try { return send(res, 200, await clean(ids)); }
      catch (e) { return send(res, 500, { error: String(e.message || e) }); }
      finally { busy = false; }
    }
    return send(res, 404, { error: 'not found' });
  }

  // static files from public/ only
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(PUB, rel);
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  try { send(res, 200, await fsp.readFile(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'); }
  catch { send(res, 404, 'not found', 'text/plain'); }
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`;
  console.log(`KubeClean: ${url}`);
  if (process.argv.includes('--no-open')) return;
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean).map((p) => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync);
  const child = edge
    ? spawn(edge, [`--app=${url}`, '--window-size=1180,820'], { detached: true, stdio: 'ignore' })
    : spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
});

// quit once the window has been closed for 20 s (the page pings every 5 s)
setInterval(() => { if (lastPing && !busy && Date.now() - lastPing > 20000) process.exit(0); }, 5000).unref?.();
