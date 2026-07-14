# Access DB Browser

A Tauri v2 desktop app (Windows) to browse and manage Microsoft Access databases
(`.accdb` / `.mdb`) via ODBC — without needing Microsoft Access itself.

## Features

- **Open & introspect**: pick an `.accdb`/`.mdb` via file dialog; the last used
  database is reopened automatically on the next start. All user tables and
  saved queries are listed in the sidebar (system objects `MSys*`, `USys*`, `~*`
  are hidden).
- **Data grid**: 50 rows per page, sortable columns (click header), row detail
  side panel (click a row).
- **Filtering**: global search across all columns, plus per-column filters
  (text contains/equals, number ≥/≤/=, date on/after & on/before, boolean,
  NULL / NOT NULL). All filters are ANDed and always sent as *parameterized*
  SQL — no user input is ever concatenated into a query.
- **Full CRUD**:
  - `+ New Row` opens a schema-generated form (correct input per column type;
    AutoNumber columns are excluded and assigned by Access).
  - Inline editing: double-click a cell, `Enter` saves, `Esc` cancels.
    Booleans toggle on double-click.
  - `✎ Edit` per row opens the pre-filled form.
  - `🗑` per row and multi-select + `Delete selected`, both with confirmation.
  - Tables without a primary key are read-only (rows can't be identified
    unambiguously); the UI explains this.
- **Saved Access queries**: listed under "Queries", executed via
  `SELECT * FROM [QueryName]`, shown read-only in the same grid with full
  filtering/sorting/paging/export. Parameter and action queries can't run via
  ODBC — the app shows a clear message instead.
- **CSV export** of the current filtered view (UTF-8 with BOM, Excel-friendly).
- **Lock detection**: if a `.laccdb` lock file is present or the connection
  fails with a lock error, a persistent warning banner appears with a
  "Retry / Reconnect" button. Read-only browsing keeps working when possible.

## Requirements (on any machine running the app)

1. **Windows 10/11 (64-bit)**
2. **Microsoft Edge WebView2 Runtime** — preinstalled on Windows 11 and most
   Windows 10 systems; otherwise the NSIS installer offers to download it.
3. **Microsoft Access Driver (*.mdb, *.accdb), 64-bit** — NOT bundled with the
   app. If missing, install the
   [Microsoft Access Database Engine 2016 Redistributable](https://www.microsoft.com/en-us/download/details.aspx?id=54920)
   (choose the **x64** variant). The app shows a clear error if the driver is
   absent.

## Development

```powershell
npm install
npm run tauri dev
```

Backend integration tests run against a generated test database:

```powershell
$env:TEST_ACCDB = "C:\path\to\test.accdb"
cd src-tauri
cargo test --test db_test -- --nocapture
```

## Build (release + NSIS installer)

```powershell
npm run tauri build
```

Outputs:

- Standalone exe: `src-tauri\target\release\accessdb.exe`
- NSIS installer: `src-tauri\target\release\bundle\nsis\Access DB Browser_<version>_x64-setup.exe`

## Architecture notes

- **Rust backend** (`src-tauri/src/`):
  - `db.rs` — all ODBC work via `odbc-api`; connection-per-request (cheap for
    the local ACE driver, avoids thread-safety issues). Text is decoded/encoded
    as Windows-1252 (the ANSI codepage the narrow ODBC API uses).
  - Primary keys are detected via raw `SQLStatisticsW` (unique indexes,
    preferring the index Access names `PrimaryKey`), because the Access ODBC
    driver does **not** support `SQLPrimaryKeys`.
  - Pagination uses `SELECT TOP (end)` + skipping rows while draining the
    cursor (Access SQL has no `OFFSET`), plus a separate `COUNT(*)` for totals.
  - Integer parameters are bound as `i32` (the driver rejects BIGINT binding).
  - `error.rs` — categorized errors (`driver_missing`, `locked`,
    `parameter_query`, `no_primary_key`, …) so the UI can react appropriately.
- **Frontend** (`src/`): React 19 + TypeScript + Tailwind; all backend calls in
  `api.ts` via Tauri `invoke`.

### Known driver quirks (inherent to the Access ODBC driver)

- Required (NOT NULL) text/number fields are reported as *nullable* by the
  driver; Access still enforces them on insert — the app surfaces the error.
- Parameter queries fail with "Too few parameters" → shown as a friendly hint.
- Memo/long-text cells are truncated at 8 KB for display in the grid.
