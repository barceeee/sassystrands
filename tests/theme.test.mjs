// Run: npm test
// Theme inheritance, CSS variable output, and WCAG AA contrast for text on every glass surface.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Theme } from '../src/theme/Theme.js'
import { ShowroomTheme } from '../src/theme/themes.js'
import { flatten, contrast } from '../src/theme/contrast.js'

test('a subclass overrides one token and inherits everything else', () => {
  const base = new Theme().tokens
  const showroom = new ShowroomTheme().tokens
  assert.equal(showroom.glass.strong.bg, 'rgba(92, 80, 66, 0.88)')
  assert.equal(showroom.glass.strong.border, base.glass.strong.border)
  assert.deepEqual(showroom.color, base.color)
  assert.deepEqual({ ...showroom.glass, strong: null }, { ...base.glass, strong: null })
  assert.notEqual(base.glass.strong.bg, showroom.glass.strong.bg, 'base must not be mutated')
})

test('subclasses of subclasses merge the whole chain', () => {
  class Night extends ShowroomTheme {
    static id = 'night'
    static tokens = { radius: { lg: '20px' } }
  }
  const t = new Night().tokens
  assert.equal(t.radius.lg, '20px')
  assert.equal(t.radius.md, new Theme().tokens.radius.md)
  assert.equal(t.glass.strong.bg, new ShowroomTheme().tokens.glass.strong.bg)
  assert.equal(new Night().id, 'night')
})

test('Theme.extend and instance overrides work without a class body', () => {
  const Quiet = Theme.extend('quiet', { color: { canvas: '#F0EEEA' } })
  assert.equal(new Quiet().tokens.color.canvas, '#F0EEEA')
  assert.equal(new Theme({ space: { 4: '18px' } }).tokens.space[4], '18px')
  assert.equal(new Theme().tokens.space[4], '16px')
})

test('resolved tokens are frozen', () => {
  assert.throws(() => { new Theme().tokens.color.ink = 'red' }, TypeError)
})

test('cssVars flattens tokens into --ss-* names', () => {
  const vars = new Theme().cssVars()
  assert.equal(vars['--ss-color-ink'], '#23211E')
  assert.equal(vars['--ss-color-on-strong'], '#F7F5F1')
  assert.equal(vars['--ss-glass-surface-bg-hover'], 'rgba(251, 250, 248, 0.74)')
  assert.equal(vars['--ss-space-4'], '16px')
  assert.equal(Theme.var('glass.surface.bg'), 'var(--ss-glass-surface-bg)')
  for (const group of ['color', 'font', 'text', 'space', 'radius', 'shadow', 'glass']) {
    assert.ok(Object.keys(vars).some((k) => k.startsWith(`--ss-${group}-`)), `missing ${group} tokens`)
  }
})

// Each theme's text must clear AA (4.5:1) on every light glass layer, composited over each
// backdrop the app paints (canvas, and the stone tones in its wash), and on hover.
const AA = 4.5
for (const T of [Theme, ShowroomTheme]) {
  test(`${T.id}: text on glass meets WCAG AA`, () => {
    const { color: c, glass: g } = new T().tokens
    const backdrops = [c.canvas, c.offWhite, c.stone, c.stoneDeep]
    const texts = ['ink', 'inkSoft', 'muted', 'danger', 'success', 'warning', 'info', 'accent']
    for (const b of backdrops) {
      for (const v of ['surface', 'raised', 'subtle', 'control']) {
        for (const state of ['bg', 'bgHover']) {
          const bg = flatten(b, g[v][state])
          for (const t of texts) assert.ok(contrast(c[t], bg) >= AA, `${t} on ${v}.${state} over ${b}: ${contrast(c[t], bg).toFixed(2)}`)
        }
        const fb = g[v].fallback
        for (const t of texts) assert.ok(contrast(c[t], fb) >= AA, `${t} on ${v}.fallback: ${contrast(c[t], fb).toFixed(2)}`)
      }
      // Buttons sit on cards; selected rows add a tint.
      const stacked = flatten(b, g.surface.bg, g.control.bg)
      assert.ok(contrast(c.muted, stacked) >= AA)
      assert.ok(contrast(c.ink, flatten(b, g.subtle.bg, c.tint)) >= AA)
      // Primary buttons and selected tabs/nav: pearl text on graphite glass, over the
      // lightest and darkest backdrops.
      for (const v of ['strong', 'selected']) {
        for (const back of [c.white, b]) {
          for (const state of ['bg', 'bgHover']) {
            const r = contrast(c.onStrong, flatten(back, g[v][state]))
            assert.ok(r >= AA, `onStrong on ${v}.${state} over ${back}: ${r.toFixed(2)}`)
          }
        }
        assert.ok(contrast(c.onStrong, g[v].fallback) >= AA)
        // The selected silhouette must stand out from the light track around it (3:1, non-text).
        assert.ok(contrast(flatten(b, g.subtle.bg, g[v].bg), flatten(b, g.subtle.bg)) >= 3)
      }
    }
    // Status text on its own soft badge/alert background.
    for (const s of ['success', 'danger', 'warning', 'info', 'accent']) {
      assert.ok(contrast(c[s], c[`${s}Soft`]) >= AA, `${s} on ${s}Soft`)
    }
    // Focus ring: non-text contrast 3:1 against the canvas.
    assert.ok(contrast(c.focus, c.canvas) >= 3)
  })
}
