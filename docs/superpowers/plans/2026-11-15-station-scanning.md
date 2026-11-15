# Station Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track every piece of hair by its own serial from arrival at HQ, moved only by station scans, with team-leader dashboards and read-only progress for everyone else.

**Architecture:** Replace batch `production_records` with `pieces` (one row per serial, own stage) plus `piece_events` history. All writes stay in security-definer Postgres functions; the React app routes each role to its home screen and locks STATION users to the scanner.

**Tech Stack:** React 19 + react-router 7 + Vite, Supabase (Postgres, RLS, edge function `admin-users`), `jsbarcode@3.11.6` (labels), `@zxing/browser@0.1.5` (camera fallback), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-15-station-scanning-design.md`

## Global Constraints

- Serial format: `SS-` + 6-digit zero-padded id (`SS-000001`), Code 128 barcode.
- New roles: `STATION`, `LEADER`, each with `profiles.station` = one station stage code; null for all other roles.
- Station stages (one station each): `RSB`, `WEFTING`, `VENT_MARINDUQUE`, `VENT_HQ_PCR`, `VENT_HQ_FIXING`, `CURLING`, `FOR_QA` (label "QA station").
- First stage `RECEIVED` ("Received at HQ") replaces `ALLOCATED`. Outcome stages `READY`, `REJECTED`; inventory stages `SHIPPED`, `IN_STOCK`.
- Only `station_scan`, `qa_result` and `leader_fix` change a piece's station stage. OWNER/ADMIN/PRODUCTION/QA have no stage-changing UI or permission.
- INVENTORY: receive, print/reprint labels, link/unlink orders, ship, receive to stock.
- Scanner input accepted only at scanner speed: whole code within `SCAN_MAX_MS = 300` (one constant in `src/lib/scan.js`). Camera reads always accepted. LEADER manual entry logged with method `manual`.
- Every destructive/state change is a DB function; tables stay read-only via RLS. New functions: `revoke ... from public, anon` and explicit `grant ... to authenticated`; internal helpers revoked from `authenticated`.
- The database is empty: drop old production tables/functions instead of migrating rows.
- SQL checks live in `supabase/tests/*.sql`, each `begin; … rollback;`, failing via `raise exception`. Run them with the Supabase MCP `execute_sql` (project `fygmtcqfwshfsbrvhvas`) and expect no error.

## Review Focus

1. **Scanner double-fire / re-scan** — the same serial scanned twice within a second must give one move and a clear "already at this station" on the second, never two events. (Task 3 test `rescan_same_station_refused`.)
2. **Station user typing a URL** (`/users`, `/production`) — must land back on `/station`, not a Forbidden page. (Task 6 test `stationHome`.)
3. **Scanners that end with Tab, not Enter, or send slowly over Bluetooth** — Tab must submit too; a 9-char code over 250 ms still counts as a scan. (Task 5 tests.)
4. **Serial noise** — lowercase, surrounding spaces, or a scanner-added `]C0` symbology prefix must resolve to the same piece. (Task 3 test `serial_normalised`, Task 5 test `normaliseSerial`.)
5. **Over-linking and shipping the wrong pieces** — linking more pieces than a line ordered, shipping unlinked or not-Ready pieces, receiving linked pieces to stock: all refused with a message naming the serial. (Task 4 tests.)

---

### Task 1: Roles and stations

**Files:**
- Create: `supabase/migrations/20261116000100_station_roles.sql`, `supabase/tests/01_station_roles.sql`
- Modify: `supabase/functions/admin-users/index.ts` (ROLES list, create/update accept `station`), `src/lib/perms.js`, `src/pages/Users.jsx`

**Interfaces:**
- Produces: `profiles.station text references production_stages(code)`; check `(role in ('STATION','LEADER')) = (station is not null)`. `has_perm(p)` new cases: `'station.scan'` → role in (STATION, LEADER); `'station.lead'` → LEADER; `'receiving.manage'` → INVENTORY, OWNER, ADMIN; `'production.manage'` and `'qa.manage'` → **false for every role** (kept so old callers fail closed). `public.my_station() returns text`. JS: `ROLE_LABELS` gains `STATION: 'Station'`, `LEADER: 'Team leader'`; `can()` mirrors the SQL; new `isStationRole(role) -> boolean`.

- [ ] **Step 1:** Write `01_station_roles.sql`: as a STATION profile with station `RSB`, assert `has_perm('station.scan')`, `not has_perm('station.lead')`, `my_station() = 'RSB'`; as INVENTORY assert `has_perm('receiving.manage')` and `not has_perm('production.manage')`; inserting a STATION profile with null station raises.
- [ ] **Step 2:** Run it via `execute_sql`. Expected: error (column `station` does not exist).
- [ ] **Step 3:** Write the migration (role check widened to 7 roles, `station` column + check, `has_perm`, `my_station`); add `RECEIVED` stage row here so the FK target exists.
- [ ] **Step 4:** Apply migration, rerun the test. Expected: no error.
- [ ] **Step 5:** Edge function: `ROLES` += `STATION`, `LEADER`; create/update take `station`, required for those roles and cleared otherwise (400 "Choose a station."). Deploy with MCP `deploy_edge_function`.
- [ ] **Step 6:** Users page: Station column/select shown when role is STATION/LEADER, options = station stages; `ROLE_HELP` lines for both roles.
- [ ] **Step 7:** `npm test` and `vite build` pass. Commit.

### Task 2: Pieces schema (replaces production records)

**Files:**
- Create: `supabase/migrations/20261116000200_pieces.sql`, `supabase/tests/02_pieces_schema.sql`

**Interfaces:**
- Produces tables: `receipts(id, received_at, qty, note, created_by)`; `pieces(id, serial generated 'SS-'||lpad(id,6,'0') unique, receipt_id null, stage → production_stages, status ACTIVE|ON_HOLD|CANCELED, item_id null, order_line_id null, stage_since timestamptz, import_batch_id null, created_at, updated_at)`; `piece_events(id, piece_id, event RECEIVED|IMPORTED|SCAN|QA|FIX|LINK|UNLINK|STATUS|SHIP|STOCK, from_stage, to_stage, station, method scanner|camera|manual|null, out_of_order bool default false, note, created_by, created_at)`; `qa_results(id, piece_id, passed bool, defects, inspected_by, inspected_at)`. `stock_movements.piece_id` replaces `production_id`.
- Produces read function `piece_board(p_serial text default null, p_include_closed boolean default false)` returning: id, serial, stage, stage_label, stage_sort, status, stage_since, item_id, item_name, order_line_id, order_id, order_no, client_name, group_label, receipt_id, last_event_at. Security definer, `has_perm('production.view')`.
- Rewrites `order_line_committed(line)` and `v_order_lines` production columns to count pieces (`count(*)` where status <> 'CANCELED') instead of `sum(qty)`.
- Drops: `production_units`, `production_records`, `production_events`, `qa_inspections`, `production_board`, `create_production_record`, `move_production`, `set_production_status`, `record_qa_inspection`, `_split_move`, `_isolate_unit`, `_unit_by_serial`, `_create_units`, `scan_move_unit`, `scan_qa_unit`. Stage `ALLOCATED` deleted after `RECEIVED` exists; `FOR_QA` relabelled "QA station".

- [ ] **Step 1:** Write `02_pieces_schema.sql`: insert a piece (as postgres) and assert serial `SS-000001`-shaped (`~ '^SS-\d{6}$'`); `piece_board()` as an INVENTORY user returns it with `stage_label = 'Received at HQ'`; `to_regclass('public.production_records') is null`; reading `pieces` as authenticated works, `insert` as authenticated fails.
- [ ] **Step 2:** Run. Expected: error (relation `pieces` does not exist).
- [ ] **Step 3:** Write migration (drop old objects first, then create; RLS select policies via `has_perm('production.view')`; audit trigger on `pieces`, `receipts`; `touch_updated` on `pieces`).
- [ ] **Step 4:** Apply, rerun test. Expected: no error. Then reset `pieces` identity to 1.
- [ ] **Step 5:** Commit.

### Task 3: Receiving, station scan, QA, leader fix

**Files:**
- Create: `supabase/migrations/20261116000300_scan_functions.sql`, `supabase/tests/03_scan_functions.sql`

**Interfaces:**
- Consumes: Task 1 perms, Task 2 tables.
- Produces (all return `jsonb` = the `piece_board` row of the affected piece unless noted):
  - `receive_pieces(p_qty int, p_note text default null) returns bigint` (receipt id) — `receiving.manage`; 1 ≤ qty ≤ 500; pieces in `RECEIVED`, event `RECEIVED`.
  - `station_scan(p_serial text, p_method text) returns jsonb` — `station.scan`; target = `my_station()`. Refuses: unknown serial ("No piece with serial X."), status not ACTIVE, stage in READY/SHIPPED/IN_STOCK ("X is already finished."), already at this station ("X is already at this station."). `out_of_order = true` when the source stage's sort_order is not the station stage immediately before (RECEIVED counts as before RSB; REJECTED never out of order).
  - `qa_result(p_serial text, p_passed boolean, p_defects text default null) returns jsonb` — `station.scan` and `my_station() = 'FOR_QA'`; piece must be at `FOR_QA`; defects required when rejecting; writes `qa_results` + event `QA`.
  - `leader_fix(p_serial text, p_to_stage text, p_reason text) returns jsonb` — `station.lead`; to_stage must be RECEIVED or a station stage; reason required; event `FIX`.
  - `set_piece_status(p_serial text, p_status text, p_reason text default null) returns jsonb` — `receiving.manage`, or `station.lead` when the piece is at the leader's station; cancel needs reason.
  - Internal `_piece(p_serial text) returns pieces` (for update): normalises with `upper(btrim(regexp_replace(p_serial, '^\]C0', '')))`. Revoked from authenticated.

- [ ] **Step 1:** Write `03_scan_functions.sql` with named blocks, each `raise exception` on failure:
  - `receive_creates_pieces`: INVENTORY `receive_pieces(3)` → 3 pieces in RECEIVED.
  - `station_moves_piece`: STATION@RSB scans one → stage RSB, event SCAN, method scanner, out_of_order false.
  - `rescan_same_station_refused`: second scan raises 'already at this station'.
  - `serial_normalised`: `station_scan(' ]C0' || lower(serial) || ' ', 'scanner')` from STATION@WEFTING succeeds.
  - `skip_flagged`: STATION@CURLING scanning a WEFTING piece → succeeds with out_of_order true.
  - `qa_pass_and_reject`: STATION@FOR_QA scans then `qa_result(true)` → READY; another `qa_result(false, null)` raises; with defects → REJECTED.
  - `finished_refused`: scanning a READY piece raises 'already finished'.
  - `leader_fix_needs_reason`: LEADER@RSB `leader_fix(serial,'RSB','')` raises; with reason → stage RSB, event FIX.
  - `viewer_cannot_move`: PRODUCTION and QA users calling `station_scan` raise 42501.
- [ ] **Step 2:** Run. Expected: error (function `receive_pieces` does not exist).
- [ ] **Step 3:** Write the migration with the functions above; `stage_since = now()` on every stage change.
- [ ] **Step 4:** Apply, rerun. Expected: no error.
- [ ] **Step 5:** Commit.

### Task 4: Orders, shipping, stock, import

**Files:**
- Create: `supabase/migrations/20261116000400_piece_orders.sql`, `supabase/tests/04_piece_orders.sql`
- Modify: import function (`import_workbook` body from `20261022000200_functions.sql`, redefined in the new migration), `src/import/orders.js` (`[/ALLOCATED/, 'RECEIVED']`)

**Interfaces:**
- Produces: `link_pieces(p_order_line_id bigint, p_serials text[]) returns int` (count linked; sets `item_id` from the line; refuses canceled/shipped pieces, pieces linked elsewhere, and exceeding `qty_ordered − committed`); `unlink_piece(p_serial text) returns jsonb` (not SHIPPED); `ship_pieces(p_serials text[]) returns int` (READY + linked → SHIPPED, one OUT stock movement per line with qty = pieces); `receive_to_stock(p_serials text[], p_item_id bigint, p_location text default 'HQ') returns int` (READY + unlinked → IN_STOCK, IN movement). All `receiving.manage`, events LINK/UNLINK/SHIP/STOCK. Import creates `qty` pieces per stage cell, event IMPORTED.

- [ ] **Step 1:** Write `04_piece_orders.sql`: `link_too_many_refused` (line qty 2, linking 3 raises); `link_sets_item`; `ship_requires_ready_and_linked` (unlinked READY raises, RSB linked raises, READY linked → SHIPPED and one OUT movement qty 2); `stock_requires_unlinked`; `import_creates_pieces` (one line with `{"stage":"RSB","qty":2}` → 2 RSB pieces).
- [ ] **Step 2:** Run. Expected: error (function `link_pieces` does not exist).
- [ ] **Step 3:** Write migration.
- [ ] **Step 4:** Apply, rerun. Expected: no error. `npm test` still passes (import parser mapping).
- [ ] **Step 5:** Commit.

### Task 5: Scan input logic (pure JS)

**Files:**
- Create: `src/lib/scan.js`, `tests/scan.test.mjs`

**Interfaces:**
- Produces: `SCAN_MAX_MS = 300`; `normaliseSerial(raw: string) -> string` (strip `]C0`, trim, uppercase); `createScanGate({ now = () => performance.now(), maxMs = SCAN_MAX_MS }) -> { key(char: string): void, submit(): { code: string, scanned: boolean } | null, reset(): void }` — `submit` returns null on empty, `scanned = (lastKeyAt − firstKeyAt) <= maxMs`; `isSubmitKey(key: string) -> boolean` (Enter or Tab).

- [ ] **Step 1:** Tests: `normaliseSerial(' ]C0ss-000012 ') === 'SS-000012'`; gate fed 9 keys 25 ms apart → `scanned true`; 9 keys 150 ms apart → `scanned false`; `isSubmitKey('Tab')` and `('Enter')` true, `('a')` false; submit after reset → null.
- [ ] **Step 2:** `npm test`. Expected: FAIL (cannot find module `src/lib/scan.js`).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: Role routing and the Scanner screen

**Files:**
- Create: `src/lib/home.js`, `tests/home.test.mjs`, `src/pages/station/Scanner.jsx`, `src/pages/station/Station.css`, `src/components/CameraScanner.jsx`
- Modify: `src/App.jsx` (STATION → only `/station`; LEADER → `/station`, `/station/overview`, `/account`, progress pages), `src/components/Layout.jsx` (NAV per role; station users get no sidebar), `package.json` (`@zxing/browser@0.1.5` + its peer `@zxing/library@0.21.3`)

**Interfaces:**
- Produces: `homeFor(role) -> string` (`STATION` → `/station`, `LEADER` → `/station/overview`, else `/`); `allowedPath(role, path) -> boolean`. `<CameraScanner onCode={(code: string) => void} onError={(msg: string) => void} />` — uses `window.BarcodeDetector` with formats `['code_128']` when available, else `BrowserMultiFormatReader` from `@zxing/browser`; back camera preferred; stops tracks on unmount.
- Consumes: `station_scan`, `qa_result` (Task 3), `createScanGate`/`isSubmitKey`/`normaliseSerial` (Task 5).

- [ ] **Step 1:** Tests in `home.test.mjs`: `stationHome` — `homeFor('STATION') === '/station'`, `allowedPath('STATION','/users') === false`, `allowedPath('STATION','/station') === true`; `homeFor('INVENTORY') === '/'`; `allowedPath('LEADER','/station/overview') === true`.
- [ ] **Step 2:** `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `home.js`; App redirects any disallowed path to `homeFor(role)`; Login's post-login redirect uses `homeFor(role)` instead of `/`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Scanner screen: station label header; a visually hidden, always-refocused input fed through the scan gate (`keydown` → `gate.key`, submit on `isSubmitKey`); slow input shows "Please scan the barcode."; "Use camera" toggles `<CameraScanner>`; result panel (green/red, product and order when known), beep (reuse the 2026-11-15 tone), last 10 scans. At `FOR_QA`: after a successful scan show **Pass** / **Reject** (defect picker: shedding, uneven weft, lace tear, colour mismatch, other + text), calling `qa_result`. LEADER also sees "Enter serial manually" (method `manual`).
- [ ] **Step 6:** Browser check (preview `web`, port from preview_start): station account lands on `/station`; typing `/users` returns to `/station`; typed serial refused; pasted-fast serial (`javascript_tool` dispatching keydowns 10 ms apart) moves the piece; camera button shows permission prompt or fallback message. Commit.

### Task 7: Team leader dashboard

**Files:**
- Create: `src/pages/station/Overview.jsx`
- Modify: `src/App.jsx` route `/station/overview`

**Interfaces:**
- Consumes: `piece_board()` filtered client-side to `my station`; `piece_events` select for today/this week where `station = my station`; `leader_fix`, `set_piece_status`.

- [ ] **Step 1:** Stats row: at station now, scanned in today, this week, oldest waiting (from `stage_since`), out-of-order scans this week.
- [ ] **Step 2:** Pieces table (serial, product, order, arrived, waiting) with **Fix** (modal: stage select = RECEIVED + station stages, reason required) and **Hold/Reactivate**; recent scans table (serial, by, method, out-of-order badge, time).
- [ ] **Step 3:** Browser check as a LEADER: figures match a seeded scan; Fix with empty reason shows the DB error; Fix with reason moves the piece. Commit.

### Task 8: Receiving and labels

**Files:**
- Create: `src/pages/Receiving.jsx`
- Modify: `src/pages/ProductionLabels.jsx` → route `/labels?receipt=ID` or `?serials=SS-1,SS-2` (rename file to `src/pages/Labels.jsx`), `src/App.jsx`, NAV (`Receiving`, perm `receiving.manage`)

**Interfaces:**
- Consumes: `receive_pieces`, `piece_board`, `receipts`.

- [ ] **Step 1:** Receiving form (qty 1–500, note) → on success navigate to `/labels?receipt=<id>`; receipts table (date, qty, by, note, **Reprint labels**).
- [ ] **Step 2:** Labels page reads pieces by receipt or serial list; label shows serial barcode, "Received <date>", product/order when known. LEADER can open it for a single serial (reprint).
- [ ] **Step 3:** Browser check: receive 3 → 3 labels SS-…; print preview hides chrome. Commit.

### Task 9: Read-only progress views

**Files:**
- Create: `src/pages/Piece.jsx` (`/pieces/:serial`)
- Modify: `src/pages/Production.jsx` (pieces board: counts per stage + filterable table by stage/order/serial, links to piece page), `src/pages/Dashboard.jsx` (counts from `piece_board`; "awaiting QA" = stage FOR_QA), `src/pages/QA.jsx` (read-only: pieces at QA station, recent `qa_results`), `src/pages/Reports.jsx` (production report from pieces + `qa_results`; audit table list `pieces`, `receipts`)
- Delete: `src/pages/ProductionNew.jsx`, `src/pages/ProductionDetail.jsx`, `src/pages/Scan.jsx`, `src/pages/Scan.css`, `src/components/QaForm.jsx`

**Interfaces:**
- Consumes: `piece_board`, `piece_events`, `qa_results`.

- [ ] **Step 1:** Piece page: stage badge, status, product, order, full event timeline (event, from → to, station, by, method, out-of-order badge, time).
- [ ] **Step 2:** Rewrite board/dashboard/QA/report pages; no page offers a stage change.
- [ ] **Step 3:** `grep -rn "production_records\|production_board\|move_production\|qa_inspections" src` returns nothing; `vite build` passes. Browser check as PRODUCTION: board and piece page show, no move controls. Commit.

### Task 10: Orders — link, ship, stock

**Files:**
- Modify: `src/pages/OrderDetail.jsx` (replace "Send to production" with per-line **Link pieces**: scan-or-type serial list + pick from unlinked pieces; linked pieces per line with stage; **Ship ready pieces**), stock receive action on Production board for READY unlinked pieces (INVENTORY only)

**Interfaces:**
- Consumes: `link_pieces`, `unlink_piece`, `ship_pieces`, `receive_to_stock`.

- [ ] **Step 1:** Implement; errors surface via `useAction`/`ActionResult`.
- [ ] **Step 2:** Browser check as INVENTORY: link 2 to a line of 2; a third is refused; ship after both READY. Commit.

### Task 11: Test accounts and wrap-up

**Files:**
- Modify: `src/components/DevQuickLogin.jsx` (add station/leader dummy accounts)

- [ ] **Step 1:** Ask the user before creating accounts; on yes create `station.rsb`, `station.qa`, `leader.rsb`, `leader.qa` (password `12345678`) through the `admin-users` function as OWNER, and list them in the quick login.
- [ ] **Step 2:** Run all `supabase/tests/*.sql`, `npm test`, `vite build`.
- [ ] **Step 3:** End-to-end in the browser: receive 2 → print → station.rsb scans → station.qa scans + passes one, rejects one → leader.qa sees figures and fixes the rejected piece back to RSB → inventory links and ships the passed piece; admin sees it all on the progress views. Commit.
