Spreadsheet Simplified — Multi‑User Editor (SQLite‑backed)

Overview

- Local web UI to search, view, and update records primarily on mobile.
- Backend uses SQLite for multi‑user safe edits; first run can import from the provided Excel.
- Comments are timestamped; Called/Visited checkboxes set dates; LawyerForum is editable inline.

Project layout

- `tbl_localities.xlsx` — Source Excel (Sheet1) for initial import (optional)
- `scripts/server_sqlite.ps1` — SQLite web API and static server (recommended)
- `scripts/server.ps1` — Legacy Excel/COM server (original version)
- `ui/index.html`, `ui/app.js` — Browser UI (single‑page)
- `lib/sqlite/` — ADO.NET provider files (System.Data.SQLite.dll and SQLite.Interop.dll)
- `data/app.db` — SQLite database file (created on first run)

Run (SQLite)

1) Prereqs
   - Windows x64 + PowerShell 7
   - lib/sqlite contains System.Data.SQLite.dll and SQLite.Interop.dll (x64)
2) First run (imports Excel → SQLite):

   `pwsh -File .\scripts\server_sqlite.ps1 -Port 8080 -ExcelPath .\tbl_localities.xlsx`

   This creates `data\app.db` and serves the app.

3) Subsequent runs (no import):

   `pwsh -File .\scripts\server_sqlite.ps1 -Port 8080`

4) Open: http://localhost:8080/

Notes

- Search scans all columns (case‑insensitive). Default limit 50; click “Show more” to load more.
- Click a row to open Profile.
  - Compact view shows: Name, Phone, Address, Status, PP, UC, Locality.
  - Checkboxes: Called/Visited (auto‑dates), Confirmed Voter.
  - LawyerForum is editable inline in compact view; Save Forum persists it.
  - Click “Edit Info” for full field editing; Save Changes persists.
- Comments: add a timestamped entry to the Comments field.

Limitations and tips

- Import reads the first worksheet. For changes after import, SQLite is the live source (not Excel).
- Rows are identified by `rowNumber` imported from Excel used range (absolute row index).
- For LAN access, run with `-Address http://0.0.0.0` and open firewall; only allow trusted networks.

Troubleshooting
- If POST requests fail with a Read‑BodyJson error, restart the SQLite server (script includes the parser).
- If SQLite provider errors occur, ensure both files exist under `lib/sqlite/` and install the VC++ 2015‑2022 x64 runtime.

Publish to GitHub

- Ensure Git is installed and available on your PATH.
- In a terminal at the project root, run:

  `git init`

  `git add .`

  `git commit -m "SQLite server + mobile UI updates"`

- Create a new empty repository on GitHub (no README/license). Copy its URL, e.g. `https://github.com/yourname/spreadsheet-simplified.git`.

- Add remote and push:

  `git branch -M main`

  `git remote add origin https://github.com/yourname/spreadsheet-simplified.git`

  `git push -u origin main`

- If you use GitHub CLI (gh):

  `gh repo create yourname/spreadsheet-simplified --source . --public --push`
