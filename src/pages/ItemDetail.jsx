import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, useStaff, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ActionResult, useAction } from '../components/ui.jsx'
import MovementForm from '../components/MovementForm.jsx'
import { money, qty, date, dateTime } from '../lib/format.js'

export default function ItemDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const staff = useStaff()
  const lookups = useLookups()
  const item = useLoad(() => must(supabase.from('v_stock_on_hand').select('*').eq('item_id', id).single()), [id])
  const byLoc = useLoad(() => must(supabase.from('v_stock_by_location').select('*').eq('item_id', id)), [id])
  const moves = useLoad(() => fetchAll(() => supabase.from('stock_movements').select('*').eq('item_id', id).order('movement_date').order('id')), [id])
  const counts = useLoad(() => must(supabase.from('v_count_variance').select('*').eq('item_id', id).order('count_date', { ascending: false })), [id])
  const reload = () => { item.reload(); byLoc.reload(); moves.reload(); counts.reload() }

  // Running balance, newest first for display.
  let running = 0
  const history = (moves.data ?? []).map((m) => ({ ...m, balance: (running += m.signed_qty) })).reverse()

  if (item.loading) return <Loading />
  if (item.error) return <Alert>{item.error}</Alert>
  const it = item.data
  return (
    <Page title={it.name} subtitle={it.sku} actions={<Link to="/inventory">← Stock</Link>}>
      <div className="stats">
        <div className="stat">On hand<b>{qty(it.on_hand)}</b></div>
        <div className="stat">Unit price<b>{money(it.unit_price)}</b></div>
        <div className="stat">Stock value<b>{money(it.stock_value)}</b></div>
        {(byLoc.data ?? []).length > 1 && byLoc.data.map((l) => <div className="stat" key={l.location}>{l.location}<b>{qty(l.on_hand)}</b></div>)}
      </div>
      {can('inventory.manage') && <EditItem item={it} onSaved={reload} />}
      {can('inventory.manage') && (
        <Card title="Record movement for this product">
          <MovementForm itemId={Number(id)} locations={lookups.data?.locations} onSaved={reload} />
        </Card>
      )}
      <Card title="Movement history">
        {moves.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'movement_date', label: 'Date', render: (m) => date(m.movement_date) },
              { key: 'movement_type', label: 'Type', render: (m) => <Badge value={m.movement_type} /> },
              { key: 'signed_qty', label: 'Qty', num: true, render: (m) => (m.signed_qty > 0 ? `+${m.signed_qty}` : m.signed_qty) },
              { key: 'balance', label: 'Balance', num: true },
              { key: 'location', label: 'Location' },
              { key: 'reference', label: 'Reference' },
              { key: 'note', label: 'Note', render: (m) => <>{m.note}{m.source_ref && <div className="muted small">from {m.source_ref}</div>}</> },
              { key: 'created_by', label: 'Recorded by', render: (m) => <>{staff[m.created_by] ?? (m.import_batch_id ? 'Import' : '—')}<div className="muted small">{dateTime(m.created_at)}</div></> },
            ]}
            rows={history}
            empty="No movements yet."
          />
        )}
      </Card>
      <Card title="Counts & spreadsheet snapshots">
        <Table
          columns={[
            { key: 'count_date', label: 'Date', render: (c) => date(c.count_date) },
            { key: 'source', label: 'Source', render: (c) => <>{c.source}<div className="muted small">{c.source_label}</div></> },
            { key: 'counted_qty', label: 'Counted', num: true },
            { key: 'computed_qty', label: 'Computed then', num: true },
            { key: 'variance', label: 'Variance', num: true, render: (c) => <span style={{ color: c.variance ? 'var(--amber)' : undefined }}>{c.variance > 0 ? `+${c.variance}` : c.variance}</span> },
          ]}
          rows={counts.data ?? []}
          empty="No counts recorded."
        />
      </Card>
    </Page>
  )
}

function EditItem({ item, onSaved }) {
  const [f, setF] = useState({})
  useEffect(() => setF({ unit_price: item.unit_price ?? '', reorder_level: item.reorder_level, active: item.active }), [item])
  const action = useAction()
  const save = (e) => {
    e.preventDefault()
    action.run(async () => {
      await must(supabase.from('items').update({
        unit_price: f.unit_price === '' ? null : Number(f.unit_price),
        reorder_level: Number(f.reorder_level || 0),
        active: f.active,
      }).eq('id', item.item_id))
      onSaved()
    }, 'Saved. The change is recorded in the audit log.')
  }
  return (
    <Card title="Price & settings">
      <form className="form" onSubmit={save}>
        <Field label="Unit price (₱)"><input type="number" min="0" step="0.01" value={f.unit_price ?? ''} onChange={(e) => setF({ ...f, unit_price: e.target.value })} /></Field>
        <Field label="Reorder level"><input type="number" min="0" step="1" value={f.reorder_level ?? 0} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} /></Field>
        <Field label="Status">
          <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
            <option value="1">Active</option><option value="0">Inactive (hidden from pickers)</option>
          </select>
        </Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>Save</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
