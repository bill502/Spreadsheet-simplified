import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

import { initDb, runMigrations } from './db.js';
import api from './routes/api.js';

dotenv.config();
initDb();
try {
  runMigrations();
} catch {}

const app = express();

// Middleware
app.set('trust proxy', true);
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
