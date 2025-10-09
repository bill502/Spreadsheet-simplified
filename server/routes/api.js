import express from 'express';
import fs from 'node:fs';
import cookie from 'cookie';
import crypto from 'node:crypto';
import db, { getColumns } from '../db.js';
import multer from 'multer';
import path from 'node:path';
import XLSX from 'xlsx';

const router = express.Router();

// In-memory sessions keyed by sid
const sessions = new Map();

function newSid() { return crypto.randomBytes(16).toString('hex'); }
function getSession(req) {
  const raw = req.headers.cookie || '';
  const parsed = cookie.parse(raw || '');
  const sid = parsed.sid;
  if (sid && sessions.has(sid)) return { sid, ...sessions.get(sid) };
  return null;
}
function roleGE(have, need) {
  const ord = { viewer: 0, editor: 1, admin: 2 };
  return (ord[have] ?? -1) >= (ord[need] ?? 99);
}
function requireRole(minRole) {
  return (req, res, next) => {
    const sess = getSession(req);
    if (!sess) {
      if (minRole === 'viewer') return next();
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roleGE(sess.role, minRole)) return res.status(403).json({ error: 'Forbidden' });
    req.session = sess;
    return next();
  };
}

// Helpers
function normalizeFieldValue(name, value) {
  if (value == null) return null;
  if (/^(Called|Visited|ConfirmedVoter)$/i.test(name)) {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const s = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(s) ? 1 : 0;
  }
  return value;
}

function ensureColumns(fields) {
  if (!fields) return;
  const cols = new Set(getColumns());
  for (const k of Object.keys(fields)) {
    if (k === 'rowNumber') continue;
    if (!cols.has(k)) {
      const safe = k.replace(']', ']]');
      db.prepare(`ALTER TABLE people ADD COLUMN [${safe}] TEXT`).run();
      cols.add(k);
    }
  }
}

function getRowByNumber(n) {
  const row = db.prepare('SELECT * FROM people WHERE rowNumber = ?').get(n);
  return row || { rowNumber: n };
}

// Routes
router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/columns', (req, res) => {
  return res.json({ columns: getColumns().filter(Boolean) });
});

router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '100', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
  const by = (req.query.by || '').toString().trim();
  const cols = getColumns();
  if (!q) {
    const items = db.prepare('SELECT * FROM people ORDER BY rowNumber LIMIT ? OFFSET ?').all(limit, offset);
    const total = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
    return res.json({ total, items });
  }
  let likeCols = [];
  if (by === 'uc') likeCols = ['UC', 'Uc'];
  else if (by === 'pp') likeCols = ['PP', 'Pp'];
  else if (by === 'locality') likeCols = ['Locality', 'LocalityName'];
  else likeCols = cols.filter(c => c && c !== 'rowNumber');
  likeCols = likeCols.filter(c => cols.includes(c));
  if (likeCols.length === 0) {
    return res.json({ total: 0, items: [] });
  }
  const conds = likeCols.map(c => `[${c}] LIKE @pat`).join(' OR ');
  const items = db.prepare(`SELECT * FROM people WHERE ${conds} ORDER BY rowNumber LIMIT @l OFFSET @o`).all({ pat: `%${q}%`, l: limit, o: offset });
  const total = db.prepare(`SELECT COUNT(*) AS c FROM people WHERE ${conds}`).get({ pat: `%${q}%` }).c;
  return res.json({ total, items });
});

router.get('/row/:id', (req, res) => {
  const n = parseInt(req.params.id, 10);
  return res.json(getRowByNumber(n));
});

router.post('/row', requireRole('editor'), (req, res) => {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const fields = {};
  for (const [k, v] of Object.entries(body)) { if (k !== 'rowNumber') fields[k] = normalizeFieldValue(k, v); }
  // assign new rowNumber
  const max = db.prepare('SELECT IFNULL(MAX(rowNumber), 0) AS m FROM people').get().m;
  const newNum = Number(max) + 1;
  fields.rowNumber = newNum;
  ensureColumns(fields);
  const keys = Object.keys(fields);
  const colSql = keys.map(k => `[${k.replace(']', ']]')}]`).join(',');
  const ph = keys.map(k => `@${k.replace(/[^A-Za-z0-9_]/g, '_')}`).join(',');
  const params = {}; keys.forEach(k => { params[k.replace(/[^A-Za-z0-9_]/g, '_')] = fields[k]; });
  db.prepare(`INSERT INTO people (${colSql}) VALUES (${ph})`).run(params);
  return res.status(201).json(getRowByNumber(newNum));
});

router.post('/row/:id', requireRole('editor'), (req, res) => {
  const n = parseInt(req.params.id, 10);
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const fields = {};
  for (const [k, v] of Object.entries(body)) { if (k !== 'rowNumber') fields[k] = normalizeFieldValue(k, v); }
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Empty body' });
  // Enforce PP/UC from locality for non-admins; do not allow manual PP/UC changes by editors
  const sess = getSession(req);
  const isAdmin = !!sess && roleGE(sess.role, 'admin');
  // Normalize locality key
  const localityKey = (fields.LocalityName !== undefined) ? 'LocalityName' : ((fields.Locality !== undefined) ? 'Locality' : null);
  if (!isAdmin) {
    if ('PP' in fields) delete fields.PP;
    if ('UC' in fields) delete fields.UC;
  }
  if (localityKey) {
    const locName = String(fields[localityKey] ?? '').trim();
    if (locName) {
      const loc = db.prepare('SELECT name, pp, uc FROM localities WHERE name = ?').get(locName);
      if (loc) {
        fields.PP = loc.pp;
        fields.UC = loc.uc;
      }
    }
  }
  ensureColumns(fields);
  const before = JSON.stringify(getRowByNumber(n));
  const sets = Object.keys(fields).map(k => `[${k.replace(']', ']]')}] = @${k.replace(/[^A-Za-z0-9_]/g, '_')}`);
  const params = { n };
  Object.entries(fields).forEach(([k, v]) => { params[k.replace(/[^A-Za-z0-9_]/g, '_')] = v; });
  db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE rowNumber = @n`).run(params);
  const afterRow = getRowByNumber(n);
  const after = JSON.stringify(afterRow);
  db.prepare(`INSERT INTO audit(ts,user,action,rowNumber,details,before,after)
    VALUES(@ts,@u,'update',@n,@d,@b,@a)`).run({ ts: new Date().toISOString(), u: sess?.user || '', n, d: Object.keys(fields).join(','), b: before, a: after });
  return res.json(afterRow);
});

router.post('/row/:id/comment', requireRole('editor'), (req, res) => {
  const n = parseInt(req.params.id, 10);
  const c = (req.body?.comment || '').toString().trim();
  if (!c) return res.status(400).json({ error: 'Missing comment' });
  const row = getRowByNumber(n);
  const existing = row.Comments ? String(row.Comments) : '';
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const sess = getSession(req);
  const txt = (sess?.user ? `${sess.user}: ` : '') + c;
  const val = existing ? `${existing}\n[${ts}] ${txt}` : `[${ts}] ${txt}`;
  ensureColumns({ Comments: val });
  db.prepare('UPDATE people SET [Comments] = @c WHERE rowNumber = @n').run({ c: val, n });
  db.prepare('INSERT INTO audit(ts,user,action,rowNumber,details) VALUES(@ts,@u,\'comment\',@n,@d)')
    .run({ ts: new Date().toISOString(), u: sess?.user || '', n, d: c });
  return res.json(getRowByNumber(n));
});

// Auth
router.post('/login', (req, res) => {
  const u = (req.body?.username || '').toString().trim();
  const p = (req.body?.password || '').toString();
  if (!u || !p) return res.status(400).json({ error: 'Missing credentials' });
  db.prepare('CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, role TEXT)').run();
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run('admin', 'admin', 'admin');
  let row = db.prepare('SELECT username, password, role FROM users WHERE username = ?').get(u);
  if (!row && u === 'admin' && p === 'admin') {
    db.prepare('INSERT OR REPLACE INTO users(username,password,role) VALUES(?,?,?)').run('admin','admin','admin');
    row = { username: 'admin', password: 'admin', role: 'admin' };
  }
  if (!row || row.password !== p) return res.status(401).json({ error: 'Invalid credentials' });
  const sid = newSid();
  sessions.set(sid, { user: row.username, role: row.role, created: new Date() });
  res.setHeader('Set-Cookie', cookie.serialize('sid', sid, { path: '/', httpOnly: true, sameSite: 'lax' }));
  return res.json({ user: row.username, role: row.role });
});

router.post('/logout', (req, res) => {
  const sess = getSession(req);
  if (sess) sessions.delete(sess.sid);
  return res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const sess = getSession(req);
  return res.json({ user: sess?.user, role: sess?.role || 'viewer' });
});

router.get('/admin/users', requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT username, role FROM users ORDER BY username').all();
  return res.json({ users });
});

router.post('/admin/user', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const u = (body.username || '').toString();
  const p = body.password != null ? String(body.password) : undefined;
  const r = (body.role || '').toString();
  const old = (body.oldUsername || '').toString();
  if (!u || !r) return res.status(400).json({ error: 'Missing username/role' });
  const target = old ? old : u;
  const exists = db.prepare('SELECT COUNT(*) AS c FROM users WHERE username = ?').get(target).c;
  if (exists > 0) {
    const rename = u !== target;
    if (rename) {
      const taken = db.prepare('SELECT COUNT(*) AS c FROM users WHERE username = ?').get(u).c;
      if (taken > 0) return res.status(409).json({ error: 'Username already exists' });
      if (p && p.trim() !== '')
        db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE username = ?').run(u, p, r, target);
      else db.prepare('UPDATE users SET username = ?, role = ? WHERE username = ?').run(u, r, target);
    } else {
      if (p && p.trim() !== '')
        db.prepare('UPDATE users SET password = ?, role = ? WHERE username = ?').run(p, r, u);
      else db.prepare('UPDATE users SET role = ? WHERE username = ?').run(r, u);
    }
  } else {
    if (!p || p.trim() === '') return res.status(400).json({ error: 'Missing password for new user' });
    db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(u, p, r);
  }
  return res.json({ ok: true });
});

router.delete('/admin/user/:username', requireRole('admin'), (req, res) => {
  const uname = decodeURIComponent(req.params.username || '');
  const row = db.prepare('SELECT role FROM users WHERE username = ?').get(uname);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  if (row.role === 'admin' && adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  db.prepare('DELETE FROM users WHERE username = ?').run(uname);
  return res.json({ ok: true });
});

router.post('/admin/revert', requireRole('admin'), (req, res) => {
  const from = (req.body?.from || '').toString();
  const to = (req.body?.to || '').toString();
  if (!from || !to) return res.status(400).json({ error: 'from/to required (ISO)' });
  const logs = db.prepare('SELECT * FROM audit WHERE ts BETWEEN ? AND ? ORDER BY id DESC').all(from, to);
  let reverted = 0;
  for (const log of logs) {
    if (!log.before) continue;
    try {
      const before = JSON.parse(log.before);
      const rowNum = Number(log.rowNumber);
      const fields = {};
      Object.keys(before).forEach(k => { if (k !== 'rowNumber') fields[k] = before[k]; });
      ensureColumns(fields);
      const sets = Object.keys(fields).map(k => `[${k.replace(']', ']]')}] = @${k.replace(/[^A-Za-z0-9_]/g, '_')}`);
      const params = { n: rowNum };
      Object.entries(fields).forEach(([k, v]) => { params[k.replace(/[^A-Za-z0-9_]/g, '_')] = v; });
      db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE rowNumber = @n`).run(params);
      reverted++;
    } catch { /* ignore */ }
  }
  return res.json({ reverted });
});

// Reports
router.get('/reports', requireRole('editor'), (req, res) => {
  const q = req.query || {};
  const limit = Math.max(1, Math.min(1000, parseInt(q.limit || '200', 10)));
  const cols = new Set(getColumns());
  const conds = [];
  const params = {};
  const addLike = (value, candidates, key) => {
    const v = (value || '').toString().trim(); if (!v) return;
    const names = candidates.filter(c => cols.has(c)).map(c => `[${c.replace(']', ']]')}] LIKE @${key}`);
    if (names.length) { conds.push(`(${names.join(' OR ')})`); params[key] = `%${v}%`; }
  };
  if (q.calledFrom) { conds.push('[CallDate] >= @cf'); params.cf = String(q.calledFrom); }
  if (q.calledTo)   { conds.push('[CallDate] <= @ct'); params.ct = String(q.calledTo); }
  if (q.visitedFrom){ conds.push('[VisitDate] >= @vf'); params.vf = String(q.visitedFrom); }
  if (q.visitedTo)  { conds.push('[VisitDate] <= @vt'); params.vt = String(q.visitedTo); }
  addLike(q.uc, ['UC','Uc'], 'uc');
  addLike(q.pp, ['PP','Pp'], 'pp');
  addLike(q.locality, ['Locality','LocalityName'], 'loc');

  // Modified filters via audit
  const sess = getSession(req);
  const auditConds = ["action = 'update'"];
  if (q.byUser) { auditConds.push('user = @au'); params.au = String(q.byUser); }
  if (q.session === 'current' && sess) {
    if (!q.byUser) { auditConds.push('user = @au'); params.au = String(sess.user || ''); }
    auditConds.push('ts >= @mf'); params.mf = (sess.created instanceof Date ? sess.created : new Date(sess.created)).toISOString().slice(0,19);
  } else if (q.modifiedFrom) { auditConds.push('ts >= @mf'); params.mf = String(q.modifiedFrom); }
  if (q.modifiedTo) { auditConds.push('ts <= @mt'); params.mt = String(q.modifiedTo); }
  if (q.byUser || q.modifiedFrom || q.modifiedTo || q.session === 'current') {
    conds.push(`(rowNumber IN (SELECT rowNumber FROM audit WHERE ${auditConds.join(' AND ')}))`);
  }

  let sql = 'SELECT * FROM people';
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY rowNumber DESC LIMIT @l';
  params.l = limit;
  const items = db.prepare(sql).all(params);
  return res.json({ total: items.length, items });
});

export default router;
// Debug routes (guarded)
function debugGuard(req, res, next){
  if (process.env.NODE_ENV !== 'production') return next();
  const t = req.get('X-Debug-Token');
  if (t && process.env.DEBUG_TOKEN && t === process.env.DEBUG_TOKEN) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

router.get('/_debug/db', debugGuard, (req, res) => {
  try {
    const dbPath = (process.env.DATABASE_URL || '/data/app.db');
    let exists = false, sizeBytes = 0, tablesCount = 0;
    try { const st = fs.statSync(dbPath); exists = st.isFile(); sizeBytes = st.size; } catch {}
    try { tablesCount = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c } catch {}
    return res.json({ dbPath, exists, sizeBytes, tablesCount });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get('/_debug/tables', debugGuard, (req, res) => {
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const list = names.map(n => {
      try { const c = db.prepare(`SELECT COUNT(*) AS c FROM [${n.replace(']',']]')}]`).get().c; return { name: n, count: c } } catch { return { name: n, count: null } }
    });
    return res.json({ tables: list });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
// --- Import from Excel (admin) ---
const upload = multer({ dest: '/tmp' });

function sanitizePPUC(val){
  if (val == null) return val;
  if (typeof val === 'number') return String(Math.trunc(val));
  const s = String(val).trim();
  if (s.includes('.')) return s.split('.')[0];
  return s;
}

function importFromWorksheet(ws){
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return { count: 0 };
  // Determine columns from headers
  const headers = Object.keys(rows[0]).filter(Boolean);
  // Drop columns explicitly
  const drop = new Set(['HighlightedAddress','highlightedaddress','Status','status']);
  const finalCols = headers.filter(h => !drop.has(h));
  // Build table schema
  const safeCols = finalCols.map(c => c.replace(']', ']]'));
  const createCols = ['rowNumber INTEGER PRIMARY KEY'].concat(safeCols.map(c => `[${c}] TEXT`)).join(', ');
  const tx = db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS people');
    db.exec(`CREATE TABLE people (${createCols})`);
    const idxs = ["CREATE INDEX IF NOT EXISTS idx_people_uc ON people([UC])", "CREATE INDEX IF NOT EXISTS idx_people_pp ON people([PP])", "CREATE INDEX IF NOT EXISTS idx_people_locality ON people([LocalityName])"];
    idxs.forEach(sql => { try { db.exec(sql) } catch {} });
    // Insert rows
    let rowNumber = 1;
    const ph = finalCols.map(c => `@${c.replace(/[^A-Za-z0-9_]/g,'_')}`).join(',');
    const colSql = finalCols.map(c => `[${c.replace(']', ']]')}]`).join(',');
    const stmt = db.prepare(`INSERT INTO people (rowNumber, ${colSql}) VALUES (@rn, ${ph})`);
    for (const r of rows){
      const rec = {};
      for (const c of finalCols){
        let v = r[c];
        if (c === 'PP' || c === 'UC') v = sanitizePPUC(v);
        if (c.toLowerCase() === 'highlightedaddress' || c.toLowerCase() === 'status') continue; // dropped
        rec[c.replace(/[^A-Za-z0-9_]/g,'_')] = v == null ? '' : String(v);
      }
      stmt.run({ rn: rowNumber++, ...rec });
    }
  });
  tx();
  return { count: rows.length, columns: finalCols };
}

router.post('/admin/import', requireRole('admin'), upload.single('file'), (req, res) => {
  try {
    let filePath = req.file?.path;
    if (!filePath){
      const p = (req.body?.path || '').toString().trim();
      if (!p) return res.status(400).json({ error: 'Provide file via multipart field "file" or JSON body { path }' });
      filePath = path.resolve(p);
    }
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames.includes('merged') ? 'merged' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const result = importFromWorksheet(ws);
    // Populate localities from unique LocalityName/PP/UC
    try {
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const set = new Map();
      for (const r of data){
        const name = String(r['LocalityName']||'').trim();
        if(!name) continue;
        const pp = sanitizePPUC(r['PP']);
        const uc = sanitizePPUC(r['UC']);
        const key = name.toLowerCase();
        if(!set.has(key)) set.set(key, { name, pp, uc });
      }
      const tx2 = db.transaction(() => {
        db.exec('CREATE TABLE IF NOT EXISTS localities (id INTEGER PRIMARY KEY, name TEXT UNIQUE, alias TEXT, pp TEXT, uc TEXT)');
        const ins = db.prepare('INSERT INTO localities(name, alias, pp, uc) VALUES(@name, @alias, @pp, @uc) ON CONFLICT(name) DO UPDATE SET pp=excluded.pp, uc=excluded.uc');
        for (const v of set.values()) ins.run({ name: v.name, alias: '', pp: v.pp ?? '', uc: v.uc ?? '' });
      });
      tx2();
    } catch {}
    return res.json({ ok: true, sheet: sheetName, ...result });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// --- Localities endpoints ---
router.get('/localities', (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  let items;
  if (q) {
    items = db.prepare('SELECT id, name, alias, pp, uc FROM localities WHERE lower(name) LIKE ? ORDER BY name LIMIT 1000').all(`%${q}%`);
  } else {
    items = db.prepare('SELECT id, name, alias, pp, uc FROM localities ORDER BY name LIMIT 2000').all();
  }
  return res.json({ items });
});

router.post('/admin/locality', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const name = (b.name||'').toString().trim();
  const alias = (b.alias||'').toString();
  const pp = sanitizePPUC(b.pp);
  const uc = sanitizePPUC(b.uc);
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('CREATE TABLE IF NOT EXISTS localities (id INTEGER PRIMARY KEY, name TEXT UNIQUE, alias TEXT, pp TEXT, uc TEXT)').run();
  db.prepare('INSERT INTO localities(name, alias, pp, uc) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET alias=excluded.alias, pp=excluded.pp, uc=excluded.uc').run(name, alias, pp ?? '', uc ?? '');
  return res.json({ ok: true });
});

router.delete('/admin/locality/:name', requireRole('admin'), (req, res) => {
  const name = decodeURIComponent(req.params.name||'');
  const x = db.prepare('DELETE FROM localities WHERE name = ?').run(name);
  return res.json({ ok: true, deleted: x.changes });
});
