// Run: npm test
// Scanner-vs-typing gate: whole code must arrive within SCAN_MAX_MS; serial normalising.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCAN_MAX_MS, normaliseSerial, createScanGate, isSubmitKey } from '../src/lib/scan.js'

// Feeds `text` one char per tick, `gapMs` apart, starting at t = 0.
function feed(gate, clock, text, gapMs) {
  for (const ch of text) {
    clock.t += gapMs
    gate.key(ch)
  }
}

function fakeClock(start = 0) {
  return { t: start, now() { return this.t } }
}

test('SCAN_MAX_MS is 300', () => {
  assert.equal(SCAN_MAX_MS, 300)
})

test('normaliseSerial strips the ]C0 prefix, trims and uppercases', () => {
  assert.equal(normaliseSerial(' ]C0ss-000012 '), 'SS-000012')
  assert.equal(normaliseSerial('ss-000012'), 'SS-000012')
})

test('a code fed 25 ms apart is scanned', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  feed(gate, clock, 'SS-000001', 25)
  const result = gate.submit()
  assert.deepEqual(result, { code: 'SS-000001', scanned: true })
})

test('a code fed 150 ms apart is typed, not scanned', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  feed(gate, clock, 'SS-000001', 150)
  const result = gate.submit()
  assert.deepEqual(result, { code: 'SS-000001', scanned: false })
})

test('a single character counts as scanned (first and last key at the same time)', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  gate.key('X')
  assert.deepEqual(gate.submit(), { code: 'X', scanned: true })
})

test('submit on an empty buffer returns null', () => {
  const gate = createScanGate({ now: () => 0 })
  assert.equal(gate.submit(), null)
})

test('submit clears the buffer', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  feed(gate, clock, 'SS-000002', 10)
  assert.ok(gate.submit())
  assert.equal(gate.submit(), null)
})

test('submit after reset returns null', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  feed(gate, clock, 'SS-000003', 10)
  gate.reset()
  assert.equal(gate.submit(), null)
})

test('the gate honours a custom maxMs', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now(), maxMs: 50 })
  feed(gate, clock, 'SS-000004', 25) // span 8 * 25 = 200 ms > 50
  assert.equal(gate.submit().scanned, false)
})

test('the code is normalised by the gate too', () => {
  const clock = fakeClock()
  const gate = createScanGate({ now: () => clock.now() })
  feed(gate, clock, ']C0ss-000005', 10)
  assert.equal(gate.submit().code, 'SS-000005')
})

test('isSubmitKey is true for Enter and Tab only', () => {
  assert.equal(isSubmitKey('Tab'), true)
  assert.equal(isSubmitKey('Enter'), true)
  assert.equal(isSubmitKey('a'), false)
})
