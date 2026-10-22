import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useLoad, useStaff, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ActionResult, useAction } from '../components/ui.jsx'
import { date, money, today, dateTime } from '../lib/format.js'

// Official receipt (OR) numbers: register booklet ranges, issue them in sequence against client
// payments (optionally linked to an order), and void with a reason. Numbers are never deleted.
export default function OrNumbers() {
  const staff = useStaff()
  const ors = useLoad(() => fetchAll(() => supabase.from('or_numbers').select('*').order('seq').order('or_no')), [])
  const orders = useLoad(() => must(supabase.from('v_orders').select('id, order_no, client_name, status').order('id', { ascending: false })), [])
  const [status, setStatus] = useState('AVAILABLE')
  const [q, setQ] = useState('')
  const [issuing, setIssuing] = useState(null)
  const action = useAction()

  const all = ors.data ?? []
  const next = all.find((o) => o.status === 'AVAILABLE')
  const rows = all.filter((o) => (!status || o.status === status) &&
    (!q || `${o.or_no} ${o.payer ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const orderNo = Object.fromEntries((orders.data ?? []).map((o) => [o.id, o]))

  const voidOr = async (o) => {
    const reason = window.prompt(`Reason for voiding OR ${o.or_no}?`)
    if (!reason) return
    await action.run(async () => { await rpc('void_or', { p_id: o.id, p_reason: reason }); ors.reload() }, `OR ${o.or_no} voided.`)
  }

  return (
    <Page title="OR numbers" subtitle={next ? `Next available: ${next.or_no}` : 'No available OR numbers — register a booklet range.'}>
      <RegisterRange onSaved={ors.reload} />
      {issuing && <IssueOr or={issuing} orders={orders.data ?? []} onClose={() => setIssuing(null)} onSaved={() => { setIssuing(null); ors.reload() }} />}
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="AVAILABLE">Available</option><option value="ISSUED">Issued</option><option value="VOIDED">Voided</option><option value="">All</option>
          </select>
          <input type="search" placeholder="OR no. or payer" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">
            {all.filter((o) => o.status === 'AVAILABLE').length} available · {all.filter((o) => o.status === 'ISSUED').length} issued ·{' '}
            {all.filter((o) => o.status === 'VOIDED').length} voided · issued total {money(all.filter((o) => o.status === 'ISSUED').reduce((t, o) => t + Number(o.amount ?? 0), 0))}
          </span>
        </div>
        <ActionResult action={action} />
        <Alert>{ors.error}</Alert>
        {ors.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'or_no', label: 'OR no.' },
              { key: 'status', label: 'Status', render: (o) => <Badge value={o.status} /> },
              { key: 'issued_on', label: 'Date', render: (o) => date(o.issued_on) },
              { key: 'payer', label: 'Payer' },
              { key: 'order_id', label: 'Order', render: (o) => o.order_id && <Link to={`/orders/${o.order_id}`}>{orderNo[o.order_id]?.order_no ?? `#${o.order_id}`}</Link> },
              { key: 'amount', label: 'Amount', num: true, render: (o) => money(o.amount) },
              { key: 'who', label: 'By', render: (o) => o.status === 'VOIDED'
                ? <>{staff[o.voided_by] ?? '—'}<div className="muted small">Void: {o.void_reason} · {dateTime(o.voided_at)}</div></>
                : o.issued_by && <>{staff[o.issued_by]}<div className="muted small">{dateTime(o.issued_at)}</div></> },
              { key: 'act', label: '', render: (o) => (
                <div className="actions">
                  {o.status === 'AVAILABLE' && <button className="small primary" onClick={() => setIssuing(o)}>Issue</button>}
                  {o.status !== 'VOIDED' && <button className="small danger" onClick={() => voidOr(o)}>Void</button>}
                </div>
              ) },
            ]}
            rows={rows.slice(0, 500)}
            empty="No OR numbers."
          />
        )}
      </Card>
    </Page>
  )
}

function RegisterRange({ onSaved }) {
  const [f, setF] = useState({ prefix: '', start: '', end: '', pad: '0' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const n = await action.run(() => rpc('register_or_range', { p_prefix: f.prefix, p_start: Number(f.start), p_end: Number(f.end), p_pad: Number(f.pad || 0) }),
      (count) => `${count} OR number(s) registered (numbers already on file were skipped).`)
    if (n !== undefined) { setF({ ...f, start: '', end: '' }); onSaved() }
  }
  return (
    <Card title="Register a booklet / range">
      <form className="form" onSubmit={submit}>
        <Field label="Prefix" hint="Optional, e.g. A-"><input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></Field>
        <Field label="First number"><input type="number" min="1" step="1" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></Field>
        <Field label="Last number"><input type="number" min="1" step="1" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Field>
        <Field label="Digits" hint="Zero-pad to this many digits (0 = none)"><input type="number" min="0" max="12" value={f.pad} onChange={(e) => setF({ ...f, pad: e.target.value })} /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>Register</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}

function IssueOr({ or, orders, onClose, onSaved }) {
  const [f, setF] = useState({ order: '', payer: '', amount: '', date: today() })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => rpc('issue_or', {
      p_id: or.id, p_issued_on: f.date, p_amount: Number(f.amount), p_payer: f.payer || null, p_order_id: f.order ? Number(f.order) : null,
    }))
    if (ok) onSaved()
  }
  return (
    <Card title={`Issue OR ${or.or_no}`} actions={<button onClick={onClose}>Close</button>}>
      <form className="form" onSubmit={submit}>
        <Field label="For order (optional)">
          <select value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })}>
            <option value="">— none —</option>
            {orders.filter((o) => o.status !== 'CANCELED').map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.client_name}</option>)}
          </select>
        </Field>
        <Field label="Payer" hint={f.order ? 'Blank = the order’s client' : null}><input value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} required={!f.order} /></Field>
        <Field label="Amount (₱)"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>Issue</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
