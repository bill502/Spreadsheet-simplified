import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import db, { initDb, runMigrations } from './db.js';
import api from './routes/api.js';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

dotenv.config();
initDb();
try {
  await runMigrations();
} catch {}

// Cleanup: remove Status values and normalize PP/UC to integer strings
try {
  try { db.exec('UPDATE people SET Status=NULL'); } catch {}
  try { db.exec('UPDATE people SET HighlightedAddress=NULL'); } catch {}
  try { db.exec("UPDATE people SET PP = CAST(PP AS INTEGER) WHERE PP IS NOT NULL AND TRIM(PP)<>''"); } catch {}
  try { db.exec("UPDATE people SET UC = CAST(UC AS INTEGER) WHERE UC IS NOT NULL AND TRIM(UC)<>''"); } catch {}
  try { db.exec("UPDATE people SET Called = CAST(Called AS INTEGER) WHERE Called IS NOT NULL AND TRIM(Called)<>''"); } catch {}
  try { db.exec("UPDATE people SET Visited = CAST(Visited AS INTEGER) WHERE Visited IS NOT NULL AND TRIM(Visited)<>''"); } catch {}
  try { db.exec("UPDATE people SET ConfirmedVoter = CAST(ConfirmedVoter AS INTEGER) WHERE ConfirmedVoter IS NOT NULL AND TRIM(ConfirmedVoter)<>''"); } catch {}
  // Define helper for name backfill so we can run it after append too
  const backfillLawyerName = () => {
    try {
      const info = db.prepare('PRAGMA table_info(people)').all();
      const cols = info.map(r => String(r.name));
      const has = (n) => cols.includes(n);
      const preferred = ['LAWYER NAME','Lawyer Name','Lawyer Names','LAWYER NAMES','Name','Full Name','FullName','Alias'];
      const dynamic = cols.filter(c => {
        const lc = String(c).toLowerCase();
        if (lc === 'lawyername' || lc === 'rownumber' || lc === 'localityname') return false;
        return lc.includes('name');
      });
      const order = Array.from(new Set([...preferred, ...dynamic]));
      for (const col of order) {
        if (!has(col)) continue;
        const safe = col.replace(']', ']]');
        db.exec(`UPDATE people SET [LAWYERNAME] = [${safe}] 
          WHERE ([LAWYERNAME] IS NULL OR TRIM([LAWYERNAME])='') 
            AND [${safe}] IS NOT NULL 
            AND TRIM([${safe}])<>''`);
      }
      try {
        const left = db.prepare("SELECT COUNT(*) AS c FROM people WHERE [LAWYERNAME] IS NULL OR TRIM([LAWYERNAME])='' ").get().c;
        console.log(`[boot] LAWYERNAME backfill remaining empty: ${left}`);
      } catch {}
    } catch (e) { console.warn('[boot] LAWYERNAME backfill failed:', e?.message || e) }
  };
  const fillNamesFromAppendByPhone = () => {
    try {
      const dir = './append';
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx'));
      if (!files.length) return;
      const getDigits = (v) => { if (v==null) return ''; return String(v).replace(/\D+/g, '') };
      const pick = (obj, keys) => { for (const k of keys){ const v = obj?.[k]; if (v!=null && String(v).trim()!=='') return String(v).trim() } return '' };
      const nameKeys = ['LAWYERNAME','LawyerName','Lawyer Name','LAWYER NAME','Lawyer Names','LAWYER NAMES','Name','Full Name','FullName','Alias'];
      const phoneKeys = ['PHONE','Phone','Phone Number','Mobile','Mobile Number','Contact','Cell'];
      const byPhone = new Map();
      for (const f of files){
        try {
          const wb = XLSX.readFile(path.join(dir,f));
          const ws = wb.Sheets[ wb.SheetNames.includes('merged') ? 'merged' : wb.SheetNames[0] ];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          for (const r of rows){
            const nm = pick(r, nameKeys);
            const ph = pick(r, phoneKeys);
            const pd = getDigits(ph);
            if (nm && pd) { if (!byPhone.has(pd)) byPhone.set(pd, nm) }
          }
        } catch {}
      }
      if (byPhone.size === 0) return;
      const candidates = db.prepare("SELECT rowNumber, [PHONE] AS ph FROM people WHERE ([LAWYERNAME] IS NULL OR TRIM([LAWYERNAME])='') AND [PHONE] IS NOT NULL AND TRIM([PHONE])<>''").all();
      const upd = db.prepare('UPDATE people SET [LAWYERNAME]=@v WHERE rowNumber=@n');
      let fixed = 0;
      const tx = db.transaction((list)=>{
        for (const r of list){ const pd = getDigits(r.ph); const nm = byPhone.get(pd); if (nm){ upd.run({ v: nm, n: r.rowNumber }); fixed++; } }
      });
      tx(candidates);
      console.log(`[boot] Phone-based name backfill applied: ${fixed}`);
    } catch (e) { console.warn('[boot] Phone-based backfill failed:', e?.message || e) }
  };
  backfillLawyerName();
  fillNamesFromAppendByPhone();
} catch {}

// Seed localities from existing people if localities table is empty
try {
  db.exec('CREATE TABLE IF NOT EXISTS localities (id INTEGER PRIMARY KEY, name TEXT UNIQUE, alias TEXT, pp TEXT, uc TEXT)');
  const c = db.prepare("SELECT COUNT(*) AS c FROM localities").get().c;
  if (Number(c) === 0) {
    const sanitize = (v) => { if (v==null) return ''; if (typeof v==='number') return String(Math.trunc(v)); const s=String(v).trim(); return s.includes('.')? s.split('.')[0] : s };
    // Determine available locality columns
    let hasLocality = false; let hasLocalityName = false;
    try {
      const info = db.prepare('PRAGMA table_info(people)').all();
      hasLocality = info.some(r => String(r.name) === 'Locality');
      hasLocalityName = info.some(r => String(r.name) === 'LocalityName');
    } catch {}
    let rows = [];
    if (hasLocality && hasLocalityName) {
      rows = db.prepare("SELECT DISTINCT COALESCE([LocalityName],[Locality]) AS name, [PP] AS pp, [UC] AS uc FROM people WHERE COALESCE([LocalityName],[Locality]) IS NOT NULL AND TRIM(COALESCE([LocalityName],[Locality]))<>''").all();
    } else if (hasLocalityName) {
      rows = db.prepare("SELECT DISTINCT [LocalityName] AS name, [PP] AS pp, [UC] AS uc FROM people WHERE [LocalityName] IS NOT NULL AND TRIM([LocalityName])<>''").all();
    } else if (hasLocality) {
      rows = db.prepare("SELECT DISTINCT [Locality] AS name, [PP] AS pp, [UC] AS uc FROM people WHERE [Locality] IS NOT NULL AND TRIM([Locality])<>''").all();
    }
    const tx = db.transaction((list)=>{
      const ins = db.prepare('INSERT INTO localities(name, alias, pp, uc) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET pp=excluded.pp, uc=excluded.uc');
      for (const r of list) { ins.run(String(r.name).trim(), '', sanitize(r.pp), sanitize(r.uc)) }
    });
    tx(rows);
    console.log(`[db] Seeded localities from people: ${rows.length}`);
  }
} catch (e) { console.warn('[db] Localities seed check failed:', e?.message || e) }

// Auto-append from ./append on boot (idempotent with marker)
try {
  const dir = './append';
  const marker = '/data/.append_done.json';
  const shouldRun = (() => {
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx')).sort();
    if (files.length === 0) return false;
    const h = crypto.createHash('sha256');
    for (const f of files) {
      const p = path.join(dir, f);
      try { const st = fs.statSync(p); h.update(f + ':' + st.size + ':' + st.mtimeMs); } catch {}
    }
    const digest = h.digest('hex');
    let prev = '';
    try { prev = JSON.parse(fs.readFileSync(marker, 'utf8')).digest || '' } catch {}
    if (prev === digest) return false;
    return { digest, files };
  })();
  if (shouldRun && typeof shouldRun === 'object') {
    console.log('[boot] Append detected; running append_from_xlsx for', shouldRun.files.length, 'file(s)');
    try {
      const mod = await import('./tools/append_from_xlsx.js');
      const fn = mod.default || mod.runAppend;
      if (typeof fn === 'function') {
        const res = await fn({ dir: './append', apply: true, patch: true, overwrite: true });
        console.log('[boot] Append result:', JSON.stringify(res));
        // Run name backfills again in case newly appended rows have alternate headers
        try { backfillLawyerName(); } catch {}
        try { fillNamesFromAppendByPhone(); } catch {}
        try { fs.writeFileSync(marker, JSON.stringify({ digest: shouldRun.digest, at: new Date().toISOString(), result: { totalAfter: res?.totalAfter, patched: res?.patched } })) } catch {}
      }
    } catch (e) {
      console.warn('[boot] Append run failed:', e?.message || e);
    }
  } else {
    console.log('[boot] No append action needed');
    // Even if no append, ensure any residual empty LAWYERNAME is backfilled
    try { backfillLawyerName(); } catch {}
    try { fillNamesFromAppendByPhone(); } catch {}
  }
} catch (e) { console.warn('[boot] Append check failed:', e?.message || e) }

// XLSX/Rebuild workflow removed — data edits happen via the web UI only.

const app = express();

// Middleware
// Render sits behind a single proxy; set an exact hop count to keep rate-limit safe
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
app.use(limiter);

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// API routes
app.use('/api', api);

// Static serving from /ui to keep existing frontend unchanged
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log('Server cwd:', process.cwd());
console.log('Server running from:', __dirname);
const root = path.resolve(__dirname, '..');
const staticDir = path.join(root, 'ui');
app.use(express.static(staticDir, { maxAge: '5m', etag: true }));
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
