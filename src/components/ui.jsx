import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { titleCase } from '../lib/format.js'

export function Page({ title, actions, children, subtitle }) {
  useEffect(() => { document.title = `${title} · Sassy Strands` }, [title])
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export const Card = ({ title, children, actions, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <div className="card-head">
        {title && <h2>{title}</h2>}
        {actions && <div className="actions">{actions}</div>}
      </div>
    )}
    {children}
  </section>
)

export const Alert = ({ kind = 'error', children }) =>
  children ? <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null

export const Loading = () => <p className="muted">Loading…</p>

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

const BADGE_TONES = {
  ERROR: 'red', WARNING: 'amber', INFO: 'blue',
  CANCELED: 'grey', VOIDED: 'grey', ON_HOLD: 'amber', NOT_STARTED: 'grey', NO_LINES: 'grey', CLOSED: 'grey',
  FULFILLED: 'green', APPROVED: 'green', ISSUED: 'green', SOLD: 'grey', READY: 'green', READY_TO_SHIP: 'green',
  IN_STOCK: 'green', SHIPPED: 'green',
  REJECTED: 'red', PARTIAL: 'amber', PARTIALLY_SHIPPED: 'amber', IN_PRODUCTION: 'blue', FOR_QA: 'purple',
  AVAILABLE: 'blue', ACTIVE: 'blue', OPEN: 'blue',
  IN: 'green', OUT: 'red', ADJUST: 'amber', OPENING: 'blue',
}
export const Badge = ({ value, label }) => <span className={`badge badge-${BADGE_TONES[value] ?? 'grey'}`}>{label ?? titleCase(value)}</span>

// Wraps an async action: tracks busy state and shows the error (or a success message).
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const run = async (fn, successMessage) => {
    setBusy(true); setError(null); setDone(null)
    try {
      const r = await fn()
      if (successMessage) setDone(typeof successMessage === 'function' ? successMessage(r) : successMessage)
      return r ?? true
    } catch (e) {
      setError(e.message ?? String(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, done, run, setError, setDone }
}

export const ActionResult = ({ action }) => (
  <>
    <Alert>{action.error}</Alert>
    <Alert kind="success">{action.done}</Alert>
  </>
)

// Searchable product picker over v_items.
export function ItemPicker({ items, value, onChange, filter, required, id }) {
  const [q, setQ] = useState('')
  const options = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (items ?? [])
      .filter((i) => i.active !== false && (!filter || filter(i)))
      .filter((i) => i.id === Number(value) || words.every((w) => `${i.name} ${i.sku}`.toLowerCase().includes(w)))
      .slice(0, 300)
  }, [items, q, filter, value])
  return (
    <div className="item-picker">
      <input type="search" placeholder="Filter, e.g. dd manila 16" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter products" />
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} required={required}>
        <option value="">— choose product ({options.length}) —</option>
        {options.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  )
}

export function Table({ columns, rows, empty = 'Nothing to show.', footer, rowKey = 'id', onRowClick }) {
  if (!rows) return null
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key ?? c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="muted center">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key ?? c.label} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot><tr>{footer}</tr></tfoot>}
      </table>
    </div>
  )
}

export const Forbidden = () => (
  <div className="page"><Alert>You do not have access to this page. <Link to="/">Back to the dashboard</Link></Alert></div>
)

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">
    {tabs.map((t) => (
      <button type="button" key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'active' : ''} onClick={() => onChange(t.value)}>
        {t.label}
      </button>
    ))}
  </div>
)
