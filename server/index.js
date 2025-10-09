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
