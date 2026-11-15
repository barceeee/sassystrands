import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../supabase.js'
import { useLoad, fetchAll, useStaff } from '../lib/data.js'
import { dateTime } from '../lib/format.js'
import { Page, Card, Field, Table, Alert, Loading, ActionResult, useAction } from '../components/ui.jsx'

// Inventory records raw hair arriving at HQ: each unit becomes a piece with its own serial, then labels are printed.
export default function Receiving() {
  const navigate = useNavigate()
  const staff = useStaff()
  const receipts = useLoad(() => fetchAll(() => supabase.from('receipts')
    .select('id, received_at, qty, note, created_by').order('received_at', { ascending: false }).order('id', { ascending: false })), [])
  const [f, setF] = useState({ qty: '', note: '' })
  const action = useAction()

  const submit = async (e) => {
    e.preventDefault()
    const id = await action.run(() => rpc('receive_pieces', { p_qty: Number(f.qty), p_note: f.note.trim() || null }))
    if (id) navigate(`/labels?receipt=${id}`)
  }

  const columns = [
    { label: 'Receipt', render: (r) => `#${r.id}` },
    { label: 'Received', render: (r) => dateTime(r.received_at) },
    { label: 'Qty', num: true, render: (r) => r.qty },
    { label: 'By', render: (r) => staff[r.created_by] ?? '—' },
    { label: 'Note', render: (r) => r.note ?? '—' },
    { label: '', render: (r) => <Link className="button" to={`/labels?receipt=${r.id}`}>Reprint labels</Link> },
  ]

  return (
    <Page title="Receiving" subtitle="Record raw hair arriving at HQ and print a barcode label for each piece.">
      <Card title="Receive pieces">
        <form className="form" onSubmit={submit}>
          <Field label="Quantity" hint="1 to 500 pieces">
            <input type="number" min="1" max="500" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          </Field>
          <Field label="Note" wide><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} autoComplete="off" /></Field>
          <div className="form-actions"><button className="primary" disabled={action.busy}>Receive and print labels</button></div>
          <div className="wide"><ActionResult action={action} /></div>
        </form>
      </Card>
      <Card title="Receipts">
        <Alert>{receipts.error}</Alert>
        {receipts.loading && !receipts.data ? <Loading /> : <Table columns={columns} rows={receipts.data} empty="Nothing received yet." />}
      </Card>
    </Page>
  )
}
