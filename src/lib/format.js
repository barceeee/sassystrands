const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const num = new Intl.NumberFormat('en-PH')

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : peso.format(Number(v)))
export const qty = (v) => (v === null || v === undefined ? '—' : num.format(Number(v)))
export const date = (v) => (v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
export const dateTime = (v) => (v ? new Date(v).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
export const titleCase = (s) => (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// How a piece's product and destination read everywhere (boards, piece page, QA).
export const PRODUCT_NOT_SET = 'Not set yet'
export const pieceFor = (p) => (p.order_no ? `${p.client_name ? `${p.client_name} · ` : ''}${p.order_no}` : p.stage === 'IN_STOCK' ? 'Stock' : 'Not linked to an order')

export function downloadCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => esc(c.label)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
