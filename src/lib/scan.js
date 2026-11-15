// Tells a hardware barcode scanner (keyboard wedge: types the code fast, then Enter or Tab)
// apart from a person typing. A whole code must arrive within SCAN_MAX_MS to count as scanned.

export const SCAN_MAX_MS = 300

// Scanners can prefix the AIM symbology identifier `]C0`; strip it, trim and uppercase.
export function normaliseSerial(raw) {
  return String(raw).replaceAll(']C0', '').trim().toUpperCase()
}

export function isSubmitKey(key) {
  return key === 'Enter' || key === 'Tab'
}

export function createScanGate({ now = () => performance.now(), maxMs = SCAN_MAX_MS } = {}) {
  let chars = []
  let firstKeyAt = 0
  let lastKeyAt = 0

  return {
    key(char) {
      const t = now()
      if (chars.length === 0) firstKeyAt = t
      lastKeyAt = t
      chars.push(char)
    },
    submit() {
      if (chars.length === 0) return null
      const code = normaliseSerial(chars.join(''))
      const scanned = lastKeyAt - firstKeyAt <= maxMs
      chars = []
      return { code, scanned }
    },
    reset() {
      chars = []
    },
  }
}
