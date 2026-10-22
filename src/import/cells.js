// Cell reading helpers over ExcelJS worksheets, plus the flag collector shared by all parsers.

export function colLetter(c) {
  let s = ''
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

export const addr = (r, c) => `${colLetter(c)}${r}`

// Returns { value, formula, error, raw } where value is the plain value (cached result for formulas).
export function readCell(ws, r, c) {
  const cell = ws.getRow(r).getCell(c)
  // ExcelJS repeats a merged range's value in every covered cell; only the top-left cell holds it.
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return { value: null, formula: null, error: null }
  const v = cell.value
  if (v === null || v === undefined) return { value: null, formula: null, error: null }
  if (v instanceof Date) return { value: v, formula: null, error: null }
  if (typeof v === 'object') {
    if ('error' in v) return { value: null, formula: null, error: v.error }
    if ('formula' in v || 'sharedFormula' in v) {
      // cell.formula translates shared formulas (v.sharedFormula is only the master cell's address).
      const formula = cell.formula ?? v.formula ?? ''
      const res = v.result
      if (res && typeof res === 'object' && 'error' in res) return { value: null, formula, error: res.error }
      if (/#REF!/i.test(formula)) return { value: res ?? null, formula, error: '#REF!' }
      return { value: res ?? null, formula, error: null }
    }
    if ('richText' in v) return { value: v.richText.map((t) => t.text).join(''), formula: null, error: null }
    if ('text' in v) return { value: v.text, formula: null, error: null }
    return { value: String(v), formula: null, error: null }
  }
  return { value: v, formula: null, error: null }
}

export function text(ws, r, c) {
  const { value } = readCell(ws, r, c)
  if (value === null || value instanceof Date) return ''
  return String(value).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

export const isBlank = (cell) => cell.value === null && !cell.error && !cell.formula ||
  (typeof cell.value === 'string' && cell.value.trim() === '' && !cell.formula)

// Formula text typed into a cell as a literal string, e.g. "=C5*D5" or "SUM(D3:D9)".
export const looksLikeFormulaText = (s) => typeof s === 'string' && /^\s*(=|\+?SUM\s*\(|[A-Z]{1,3}\d+\s*[-+*/])/i.test(s)

// Interprets a cell that should hold a number. Returns { num, issue } where issue explains
// anything that is not a clean number (num stays null when the value cannot be used).
export function numberCell(cell) {
  if (cell.error) return { num: null, issue: { severity: 'ERROR', code: 'FORMULA_ERROR', message: `Formula error ${cell.error}${cell.formula ? ` in =${cell.formula}` : ''}` } }
  const v = cell.value
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { num: null, issue: null }
  if (typeof v === 'number') return { num: v, issue: null }
  if (v instanceof Date) return { num: null, issue: { severity: 'ERROR', code: 'DATE_IN_NUMBER_CELL', message: `Expected a number but found a date (${isoDate(v)})` } }
  const s = String(v).trim()
  if (looksLikeFormulaText(s)) return { num: null, issue: { severity: 'ERROR', code: 'FORMULA_AS_TEXT', message: `Formula typed as text: "${s}"` } }
  const n = Number(s.replace(/[,"″]/g, ''))
  if (Number.isFinite(n)) return { num: n, issue: { severity: 'WARNING', code: 'NUMBER_AS_TEXT', message: `Number stored as text ("${s}") — read as ${n}` } }
  return { num: null, issue: { severity: 'ERROR', code: 'NOT_A_NUMBER', message: `Expected a number but found "${s}"` } }
}

export function isoDate(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

export function monthFromName(name) {
  const up = name.toUpperCase()
  const i = MONTHS.findIndex((m) => up.includes(m) || new RegExp(`\\b${m.slice(0, 3)}\\b`).test(up))
  return i === -1 ? null : i + 1
}

export const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// Collects row-level problems. outcome: IMPORTED | IMPORTED_WITH_ASSUMPTION | NOT_IMPORTED
export class Flags {
  constructor() { this.list = [] }
  add(sheet, row, cell, severity, code, message, outcome, raw) {
    this.list.push({ sheet, row: row ?? null, cell: cell ?? null, severity, code, message, outcome, raw: raw ?? null })
  }
}

// Row snapshot for a flag, so staff can see what the spreadsheet said without opening it.
export function rowSnapshot(ws, r, fromCol = 1, toCol = Math.min(ws.columnCount || 20, 20)) {
  const out = {}
  for (let c = fromCol; c <= toCol; c++) {
    const cell = readCell(ws, r, c)
    if (cell.value === null && !cell.error && !cell.formula) continue
    out[addr(r, c)] = cell.error ? cell.error : cell.formula ? `=${cell.formula}` + (cell.value !== null ? ` → ${fmt(cell.value)}` : '') : fmt(cell.value)
  }
  return out
}

const fmt = (v) => (v instanceof Date ? isoDate(v) : v)
