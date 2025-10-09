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
- DATABASE_URL (default ./data/app.db locally; defaults to /data/app.db in production)

DB Initialization
- On boot, the server ensures tables for users and audit exist (idempotent), and seeds admin/admin if users is empty.
- The people table is expected to exist (carried over from PowerShell). If missing, you can create/import as before; the server also auto-adds new columns as you post fields.
- First-boot bootstrap: if DATABASE_URL does not exist at startup, the server will try to copy a seed DB from ./data/app.db (repo copy) or ./seed/app.db into the DATABASE_URL path. This makes Render/Railway first deploys pick up your existing DB. To use a different seed, place it in ./seed/app.db before deploying.

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
There is a render.yaml in the repo root. You can one‑click deploy:

Option A — via render.yaml
1) In Render, New → Blueprint → Select your GitHub repo
2) Render reads render.yaml and proposes a web service named my-app
3) Click Apply; first deploy will build and start automatically
   - The service uses:
     - buildCommand: npm install
     - startCommand: node server/index.js
     - plan: starter, region: singapore
     - disk: /data (5GB) mounted for the SQLite file
4) No env vars required; the server uses PORT from the platform and defaults DATABASE_URL to /data/app.db in production. On first boot, it will bootstrap by copying ./data/app.db or ./seed/app.db into /data/app.db if none exists.

Option B — manual Web Service
1) Create a new Web Service from this repo
2) Build Command: npm install
3) Start Command: node server/index.js

Entry point
- The server entry is at server/index.js. Both package.json ("start": "node server/index.js") and render.yaml (startCommand: node server/index.js) point to this path.

Admin UI
- Tabs: Users (list + form), Localities, Revert.
- Users: create/update roles and credentials.
- Localities: manage the list of localities (name, alias, PP, UC). This drives the Locality dropdown in Profile and auto‑sets PP/UC.
- Revert: restore changes by audit window.

Localities & PP/UC mapping
- Localities table (name, alias, pp, uc) is seeded from people on first boot if empty, and again on first /api/localities if needed.
- Editors can only pick a Locality. PP/UC are set automatically and are not editable for editors.
- Admins can edit PP/UC directly or adjust the Locality mapping.

Removed Excel import
- All Excel import routes and UI have been removed for the final launch.
- To update data in the future, use the web UI only.
4) Add a persistent disk mounted at /data (>=5GB)
5) (Optional) Set DATABASE_URL=/data/app.db (defaults to this in production). The server will copy ./data/app.db or ./seed/app.db into /data/app.db on first boot if the file is missing.

Deployment (Railway)
1) Create a new project → Deploy from GitHub
2) Add Env Vars:
   - PORT = 3000
   - DATABASE_URL = ./data/app.db
3) Add a persistent volume (Railway plugin) mounted at /data; place your DB there for persistence across deploys.

Notes
- SQLite prefers a single process instance; avoid multi-instance horizontal scaling.
- HTTPS is handled by the platform; the server binds 0.0.0.0 and listens on PORT.

Spreadsheet Source of Truth (XLSX)
- Preferred location in production: `/data/tbl_localities.xlsx`
- Admin can upload/replace via API:
  - POST `/api/admin/upload-xlsx` (admin only)
  - Body (JSON): { "data": "<base64-of-xlsx>", "sha256": "<optional-expected-hex>" }
  - Writes to `/data/tbl_localities.xlsx` atomically and returns size/checksum.
- Rebuild database while preserving recent contact fields:
  - POST `/api/admin/rebuild-preserve`
    - Optional body: { "path": "/data/tbl_localities.xlsx" }
    - Auto-detects spreadsheet in order: request path, `/data/tbl_localities.xlsx`, `./tbl_localities.xlsx`, `<cwd>/tbl_localities.xlsx`, `<cwd>/data/tbl_localities.xlsx`.
    - After success, always copies source to `/data/tbl_localities.xlsx`.
    - Returns: { ok, path, sizeBytes, sha256, rowsInXlsx, preservedCount, importedCount, totalAfter, sample }.
- Verify totals and preservation:
  - Expect `totalAfter` to equal 24684.
  - Inspect `sample` for 3–5 preserved rows showing before/after of Called/Visited/ConfirmedVoter/CallDate/VisitDate/LawyerForum.
- Debug helpers (admin or X-Debug-Token; token only required in production):
  - GET `/api/_debug/xlsx` → { path, exists, sizeBytes, sha256 }
  - GET `/api/_debug/db` → { dbPath, exists, sizeBytes, tablesCount }
  - GET `/api/_debug/tables` → { tables: [{ name, count }] }

Automatic Apply on Boot (hands-off)
- If `/data/tbl_localities.xlsx` exists (or `./tbl_localities.xlsx` in the repo), the server will on startup:
  - Copy it into `/data/tbl_localities.xlsx` if needed
  - Compute its SHA-256 and compare with `/data/.xlsx_applied.sha256`
  - If different, run the rebuild-preserve process automatically and then record the checksum
- This keeps deployments fully hands-off: committing `./tbl_localities.xlsx` with the desired content and redeploying will refresh the DB automatically while preserving recent contact fields.

Search Ordering Safety
- GET `/api/search` supports `sort` (whitelist: last_name, first_name, email, name/lawyername) and `desc=true`.
- Ordering is case-insensitive for text columns (`COLLATE NOCASE`), and LIMIT/OFFSET are bound parameters.

