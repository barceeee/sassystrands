import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ActionResult, useAction } from '../components/ui.jsx'
import { ROLE_LABELS } from '../lib/perms.js'
import { dateTime } from '../lib/format.js'

const ROLE_HELP = {
  OWNER: 'Everything, including users',
  ADMIN: 'Same as Owner',
  INVENTORY: 'Everything except user management',
  PRODUCTION: 'Production records and stages only',
  QA: 'View production; record QA inspections',
}

// Creating users and changing passwords happens in the admin-users Edge Function (service key stays server-side).
async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error ?? msg } catch { /* keep generic message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export default function Users() {
  const { profile } = useAuth()
  const users = useLoad(async () => (await adminUsers({ action: 'list' })).users, [])
  const action = useAction()
  const [resetting, setResetting] = useState(null)

  const update = (u, patch, msg) => action.run(async () => { await adminUsers({ action: 'update', id: u.id, ...patch }); users.reload() }, msg)

  return (
    <Page title="Users" subtitle="Staff sign in with a username. Each role sees only its own modules.">
      <NewUser onSaved={users.reload} />
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      <Card>
        <ActionResult action={action} />
        <Alert>{users.error}</Alert>
        {users.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'full_name', label: 'Name', render: (u) => <>{u.full_name}<div className="muted small">{u.username}{u.email ? ` · ${u.email}` : ''}</div></> },
              { key: 'role', label: 'Role', render: (u) => (
                <select value={u.role} disabled={u.id === profile.id || action.busy} onChange={(e) => update(u, { role: e.target.value }, `${u.full_name} is now ${ROLE_LABELS[e.target.value]}.`)} aria-label={`Role for ${u.full_name}`}>
                  {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              ) },
              { key: 'active', label: 'Status', render: (u) => <Badge value={u.active ? 'ACTIVE' : 'CANCELED'} label={u.active ? 'Active' : 'Deactivated'} /> },
              { key: 'last_sign_in_at', label: 'Last sign-in', render: (u) => dateTime(u.last_sign_in_at) },
              { key: 'act', label: '', render: (u) => (
                <div className="actions">
                  <button className="small" onClick={() => setResetting(u)}>Reset password</button>
                  {u.id !== profile.id && (
                    <button className={`small ${u.active ? 'danger' : ''}`} disabled={action.busy}
                      onClick={() => update(u, { active: !u.active }, u.active ? `${u.full_name} deactivated.` : `${u.full_name} reactivated.`)}>
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </div>
              ) },
            ]}
            rows={users.data ?? []}
          />
        )}
      </Card>
    </Page>
  )
}

function NewUser({ onSaved }) {
  const [f, setF] = useState({ username: '', full_name: '', role: 'PRODUCTION', password: '', email: '' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => adminUsers({ action: 'create', ...f }), `User ${f.username} created. Give them their username and password.`)
    if (ok) { setF({ username: '', full_name: '', role: f.role, password: '', email: '' }); onSaved() }
  }
  return (
    <Card title="Add a user">
      <form className="form" onSubmit={submit} autoComplete="off">
        <Field label="Full name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></Field>
        <Field label="Username" hint="Lowercase letters, numbers, . _ -"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} pattern="[a-z0-9._\-]{3,32}" required /></Field>
        <Field label="Role" hint={ROLE_HELP[f.role]}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="Temporary password" hint="At least 8 characters"><input type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="Email (optional)" hint="Only if they should sign in with an email instead"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>Create user</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}

function ResetPassword({ user, onClose }) {
  const [password, setPassword] = useState('')
  const action = useAction()
  const submit = (e) => {
    e.preventDefault()
    action.run(() => adminUsers({ action: 'reset_password', id: user.id, password }), 'Password changed.')
  }
  return (
    <Card title={`Reset password for ${user.full_name}`} actions={<button onClick={onClose}>Close</button>}>
      <form className="form" onSubmit={submit}>
        <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>Set password</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
