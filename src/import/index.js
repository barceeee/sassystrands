// Entry point for spreadsheet imports: recognise which of the client's workbooks this is and parse it.
import ExcelJS from 'exceljs'
import { text } from './cells.js'
import { parseTracker } from './tracker.js'
import { parseLedger } from './ledger.js'
import { parseOrders } from './orders.js'

export function detectKind(wb) {
  const names = wb.worksheets.map((w) => w.name.toUpperCase())
  if (names.some((n) => /(SINGLE|DOUBLE) DRAWN/.test(n))) return 'TRACKER'
  for (const ws of wb.worksheets) {
    const row1 = Array.from({ length: Math.min(ws.columnCount, 15) }, (_, i) => text(ws, 1, i + 1).toUpperCase())
    if (row1.includes('ORDER') && row1.some((h) => h.includes('REMAINING'))) return 'ORDERS'
  }
  if (names.some((n) => n.includes('SALE BUNDLE'))) return 'LEDGER'
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 6); r++) {
      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
        if (text(ws, r, c).toUpperCase() === 'LENGTH' && text(ws, r, c + 1).toUpperCase() === 'DESCRIPTION') return 'LEDGER'
      }
    }
  }
  return null
}

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Parses an .xlsx ArrayBuffer into the payload expected by the import_batch() database function. */
export async function parseWorkbook(buffer, { today = new Date() } = {}) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const kind = detectKind(wb)
  if (!kind) {
    throw new Error('This workbook is not one of the supported files (bundle & closure inventory, available stocks, client orders).')
  }
  const sha256 = await sha256Hex(buffer)
  const parsed =
    kind === 'TRACKER' ? parseTracker(wb, { today })
    : kind === 'LEDGER' ? parseLedger(wb, { today })
    : parseOrders(wb, { fileTag: sha256.slice(0, 6).toUpperCase() })
  return { ...parsed, sha256 }
}

// Shape sent to the database (drops parser-only fields).
export function toPayload(parsed) {
  const { items = [], movements = [], counts = [], bundles = [], orders = [], flags = [], summary = {} } = parsed
  return {
    items,
    movements,
    counts,
    bundles: bundles.map(({ code, price, status, note, ref, sheet, row, components }) => ({ code, price, status, note, ref, sheet, row, components })),
    orders,
    flags,
    summary: { ...summary, flags: countBy(flags, 'severity') },
  }
}

const countBy = (list, k) => list.reduce((acc, x) => ({ ...acc, [x[k]]: (acc[x[k]] ?? 0) + 1 }), {})
