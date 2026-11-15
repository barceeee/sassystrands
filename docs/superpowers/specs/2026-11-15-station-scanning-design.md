# Station scanning — design

Status: draft for approval · 2026-11-15

## Why

Production happens at physical stations. Today people move batch records by hand in the app,
so the system is only as accurate as whoever remembers to update it. The owner wants each
piece of hair tracked individually, from the moment raw hair arrives at HQ, by having the
station that physically holds it scan its barcode. Everyone else should only *watch* progress,
so the stage of every piece reflects what the floor actually did.

## Goals

- A serial number + barcode per piece, created only when raw hair **arrives at HQ** (start of production).
- Every station has a scanner. Station users work in a **scan-only screen**: scan a piece → it is now at their station.
- Scanning works on **any device**: USB / Bluetooth keyboard-style scanners, and phone/tablet cameras.
- Each station has a **team leader** who sees that station's bulk figures and can **fix wrong scans**.
- Owner, Admin, Inventory, Production and QA roles **see progress only** (which stage each piece is in).

## Non-goals (for now)

- Raw hair "types" (the owner mentioned 3; parked). Leave room for a `hair_type` on a piece later.
- Different routes per piece. All pieces follow the same stage list.
- Offline scanning (stations need a connection).

## Anti-goals (would be a failure even if it works)

- Station users being able to type serials or reach any screen other than the scanner.
- Anyone other than a station scan (or a team-leader fix) changing a piece's stage.
- Stage figures that disagree with the floor because of batch splitting or hand edits.

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Start of production | Raw hair arriving at HQ. That is when serials are created. |
| Who receives | **Inventory** records arrivals at HQ (the only typed step: "N pieces arrived"). |
| Orders | Pieces arrive unlinked. **Orders are linked later.** |
| Wrong scans | **The team leader** of the station fixes them. |
| Approach | One app; the **piece** is the tracked thing (not batch records). |

## Approaches considered

1. **One app, piece-first (chosen).** Each piece holds its own stage and history. Simplest model that
   matches "scan each piece"; costs a rebuild of the production, QA and dashboard screens.
2. One app, keep batch records and split per scan (what was built on 2026-11-15). Less rework now, but every
   piece ends up its own one-unit record with split clutter, and order/QA screens stay batch-shaped.
3. Separate scanner site on the same database. Two deployments to keep in sync for no gain, since roles
   can already lock station users to the scanner inside one app.

## The design

### Roles

| Role | Tied to a station? | Home screen | Can do |
|---|---|---|---|
| OWNER, ADMIN | no | Progress | View progress. Manage users (assign roles and stations). |
| INVENTORY | no | Progress | View progress. **Receive** raw hair, print/reprint labels, **link pieces to orders**, ship, receive to stock. |
| PRODUCTION, QA | no | Progress | View progress only. |
| **STATION** (new) | yes, one stage | Scanner (only screen) | Scan pieces into their stage. QA station: pass / reject after scan. |
| **LEADER** (new) | yes, one stage | Station dashboard | Everything STATION can, plus station figures, fix wrong scans, reprint a label, manual serial entry for damaged labels. |

`profiles` gets a `station` column (stage code), required for STATION and LEADER and null for others.
The Users page lets Owner/Admin set it.

### Stages

- New first stage **`RECEIVED` — "Received at HQ"**, replacing `ALLOCATED`. Receiving puts pieces here.
- Station stages (one station each): RSB, Wefting, Ventilation – Marinduque, Ventilation – HQ/PCR,
  HQ fixing/checking, Curling, QA.
- QA outcome stages: `READY` (passed), `REJECTED` (rework).
- Inventory stages: `SHIPPED`, `IN_STOCK`.

### Data (replaces production_records / production_units)

- **`pieces`**: id, `serial` (`SS-000001`, generated), `stage`, `status` (ACTIVE / ON_HOLD / CANCELED),
  `item_id` (nullable until known), `order_line_id` (nullable), `received_batch_id`, timestamps.
- **`receipts`**: one row per arrival (who, when, how many, note). Labels for a receipt can be reprinted together.
- **`piece_events`**: every scan, QA result, fix, link and status change: piece, event, from/to stage,
  station, user, device kind (`scanner` / `camera` / `manual`), note, time. This is the piece's history.
- **`qa_results`**: per piece: pass/reject, defects, inspector, time.
- The order and dashboard figures (`v_order_lines` committed/in-production counts, `order_line_committed`)
  count pieces instead of summing record quantities.
- All writes go through security-definer functions, as today. Tables stay read-only to clients via RLS.

### Functions (database is the gate)

- `receive_pieces(qty, note)` (INVENTORY): creates a receipt and `qty` pieces in RECEIVED; returns serials.
- `station_scan(serial, method)` (STATION/LEADER): moves the piece into **the caller's own station**. Refuses
  unknown serials, pieces that are canceled/on hold/shipped/in stock, and pieces already at that station.
  At the QA station, the scan only marks the piece "at QA". The result is recorded by `qa_result`.
- `qa_result(serial, passed, defects)` (QA-station STATION/LEADER): READY or REJECTED. Defects required on reject.
- `leader_fix(serial, to_stage, reason)` (LEADER): moves a piece to any station stage, with a required reason.
  Logged as a FIX event.
- `link_pieces(order_line_id, serials[])` / `unlink_piece(serial)` (INVENTORY): sets the order line (and the
  line's product on the piece); refuses linking more pieces than the line ordered.
- `ship_pieces(serials[])` (INVENTORY, Ready + linked) and `receive_to_stock(serials[], item_id, location)`
  (INVENTORY, Ready + unlinked): posts stock movements as today.
- `set_piece_status` (INVENTORY, LEADER for their station): hold / reactivate / cancel with reason.

### Screens

- **Scanner** (`/station`): full-screen, large text, station name at top. A hardware scanner always lands in a
  focused hidden input. A **Use camera** button opens the camera view. Each scan gives a big green or red
  result with a beep and the piece's product/order if known, plus a short list of recent scans. At the QA
  station each scan shows **Pass** / **Reject** (defect picker) buttons. Station users are routed here and
  every other route redirects back.
- **Station dashboard** (`/station/overview`, LEADER): pieces at the station now, scanned in today / this week,
  oldest waiting, a pieces table (serial, product, order, arrived at station, time waiting), recent scans by
  user, and a **Fix** action per piece (pick stage + reason). A link opens the scanner.
- **Receiving** (`/receiving`, INVENTORY): "How many pieces arrived?" + note → creates pieces and opens the
  label sheet. A list of past receipts with **Reprint labels**.
- **Progress** (`/production`, everyone): counts per stage, a pieces table filterable by stage/order/serial,
  and a piece page (`/pieces/:serial`) with its full history. Read-only, except Inventory's link/ship/stock
  actions where they apply.
- **Orders** page: shows pieces linked to each line by stage, and Inventory's "Link pieces" (scan or pick Ready/in-progress unlinked pieces).
- **Removed:** New production record, manual Move form, batch QA form, the 2026-11-15 `/scan` page and its
  batch-split functions.

### Any-device scanning

- **Hardware scanners** (USB / Bluetooth): they act as keyboards, so they work on any OS/browser with no setup.
- **Camera**: use the browser's built-in `BarcodeDetector` where it exists (Chrome/Edge on Android, desktop
  Chrome), otherwise a JS fallback (`@zxing/browser`) for iPhone/iPad Safari and Firefox. Needs HTTPS (Vercel is).
- **"Scan, don't type"**: the scanner input accepts a code only if it arrives at scanner speed (whole code within
  about 300 ms). Slower input is refused with "Please scan the barcode." Camera reads are always accepted. Leaders
  get a separate **Enter serial manually** field for damaged labels, logged as `manual`.
- Labels: Code 128 (every listed scanner type and camera library reads it). Print sheet as built on 2026-11-15.

## Calls made by Claude (check these)

- `RECEIVED` replaces `ALLOCATED` as the first stage. Pieces wait there until the first station scans them.
- Stations may scan a piece from **any** earlier or later station stage (stages can be skipped or revisited,
  e.g. rework). The scan is accepted but flagged "out of order" in history and on the leader's dashboard, instead
  of being refused. Refusing would block real floor situations like rework going straight back to Curling.
- Rejected pieces sit in REJECTED until any station scans them back in.
- A piece's product is unknown at arrival. It comes from the order line when linked, or is chosen when received to stock.
- Inventory keeps ship / receive-to-stock / order linking (needed to run the business; "view only" applies to stage moves).
- Spreadsheet import of in-progress production creates pieces directly in their stage (with serials) so labels can be
  printed for them. It is the only path besides receiving that creates pieces.
- The database is empty today, so old production tables are dropped instead of migrated.

## Left to the builder

- Exact dashboard layout and chart choices (follow existing `Page`/`Card`/`Table` patterns).
- Camera view details (torch toggle, front/back camera switch).
- Beep tones, scan-speed threshold tuning (keep it configurable in one constant).
