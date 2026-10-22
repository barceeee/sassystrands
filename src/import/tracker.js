// HAIR BUNDLE AND CLOSURE INVENTORY workbook.
//  - "SINGLE/DOUBLE DRAWN <MONTH>" sheets: one block per texture, rows = length, a pair of IN/OUT
//    columns per day, then STARTING BUNDLES / TOTAL IN / TOTAL OUT / TOTAL (and in October a
//    BEGINNING AUDIT column). Daily cells become IN/OUT movements; the first month's starting
//    balance becomes the OPENING balance and later starting balances are checked against the
//    computed balance (differences are posted as flagged ADJUST movements).
//  - "CLOSURE …" sheets: lace × texture matrices of length × lace size counts. Each is stored as a
//    dated snapshot count; the latest snapshot of each lace/texture block becomes the opening balance.
import { readCell, text, numberCell, addr, isoDate, monthFromName, ymd, lastDayOfMonth, Flags, rowSnapshot, MONTHS } from './cells.js'
import { parseDescription, itemKey } from './describe.js'

export function parseTracker(wb, { today = new Date() } = {}) {
  const flags = new Flags()
  const items = new Map()
  const movements = []
  const counts = []
  const bundleSheets = []
  const closureSheets = []

  const year = guessYear(wb) ?? today.getUTCFullYear()
  let prevMonth = null
  for (const ws of wb.worksheets) {
    const name = ws.name.trim()
    const up = name.toUpperCase()
    let month = monthFromName(name)
    if (/CLOSURE/.test(up)) {
      if (!month) {
        month = prevMonth
        flags.add(name, null, null, 'WARNING', 'SHEET_MONTH_MISSING',
          month ? `Sheet name has no month; it sits between ${MONTHS[month - 1]} sheets, so its counts are dated ${MONTHS[month - 1]} ${year}.`
                : 'Sheet name has no month and none could be inferred; its counts were not imported.',
          month ? 'IMPORTED_WITH_ASSUMPTION' : 'NOT_IMPORTED')
        if (!month) continue
      }
      closureSheets.push({ ws, name, month })
    } else if (/(SINGLE|DOUBLE) DRAWN/.test(up)) {
      if (!month) {
        flags.add(name, null, null, 'ERROR', 'SHEET_MONTH_MISSING', 'Cannot tell which month this sheet covers; not imported.', 'NOT_IMPORTED')
        continue
      }
      bundleSheets.push({ ws, name, month, draw: /SINGLE/.test(up) ? 'SD' : 'DD' })
    } else {
      flags.add(name, null, null, 'INFO', 'SHEET_SKIPPED', 'Sheet is not a bundle or closure tracker; skipped.', 'NOT_IMPORTED')
    }
    if (month) prevMonth = month
  }

  const addItem = (item) => {
    const key = itemKey(item)
    if (!items.has(key)) items.set(key, { key, ...item })
    return key
  }

  // ---------------------------------------------------------------- bundles
  // monthly[key] = { month → { start, row ref } } ; daily movements collected first, opening logic after.
  const starts = new Map()
  for (const sheet of bundleSheets.sort((a, b) => a.month - b.month)) {
    parseBundleSheet(sheet, year, flags, addItem, movements, counts, starts)
  }
  applyOpeningBalances(starts, movements, flags, year)

  // ---------------------------------------------------------------- closures
  const latestBlock = new Map() // lace|style → { month, cells: [{key, qty, ref}] }
  for (const sheet of closureSheets) {
    parseClosureSheet(sheet, year, flags, addItem, counts, latestBlock)
  }
  for (const block of latestBlock.values()) {
    for (const cell of block.cells) {
      if (cell.qty > 0) {
        movements.push({ item: cell.key, type: 'OPENING', qty: cell.qty, date: ymd(year, block.month, 1), ref: cell.ref,
          note: `Opening balance from latest closure count (${block.sheet})` })
      }
    }
  }

  const summary = {
    year,
    bundle_sheets: bundleSheets.map((s) => s.name),
    closure_sheets: closureSheets.map((s) => s.name),
    items: items.size,
    movements: movements.length,
    counts: counts.length,
  }
  return { kind: 'TRACKER', items: [...items.values()], movements, counts, flags: flags.list, summary }
}

function guessYear(wb) {
  const tally = new Map()
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      for (let c = 1; c <= Math.min(ws.columnCount, 80); c++) {
        const { value } = readCell(ws, r, c)
        if (value instanceof Date) tally.set(value.getUTCFullYear(), (tally.get(value.getUTCFullYear()) ?? 0) + 1)
      }
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function parseBundleSheet({ ws, name, month, draw }, year, flags, addItem, movements, counts, starts) {
  const maxCol = ws.columnCount
  const headerRows = []
  for (let r = 1; r <= ws.rowCount; r++) if (text(ws, r, 1).toUpperCase() === 'LENGTH') headerRows.push(r)

  let sheetAudit = null // the BEGINNING AUDIT heading is only typed on the first block of a sheet
  for (const hr of headerRows) {
    const title = text(ws, hr - 1, 1)
    const parsed = parseDescription(`${draw} ${title}`, { length: 12 })
    if (!parsed.item) {
      flags.add(name, hr - 1, addr(hr - 1, 1), 'ERROR', 'UNKNOWN_SECTION', `Section "${title}" is not a known texture; block not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, hr - 1))
      continue
    }
    const style = parsed.item.style

    // Column layout of this block's header row.
    let startCol = null, totalInCol = null, totalOutCol = null, totalCol = null, auditCol = null
    for (let c = 2; c <= maxCol; c++) {
      const t = text(ws, hr, c).toUpperCase()
      if (t.startsWith('STARTING')) startCol = c
      else if (t === 'TOTAL IN') totalInCol = c
      else if (t === 'TOTAL OUT') totalOutCol = c
      else if (t === 'TOTAL') totalCol = c
      else if (t.includes('AUDIT')) auditCol = c
    }
    if (!startCol) {
      flags.add(name, hr, null, 'ERROR', 'LAYOUT', 'No STARTING BUNDLES column in this block; block not imported.', 'NOT_IMPORTED')
      continue
    }

    // Day columns: B, D, F, … up to the STARTING column; each is IN, the next column is OUT.
    const days = []
    const wrongMonth = [], missing = [], duplicate = []
    let prevDate = null
    for (let c = 2; c + 1 < startCol; c += 2) {
      const h = readCell(ws, hr, c).value
      let date
      if (h instanceof Date) {
        const hy = h.getUTCFullYear(), hm = h.getUTCMonth() + 1, hd = h.getUTCDate()
        if (hm !== month || hy !== year) {
          const d = Math.min(hd, lastDayOfMonth(year, month))
          date = ymd(year, month, d)
          wrongMonth.push(`${addr(hr, c)} says ${isoDate(h)}`)
        } else {
          date = isoDate(h)
        }
      } else {
        const d = prevDate ? Number(prevDate.slice(8)) + 1 : 1
        date = ymd(year, month, Math.min(d, lastDayOfMonth(year, month)))
        missing.push(`${addr(hr, c)} (used ${date})`)
      }
      if (days.some((x) => x.date === date)) duplicate.push(`${addr(hr, c)} = ${date}`)
      days.push({ inCol: c, outCol: c + 1, date })
      prevDate = date
    }
    if (wrongMonth.length) {
      flags.add(name, hr, null, 'WARNING', 'DATE_HEADER_MISMATCH',
        `${wrongMonth.length} date header(s) in row ${hr} are not in ${MONTHS[month - 1]} ${year} (e.g. ${wrongMonth.slice(0, 3).join('; ')}). ` +
        `Movements under them were dated the same day in ${MONTHS[month - 1]}.`, 'IMPORTED_WITH_ASSUMPTION')
    }
    if (missing.length) {
      flags.add(name, hr, null, 'WARNING', 'DATE_HEADER_MISSING',
        `Missing date header(s): ${missing.join('; ')}. Date taken as the day after the previous column.`, 'IMPORTED_WITH_ASSUMPTION')
    }
    if (duplicate.length) {
      flags.add(name, hr, null, 'WARNING', 'DATE_HEADER_DUPLICATE', `Two columns resolve to the same date: ${duplicate.join('; ')}.`, 'IMPORTED_WITH_ASSUMPTION')
    }

    // Audit column (October sheets): "BEGINNING AUDIT" with a date underneath.
    let auditDate = null
    if (auditCol) {
      const ad = readCell(ws, hr + 1, auditCol).value
      if (ad instanceof Date) {
        auditDate = isoDate(ad)
        const swapped = ymd(ad.getUTCFullYear(), ad.getUTCDate(), ad.getUTCMonth() + 1)
        if (ad.getUTCMonth() + 1 !== month && ad.getUTCDate() === month && ad.getUTCMonth() + 1 <= 12) {
          flags.add(name, hr + 1, addr(hr + 1, auditCol), 'WARNING', 'AMBIGUOUS_AUDIT_DATE',
            `BEGINNING AUDIT is dated ${auditDate}, months before this ${MONTHS[month - 1]} sheet; day and month look swapped, so the audit is dated ${swapped}.`,
            'IMPORTED_WITH_ASSUMPTION')
          auditDate = swapped
        }
      } else {
        flags.add(name, hr + 1, addr(hr + 1, auditCol), 'WARNING', 'AUDIT_DATE_MISSING', 'BEGINNING AUDIT column has no date; audit counts not imported.', 'NOT_IMPORTED')
      }
      sheetAudit = { col: auditCol, date: auditDate, row: hr }
    } else if (sheetAudit?.date) {
      auditCol = sheetAudit.col
      auditDate = sheetAudit.date
      const hasValues = Array.from({ length: 20 }, (_, i) => readCell(ws, hr + 2 + i, auditCol).value).some((v) => typeof v === 'number')
      if (hasValues) {
        flags.add(name, hr, addr(hr, auditCol), 'INFO', 'AUDIT_COLUMN_INHERITED',
          `Column ${addr(hr, auditCol).replace(/\d+/, '')} has no heading in this block; read as BEGINNING AUDIT like the heading on row ${sheetAudit.row}.`,
          'IMPORTED_WITH_ASSUMPTION')
      }
    }

    // Data rows until the TOTAL row.
    for (let r = hr + 2; r <= ws.rowCount; r++) {
      const a = text(ws, r, 1).toUpperCase()
      if (a === 'TOTAL' || a === 'LENGTH') break
      const lenCell = readCell(ws, r, 1)
      if (lenCell.value === null) continue
      const length = typeof lenCell.value === 'number' ? lenCell.value : Number(String(lenCell.value).replace(/"/g, ''))
      if (!Number.isInteger(length)) {
        if (a) flags.add(name, r, addr(r, 1), 'ERROR', 'BAD_LENGTH', `Length "${lenCell.value}" is not a whole number; row not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }
      const item = { category: 'BUNDLE', draw, style, lace_type: null, lace_size: null, length_in: length, variant: '' }
      const key = addItem(item)
      const ref = `${name}!${r}`

      let totalIn = 0, totalOut = 0
      for (const d of days) {
        for (const [col, type] of [[d.inCol, 'IN'], [d.outCol, 'OUT']]) {
          const { num, issue } = numberCell(readCell(ws, r, col))
          if (issue) flags.add(name, r, addr(r, col), issue.severity, issue.code, issue.message, num === null ? 'NOT_IMPORTED' : 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
          if (num === null || num === 0) continue
          if (num < 0 || !Number.isInteger(num)) {
            flags.add(name, r, addr(r, col), 'ERROR', 'BAD_QUANTITY', `${type} quantity ${num} is not a positive whole number; not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
            continue
          }
          movements.push({ item: key, type, qty: num, date: d.date, ref: `${name}!${addr(r, col)}` })
          if (type === 'IN') totalIn += num; else totalOut += num
        }
      }

      const startCell = numberCell(readCell(ws, r, startCol))
      if (startCell.issue) flags.add(name, r, addr(r, startCol), startCell.issue.severity, startCell.issue.code, startCell.issue.message, 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
      const start = startCell.num ?? 0
      if (!starts.has(key)) starts.set(key, new Map())
      starts.get(key).set(month, { start, ref, sheet: name, row: r })

      // Cross-check the sheet's own formulas against what the app computes.
      const check = (col, expected, label) => {
        if (!col) return
        const cell = readCell(ws, r, col)
        if (cell.error) {
          flags.add(name, r, addr(r, col), 'WARNING', 'FORMULA_ERROR', `${label} formula shows ${cell.error}; the app computes ${expected}.`, 'IMPORTED', rowSnapshot(ws, r))
        } else if (typeof cell.value === 'number' && cell.value !== expected) {
          flags.add(name, r, addr(r, col), 'WARNING', 'SHEET_TOTAL_MISMATCH',
            `Sheet ${label} is ${cell.value} but the daily cells add up to ${expected}${cell.formula ? ` (formula =${cell.formula.slice(0, 60)}${cell.formula.length > 60 ? '…' : ''})` : ''}. The app uses ${expected}.`,
            'IMPORTED', rowSnapshot(ws, r))
        }
      }
      check(totalInCol, totalIn, 'TOTAL IN')
      check(totalOutCol, totalOut, 'TOTAL OUT')
      check(totalCol, start + totalIn - totalOut, 'TOTAL')

      if (auditCol && auditDate) {
        const au = numberCell(readCell(ws, r, auditCol))
        if (au.issue) flags.add(name, r, addr(r, auditCol), au.issue.severity, au.issue.code, au.issue.message, au.num === null ? 'NOT_IMPORTED' : 'IMPORTED_WITH_ASSUMPTION')
        if (au.num !== null) {
          counts.push({ item: key, date: auditDate, qty: au.num, source: 'AUDIT', label: `${name} BEGINNING AUDIT`, ref: `${name}!${addr(r, auditCol)}` })
        }
      }
    }

    // Anything typed to the right of the known columns is reported, not imported.
    const lastKnown = Math.max(startCol, totalInCol ?? 0, totalOutCol ?? 0, totalCol ?? 0, auditCol ?? 0)
    const stray = new Map() // column → cells
    for (let r = hr + 2; r <= ws.rowCount; r++) {
      if (text(ws, r, 1).toUpperCase() === 'TOTAL') break
      for (let c = lastKnown + 1; c <= maxCol; c++) {
        const cell = readCell(ws, r, c)
        if (cell.value !== null && String(cell.value).trim() !== '') {
          if (!stray.has(c)) stray.set(c, [])
          stray.get(c).push(`${addr(r, c)}=${cell.value instanceof Date ? isoDate(cell.value) : cell.value}`)
        }
      }
    }
    for (const [c, cells] of stray) {
      flags.add(name, hr, addr(hr, c), 'INFO', 'UNLABELLED_COLUMN',
        `Column ${addr(hr, c).replace(/\d+/, '')} has ${cells.length} value(s) but no heading (${cells.slice(0, 4).join(', ')}${cells.length > 4 ? ', …' : ''}); ignored.`,
        'NOT_IMPORTED')
    }
  }
}

// First month a product appears: its STARTING BUNDLES becomes the OPENING balance.
// Later months: STARTING BUNDLES should equal the computed balance carried forward; any
// difference is posted as an ADJUST on the 1st of that month and flagged for review.
function applyOpeningBalances(starts, movements, flags, year) {
  const byItem = new Map()
  for (const m of movements) {
    if (!byItem.has(m.item)) byItem.set(m.item, [])
    byItem.get(m.item).push(m)
  }
  const extra = []
  for (const [key, months] of starts) {
    const ordered = [...months.entries()].sort((a, b) => a[0] - b[0])
    let opened = false
    for (const [month, s] of ordered) {
      const monthStart = ymd(year, month, 1)
      if (!opened) {
        if (s.start > 0) extra.push({ item: key, type: 'OPENING', qty: s.start, date: monthStart, ref: s.ref, note: `Opening balance (STARTING BUNDLES, ${s.sheet})` })
        if (s.start < 0) flags.add(s.sheet, s.row, null, 'ERROR', 'NEGATIVE_START', `Starting balance is ${s.start}; opening balance not imported.`, 'NOT_IMPORTED')
        opened = true
        continue
      }
      const carried = [...extra, ...(byItem.get(key) ?? [])]
        .filter((m) => m.item === key && m.date < monthStart)
        .reduce((t, m) => t + (m.type === 'OUT' ? -m.qty : m.qty), 0)
      if (s.start !== carried) {
        const diff = s.start - carried
        extra.push({ item: key, type: 'ADJUST', qty: diff, date: monthStart, ref: s.ref,
          note: `STARTING BUNDLES on ${s.sheet} is ${s.start}, computed carry-forward was ${carried}` })
        flags.add(s.sheet, s.row, null, 'WARNING', 'STARTING_BALANCE_MISMATCH',
          `${key}: starting balance ${s.start} ≠ previous month's computed ending ${carried}. Posted an adjustment of ${diff > 0 ? '+' : ''}${diff} on ${monthStart}.`,
          'IMPORTED_WITH_ASSUMPTION')
      }
    }
  }
  movements.push(...extra)

  // Report balances that dip below zero (an OUT recorded before its IN, or a missing IN).
  const all = new Map()
  for (const m of movements) {
    if (!all.has(m.item)) all.set(m.item, [])
    all.get(m.item).push(m)
  }
  for (const [key, list] of all) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b)))
    let bal = 0
    for (const m of list) {
      bal += m.type === 'OUT' ? -m.qty : m.qty
      if (bal < 0) {
        const [sheet, cell] = (m.ref ?? '!').split('!')
        flags.add(sheet, Number(cell.replace(/^[A-Z]+/, '')) || null, cell, 'WARNING', 'NEGATIVE_BALANCE',
          `${key} goes to ${bal} on ${m.date} (more OUT than available). Imported as recorded; check the sheet.`, 'IMPORTED')
        break
      }
    }
  }
}

const rank = (m) => ({ OPENING: 0, ADJUST: 1, IN: 2, OUT: 3 })[m.type]

function parseClosureSheet({ ws, name, month }, year, flags, addItem, counts, latestBlock) {
  const date = ymd(year, month, 1)
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = text(ws, r, c).toUpperCase()
      const m = t.match(/^(TRANSPARENT|SWISS|HD)\s+LACE\s+(.+)$/)
      if (!m) continue
      const lace = m[1]
      const styleText = m[2].trim()
      const parsed = parseDescription(`5X5 ${lace} ${styleText}`, { length: 12 })
      if (!parsed.item) {
        flags.add(name, r, addr(r, c), 'ERROR', 'UNKNOWN_SECTION', `Section "${t}" is not a known texture; block not imported.`, 'NOT_IMPORTED')
        continue
      }
      if (/\/|\bAND\b/.test(styleText)) {
        flags.add(name, r, addr(r, c), 'WARNING', 'AMBIGUOUS_SECTION',
          `Section "${t}" mixes textures; its counts were recorded as ${parsed.item.style.replace(/_/g, ' ').toLowerCase()}.`, 'IMPORTED_WITH_ASSUMPTION')
      }
      // Sizes run along row r+2 from column c+1; lengths down column c from row r+3.
      const sizes = []
      for (let sc = c + 1; sc <= ws.columnCount; sc++) {
        const s = text(ws, r + 2, sc).toUpperCase().replace(/\s/g, '')
        if (!/^\d{1,2}X\d{1,2}$/.test(s)) break
        sizes.push({ col: sc, size: s })
      }
      const blockKey = `${lace}|${parsed.item.style}`
      const block = { month, sheet: name, cells: [] }
      for (let rr = r + 3; rr <= ws.rowCount; rr++) {
        const len = readCell(ws, rr, c).value
        if (typeof len !== 'number') break
        for (const { col, size } of sizes) {
          const cell = readCell(ws, rr, col)
          const { num, issue } = numberCell(cell)
          if (issue) flags.add(name, rr, addr(rr, col), issue.severity, issue.code, issue.message, num === null ? 'NOT_IMPORTED' : 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, rr, c, c + sizes.length))
          if (num === null) continue
          if (num < 0 || !Number.isInteger(num)) {
            flags.add(name, rr, addr(rr, col), 'ERROR', 'BAD_QUANTITY', `Count ${num} is not a whole number ≥ 0; not imported.`, 'NOT_IMPORTED')
            continue
          }
          const key = addItem({ category: 'CLOSURE', draw: null, style: parsed.item.style, lace_type: lace, lace_size: size, length_in: len, variant: '' })
          const ref = `${name}!${addr(rr, col)}`
          block.cells.push({ key, qty: num, ref })
          if (num > 0) counts.push({ item: key, date, qty: num, source: 'SNAPSHOT', label: name, ref })
        }
      }
      const prev = latestBlock.get(blockKey)
      if (!prev || prev.month <= month) latestBlock.set(blockKey, block)
    }
  }
}
