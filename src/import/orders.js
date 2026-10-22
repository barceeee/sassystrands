// MONITORING CLIENTS ORDER workbook: one block per client (name in column A), optional sub-group
// labels in column B (e.g. SAMBIA), lines of LENGTH | DESCRIPTION | ORDER | stage quantities | REMAINING,
// status notes to the right, and a TOTAL row per block.
// Each block becomes one order; each stage quantity becomes a production record in that stage, so
// the order screen shows the same Allocated → Ventilation → Ready → Curling → Shipped breakdown.
import { readCell, text, numberCell, addr, Flags, rowSnapshot } from './cells.js'
import { parseDescription, parseLength, itemKey } from './describe.js'

const STAGE_HEADERS = [
  [/ALLOCATED/, 'ALLOCATED'],
  [/MARINDUQUE/, 'VENT_MARINDUQUE'],
  [/FIXING|CHECKING/, 'VENT_HQ_FIXING'],
  [/PCR/, 'VENT_HQ_PCR'],
  [/^READY/, 'READY'],
  [/CURL/, 'CURLING'],
  [/SHIPPED/, 'SHIPPED'],
]

export function parseOrders(wb, { fileTag = 'X' } = {}) {
  const flags = new Flags()
  const items = new Map()
  const orders = []

  for (const ws of wb.worksheets) {
    const name = ws.name.trim()
    if (ws.actualRowCount <= 1 && !text(ws, 1, 1)) {
      flags.add(name, null, null, 'INFO', 'SHEET_SKIPPED', 'Empty sheet; skipped.', 'NOT_IMPORTED')
      continue
    }
    const cols = mapColumns(ws)
    if (!cols.qty) {
      flags.add(name, null, null, 'WARNING', 'SHEET_SKIPPED', 'No ORDER column heading in row 1; sheet skipped.', 'NOT_IMPORTED')
      continue
    }
    parseSheet(ws, name, cols, flags, items, orders, fileTag)
  }

  const lines = orders.flatMap((o) => o.lines)
  const summary = {
    clients: new Set(orders.map((o) => o.client.toUpperCase())).size,
    orders: orders.length,
    lines: lines.length,
    units_ordered: lines.reduce((t, l) => t + l.qty, 0),
    production_records: lines.reduce((t, l) => t + l.stages.length, 0),
  }
  return { kind: 'ORDERS', items: [...items.values()], orders, flags: flags.list, summary }
}

function mapColumns(ws) {
  const cols = { length: 1, desc: 2, stages: [], notes: [] }
  for (let c = 2; c <= ws.columnCount; c++) {
    const h = text(ws, 1, c).toUpperCase()
    if (!h) continue
    if (h === 'ORDER' || h === 'QTY') cols.qty = c
    else if (/REMAINING/.test(h)) cols.remaining = c
    else {
      const st = STAGE_HEADERS.find(([re]) => re.test(h))
      if (st) cols.stages.push({ col: c, stage: st[1], header: h })
    }
  }
  const lastKnown = Math.max(cols.qty ?? 0, cols.remaining ?? 0, ...cols.stages.map((s) => s.col))
  for (let c = lastKnown + 1; c <= Math.max(ws.columnCount, lastKnown + 4); c++) cols.notes.push(c)
  return cols
}

function parseSheet(ws, name, cols, flags, items, orders, fileTag) {
  let order = null
  let group = null
  let blockStart = null
  let lastClient = null

  const startOrder = (client, r) => {
    order = {
      client,
      order_no: `IMP-${fileTag}-${String(orders.length + 1).padStart(3, '0')}`,
      ref: `${name}!A${r}`,
      notes: `Imported from ${name} row ${r}`,
      lines: [],
      firstLineRow: null,
      lastLineRow: null,
    }
    orders.push(order)
    lastClient = client
    group = null
    blockStart = r
  }

  // Row 1 holds the first client name in column A and the column headings to the right.
  const first = text(ws, 1, 1)
  if (first) startOrder(clientName(first), 1)

  for (let r = 2; r <= ws.rowCount; r++) {
    const aCell = readCell(ws, r, 1)
    const a = text(ws, r, 1)
    const b = text(ws, r, 2)
    const qtyCell = readCell(ws, r, cols.qty)
    const length = parseLength(aCell.value)

    if (/^TOTAL$/i.test(a)) {
      checkTotalRow(ws, name, r, cols, order, blockStart, flags)
      order = null
      blockStart = r
      continue
    }
    if (!a && !b && qtyCell.value === null) continue

    if (a && length === null) {
      // Client heading
      startOrder(clientName(a), r)
      if (b) flags.add(name, r, addr(r, 2), 'INFO', 'IGNORED_TEXT', `Text "${b}" next to the client name was ignored.`, 'NOT_IMPORTED')
      continue
    }
    if (!a && b && (qtyCell.value === null || text(ws, r, cols.qty) === '')) {
      group = b
      flags.add(name, r, addr(r, 2), 'INFO', 'GROUP_LABEL',
        `"${b}" has no length or quantity; treated as a sub-group label for the lines below it${/^UPRODUCED$/i.test(b) ? ' (probably "UNPRODUCED")' : ''}.`,
        'IMPORTED_WITH_ASSUMPTION')
      continue
    }
    if (!order && lastClient) {
      // Lines straight after a TOTAL row with no new heading continue the previous client.
      startOrder(lastClient, r)
      flags.add(name, r, null, 'WARNING', 'NO_CLIENT_HEADING',
        `Lines start after the previous TOTAL row without a client name; assumed to be a second order for ${lastClient}.`,
        'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
    }
    if (!order) {
      flags.add(name, r, null, 'ERROR', 'NO_CLIENT', 'Line appears before any client heading; not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
      continue
    }
    if (length === null) {
      flags.add(name, r, addr(r, 1), 'ERROR', 'BAD_LENGTH', `Line has no valid length (column A = "${a}"); not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
      continue
    }
    if (!b) {
      flags.add(name, r, addr(r, 2), 'ERROR', 'NO_DESCRIPTION', 'Line has a length but no product description; not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
      continue
    }

    const parsed = parseDescription(b, { length })
    for (const n of parsed.notes) flags.add(name, r, addr(r, 2), n.severity, n.code, n.message, n.severity === 'INFO' ? 'IMPORTED' : 'IMPORTED_WITH_ASSUMPTION')
    if (!parsed.item) {
      flags.add(name, r, addr(r, 2), 'ERROR', 'UNPARSED_DESCRIPTION', `${parsed.error} Line not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
      continue
    }

    const qty = numberCell(qtyCell)
    if (qty.num === null || qty.num <= 0 || !Number.isInteger(qty.num)) {
      flags.add(name, r, addr(r, cols.qty), 'ERROR', qty.issue?.code ?? 'NO_QTY',
        `${qty.issue?.message ?? 'Ordered quantity is blank'} — ${b} ${length}" for ${order.client} not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
      continue
    }

    const stages = []
    let staged = 0
    for (const s of cols.stages) {
      const n = numberCell(readCell(ws, r, s.col))
      if (n.issue) flags.add(name, r, addr(r, s.col), n.issue.severity, n.issue.code, n.issue.message, n.num === null ? 'NOT_IMPORTED' : 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
      if (n.num === null || n.num === 0) continue
      if (n.num < 0 || !Number.isInteger(n.num)) {
        flags.add(name, r, addr(r, s.col), 'ERROR', 'BAD_QUANTITY', `${s.header} quantity ${n.num} is not a positive whole number; not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }
      stages.push({ stage: s.stage, qty: n.num })
      staged += n.num
    }
    if (staged > qty.num) {
      flags.add(name, r, null, 'WARNING', 'OVER_ALLOCATED',
        `Stage quantities add up to ${staged} but only ${qty.num} were ordered. Imported as recorded; the order shows it as over-allocated.`,
        'IMPORTED', rowSnapshot(ws, r))
    }

    if (cols.remaining) {
      const rem = readCell(ws, r, cols.remaining)
      const expected = qty.num - staged
      if (rem.formula && /--/.test(rem.formula)) {
        const wrongNow = typeof rem.value !== 'number' || rem.value !== expected
        flags.add(name, r, addr(r, cols.remaining), wrongNow ? 'WARNING' : 'INFO', 'MALFORMED_FORMULA',
          `REMAINING formula =${rem.formula} has "--", which adds a column instead of subtracting it` +
          (wrongNow ? `; the sheet shows ${rem.value ?? 'nothing'}, the correct remaining is ${expected}.` : ` (gives the right answer only while those columns are 0). The app computes ${expected}.`),
          'IMPORTED', rowSnapshot(ws, r))
      } else if (rem.error) {
        flags.add(name, r, addr(r, cols.remaining), 'WARNING', 'FORMULA_ERROR', `REMAINING shows ${rem.error}; the app computes ${expected}.`, 'IMPORTED', rowSnapshot(ws, r))
      } else if (typeof rem.value === 'number' && rem.value !== expected) {
        flags.add(name, r, addr(r, cols.remaining), 'WARNING', 'SHEET_TOTAL_MISMATCH',
          `Sheet REMAINING is ${rem.value} but ${qty.num} ordered − ${staged} in stages = ${expected}${rem.formula ? ` (formula =${rem.formula})` : ''}. The app uses ${expected}.`,
          'IMPORTED', rowSnapshot(ws, r))
      } else if (typeof rem.value === 'string' && rem.value.trim()) {
        const n = numberCell(rem)
        if (n.issue) flags.add(name, r, addr(r, cols.remaining), n.issue.severity, n.issue.code, n.issue.message, 'IMPORTED', rowSnapshot(ws, r))
      }
    }

    const notes = cols.notes.map((c) => text(ws, r, c)).filter(Boolean)
    const canceled = notes.some((n) => /CANCEL/i.test(n))
    const lineNote = notes.filter((n) => !/CANCEL/i.test(n)).map((n) => n.toUpperCase()).join('; ') || null
    if (canceled && stages.some((s) => s.stage !== 'SHIPPED')) {
      flags.add(name, r, null, 'WARNING', 'CANCELED_WITH_WORK',
        `Line is marked CANCELED but still has ${stages.map((s) => `${s.qty} in ${s.stage}`).join(', ')}. Imported as canceled; review those production records.`,
        'IMPORTED', rowSnapshot(ws, r))
    }

    const key = itemKey(parsed.item)
    if (!items.has(key)) items.set(key, { key, ...parsed.item })
    order.lines.push({
      item: key, qty: qty.num, group_label: group, line_note: lineNote, canceled, description_raw: b,
      ref: `${name}!${r}`, stages,
    })
    order.firstLineRow ??= r
    order.lastLineRow = r
  }

  // Blocks that ended up with no importable lines are reported and dropped.
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]
    if (o.lines.length === 0) {
      flags.add(name, Number(o.ref.split('!A')[1]), o.ref.split('!')[1], 'WARNING', 'EMPTY_CLIENT_BLOCK',
        `Client "${o.client}" has no importable lines; no order created.`, 'NOT_IMPORTED')
      orders.splice(i, 1)
    }
    delete o.firstLineRow
    delete o.lastLineRow
  }
}

const clientName = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase()

// TOTAL rows are not imported. If their SUM ranges do not cover exactly this client's lines,
// the sheet's printed totals are wrong — tell the client.
function checkTotalRow(ws, name, r, cols, order, blockStart, flags) {
  if (!order || order.firstLineRow == null) {
    let hasData = false
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = readCell(ws, r, c)
      if (typeof v.value === 'number' && v.value !== 0) hasData = true
    }
    if (!order || blockStart === null || hasData) {
      flags.add(name, r, null, 'INFO', 'TOTAL_WITHOUT_LINES', 'TOTAL row with no client lines above it; ignored.', 'NOT_IMPORTED')
    }
    return
  }
  const wrong = []
  for (const c of [cols.qty, ...cols.stages.map((s) => s.col), cols.remaining].filter(Boolean)) {
    const cell = readCell(ws, r, c)
    if (!cell.formula) continue
    const rows = [...cell.formula.matchAll(/[A-Z]{1,3}(\d+)/g)].map((m) => Number(m[1]))
    if (!rows.length) continue
    const lo = Math.min(...rows), hi = Math.max(...rows)
    if (lo > order.firstLineRow || hi < order.lastLineRow || lo < blockStart) {
      wrong.push(`${addr(r, c)} =${cell.formula.length > 40 ? cell.formula.slice(0, 40) + '…' : cell.formula}`)
    }
  }
  if (wrong.length) {
    flags.add(name, r, null, 'WARNING', 'TOTAL_RANGE_MISMATCH',
      `${order.client}'s lines are rows ${order.firstLineRow}–${order.lastLineRow}, but the TOTAL row sums other rows: ${wrong.join('; ')}. The sheet's totals for this client are wrong; the app computes them from the lines.`,
      'NOT_IMPORTED', rowSnapshot(ws, r))
  }
}
