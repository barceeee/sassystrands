import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, loadItems, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ItemPicker, ActionResult, useAction } from '../components/ui.jsx'
import { date, money, today } from '../lib/format.js'
import { normaliseSerial } from '../lib/scan.js'

// Stage columns mirror the client's MONITORING CLIENTS ORDER sheet.
const STAGE_COLS = [
  { key: 'allocated', label: 'Received' },
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
  const receiving = can('receiving.manage')
  const order = useLoad(() => must(supabase.from('v_orders').select('*').eq('id', id).single()), [id])
  const lines = useLoad(() => must(supabase.from('v_order_lines').select('*').eq('order_id', id).order('id')), [id])
  const ors = useLoad(() => (can('or.manage') ? must(supabase.from('or_numbers').select('*').eq('order_id', id).order('seq')) : []), [id])
  const pieces = useLoad(() => fetchAll(() => supabase.rpc('piece_board', { p_order_id: Number(id), p_include_closed: true })), [id])
  // Open pieces not linked to any order, for the "Link pieces" picker (Inventory only).
  const unlinkedPieces = useLoad(async () => (receiving
    ? (await fetchAll(() => supabase.rpc('piece_board').is('order_line_id', null))).filter((p) => p.stage !== 'REJECTED')
    : []), [receiving])
  const [selected, setSelected] = useState(null)
  const action = useAction()
  const reload = () => { order.reload(); lines.reload(); pieces.reload(); unlinkedPieces.reload() }

  if (order.loading) return <Loading />
  if (order.error) return <Alert>{order.error}</Alert>
  const o = order.data
  const myPieces = pieces.data ?? []
  const unlinked = unlinkedPieces.data ?? []

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
              key: 'act', label: '', render: (l) => o.status === 'OPEN' && (
                <div className="actions">
                  {!l.canceled && l.remaining > 0 && (manage || receiving) && <button className="small" onClick={() => setSelected(l)}>Link / ship from stock</button>}
                  {manage && <button className="small" onClick={() => toggleLine(l)}>{l.canceled ? 'Restore' : 'Cancel'}</button>}
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

      {selected && <AllocateLine line={selected} unlinked={unlinked} manage={manage} receiving={receiving} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); reload() }} />}
      {manage && o.status === 'OPEN' && <AddLine orderId={Number(id)} onSaved={reload} />}

      <Card title="Pieces on this order" actions={<Link to="/production">Production board</Link>}>
        <Alert>{pieces.error || unlinkedPieces.error}</Alert>
        {/* Canceled lines still show while pieces are linked to them, so those pieces can be unlinked. */}
        {(lines.data ?? []).map((l) => ({ line: l, linked: myPieces.filter((p) => p.order_line_id === l.id) }))
          .filter(({ line, linked }) => !line.canceled || linked.length > 0)
          .map(({ line, linked }) => (
            <LinePieces key={line.id} line={line} pieces={linked} canShip={o.status === 'OPEN' && !line.canceled} receiving={receiving} onChanged={reload} />
          ))}
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

function LinePieces({ line, pieces, canShip, receiving, onChanged }) {
  const action = useAction()
  const ready = pieces.filter((p) => p.stage === 'READY' && p.status === 'ACTIVE')
  const linked = pieces.filter((p) => p.status !== 'CANCELED').length
  const ship = () => window.confirm(`Ship ${ready.length} piece(s) for ${line.item_name}? This cannot be undone.`) && action.run(async () => {
    await rpc('ship_pieces', { p_serials: ready.map((p) => p.serial) })
    onChanged()
  }, `Shipped ${ready.length} piece${ready.length === 1 ? '' : 's'}.`)
  const unlink = (p) => action.run(async () => {
    await rpc('unlink_piece', { p_serial: p.serial })
    onChanged()
  }, `${p.serial} unlinked.`)
  return (
    <div>
      <h4>{line.item_name}{line.group_label ? ` · ${line.group_label}` : ''} <span className="muted small">({linked} of {line.qty_ordered} linked)</span>{line.canceled && <> <Badge value="CANCELED" label="Line canceled" /></>}</h4>
      <Table
        columns={[
          { key: 'serial', label: 'Serial', render: (p) => <Link to={`/pieces/${p.serial}`}>{p.serial}</Link> },
          { key: 'stage_label', label: 'Stage', render: (p) => <Badge value={p.stage} label={p.stage_label} /> },
          { key: 'status', label: 'Status', render: (p) => p.status !== 'ACTIVE' && <Badge value={p.status} /> },
          { key: 'act', label: '', render: (p) => receiving && !['SHIPPED', 'IN_STOCK'].includes(p.stage) && (
            <button className="small" disabled={action.busy} onClick={() => window.confirm(`Unlink ${p.serial} from this order?`) && unlink(p)}>Unlink</button>
          ) },
        ]}
        rows={pieces}
        empty="No pieces linked yet."
      />
      {receiving && canShip && <div className="actions"><button className="primary small" disabled={action.busy || ready.length === 0} onClick={ship}>Ship ready pieces ({ready.length})</button></div>}
      <ActionResult action={action} />
    </div>
  )
}

function AllocateLine({ line, unlinked, manage, receiving, onClose, onSaved }) {
  const lookups = useLookups()
  const [mode, setMode] = useState(receiving ? 'link' : 'stock')
  const [f, setF] = useState({ qty: line.remaining, location: 'HQ', date: today(), note: '', serials: '', pick: '' })
  const action = useAction()
  const serialList = () => [...new Set(f.serials.split(/[\s,;]+/).map(normaliseSerial).filter(Boolean))]
  const addPick = (serial) => {
    if (!serial) return
    setF({ ...f, serials: serialList().includes(serial) ? f.serials : [...serialList(), serial].join('\n'), pick: '' })
  }
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => (mode === 'link'
      ? rpc('link_pieces', { p_order_line_id: line.id, p_serials: serialList() })
      : rpc('ship_from_stock', { p_line_id: line.id, p_qty: Number(f.qty), p_location: f.location, p_date: f.date, p_note: f.note || null })))
    if (ok) onSaved()
  }
  return (
    <Card title={`${line.item_name} — ${line.remaining} not started`} actions={<button onClick={onClose}>Close</button>}>
      <form className="form" onSubmit={submit}>
        <Field label="Action">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {receiving && <option value="link">Link pieces</option>}
            {manage && <option value="stock">Ship from existing stock</option>}
          </select>
        </Field>
        {mode === 'link' ? (<>
          <Field label="Serials (scan or type, one per line)" wide>
            <textarea rows="4" value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} placeholder="SS-000001" required />
          </Field>
          <Field label="Or pick an unlinked piece" wide>
            <select value={f.pick} onChange={(e) => addPick(e.target.value)}>
              <option value="">— choose piece ({unlinked.length}) —</option>
              {unlinked.slice(0, 300).map((p) => <option key={p.serial} value={p.serial}>{p.serial} · {p.stage_label}{p.item_name ? ` · ${p.item_name}` : ''}</option>)}
            </select>
          </Field>
        </>) : (<>
          <Field label="Quantity"><input type="number" min="1" max={line.remaining} step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required /></Field>
          <Field label="From location">
            <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>{(lookups.data?.locations ?? []).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </Field>
          <Field label="Ship date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Note" wide><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </>)}
        <div className="form-actions"><button className="primary" disabled={action.busy}>{mode === 'link' ? 'Link pieces' : 'Record shipment (stock OUT)'}</button></div>
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
