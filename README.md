Lawyer Voter Database — Node.js + SQLite Server

Overview
- Express server that serves the existing frontend (ui/) and exposes REST APIs equivalent to the prior PowerShell backend.
- Uses better-sqlite3 for synchronous, simple access to the same SQLite DB (./data/app.db by default).
- Minimal frontend changes — same /api/* shapes.

Quick Start
1) Install deps
   npm i

2) Configure env
   cp .env.example .env
   # Optionally edit DATABASE_URL if your DB is elsewhere

3) Run in dev
   npm run dev

4) Open
   http://localhost:3000

Configuration
- PORT (default 3000)
- DATABASE_URL (default ./data/app.db)

DB Initialization
- On boot, the server ensures tables for users and audit exist (idempotent), and seeds admin/admin if users is empty.
- The people table is expected to exist (carried over from PowerShell). If missing, you can create/import as before; the server also auto-adds new columns as you post fields.

Endpoints (selected)
- GET /health → { ok: true }
- GET /api/columns → { columns: [...] }
- GET /api/search?q=&limit=&by=uc|pp|locality
- GET /api/row/:id
- POST /api/row (editor+)
- POST /api/row/:id (editor+)
- POST /api/row/:id/comment (editor+)
- POST /api/login, POST /api/logout, GET /api/me
- GET /api/admin/users (admin)
- POST /api/admin/user (admin) — upsert/rename, basic validation
- DELETE /api/admin/user/:username (admin) — prevents deletion of last admin
- POST /api/admin/revert (admin) — revert by audit window
- GET /api/reports (editor+) — filters for called/visited/user/modified/uc/pp/locality

Security & Stability
- CORS enabled with credentials
- morgan(tiny) logging
- express-rate-limit with a default window
- JSON body parsing
- SQLite PRAGMAs: WAL, NORMAL, foreign_keys ON, busy_timeout 5000

Deployment (Render)
1) Create a new Web Service from this repo
2) Set Build Command: npm i
3) Set Start Command: npm start
4) Add Env Vars:
   - PORT = 3000 (Render sets this; server also reads it)
   - DATABASE_URL = ./data/app.db
5) Add a persistent disk mounted at /data (at least 1GB). Ensure DATABASE_URL points inside or copy your DB into it on first boot.

Deployment (Railway)
1) Create a new project → Deploy from GitHub
2) Add Env Vars:
   - PORT = 3000
   - DATABASE_URL = ./data/app.db
3) Add a persistent volume (Railway plugin) mounted at /data; place your DB there for persistence across deploys.

Notes
- SQLite prefers a single process instance; avoid multi-instance horizontal scaling.
- HTTPS is handled by the platform; the server binds 0.0.0.0 and listens on PORT.
