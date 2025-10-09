import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import db, { initDb, runMigrations } from './db.js';
import api from './routes/api.js';

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

// Auto-apply spreadsheet on boot (hands-off):
// - Prefer /data/tbl_localities.xlsx; if missing, copy from repo ./tbl_localities.xlsx
// - If the applied checksum differs from previously applied one, rebuild DB preserving recent contact fields
try {
  const cwd = process.cwd();
  const repoXlsx = path.resolve(cwd, 'tbl_localities.xlsx');
  const dataXlsx = '/data/tbl_localities.xlsx';
  const marker = '/data/.xlsx_applied.sha256';
  const candidates = [dataXlsx, repoXlsx, path.join(cwd, 'data', 'tbl_localities.xlsx')];
  const found = candidates.find(p => { try { return fs.existsSync(p) } catch { return false } });
  if (!found) {
    console.log('[boot] No spreadsheet found to apply. Skipping auto-rebuild.');
  } else {
    // Ensure /data copy exists and is current
    try { fs.mkdirSync('/data', { recursive: true }); } catch {}
    if (found !== dataXlsx) {
      try { fs.copyFileSync(found, dataXlsx); console.log(`[boot] Copied spreadsheet ${found} -> ${dataXlsx}`) } catch (e) { console.warn('[boot] Copy spreadsheet failed:', e?.message || e) }
    }
    // Compute checksum
    let sha = null; let size = 0;
    try { const buf = fs.readFileSync(dataXlsx); size = buf.length; sha = crypto.createHash('sha256').update(buf).digest('hex') } catch {}
    const prev = (()=>{ try { return fs.readFileSync(marker, 'utf8').trim() } catch { return '' } })();
    const shouldRun = !!sha && sha !== prev;
    if (!shouldRun) {
      console.log('[boot] Spreadsheet already applied (checksum match). Skipping rebuild.');
    } else {
      console.log(`[boot] Applying spreadsheet ${dataXlsx} (size ${size} bytes, sha256 ${sha})`);
      try {
        const mod = await import('./tools/rebuild_from_xlsx_preserve_recent.js');
        const func = mod.runRebuild || mod.default;
        if (typeof func === 'function') {
          const res = await func(dataXlsx);
          console.log('[boot] Rebuild result:', JSON.stringify(res));
          try {
            const expected = Number(process.env.EXPECTED_TOTAL || 24684);
            if (typeof res?.totalAfter === 'number' && res.totalAfter !== expected) {
              console.warn(`[boot] WARNING: totalAfter ${res.totalAfter} != expected ${expected}`);
            }
          } catch {}
          try { fs.writeFileSync(marker, sha) } catch {}
        } else {
          console.warn('[boot] Rebuild function not available');
        }
      } catch (e) {
        console.warn('[boot] Auto-rebuild failed:', e?.message || e);
      }
    }
  }
} catch (e) {
  console.warn('[boot] Auto-apply spreadsheet check failed:', e?.message || e);
}

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
