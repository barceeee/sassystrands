import { useState } from 'react'
import { useAuth } from '../auth.jsx'
import { Alert } from '../components/ui.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await signIn(login, password) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <div className="login-intro">
        <img src="/favicon.svg" alt="" width="56" height="56" />
        <h1>Sassy Strands</h1>
        <p>Inventory, orders, production and QA in one place.</p>
      </div>
      <form className="card login-card" onSubmit={submit}>
        <h2>Staff sign in</h2>
        <label className="field">
          <span>Username</span>
          <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <Alert>{error}</Alert>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Forgot your password? Ask the Owner or an Admin to reset it.</p>
      </form>
    </div>
  )
}
