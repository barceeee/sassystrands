// Run: npm test
// Workbook tests also run when XLSX_DIR points at a folder with the client's three spreadsheets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseDescription, itemKey } from '../src/import/describe.js'
import { parseWorkbook } from '../src/import/index.js'

const item = (desc, length) => parseDescription(desc, { length }).item

test('normalises spelling variants into controlled values', () => {
  assert.equal(itemKey(item('DD MANILA CULS', 10)), 'DD-MANILA_CURLS-10')
  assert.equal(itemKey(item('6X6 TRANS SARGAO', 12)), 'CL-TRANSPARENT-6X6-SIARGAO_CURLS-12')
  assert.equal(itemKey(item('6X6 HD LACE MNL', 6)), 'CL-HD-6X6-MANILA_CURLS-6')
  assert.equal(itemKey(item('4X4 TRANPARENT STRAIGHT', 14)), 'CL-TRANSPARENT-4X4-STRAIGHT-14')
  assert.equal(itemKey(item('5X5 TRANSPARENT LACE STRIGHT', 18)), 'CL-TRANSPARENT-5X5-STRAIGHT-18')
  assert.equal(itemKey(item('6X6HD LACE MANILA CURLS', 12)), 'CL-HD-6X6-MANILA_CURLS-12')
  assert.equal(itemKey(item('SD SGO NW', 12)), 'SD-SIARGAO_NATURAL_WAVY-12')
  assert.equal(itemKey(item('SD SIARGAO NATURAL WAVY', 16)), 'SD-SIARGAO_NATURAL_WAVY-16')
  assert.equal(itemKey(item('13X6 HD LACE BIG LAGUNA', 22)), 'CL-HD-13X6-BIG_LAGUNA_CURLS-22')
  assert.equal(itemKey(item('SD STRAIGHT BULK', 12)), 'SD-STRAIGHT-12-BULK')
  assert.equal(itemKey(item('SD SIARGAO CURLS W/ WHITE HAIR', 8)), 'SD-SIARGAO_CURLS-8-WHITE_HAIR')
  assert.equal(itemKey(item('SD BLACKENING NATURAL WAVY', 14)), 'SD-BLACKENING_NATURAL_WAVY-14')
  assert.equal(itemKey(item('SD BLACKENING STRAIGHT', 14)), 'SD-BLACKENING_STRAIGHT-14')
})

test('rejects descriptions it cannot classify', () => {
  assert.match(parseDescription('STRAIGHT SINGLE DONOR', { length: 14 }).error, /Single Drawn/)
  assert.match(parseDescription('DD MANILA CURLS', { length: null }).error, /length/i)
  assert.match(parseDescription('13X6 MANILA CURLS', { length: 12 }).error, /Transparent, Swiss or HD/)
})

test('flags non-standard lace sizes', () => {
  const p = parseDescription('6X4  HD LACE STRAIGHT', { length: 12 })
  assert.equal(p.item.lace_size, '6X4')
  assert.ok(p.notes.some((n) => n.code === 'NONSTANDARD_LACE_SIZE'))
})

const dir = process.env.XLSX_DIR
const file = (name) => {
  const buf = readFileSync(join(dir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
const codes = (p) => new Set(p.flags.map((f) => f.code))
const today = new Date('2026-10-22T00:00:00Z')

test('inventory tracker workbook', { skip: !dir || !existsSync(join(dir ?? '', 'HAIR BUNDLE  AND CLOSURE INVENTORY.xlsx')) }, async () => {
  const p = await parseWorkbook(file('HAIR BUNDLE  AND CLOSURE INVENTORY.xlsx'), { today })
  assert.equal(p.kind, 'TRACKER')
  assert.ok(p.movements.some((m) => m.type === 'OPENING' && m.date === '2026-06-01'))
  for (const c of ['DATE_HEADER_MISMATCH', 'STARTING_BALANCE_MISMATCH', 'AMBIGUOUS_AUDIT_DATE', 'SHEET_MONTH_MISSING']) assert.ok(codes(p).has(c), c)
  // August headers typed as July must still land in August.
  assert.ok(!p.movements.some((m) => m.ref.startsWith('SINGLE DRAWN (AUGUST)') && !m.date.startsWith('2026-08') && m.type !== 'ADJUST'))
  assert.ok(p.counts.some((c) => c.source === 'AUDIT' && c.date === '2026-10-03'))
})

test('available stocks workbook', { skip: !dir || !existsSync(join(dir ?? '', 'AVAILABLE STOCKS (26).xlsx')) }, async () => {
  const p = await parseWorkbook(file('AVAILABLE STOCKS (26).xlsx'), { today })
  assert.equal(p.kind, 'LEDGER')
  for (const c of ['REF_ERROR', 'BLANK_PRICE', 'TYPED_TOTAL', 'PRICE_CONFLICT']) assert.ok(codes(p).has(c), c)
  assert.equal(p.bundles.length, 30)
  assert.ok(p.bundles.some((b) => b.code === 'SSKB#37' && b.status === 'SOLD'))
  assert.deepEqual(p.bundles.find((b) => b.code === 'SSKB#31').components.map((c) => c.qty), [3, 1])
})

test('client orders workbook', { skip: !dir || !existsSync(join(dir ?? '', 'MONITORING CLIENTS ORDER.xlsx')) }, async () => {
  const p = await parseWorkbook(file('MONITORING CLIENTS ORDER.xlsx'), { today })
  assert.equal(p.kind, 'ORDERS')
  const sassy = p.orders.filter((o) => o.client === 'SASSY STRANDS')
  assert.equal(sassy.length, 2)
  assert.equal(sassy[0].lines[0].group_label, 'SAMBIA')
  for (const c of ['MALFORMED_FORMULA', 'TOTAL_RANGE_MISMATCH', 'NO_QTY', 'UNPARSED_DESCRIPTION', 'CANCELED_WITH_WORK']) assert.ok(codes(p).has(c), c)
  const canceled = p.orders.flatMap((o) => o.lines).filter((l) => l.canceled)
  assert.ok(canceled.length >= 3)
})
