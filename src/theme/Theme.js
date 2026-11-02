// Sassy Strands theme: the single source of truth for UI styling.
//
// `Theme` holds every design token. A subclass lists only the tokens it changes in its own
// `static tokens`; `resolve()` deep-merges the class chain (base → subclass → sub-subclass), so
// nothing from the base is ever copied. ThemeProvider turns the resolved tokens into CSS custom
// properties (`--ss-<group>-<name>`), which every stylesheet and component reads.
//
// Plain JS (no JSX) so Node tests can import it.

const BASE_TOKENS = {
  color: {
    // Neutrals: soft whites → pearl → stone → graphite → warm charcoal.
    white: '#FFFFFF',
    offWhite: '#FAF9F7',
    pearl: '#F2F0EC',
    canvas: '#ECEAE5', // page background
    stone: '#DCD7CF',
    stoneDeep: '#BDB6AA',
    graphite: '#3A3733',
    charcoal: '#2B2926',

    // Text. Values are checked against every glass surface in tests/theme.test.mjs (WCAG AA).
    ink: '#23211E', // body text and headings
    inkSoft: '#3A3733', // secondary headings, icons
    muted: '#5A554E', // supporting text
    onStrong: '#F7F5F1', // text on graphite glass (primary buttons)

    // Lines, fields, focus, hover/selected wash.
    tint: 'rgba(35, 33, 30, 0.06)',
    line: 'rgba(35, 33, 30, 0.12)',
    lineStrong: 'rgba(35, 33, 30, 0.22)',
    field: '#FDFCFA',
    focus: '#3A3733',
    focusRing: 'rgba(58, 55, 51, 0.20)', // soft halo around a focused field

    // Status: earthy, desaturated, so meaning survives without loud accents.
    success: '#3C5843',
    successSoft: '#E4EBE3',
    danger: '#8A382C',
    dangerSoft: '#F3E3DF',
    warning: '#74510F',
    warningSoft: '#F3EAD6',
    info: '#36506F',
    infoSoft: '#E3E8EF',
    accent: '#56476A',
    accentSoft: '#EAE6EF',
  },

  font: {
    display: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
    body: '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace',
  },
  text: {
    xs: '0.75rem',
    sm: '0.85rem',
    md: 'clamp(0.9375rem, 0.85rem + 0.12vw, 1.0625rem)', // base size: 15px on laptops, up to 17px on big monitors
    lg: '1.125rem',
    xl: 'clamp(1.35rem, 1.1rem + 0.8vw, 2rem)', // page titles
    xxl: 'clamp(1.9rem, 1.4rem + 1.6vw, 2.75rem)',
  },
  weight: { regular: '400', medium: '500', semibold: '600' },
  leading: { tight: '1.2', normal: '1.5' },
  tracking: { display: '-0.01em', caps: '0.08em' },

  space: {
    0: '0', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px',
  },

  // Inputs, selects and buttons share one height so a row of controls lines up.
  // Touch screens get the larger height (44px is the minimum comfortable tap target).
  size: { control: '40px', controlSm: '30px', controlTouch: '44px' },

  // Fluid layout: these grow with the screen so the app fills phones and ultra-wide monitors alike.
  layout: {
    topbar: '56px',
    sidebar: 'clamp(200px, 14vw, 264px)',
    gutter: 'clamp(16px, 2.2vw, 44px)', // page padding
    gap: 'clamp(12px, 1.3vw, 24px)', // space between cards
  },

  radius: { sm: '8px', md: '12px', lg: '18px', xl: '24px', pill: '999px' },

  shadow: {
    xs: '0 1px 2px rgba(31, 29, 27, 0.05)',
    sm: '0 1px 2px rgba(31, 29, 27, 0.04), 0 4px 12px -4px rgba(31, 29, 27, 0.10)',
    md: '0 2px 4px rgba(31, 29, 27, 0.04), 0 12px 32px -12px rgba(31, 29, 27, 0.16)',
    lg: '0 2px 6px rgba(31, 29, 27, 0.06), 0 28px 64px -18px rgba(31, 29, 27, 0.30)',
  },

  motion: { fast: '140ms', ease: 'cubic-bezier(0.2, 0, 0, 1)' },

  // Glass building blocks. Each variant is one layer of the same recipe: translucent fill,
  // backdrop blur, light border, inner highlight, soft shadow, and an opaque fallback for
  // browsers without backdrop-filter (or users who ask for reduced transparency).
  glass: {
    saturate: '120%',
    highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.70)',
    // Cards, stat tiles, tables, boards.
    surface: {
      bg: 'rgba(251, 250, 248, 0.62)',
      bgHover: 'rgba(251, 250, 248, 0.74)',
      border: 'rgba(255, 255, 255, 0.70)',
      blur: '20px',
      shadow: '0 1px 2px rgba(31, 29, 27, 0.04), 0 12px 32px -14px rgba(31, 29, 27, 0.16)',
      fallback: '#F7F6F3',
    },
    // Modals and dialogs: the most opaque light layer, sits above everything.
    raised: {
      bg: 'rgba(251, 250, 248, 0.82)',
      bgHover: 'rgba(251, 250, 248, 0.82)',
      border: 'rgba(255, 255, 255, 0.80)',
      blur: '32px',
      shadow: '0 2px 6px rgba(31, 29, 27, 0.06), 0 28px 64px -18px rgba(31, 29, 27, 0.30)',
      fallback: '#FAF9F7',
    },
    // Chrome and nested tiles (top bar, sidebar, production jobs).
    subtle: {
      bg: 'rgba(251, 250, 248, 0.50)',
      bgHover: 'rgba(251, 250, 248, 0.68)',
      border: 'rgba(255, 255, 255, 0.55)',
      blur: '16px',
      shadow: '0 1px 2px rgba(31, 29, 27, 0.03)',
      fallback: '#F4F3EF',
    },
    // Default buttons.
    control: {
      bg: 'rgba(255, 255, 255, 0.56)',
      bgHover: 'rgba(255, 255, 255, 0.80)',
      border: 'rgba(35, 33, 30, 0.13)',
      blur: '12px',
      shadow: '0 1px 2px rgba(31, 29, 27, 0.06)',
      fallback: '#FBFAF8',
    },
    // Primary buttons: graphite glass with pearl text.
    strong: {
      bg: 'rgba(43, 41, 38, 0.86)',
      bgHover: 'rgba(31, 29, 27, 0.92)',
      border: 'rgba(255, 255, 255, 0.12)',
      blur: '12px',
      shadow: '0 6px 16px -6px rgba(31, 29, 27, 0.38)',
      fallback: '#2E2C29',
    },
    // The chosen item in a set: active tab, current sidebar page. A solid graphite silhouette
    // with pearl text, so the selection is obvious at a glance.
    selected: {
      bg: 'rgba(43, 41, 38, 0.90)',
      bgHover: 'rgba(43, 41, 38, 0.90)',
      border: 'rgba(255, 255, 255, 0.10)',
      blur: '12px',
      shadow: '0 1px 1px rgba(31, 29, 27, 0.10), 0 6px 18px -6px rgba(31, 29, 27, 0.40)',
      fallback: '#2E2C29',
    },
    // Dimmed layer behind a modal.
    scrim: { bg: 'rgba(31, 29, 27, 0.30)', blur: '6px', fallback: 'rgba(31, 29, 27, 0.55)' },
  },
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Returns a new object: `over` merged into `base`, leaf by leaf. Neither input is changed.
export function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v
  return out
}

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => isPlainObject(v) && deepFreeze(v))
  return Object.freeze(o)
}

const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
export const cssVarName = (path) => `--ss-${path.split('.').map(kebab).join('-')}`

const resolved = new WeakMap()

export class Theme {
  // Shown as data-theme on the element the theme is applied to. Subclasses set their own.
  static id = 'base'
  static tokens = BASE_TOKENS

  // Base tokens merged with every subclass's own `static tokens`, top of the chain first.
  static resolve() {
    if (resolved.has(this)) return resolved.get(this)
    const parent = Object.getPrototypeOf(this)
    const inherited = parent && typeof parent.resolve === 'function' ? parent.resolve() : {}
    const own = Object.prototype.hasOwnProperty.call(this, 'tokens') ? this.tokens : {}
    const tokens = deepFreeze(deepMerge(inherited, own))
    resolved.set(this, tokens)
    return tokens
  }

  // Shorthand for a one-off subclass: Theme.extend('showroom', { color: { canvas: '#…' } }).
  static extend(id, tokens) {
    return class extends this {
      static id = id
      static tokens = tokens
    }
  }

  // `overrides` applies to this one instance only, on top of the class chain.
  constructor(overrides) {
    this.id = this.constructor.id
    this.tokens = overrides ? deepFreeze(deepMerge(this.constructor.resolve(), overrides)) : this.constructor.resolve()
  }

  // Token by dotted path: theme.get('glass.surface.bg').
  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this.tokens)
  }

  // `var(--ss-…)` reference for inline styles, so components never hard-code a value.
  static var(path) {
    return `var(${cssVarName(path)})`
  }

  // Flat { '--ss-color-ink': '#23211E', … } map of every token.
  cssVars() {
    const out = {}
    const walk = (node, path) => {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k
        if (isPlainObject(v)) walk(v, p)
        else out[cssVarName(p)] = String(v)
      }
    }
    walk(this.tokens, '')
    return out
  }
}
