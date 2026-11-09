import express from 'express';
import compression from 'compression';
import cors from 'cors';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

/* =====================================================================
 * KMind Palace web host
 *
 * Serves the PWA built from packages/core and exposes a small read/write
 * API over the same on-disk layout the Obsidian plugin uses:
 *
 *   <vault>/index.json          palace list + last opened
 *   <vault>/world.json          world placement
 *   <vault>/palaces/<id>.json   one file per palace
 *   <vault>/review.json         FSRS scheduling state (KMind's own)
 *   <vault>/media/<id>          photos, glb, spz
 *   <vault>/scans/<id>/         scan jobs (video in, spz + mesh out)
 *
 * The Obsidian plugin keeps working on the same files.
 * ===================================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vault root: where palace JSON + media live. Default to the private vault.
const VAULT = process.env.KMIND_VAULT || '/mnt/zer0models/sft-svlm/data/limitless/kmind-vault';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5182;
const HOST = process.env.KMIND_HOST || '0.0.0.0';
// Where finished .spz splats are published for the PWA to fetch.
const SPLAT_DIR = path.join(VAULT, 'media');

const app = express();
const server = createServer(app);

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '64mb' }));

/* ---------------- vault helpers ---------------- */

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

function vaultPath(...parts: string[]) {
  const p = path.join(VAULT, ...parts.map(safeName));
  // refuse to escape the vault
  const rel = path.relative(VAULT, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path escapes vault');
  return p;
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
}

async function readJson(file: string): Promise<unknown> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown) {
  await ensureDir(path.dirname(file));
  // write to a temp file then rename: never leave a half-written JSON behind
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 1), 'utf8');
  await fsp.rename(tmp, file);
}

async function listPalaces(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const index = await readJson(vaultPath('index.json')) as any;
  if (index && Array.isArray(index.palaces)) return index.palaces;
  // index missing: rebuild from the palaces/ dir
  const dir = vaultPath('palaces');
  let names: string[] = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out: { id: string; name: string; updatedAt: number }[] = [];
  for (const n of names.filter(x => x.endsWith('.json'))) {
    const doc = await readJson(path.join(dir, n)) as any;
    if (doc?.id) out.push({ id: doc.id, name: doc.name || doc.id, updatedAt: Number(doc.updatedAt) || 0 });
  }
  out.sort((a, b) => a.updatedAt - b.updatedAt);
  return out;
}

async function setIndex(palaces: { id: string; name: string; updatedAt: number }[], lastOpened?: string) {
  const prev = await readJson(vaultPath('index.json')) as any;
  await writeJson(vaultPath('index.json'), {
    version: 1,
    palaces,
    lastOpened: lastOpened ?? prev?.lastOpened ?? null,
  });
}

/* ---------------- api ---------------- */

const API = '/api/v1';

app.get(`${API}/health`, (_req, res) => {
  res.json({ ok: true, vault: VAULT, version: 1 });
});

app.get(`${API}/world`, async (_req, res) => {
  const w = await readJson(vaultPath('world.json'));
  res.json(w || null);
});

app.patch(`${API}/world`, async (req, res) => {
  await writeJson(vaultPath('world.json'), req.body);
  broadcast({ t: 'world', world: req.body });
  res.json(req.body);
});

app.get(`${API}/palaces`, async (_req, res) => {
  const list = await listPalaces();
  const docs = [];
  for (const p of list) {
    const doc = await readJson(vaultPath('palaces', `${p.id}.json`));
    if (doc) docs.push(doc);
  }
  res.json(docs);
});

app.get(`${API}/palaces/:id`, async (req, res) => {
  const doc = await readJson(vaultPath('palaces', `${req.params.id}.json`));
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
});

app.post(`${API}/palaces`, async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });
  const file = vaultPath('palaces', `${id}.json`);
  const existing = await readJson(file);
  const doc = existing || { ...req.body, id };
  doc.updatedAt = Date.now();
  await writeJson(file, doc);
  const list = await listPalaces();
  const i = list.findIndex(p => p.id === id);
  const entry = { id, name: doc.name || id, updatedAt: doc.updatedAt };
  if (i >= 0) list[i] = entry; else list.push(entry);
  await setIndex(list);
  broadcast({ t: 'palace', id });
  res.status(201).json(doc);
});

interface PalaceDocLike { id: string; name?: string; updatedAt?: number; [k: string]: unknown; }

app.patch(`${API}/palaces/:id`, async (req, res) => {
  const id = req.params.id;
  const file = vaultPath('palaces', `${id}.json`);
  const raw = await readJson(file);
  const doc: PalaceDocLike = (raw as PalaceDocLike) || { id };
  Object.assign(doc, req.body, { id, updatedAt: Date.now() });
  await writeJson(file, doc);
  const list = await listPalaces();
  const i = list.findIndex(p => p.id === id);
  const entry = { id, name: doc.name || id, updatedAt: doc.updatedAt ?? 0 };
  if (i >= 0) list[i] = entry; else list.push(entry);
  await setIndex(list);
  broadcast({ t: 'palace', id });
  res.json(doc);
});

app.delete(`${API}/palaces/:id`, async (req, res) => {
  try { await fsp.unlink(vaultPath('palaces', `${req.params.id}.json`)); } catch {}
  const list = (await listPalaces()).filter(p => p.id !== req.params.id);
  await setIndex(list);
  broadcast({ t: 'palace', id: req.params.id });
  res.json({ ok: true });
});

/* ---------------- review (KMind's own FSRS) ---------------- */

app.get(`${API}/review`, async (_req, res) => {
  res.json((await readJson(vaultPath('review.json'))) || {});
});

app.post(`${API}/review/states`, async (req, res) => {
  const all = (await readJson(vaultPath('review.json'))) || {};
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const out: Record<string, unknown> = {};
  for (const id of ids) if (all[id]) out[id] = all[id];
  res.json(out);
});

app.post(`${API}/review/rate/:id`, async (req, res) => {
  const all = (await readJson(vaultPath('review.json'))) || {};
  const id = req.params.id;
  const now = Date.now();
  const rating = Number(req.body?.rating) || 0;
  const c = all[id] || { card: true, reps: 0, lapses: 0, state: 0 };
  const DAY = 864e5;
  let ivl = c.ivl || 0;
  if (rating === 1) { c.lapses = (c.lapses || 0) + 1; ivl = 0; c.due = now + 10 * 60e3; c.state = c.reps ? 3 : 1; }
  else if (rating === 2) { ivl = Math.max(1, ivl * 1.2); c.due = now + ivl * DAY; c.state = 2; }
  else if (rating === 3) { ivl = Math.max(1, ivl * 2.5); c.due = now + ivl * DAY; c.state = 2; }
  else { ivl = Math.max(4, ivl * 3.5); c.due = now + ivl * DAY; c.state = 2; }
  Object.assign(c, { card: true, ivl, reps: (c.reps || 0) + 1, lastReview: now });
  all[id] = c;
  await writeJson(vaultPath('review.json'), all);
  res.json(c);
});

/* ---------------- media ---------------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(vaultPath('media')); cb(null, vaultPath('media')); }
      catch (e) { cb(e as Error, ''); }
    },
    filename: (_req, file, cb) => {
      const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      cb(null, `${safeName(path.parse(file.originalname).name)}.${ext}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

app.post(`${API}/media`, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ id: req.file.filename, url: `${API}/media/${req.file.filename}` });
});

app.get(`${API}/media/:id`, async (req, res) => {
  const file = vaultPath('media', safeName(req.params.id));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.sendFile(file);
});

/* ---------------- scan pipeline ---------------- */

app.post(`${API}/scan/upload`, upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no video' });
  const f = req.file;
  const jobId = `scan_${Date.now()}_${safeName(path.parse(f.originalname).name)}`;
  const dir = vaultPath('scans', jobId);
  await ensureDir(dir);
  const dest = path.join(dir, 'input.mp4');
  await fsp.rename(f.path, dest).catch(async () => { await fsp.copyFile(f.path, dest); await fsp.unlink(f.path).catch(() => {}); });
  const job = { jobId, status: 'queued', video: dest, createdAt: Date.now(), splat: null, mesh: null, error: null };
  await writeJson(path.join(dir, 'job.json'), job);
  broadcast({ t: 'scan', jobId, status: 'queued' });
  res.json({ jobId, status: 'queued' });
});

app.get(`${API}/scan/status/:jobId`, async (req, res) => {
  const job = await readJson(vaultPath('scans', safeName(req.params.jobId), 'job.json')) as any;
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.get(`${API}/scan/list`, async (_req, res) => {
  const dir = vaultPath('scans');
  let names: string[] = [];
  try { names = await fsp.readdir(dir); } catch { names = []; }
  const out = [];
  for (const n of names) {
    const job = await readJson(path.join(dir, n, 'job.json')) as any;
    if (job) out.push(job);
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(out);
});

/* ---------------- websocket: live doc/world/scan events ---------------- */

const wss = new WebSocketServer({ server, path: `${API}/docs/watch` });
const clients = new Set<import('ws').WebSocket>();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg: unknown) {
  const raw = JSON.stringify(msg);
  for (const ws of clients) { try { ws.send(raw); } catch {} }
}

/* ---------------- static: built PWA ---------------- */

const buildDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(buildDir, { index: 'index.html', maxAge: '1h' }));

// SPA fallback
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(buildDir, 'index.html'));
});

await ensureDir(vaultPath('media'));
await ensureDir(vaultPath('palaces'));
await ensureDir(vaultPath('scans'));

server.listen(PORT, HOST, () => {
  console.log(`[kmind-web-host] http://${HOST}:${PORT}  vault=${VAULT}`);
});
