import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, loadItems } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ItemPicker, ActionResult, useAction } from '../components/ui.jsx'
import { date, money, today } from '../lib/format.js'

// Stage columns mirror the client's MONITORING CLIENTS ORDER sheet.
const STAGE_COLS = [
  { key: 'allocated', label: 'Allocated' },
  { key: 'rsb_wefting', label: 'RSB / Weft' },
  { key: 'vent_marinduque', label: 'Vent Marinduque' },
  { key: 'vent_hq_pcr', label: 'Vent HQ/PCR' },
  { key: 'vent_hq_fixing', label: 'Vent fixing' },
  { key: 'curling', label: 'Curling' },
  { key: 'in_qa', label: 'QA' },
  { key: 'ready', label: 'Ready' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'remaining', label: 'Not started' },
]

export default function OrderDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const manage = can('orders.manage')
  const order = useLoad(() => must(supabase.from('v_orders').select('*').eq('id', id).single()), [id])
  const lines = useLoad(() => must(supabase.from('v_order_lines').select('*').eq('order_id', id).order('id')), [id])
  const ors = useLoad(() => (can('or.manage') ? must(supabase.from('or_numbers').select('*').eq('order_id', id).order('seq')) : []), [id])
  const records = useLoad(async () => {
    const all = await must(supabase.rpc('production_board', { p_include_closed: true }))
    return all
  }, [id])
  const [selected, setSelected] = useState(null)
  const action = useAction()
  const reload = () => { order.reload(); lines.reload(); records.reload() }

  if (order.loading) return <Loading />
  if (order.error) return <Alert>{order.error}</Alert>
  const o = order.data
  const lineIds = new Set((lines.data ?? []).map((l) => l.id))
  const myRecords = (records.data ?? []).filter((r) => lineIds.has(r.order_line_id))

  const setStatus = (status) => action.run(async () => {
    await must(supabase.from('orders').update({ status }).eq('id', id))
    reload()
  }, `Order marked ${status.toLowerCase()}.`)

  const toggleLine = (l) => action.run(async () => {
    await must(supabase.from('order_lines').update({ canceled: !l.canceled }).eq('id', l.id))
    reload()
  }, l.canceled ? 'Line restored.' : 'Line canceled.')

  return (
    <Page
      title={`${o.order_no} · ${o.client_name}`}
      subtitle={<>Ordered {date(o.order_date ?? o.created_at)} · <Badge value={o.fulfillment_status} /> {o.status !== 'OPEN' && <Badge value={o.status} />}</>}
      actions={<>
        <Link to="/orders">← Orders</Link>
        {manage && o.status === 'OPEN' && <button onClick={() => window.confirm('Cancel the whole order?') && setStatus('CANCELED')}>Cancel order</button>}
        {manage && o.status === 'OPEN' && <button onClick={() => setStatus('CLOSED')}>Close order</button>}
        {manage && o.status !== 'OPEN' && <button onClick={() => setStatus('OPEN')}>Reopen</button>}
      </>}
    >
      <ActionResult action={action} />
      {o.notes && <p className="muted">{o.notes}</p>}
      {o.has_over_allocation && <Alert kind="warning">Some lines have more units in production/shipped than were ordered (usually from the imported sheet). Check the highlighted lines.</Alert>}

      <Card title="Lines">
        <Alert>{lines.error}</Alert>
        <Table
          columns={[
            { key: 'item_name', label: 'Product', render: (l) => <>
              <Link to={`/inventory/items/${l.item_id}`}>{l.item_name}</Link>
              {l.group_label && <div className="muted small">{l.group_label}</div>}
              {l.line_note && <div className="small"><Badge value="INFO" label={l.line_note} /></div>}
            </> },
            { key: 'qty_ordered', label: 'Ordered', num: true },
            ...STAGE_COLS.map((c) => ({ ...c, num: true, render: (l) => (l[c.key] ? <b>{l[c.key]}</b> : <span className="muted">0</span>) })),
            { key: 'line_status', label: 'Status', render: (l) => <><Badge value={l.line_status} />{l.over_allocated && <> <Badge value="WARNING" label="Over" /></>}</> },
            {
              key: 'act', label: '', render: (l) => manage && o.status === 'OPEN' && (
                <div className="actions">
                  {!l.canceled && l.remaining > 0 && <button className="small" onClick={() => setSelected(l)}>Allocate / ship</button>}
                  <button className="small" onClick={() => toggleLine(l)}>{l.canceled ? 'Restore' : 'Cancel'}</button>
                </div>
              ),
            },
          ]}
          rows={lines.data ?? []}
          footer={lines.data && <>
            <td>Total (excl. canceled)</td>
            <td className="num">{o.qty_ordered}</td>
            {STAGE_COLS.map((c) => <td key={c.key} className="num">{(lines.data ?? []).filter((l) => !l.canceled).reduce((t, l) => t + l[c.key], 0)}</td>)}
            <td colSpan={2}>{money(o.order_value)} list value</td>
          </>}
        />
      </Card>

      {selected && <AllocateLine line={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); reload() }} />}
      {manage && o.status === 'OPEN' && <AddLine orderId={Number(id)} onSaved={reload} />}

      <Card title="Production records for this order" actions={<Link to="/production">Production board</Link>}>
        <Table
          onRowClick={undefined}
          columns={[
            { key: 'record_no', label: 'Record', render: (r) => <Link to={`/production/${r.id}`}>{r.record_no}</Link> },
            { key: 'item_name', label: 'Product' },
            { key: 'qty', label: 'Qty', num: true },
            { key: 'stage_label', label: 'Stage', render: (r) => <Badge value={r.stage} label={r.stage_label} /> },
            { key: 'status', label: 'Status', render: (r) => r.status !== 'ACTIVE' && <Badge value={r.status} /> },
          ]}
          rows={myRecords}
          empty="Nothing sent to production yet."
        />
      </Card>

      {can('or.manage') && (
        <Card title="Official receipts" actions={<Link to="/or-numbers">OR numbers</Link>}>
          <Table
            columns={[
              { key: 'or_no', label: 'OR no.' },
              { key: 'issued_on', label: 'Date', render: (r) => date(r.issued_on) },
              { key: 'amount', label: 'Amount', num: true, render: (r) => money(r.amount) },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
            ]}
            rows={ors.data ?? []}
            empty="No OR issued for this order."
          />
        </Card>
      )}
    </Page>
  )
}

function AllocateLine({ line, onClose, onSaved }) {
  const lookups = useLookups()
  const stages = (lookups.data?.stages ?? []).filter((s) => s.production_can_set)
  const [mode, setMode] = useState('production')
  const [f, setF] = useState({ qty: line.remaining, stage: 'ALLOCATED', location: 'HQ', date: today(), note: '' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => (mode === 'production'
      ? rpc('create_production_record', { p_item_id: line.item_id, p_qty: Number(f.qty), p_order_line_id: line.id, p_stage: f.stage, p_notes: f.note || null })
      : rpc('ship_from_stock', { p_line_id: line.id, p_qty: Number(f.qty), p_location: f.location, p_date: f.date, p_note: f.note || null })))
    if (ok) onSaved()
  }
  return (
    <Card title={`${line.item_name} — ${line.remaining} not started`} actions={<button onClick={onClose}>Close</button>}>
      <form className="form" onSubmit={submit}>
        <Field label="Action">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="production">Send to production</option>
            <option value="stock">Ship from existing stock</option>
          </select>
        </Field>
        <Field label="Quantity"><input type="number" min="1" max={line.remaining} step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required /></Field>
        {mode === 'production' ? (
          <Field label="Start at stage">
            <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{stages.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select>
          </Field>
        ) : (<>
          <Field label="From location">
            <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>{(lookups.data?.locations ?? []).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </Field>
          <Field label="Ship date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </>)}
        <Field label="Note" wide><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy}>{mode === 'production' ? 'Create production record' : 'Record shipment (stock OUT)'}</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}

function AddLine({ orderId, onSaved }) {
  const items = useLoad(loadItems, [])
  const [f, setF] = useState({ item: null, qty: '', group_label: '' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => must(supabase.from('order_lines').insert({
      order_id: orderId, item_id: f.item, qty_ordered: Number(f.qty), group_label: f.group_label.trim() || null,
    })), 'Line added.')
    if (ok) { setF({ item: null, qty: '', group_label: f.group_label }); onSaved() }
  }
  return (
    <Card title="Add a line">
      <form className="form" onSubmit={submit}>
        <Field label="Product" wide><ItemPicker items={items.data} value={f.item} onChange={(v) => setF({ ...f, item: v })} required /></Field>
        <Field label="Qty"><input type="number" min="1" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required /></Field>
        <Field label="Group (optional)"><input value={f.group_label} onChange={(e) => setF({ ...f, group_label: e.target.value })} /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy || !f.item}>Add line</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
