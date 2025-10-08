// SQLite (better-sqlite3) singleton with sane PRAGMAs and tiny helpers
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Default DB path: use env if provided. In production (Render/Railway), default to /data/app.db.
const DEFAULT_DB = process.env.DATABASE_URL
  || ((process.env.RENDER || process.env.NODE_ENV === 'production') ? '/data/app.db' : path.resolve('./data/app.db'));
const dbDir = path.dirname(DEFAULT_DB);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DEFAULT_DB, { fileMustExist: false, verbose: null });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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
