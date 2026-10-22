// AVAILABLE STOCKS workbook: price/quantity lists in blocks headed LENGTH | DESCRIPTION | QTY | PRICE | TOTAL,
// several blocks per sheet (side by side and stacked), plus a SALE BUNDLE sheet of SSKB-coded packages.
//  - Each priced line sets the item's unit price (first price seen wins; conflicts are flagged).
//  - Quantities are stored as LEDGER counts labelled with the sheet name. They do NOT change stock
//    balances (the movement tracker is the quantity source); the reconciliation report compares them.
//  - Typed or broken (#REF!) totals are flagged; all totals in the app are computed from rows.
import { readCell, text, numberCell, addr, isoDate, Flags, rowSnapshot } from './cells.js'
import { parseDescription, parseLength, itemKey } from './describe.js'

export function parseLedger(wb, { today = new Date() } = {}) {
  const flags = new Flags()
  const items = new Map()
  const counts = new Map() // sheet|key → count
  const bundles = []
  const prices = new Map() // key → { price, where }
  const countDate = isoDate(today)

  for (const ws of wb.worksheets) {
    const name = ws.name.trim()
    if (ws.rowCount === 0) continue
    if (/SALE/i.test(name)) parseSaleBundles(ws, name, flags, items, prices, bundles)
    else parseStockSheet(ws, name, flags, items, prices, counts, countDate)
    flagSheetTotals(ws, name, flags)
  }

  const summary = {
    items: items.size,
    ledger_lines: counts.size,
    sale_bundles: bundles.length,
    count_date: countDate,
    ledger_value: [...counts.values()].reduce((t, c) => t + c.qty * (c.unit_price ?? 0), 0),
  }
  return { kind: 'LEDGER', items: [...items.values()], counts: [...counts.values()], bundles, flags: flags.list, summary }
}

function findHeaders(ws) {
  const out = []
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= Math.min(ws.columnCount, 60); c++) {
      if (text(ws, r, c).toUpperCase() !== 'LENGTH' || text(ws, r, c + 1).toUpperCase() !== 'DESCRIPTION') continue
      const cols = { length: c, desc: c + 1 }
      for (let k = c + 2; k <= c + 6; k++) {
        const h = text(ws, r, k).toUpperCase()
        if (h === 'QTY') cols.qty = k
        else if (h === 'TOTAL QTY') cols.totalQty = k
        else if (h === 'PRICE') cols.price = k
        else if (h === 'TOTAL') cols.total = k
        else if (h === 'CODE') cols.code = k
        else if (h === '' || h === 'LENGTH') break
      }
      out.push({ row: r, cols, context: sectionContext(ws, r, c) })
    }
  }
  return out
}

// The heading above a block, e.g. "SD JETBLACK BUNDLES" or "HD LACE", gives defaults for its rows.
function sectionContext(ws, r, c) {
  for (let rr = r - 1; rr >= Math.max(1, r - 2); rr--) {
    const t = text(ws, rr, c).toUpperCase()
    if (t && t !== 'LENGTH') {
      return {
        heading: t,
        variant: /JET\s*BLACK/.test(t) ? 'JETBLACK' : undefined,
        lace_type: t.match(/\b(TRANSPARENT|SWISS|HD)\b/)?.[1],
      }
    }
  }
  return { heading: '' }
}

function itemFromRow(ws, name, r, cols, ctx, flags) {
  const lenCell = readCell(ws, r, cols.length)
  const desc = text(ws, r, cols.desc)
  const length = parseLength(lenCell.value)
  if (length === null) {
    flags.add(name, r, addr(r, cols.length), 'ERROR', 'BAD_LENGTH', `Length "${lenCell.value ?? ''}" is not a whole number of inches; row not imported.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
    return null
  }
  const parsed = parseDescription(desc, { length, variant: ctx.variant, lace_type: ctx.lace_type })
  for (const n of parsed.notes) flags.add(name, r, addr(r, cols.desc), n.severity, n.code, n.message, n.severity === 'INFO' ? 'IMPORTED' : 'IMPORTED_WITH_ASSUMPTION')
  if (!parsed.item) {
    flags.add(name, r, addr(r, cols.desc), 'ERROR', 'UNPARSED_DESCRIPTION', parsed.error, 'NOT_IMPORTED', rowSnapshot(ws, r))
    return null
  }
  return parsed.item
}

function recordPrice(key, price, where, prices, flags, name, r, cell) {
  const seen = prices.get(key)
  if (!seen) prices.set(key, { price, where })
  else if (seen.price !== price) {
    flags.add(name, r, cell, 'WARNING', 'PRICE_CONFLICT',
      `${key} is priced ${price} here but ${seen.price} at ${seen.where}. The item keeps ${seen.price}; this sheet's price is kept on its ledger line.`,
      'IMPORTED_WITH_ASSUMPTION')
  }
}

function parseStockSheet(ws, name, flags, items, prices, counts, countDate) {
  const headers = findHeaders(ws)
  if (!headers.length) {
    flags.add(name, null, null, 'INFO', 'SHEET_SKIPPED', 'No LENGTH / DESCRIPTION table found; sheet skipped.', 'NOT_IMPORTED')
    return
  }
  const headerRows = new Set(headers.map((h) => `${h.row}|${h.cols.length}`))
  for (const { row, cols, context } of headers) {
    for (let r = row + 1; r <= ws.rowCount; r++) {
      if (headerRows.has(`${r}|${cols.length}`)) break
      const lenText = text(ws, r, cols.length)
      const desc = text(ws, r, cols.desc)
      if (!lenText && !desc) continue
      // A text cell in the LENGTH column is the next section heading or a TOTAL line: block ends.
      if (lenText && parseLength(readCell(ws, r, cols.length).value) === null && !/^\d/.test(lenText)) break
      if (!desc) {
        flags.add(name, r, addr(r, cols.desc), 'ERROR', 'NO_DESCRIPTION', 'Row has a length but no description; not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }
      const item = itemFromRow(ws, name, r, cols, context, flags)
      if (!item) continue

      const qty = cols.qty ? numberCell(readCell(ws, r, cols.qty)) : { num: null, issue: null }
      if (qty.issue) flags.add(name, r, addr(r, cols.qty), qty.issue.severity, qty.issue.code, qty.issue.message, qty.num === null ? 'NOT_IMPORTED' : 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
      if (qty.num === null || qty.num < 0 || !Number.isInteger(qty.num)) {
        if (!qty.issue) flags.add(name, r, addr(r, cols.qty ?? cols.desc + 1), 'ERROR', 'BLANK_QTY', 'Quantity is blank or not a whole number; line not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }

      let price = null
      if (cols.price) {
        const p = numberCell(readCell(ws, r, cols.price))
        if (p.issue) flags.add(name, r, addr(r, cols.price), p.issue.severity, p.issue.code, p.issue.message, 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
        price = p.num
        if (price === null && !p.issue) {
          flags.add(name, r, addr(r, cols.price), 'WARNING', 'BLANK_PRICE', `No price for ${desc} ${item.length_in}"; imported without a price (value counts as 0 until a price is set).`, 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
        }
      }
      if (cols.total) {
        const t = readCell(ws, r, cols.total)
        const expected = price === null ? null : Math.round(price * qty.num * 100) / 100
        if (t.error) {
          flags.add(name, r, addr(r, cols.total), 'WARNING', 'FORMULA_ERROR', `Line total shows ${t.error}; the app computes qty × price.`, 'IMPORTED', rowSnapshot(ws, r))
        } else if (typeof t.value === 'string' && t.value.trim()) {
          const n = numberCell(t)
          if (n.issue) flags.add(name, r, addr(r, cols.total), n.issue.severity, n.issue.code, `${n.issue.message} (line total ignored; computed as qty × price)`, 'IMPORTED', rowSnapshot(ws, r))
        } else if (typeof t.value === 'number' && expected !== null && Math.abs(t.value - expected) > 0.005) {
          flags.add(name, r, addr(r, cols.total), 'WARNING', 'LINE_TOTAL_MISMATCH', `Line total ${t.value} ≠ ${qty.num} × ${price} = ${expected}.`, 'IMPORTED', rowSnapshot(ws, r))
        }
      }

      const key = itemKey(item)
      if (price !== null) recordPrice(key, price, `${name}!${addr(r, cols.price)}`, prices, flags, name, r, addr(r, cols.price))
      if (!items.has(key)) items.set(key, { key, ...item, unit_price: price })
      else if (items.get(key).unit_price == null && price !== null) items.get(key).unit_price = price

      const ck = `${name}|${key}`
      const ref = `${name}!${addr(r, cols.desc)}`
      if (counts.has(ck)) {
        const c = counts.get(ck)
        flags.add(name, r, addr(r, cols.desc), 'WARNING', 'DUPLICATE_LINE', `${key} appears more than once on this sheet (also ${c.ref}); quantities were added together.`, 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
        c.qty += qty.num
      } else {
        counts.set(ck, { item: key, date: countDate, qty: qty.num, unit_price: price, source: 'LEDGER', label: name, ref })
      }
    }
  }
}

function parseSaleBundles(ws, name, flags, items, prices, bundles) {
  for (const { row, cols } of findHeaders(ws)) {
    if (!cols.code) {
      flags.add(name, row, null, 'WARNING', 'LAYOUT', 'Sale bundle block without a CODE column; skipped.', 'NOT_IMPORTED')
      continue
    }
    let current = null
    const finish = () => {
      if (!current) return
      const sum = current.components.reduce((t, c) => t + c.qty, 0)
      if (current.declaredQty !== null && current.declaredQty !== sum) {
        flags.add(name, current.row, addr(current.row, cols.totalQty), 'WARNING', 'BUNDLE_QTY_MISMATCH',
          `${current.code}: TOTAL QTY says ${current.declaredQty} but its lines add up to ${sum}. The app uses ${sum}.`, 'IMPORTED')
      }
      delete current.declaredQty
      bundles.push(current)
      current = null
    }
    for (let r = row + 1; r <= ws.rowCount; r++) {
      const lenText = text(ws, r, cols.length)
      const desc = text(ws, r, cols.desc)
      const code = text(ws, r, cols.code).toUpperCase().replace(/\s+/g, '')
      if (/^(OVER ?ALL )?TOTAL/i.test(lenText)) { finish(); break }
      const sold = lenText.toUpperCase().match(/^SOLD\s*(SSKB\s*#?\s*\d+)/)
      if (sold) {
        finish()
        const c = sold[1].replace(/\s+/g, '').replace(/SSKB#?/, 'SSKB#')
        bundles.push({ code: c, price: null, status: 'SOLD', components: [], ref: `${name}!${addr(r, cols.length)}`, sheet: name, row: r,
          note: 'Marked SOLD in the sheet; contents not listed' })
        flags.add(name, r, addr(r, cols.length), 'INFO', 'SOLD_WITHOUT_CONTENTS', `${c} is marked SOLD with no contents listed; recorded as sold with no items.`, 'IMPORTED_WITH_ASSUMPTION')
        continue
      }
      if (!lenText && !desc) continue
      if (code) finish()
      const item = itemFromRow(ws, name, r, cols, {}, flags)
      const qty = numberCell(readCell(ws, r, cols.qty))
      if (!item) continue
      if (qty.num === null || qty.num <= 0) {
        flags.add(name, r, addr(r, cols.qty), 'ERROR', 'BLANK_QTY', 'Bundle line has no quantity; not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }
      const key = itemKey(item)
      if (!items.has(key)) items.set(key, { key, ...item, unit_price: null })
      if (code) {
        const price = cols.price ? numberCell(readCell(ws, r, cols.price)).num : null
        if (price === null) flags.add(name, r, addr(r, cols.price ?? cols.code), 'WARNING', 'BLANK_PRICE', `${code} has no bundle price.`, 'IMPORTED_WITH_ASSUMPTION', rowSnapshot(ws, r))
        const declared = cols.totalQty ? numberCell(readCell(ws, r, cols.totalQty)).num : null
        current = { code, price, status: 'AVAILABLE', components: [], declaredQty: declared, ref: `${name}!${addr(r, cols.code)}`, sheet: name, row: r }
      } else if (!current) {
        flags.add(name, r, addr(r, cols.desc), 'ERROR', 'BUNDLE_WITHOUT_CODE', 'Line is not under any SSKB code; not imported.', 'NOT_IMPORTED', rowSnapshot(ws, r))
        continue
      }
      current.components.push({ item: key, qty: qty.num })
    }
    finish()
  }
  // Duplicate codes within the file
  const seen = new Map()
  for (const b of bundles) {
    if (seen.has(b.code)) flags.add(name, b.row, null, 'ERROR', 'DUPLICATE_BUNDLE', `${b.code} appears twice (also ${seen.get(b.code)}); only the first is kept.`, 'NOT_IMPORTED')
    else seen.set(b.code, b.ref)
  }
  for (let i = bundles.length - 1; i >= 0; i--) if (bundles.findIndex((b) => b.code === bundles[i].code) !== i) bundles.splice(i, 1)
}

// Total rows are never imported, but broken or hand-typed totals are worth showing to the client.
function flagSheetTotals(ws, name, flags) {
  for (let r = 1; r <= ws.rowCount; r++) {
    const width = Math.min(ws.columnCount, 30)
    // Column-heading rows ("… PRICE | TOTAL") are not total lines.
    if (Array.from({ length: width }, (_, i) => text(ws, r, i + 1).toUpperCase()).includes('DESCRIPTION')) continue
    for (let c = 1; c <= width; c++) {
      const label = text(ws, r, c).toUpperCase()
      if (!/^(OVER ?ALL )?TOTAL\b|^OVERALL\b/.test(label)) continue
      for (let k = c + 1; k <= Math.min(c + 5, ws.columnCount); k++) {
        const cell = readCell(ws, r, k)
        if (cell.error || /#REF!/i.test(cell.formula ?? '')) {
          flags.add(name, r, addr(r, k), 'ERROR', 'REF_ERROR',
            `"${label}" total is a broken formula (${cell.error ?? '#REF!'}: =${(cell.formula ?? '').slice(0, 50)}…). Ignored; the app computes totals from the rows.`,
            'NOT_IMPORTED', rowSnapshot(ws, r))
        } else if (typeof cell.value === 'number' && !cell.formula) {
          flags.add(name, r, addr(r, k), 'WARNING', 'TYPED_TOTAL',
            `"${label}" is a typed number (${cell.value}), not a formula, so it does not follow the rows. Ignored; the app computes totals.`,
            'NOT_IMPORTED', rowSnapshot(ws, r))
        } else if (typeof cell.value === 'string' && cell.value.trim().startsWith('=')) {
          flags.add(name, r, addr(r, k), 'ERROR', 'FORMULA_AS_TEXT', `"${label}" contains formula text "${cell.value}" instead of a formula. Ignored.`, 'NOT_IMPORTED', rowSnapshot(ws, r))
        }
      }
    }
  }
}
