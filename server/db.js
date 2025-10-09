// SQLite (better-sqlite3) singleton with sane PRAGMAs and tiny helpers
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Default DB path: use env if provided. In production (Render/Railway), default to /data/app.db.
const DEFAULT_DB = process.env.DATABASE_URL
  || ((process.env.RENDER || process.env.NODE_ENV === 'production') ? '/data/app.db' : path.resolve('./data/app.db'));

console.log('[db] DATABASE_URL =', DEFAULT_DB);

// First-boot bootstrap: if DB path does not exist, copy from a seed in the repo if available
try {
  const target = DEFAULT_DB;
  const targetDir = path.dirname(target);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const needsBootstrap = !fs.existsSync(target);
  if (needsBootstrap) {
    const candidates = [
      path.resolve('./data/app.db'),
      path.resolve('./seed/app.db'),
    ];
    const seed = candidates.find(p => fs.existsSync(p));
    if (seed) {
      fs.copyFileSync(seed, target);
      console.log(`[db] Bootstrapped database: copied seed ${seed} -> ${target}`);
    } else {
      console.log(`[db] No seed DB found. A new database will be created at ${target}`);
    }
  }
} catch (e) {
  console.warn('[db] Bootstrap copy failed:', e?.message || e);
}
const dbDir = path.dirname(DEFAULT_DB);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// If DB exists but lacks 'people' OR 'people' is empty and a seed is available, replace it before opening main connection
try {
  if (fs.existsSync(DEFAULT_DB)) {
    let needsReplace = false; let tmp;
    try {
      tmp = new Database(DEFAULT_DB, { fileMustExist: false });
      const row = tmp.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='people'").get();
      if (!row) {
        needsReplace = true;
      } else {
        try {
          const cnt = tmp.prepare('SELECT COUNT(*) AS c FROM people').get().c;
          console.log(`[db] Existing DB has people rows: ${cnt}`);
          if (Number(cnt) === 0) needsReplace = true;
        } catch { needsReplace = true }
      }
    } catch { needsReplace = true } finally { try { tmp?.close() } catch {} }
    if (needsReplace) {
      const candidates = [path.resolve('./seed/app.db'), path.resolve('./data/app.db')];
      const seed = candidates.find(p => fs.existsSync(p));
      if (seed) { fs.copyFileSync(seed, DEFAULT_DB); console.log(`[db] Replaced DB with seed ${seed} -> ${DEFAULT_DB}`) }
    }
  }
} catch (e) { console.warn('[db] Seed replacement check failed:', e?.message || e) }

const db = new Database(DEFAULT_DB, { fileMustExist: false, verbose: null });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// --- Simple migration runner ---
function getServerDir() {
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
}

function ensureMigrationsTable() {
  db.prepare(`CREATE TABLE IF NOT EXISTS __migrations (
    name TEXT PRIMARY KEY,
    run_at TEXT
  )`).run();
}

export async function runMigrations() {
  try {
    ensureMigrationsTable();
    const serverDir = getServerDir();
    const migDir = path.join(serverDir, 'migrations');
    if (!fs.existsSync(migDir)) return;
    const filesSql = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
    const applied = new Set(db.prepare('SELECT name FROM __migrations').all().map(r => r.name));
    const tx = db.transaction((sqlFiles) => {
      for (const f of sqlFiles) {
        if (applied.has(f)) continue;
        const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
        db.exec(sql);
        db.prepare('INSERT INTO __migrations(name, run_at) VALUES(?, ?)').run(f, new Date().toISOString());
        console.log('[db] Applied migration', f);
      }
    });
    tx(filesSql);

    // JS migrations (for complex operations like dropping a column)
    const filesJs = fs.readdirSync(migDir).filter(f => f.endsWith('.js')).sort();
    for (const f of filesJs) {
      if (applied.has(f)) continue;
      const modUrl = pathToFileURL(path.join(migDir, f)).href;
      const mod = await import(modUrl);
      if (typeof mod.default === 'function') {
        const run = db.transaction(() => {
          mod.default(db);
          db.prepare('INSERT INTO __migrations(name, run_at) VALUES(?, ?)').run(f, new Date().toISOString());
        });
        run();
        console.log('[db] Applied JS migration', f);
      }
    }
  } catch (e) {
    console.error('[db] Migration error:', e?.message || e);
    throw e;
  }
}

export function initDb() {
  // Ensure required tables exist (idempotent). People table likely already present.
  db.prepare(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    role TEXT
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    ts TEXT,
    user TEXT,
    action TEXT,
    rowNumber INTEGER,
    details TEXT,
    before TEXT,
    after TEXT
  )`).run();

  // Seed admin/admin if empty
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run('admin', 'admin', 'admin');
  }
}

export function getDb() { return db; }

export function getColumns() {
  const rows = db.prepare('PRAGMA table_info(people)').all();
  return rows.map(r => r.name);
}

export default db;
