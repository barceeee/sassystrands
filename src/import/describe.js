// Turns the free-text product descriptions used across the spreadsheets
// ("DD MANILA CULS", "6X6 TRANS SARGAO", "13X6 HD LACE BIG LAGUNA") into controlled values.

const STANDARD_SIZES = ['2X6', '4X4', '5X5', '6X6', '7X7', '9X6', '13X4', '13X5', '13X6']

// Spelling variants seen in the client's files → canonical words.
const ALIASES = [
  [/\bSARGAO\b|\bSARGIAO\b|\bSIARGO\b/g, 'SIARGAO', 'SARGAO/SARGIAO → SIARGAO'],
  [/\bSGO\b/g, 'SIARGAO', 'SGO → SIARGAO'],
  [/\bMNL\b/g, 'MANILA', 'MNL → MANILA'],
  [/\bCULS\b|\bCURL\b/g, 'CURLS', 'CULS/CURL → CURLS'],
  [/\bTRANPARENT\b|\bTRANSPARENTS\b|\bTRANS\b/g, 'TRANSPARENT', 'TRANS/TRANPARENT → TRANSPARENT'],
  [/\bSTRIGHT\b/g, 'STRAIGHT', 'STRIGHT → STRAIGHT'],
  [/\bNW\b/g, 'NATURAL WAVY', 'NW → NATURAL WAVY'],
  [/\bJET\s+BLACK\b/g, 'JETBLACK', null],
  [/\bW\/\s*/g, '', null],
]

const STYLE_RULES = [
  [/BLACKENING NATURAL WAVY/, 'BLACKENING_NATURAL_WAVY'],
  [/BLACKENING/, 'BLACKENING_STRAIGHT'],
  [/SIARGAO (NATURAL )?WAVY/, 'SIARGAO_NATURAL_WAVY'],
  [/BIG LAGUNA/, 'BIG_LAGUNA_CURLS'],
  [/NATURAL WAVY|\bWAVY\b/, 'NATURAL_WAVY'],
  [/STRAIGHT/, 'STRAIGHT'],
  [/MANILA/, 'MANILA_CURLS'],
  [/ALABANG/, 'ALABANG_CURLS'],
  [/LAGUNA/, 'LAGUNA_CURLS'],
  [/SIARGAO/, 'SIARGAO_CURLS'],
  [/CEBU/, 'CEBU_CURLS'],
]

const VARIANT_RULES = [
  [/\bBROWN( HAIR)?\b/, 'BROWN'],
  [/\bWHITE HAIR\b/, 'WHITE HAIR'],
  [/\bBULK\b/, 'BULK'],
  [/\bFREE PART\b|\bFREE\b/, 'FREE PART'],
  [/\bCMP\b/, 'CMP'],
  [/\bJETBLACK\b/, 'JETBLACK'],
  [/\bSINGLE DONOR\b/, 'SINGLE DONOR'],
]

// Words that carry no extra meaning once the fields above are extracted.
const NOISE = new Set(['LACE', 'HAIR', 'CURLS', 'BUNDLE', 'BUNDLES', 'CLOSURE', 'SD', 'DD', 'SINGLE', 'DOUBLE', 'DRAWN', 'DRAW',
  'TRANSPARENT', 'SWISS', 'HD', 'NATURAL', 'WAVY', 'STRAIGHT', 'BLACKENING', 'MANILA', 'ALABANG', 'LAGUNA', 'BIG', 'SIARGAO',
  'CEBU', 'BROWN', 'WHITE', 'BULK', 'FREE', 'PART', 'CMP', 'JETBLACK', 'DONOR', '/'])

export function normalizeText(s) {
  return String(s ?? '').toUpperCase().replace(/ /g, ' ').replace(/(\d{1,2})\s*X\s*(\d{1,2})(?=[A-Z])/g, '$1X$2 ')
    .replace(/(\d{1,2})\s*X\s*(\d{1,2})/g, '$1X$2').replace(/\s+/g, ' ').trim()
}

// Same formula as the generated items.sku column in the database.
export function itemKey(i) {
  const base = i.category === 'BUNDLE'
    ? `${i.draw}-${i.style}-${i.length_in}`
    : `CL-${i.lace_type}-${i.lace_size}-${i.style}-${i.length_in}`
  return i.variant ? `${base}-${i.variant.replace(/ /g, '_')}` : base
}

/**
 * parseDescription("DD MANILA CULS", { length: 16 }) →
 *   { item: {category, draw, style, lace_type, lace_size, length_in, variant}, notes: [...], error: null }
 * ctx.variant: extra variant implied by the section heading (e.g. "SD JETBLACK BUNDLES").
 * ctx.lace_type / ctx.draw: defaults implied by the section when the description omits them.
 */
export function parseDescription(raw, ctx = {}) {
  const notes = []
  let s = normalizeText(raw)
  for (const [re, rep, label] of ALIASES) {
    if (re.test(s)) {
      if (label) notes.push({ severity: 'INFO', code: 'NORMALIZED', message: `"${raw}": ${label}` })
      s = s.replace(re, rep)
    }
    re.lastIndex = 0
  }
  s = s.replace(/\s+/g, ' ').trim()

  const sizeM = s.match(/\b(\d{1,2})X(\d{1,2})\b/)
  const laceM = s.match(/\b(TRANSPARENT|SWISS|HD)\b/)
  let draw = /\bSD\b|SINGLE DRAWN?/.test(s) ? 'SD' : /\bDD\b|DOUBLE DRAWN?/.test(s) ? 'DD' : (ctx.draw ?? null)
  const category = sizeM || laceM ? 'CLOSURE' : 'BUNDLE'
  const styleRule = STYLE_RULES.find(([re]) => re.test(s))
  const style = styleRule?.[1] ?? null
  const variants = VARIANT_RULES.filter(([re]) => re.test(s)).map(([, v]) => v)
  if (ctx.variant && !variants.includes(ctx.variant)) variants.push(ctx.variant)
  const length = ctx.length

  if (!style) return { item: null, notes, error: `Cannot tell the texture/style from "${raw}".` }
  if (/^[A-Z]+_CURLS$/.test(style) && !/CURLS/.test(s)) {
    notes.push({ severity: 'INFO', code: 'STYLE_INFERRED', message: `"${raw}" has no texture word; read as ${style.replace(/_/g, ' ').toLowerCase()}.` })
  }
  if (!Number.isInteger(length) || length < 1 || length > 40) {
    return { item: null, notes, error: `Hair length "${ctx.length ?? ''}" is missing or not a whole number of inches.` }
  }

  let item
  if (category === 'BUNDLE') {
    if (!draw) return { item: null, notes, error: `"${raw}" does not say Single Drawn (SD) or Double Drawn (DD).` }
    item = { category, draw, style, lace_type: null, lace_size: null, length_in: length, variant: variants.sort().join(' ') }
  } else {
    const lace_type = laceM?.[1] ?? ctx.lace_type ?? null
    if (!sizeM) return { item: null, notes, error: `Closure "${raw}" has no lace size (e.g. 5X5).` }
    if (!lace_type) return { item: null, notes, error: `Closure "${raw}" does not say Transparent, Swiss or HD lace.` }
    const lace_size = `${Number(sizeM[1])}X${Number(sizeM[2])}`
    if (!STANDARD_SIZES.includes(lace_size)) {
      notes.push({ severity: 'WARNING', code: 'NONSTANDARD_LACE_SIZE', message: `Lace size ${lace_size} in "${raw}" is not one of the standard sizes; added as a non-standard size.` })
    }
    if (draw) draw = null // closures are not tracked by draw
    item = { category, draw: null, style, lace_type, lace_size, length_in: length, variant: variants.sort().join(' ') }
  }

  const leftovers = s.replace(/\b\d{1,2}X\d{1,2}\b/g, ' ').split(/\s+/).filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w))
  if (leftovers.length) {
    notes.push({ severity: 'WARNING', code: 'UNRECOGNISED_WORDS', message: `Ignored unrecognised word(s) in "${raw}": ${leftovers.join(', ')}` })
  }
  return { item, notes, error: null }
}

export function parseLength(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null
  const m = String(v ?? '').trim().match(/^(\d{1,2})\s*(?:"|IN|INCH(?:ES)?)?$/i)
  return m ? Number(m[1]) : null
}
