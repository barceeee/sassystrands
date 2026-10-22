import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { ROLE_LABELS } from '../lib/perms.js'
import { Page, Card, Field, ActionResult, useAction } from '../components/ui.jsx'

export default function Account() {
  const { profile } = useAuth()
  const [f, setF] = useState({ password: '', confirm: '' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    if (f.password !== f.confirm) { action.setError('The two passwords do not match.'); return }
    const ok = await action.run(async () => {
      const { error } = await supabase.auth.updateUser({ password: f.password })
      if (error) throw new Error(error.message)
    }, 'Password changed.')
    if (ok) setF({ password: '', confirm: '' })
  }
  return (
    <Page title="My account">
      <Card>
        <dl className="dl">
          <dt>Name</dt><dd>{profile.full_name}</dd>
          <dt>Username</dt><dd>{profile.username}</dd>
          <dt>Role</dt><dd>{ROLE_LABELS[profile.role]}</dd>
        </dl>
      </Card>
      <Card title="Change password">
        <form className="form" onSubmit={submit}>
          <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
          <Field label="Repeat new password"><input type="password" autoComplete="new-password" minLength={8} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
          <div className="form-actions"><button className="primary" disabled={action.busy}>Change password</button></div>
          <div className="wide"><ActionResult action={action} /></div>
        </form>
      </Card>
    </Page>
  )
}
