// WCAG contrast helpers for checking theme tokens (used by tests/theme.test.mjs).
// A translucent glass fill is composited over its backdrop first, because the colour the
// eye sees is the blend, not the fill on its own.

export function parseColor(c) {
  if (Array.isArray(c)) return c.length === 4 ? c : [...c, 1]
  const s = String(c).trim()
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1)
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [r, g, b, a]
  }
  throw new Error(`Unsupported colour: ${c}`)
}

// Source-over blend of `top` onto an opaque `bottom`. Returns an opaque [r, g, b, 1].
export function composite(top, bottom) {
  const [r1, g1, b1, a] = parseColor(top)
  const [r2, g2, b2] = parseColor(bottom)
  return [r1 * a + r2 * (1 - a), g1 * a + g2 * (1 - a), b1 * a + b2 * (1 - a), 1]
}

// Blend a stack of layers, listed backdrop first: flatten('#ECEAE5', cardFill, buttonFill).
export function flatten(...layers) {
  return layers.slice(1).reduce((acc, layer) => composite(layer, acc), parseColor(layers[0]))
}

const channel = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(color) {
  const [r, g, b] = Array.isArray(color) ? color : parseColor(color)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
