// TEMPORARY — dev-only quick login for the dummy accounts.
// Renders only under `npm run dev` (import.meta.env.DEV); Vite drops it from production builds.
// To remove: delete this file, DevQuickLogin.css, and the <DevQuickLogin /> line + import in src/pages/Login.jsx.
import { useState } from 'react'
import { useAuth } from '../auth.jsx'
import { Alert } from './ui.jsx'
import './DevQuickLogin.css'

const PASSWORD = '12345678'
const ACCOUNTS = [
  { username: 'admin', role: 'Owner', tone: 'purple' },
  { username: 'inventory', role: 'Inventory', tone: 'blue' },
  { username: 'production', role: 'Production', tone: 'amber' },
  { username: 'qauser', role: 'QA', tone: 'brand' },
]

export default function DevQuickLogin() {
  const { signIn } = useAuth()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  if (!import.meta.env.DEV) return null

  const go = async (username) => {
    setBusy(username); setError(null)
    try { await signIn(username, PASSWORD) } catch (err) { setError(`${username}: ${err.message}`) } finally { setBusy(null) }
  }

  return (
    <section className="card qlogin" aria-label="Quick login">
      <div className="qlogin-head">
        <span className="badge badge-amber">Dev only</span>
        <h2>Quick login</h2>
        <p className="muted small">Pick an account to sign in instantly. Temporary — not in the production build.</p>
      </div>
      <div className="qlogin-grid">
        {ACCOUNTS.map((a) => (
          <button key={a.username} type="button" className="qlogin-tile" disabled={!!busy} onClick={() => go(a.username)}>
            <span className="qlogin-avatar" style={{ background: `var(--${a.tone}-soft)`, color: `var(--${a.tone})` }}>
              {a.username[0]}
            </span>
            <span className="qlogin-text">
              <strong>{busy === a.username ? 'Signing in…' : a.username}</strong>
              <span className="muted small">{a.role}</span>
            </span>
            <span className="qlogin-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <Alert>{error}</Alert>
    </section>
  )
}
