Spreadsheet simplified — multi-user editor for XLSX via PowerShell

Overview

- Serves a local web UI to search, edit, and comment on rows in an Excel spreadsheet.
- No external dependencies; uses PowerShell + Excel COM automation.
- Stores comments in a "Comments" column (auto-added if missing) with timestamped entries.

Project layout

- `tbl_localities.xlsx` — Your spreadsheet (Sheet1 used as data source)
- `scripts/server.ps1` — PowerShell web API and static file server
- `ui/index.html`, `ui/app.js` — Browser UI (single-page)

Run

1) Ensure Microsoft Excel is installed (COM automation required).
2) Open PowerShell in the project root.
3) Start the server:

   `pwsh -File .\scripts\server.ps1 -Port 8080`

   Optional: specify a different spreadsheet:

   `pwsh -File .\scripts\server.ps1 -FilePath .\path\to\your.xlsx`

4) Open the app: http://localhost:8080/

Notes

- Search scans all columns (case-insensitive). Results are limited (default 100).
- Click a row to edit its fields. Save to persist back into the Excel file.
- Add a comment to append a timestamped entry to the `Comments` column.
- Edits are saved immediately to the workbook on each action.

Limitations and tips

- Uses the first worksheet in the workbook. Rename or reorder if needed.
- Identifies rows by Excel row number; if you have a unique key column, you can search by it.
- For multi-user access on a LAN, run the server on a machine accessible to others and adjust the `-Address` (e.g., `http://0.0.0.0`) and firewall rules. Only allow trusted access.
- Excel COM is single-process; the server serializes access to avoid conflicts.


