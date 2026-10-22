# Sassy Strands — Inventory & Production Tracker

Replaces the client's Excel workbooks (bundle & closure inventory, available stocks, client order monitoring)
with one web app: stock movements and balances, pricing, client orders, production stages, QA, OR numbers,
reports and a spreadsheet import that flags every row it cannot read cleanly.

**Stack:** React (Vite) single-page app on Supabase: Postgres for data, row-level security and
`SECURITY DEFINER` functions for server-side role checks, Supabase Auth for login and password hashing,
and one Edge Function for user administration.

```
src/                 React app (pages/, components/, lib/)
src/import/          Spreadsheet parsers (run in the browser; also unit-tested in Node)
supabase/migrations/ Schema, functions, RLS policies, views
supabase/functions/  admin-users Edge Function (create users, roles, reset passwords)
scripts/             create-owner.mjs (seed the first Owner)
tests/               node:test tests for the parsers
```

## Run it locally

Requires Node 20+ (tested on Node 24).

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
   (Supabase Dashboard → Project Settings → API). A `.env.local` for the `sassy-strands-inventory` project
   is already present in this checkout and is git-ignored.
3. **Database** (already applied to `sassy-strands-inventory`). For a new project, apply
   `supabase/migrations/*.sql` in filename order (SQL editor, or `supabase db push`) and deploy the function:
   `supabase functions deploy admin-users`.
4. **Turn off public sign-ups:** Dashboard → Authentication → Sign In / Providers → disable
   "Allow new users to sign up". (Accounts created that way get no profile and can't see any data,
   but they shouldn't exist at all.)
5. **Create the first Owner** (one time). Put the service-role key in `.env.local` as
   `SUPABASE_SERVICE_ROLE_KEY`, then:
   ```bash
   npm run create-owner -- owner "Owner Full Name"
   ```
   The password is asked at a hidden prompt. Remove the service key from `.env.local` afterwards.
6. `npm run dev` → http://localhost:5173 → sign in with the username. Add other staff under **Users**.
7. Import the client files under **Spreadsheet import** in this order: inventory tracker, then available stocks,
   then client orders.

Tests: `npm test` (description parsing). To also test against the real workbooks:
`XLSX_DIR="path/to/folder/with/the/xlsx" npm test`.

Deploy: `vercel.json` builds the SPA (`npm run build` → `dist/`) with a catch-all rewrite. Set the two
`VITE_SUPABASE_*` variables in the Vercel project. Never set the service-role key there.

## Roles

| Role | Can do |
|---|---|
| Owner, Admin | Everything, including user management |
| Inventory | Everything except user management |
| Production | Production records only: create, move between RSB / Wefting / Ventilation / Curling / QA, hold, cancel |
| QA | View production records; record inspections (approve/reject) |

Enforced in the database (`has_perm()` in RLS policies and in every workflow function). The UI hides what a role
can't use, but the server rejects such requests anyway; the migrations were tested by simulating each role.

## How the data model replaces the sheets

- **Items** are defined by controlled values (category, SD/DD or lace type + size, texture, length, variant), so
  "DD MANILA CULS", "DD MANILA CURLS " and "DD Manila Curls" all become `DD-MANILA_CURLS-16`.
- **Stock movements** (`OPENING`, `IN`, `OUT`, `ADJUST`) replace the daily IN/OUT columns. On-hand, starting/ending
  balances and stock value are always computed. Movements can't be edited; corrections are `ADJUST`s with a reason.
  OUT movements that would make stock negative are rejected.
- **Counts** (physical audits, closure-sheet snapshots, available-stock ledger lines, manual counts) are stored next
  to the computed balance with the variance. Posting a count turns the variance into an `ADJUST`.
- **Orders → production records → QA.** Each order line's units move through production records (one record = a
  batch of one product in one stage). Moving part of a record splits it. QA approves into *Ready* or rejects into
  *Rework*. Ready units are shipped (order work) or received to stock (an `IN` movement).
- **Audit trail:** every insert/update/delete on the main tables is written to `audit_log` with the user and time.
  Movements, production events and QA inspections also store who did them.

## Assumptions to confirm with the client

1. **Place names are hair textures, not branches.** "Manila / Alabang / Laguna / Siargao / Cebu / Big Laguna" are
   read as curl patterns ("Manila Curls"), which is how the order and stock sheets use them. Stock *location* is a
   separate list that starts with a single "HQ". Add branches under *Lists & locations* if stock is kept in several places.
2. **The bundle tracker is the source of truth for quantities.** The first month (June 2026) STARTING BUNDLES
   become opening balances. In later months the sheet's starting figure often differs from the previous month's
   computed ending (149 product-months; e.g. SD Straight 4" ends August at 50 but September starts at 86). Each
   difference is posted as a flagged `ADJUST` on the 1st of the month, so app balances match the sheets.
3. **AVAILABLE STOCKS is a price list and a snapshot, not extra stock.** Its prices become product prices. Its
   quantities are stored as ledger counts for reconciliation and are not added to stock, to avoid double counting.
   Where sheets disagree on price (`DD BUNDLE` is about ₱22 lower than `SD DD BUNDLE`), the first sheet's price is
   kept and the conflict is flagged. `DD BUNDLE` may be a wholesale price list; please confirm.
4. **Sale bundles (SSKB codes) are separate packages.** They are tracked with their contents and price but don't
   move loose stock when created or sold. Their value is reported separately.
5. **Closure sheets are snapshots, dated the 1st of their month.** The most recent snapshot of each lace/texture
   block becomes the opening closure balance. The un-dated `CLOSURE` sheet is treated as July (its position in the workbook).
6. **BEGINNING AUDIT dated 2026-03-10 means 2026-10-03.** Day and month look swapped: on 3 Oct, 62 of 64 audit counts
   match the computed balance exactly. The heading appears only on the first block of each October sheet, and the
   same column is read for the other blocks.
7. **Date headers in the wrong month** (August/September sheets copied from earlier months) are re-dated to the
   same day in the sheet's own month and flagged. A missing header takes the day after the previous column.
8. **OR numbers** are BIR official-receipt booklets registered as number ranges. Each OR is issued once, for a
   payment amount, optionally linked to a client order, and can be voided with a reason (never deleted). ORs are not
   linked to stock movements. Sequential use is shown ("next available") but not forced.
9. **Order import:** each client block becomes one order (`IMP-<file>-NNN`). Each stage quantity becomes a production
   record in that stage, so the order shows the same breakdown as the sheet. The status notes CANCELED/CANCELLED cancel
   the line; REPLACE, OK, UPDATED and FINISH DELIVERED are kept as line notes. SAMBIA and UPRODUCED rows are kept as
   sub-group labels. Lines after a TOTAL row with no new client name are a second order for the previous client.
   Lines with no ordered quantity, or a description without SD/DD (e.g. "STRAIGHT SINGLE DONOR"), are not imported
   and are flagged.
10. **"Ready" comes after QA.** The sheet lists Ready before Curling. In the app, curled items go Curling → Awaiting QA →
    Ready, so every finished product passes QA. Imported "Ready" quantities are taken as already approved.
11. **RSB** is treated as one production stage between Allocated and Wefting. Its exact meaning wasn't in the files.
12. **Non-standard lace sizes** in orders (6x4, 6x5, 13x7) are accepted and marked non-standard.
13. **Products without a price** count as ₱0 in stock value and are listed as "unpriced" in reports.
14. `RAW HAIR CODING.xlsx` (raw-hair purchase lots) was provided but is outside this scope; nothing imports it yet.

## What the import flags

Rows are never dropped silently. Every problem is stored per sheet, row and cell, with the original cell values,
whether the row was imported, and a "resolved" status. Problems found in the client files include:
`#REF!` totals (SWISS sheet), blank prices, typed (hard-coded) totals, REMAINING formulas with `--` (adds a column
instead of subtracting it), TOTAL rows summing the wrong rows, wrong-month or missing date headers, starting-balance
mismatches, balances going negative, unlabelled columns, duplicate lines and price conflicts.
Formula text typed as a literal value (`"=C5*D5"`) and numbers stored as text are detected too.

## Simplest-choice notes

- Sign-in uses a username. Supabase Auth needs an email, so it stores `username@users.sassystrands.invalid`
  (a reserved domain that never receives mail). Admins reset forgotten passwords on the Users page.
- One currency (PHP). Today's date is the browser's local date.
- Imports run in a single transaction per file and can be rolled back from the import page. Rollback is refused if
  stock has since been shipped against the imported orders. The same file (by SHA-256) can't be imported twice.
