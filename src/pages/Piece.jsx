import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, useStaff } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ActionResult, useAction } from '../components/ui.jsx'
import FixPieceModal from '../components/FixPieceModal.jsx'
import { dateTime, titleCase, PRODUCT_NOT_SET } from '../lib/format.js'

const EVENT_LABELS = {
  RECEIVED: 'Received',
  IMPORTED: 'Imported',
  SCAN: 'Scanned',
  QA: 'QA',
  FIX: 'Fixed',
  LINK: 'Linked to order',
  UNLINK: 'Unlinked',
  STATUS: 'Status changed',
  SHIP: 'Shipped',
  STOCK: 'Received to stock',
}
const FINISHED = ['SHIPPED', 'IN_STOCK']

// One piece: where it is now, everything that has happened to it, and the fixes/status changes
// Inventory and team leaders may make.
export default function Piece() {
  const { serial } = useParams()
  const { can } = useAuth()
  const staff = useStaff()
  const lookups = useLookups()
  const stageLabel = lookups.data?.stageLabel ?? {}
  const piece = useLoad(async () => {
    const [found] = await must(supabase.rpc('piece_board', { p_serial: serial }))
    if (!found) return null
    const events = await must(supabase.from('piece_events').select('*').eq('piece_id', found.id).order('created_at').order('id'))
    return { piece: found, events }
  }, [serial])

  const title = serial.toUpperCase()
  if (piece.loading && !piece.data) return <Page title={title}><Loading /></Page>
  if (piece.error) return <Page title={title}><Alert>{piece.error}</Alert></Page>
  if (!piece.data) return <Page title={title}><Alert>No piece with serial {title}. <Link to="/production">Back to production</Link></Alert></Page>

  const { piece: p, events } = piece.data
  const stage = (code) => (code ? stageLabel[code] ?? titleCase(code) : null)
  return (
    <Page title={p.serial} subtitle={p.item_name ?? `Product ${PRODUCT_NOT_SET.toLowerCase()}`} actions={<Link to="/production">Back to production</Link>}>
      <Card title="Current state">
        <dl className="dl">
          <dt>Stage</dt><dd><Badge value={p.stage} label={p.stage_label} /></dd>
          <dt>Status</dt><dd><Badge value={p.status} /></dd>
          <dt>In this stage since</dt><dd>{dateTime(p.stage_since)}</dd>
          <dt>Product</dt><dd>{p.item_name ?? PRODUCT_NOT_SET}</dd>
          <dt>Order</dt><dd>
            {p.order_id
              ? (can('orders.view') ? <Link to={`/orders/${p.order_id}`}>{p.order_no}</Link> : p.order_no)
              : (p.stage === 'IN_STOCK' ? 'Stock' : 'Not linked to an order')}
            {p.client_name ? ` · ${p.client_name}` : ''}
          </dd>
          {p.group_label && <><dt>Group</dt><dd>{p.group_label}</dd></>}
        </dl>
      </Card>
      <PieceActions piece={p} stageLabel={stageLabel} onChanged={piece.reload} />
      <Card title={`History (${events.length})`}>
        <Table
          columns={[
            { key: 'created_at', label: 'When', render: (e) => dateTime(e.created_at) },
            { key: 'event', label: 'Event', render: (e) => EVENT_LABELS[e.event] ?? titleCase(e.event) },
            { key: 'move', label: 'Stage', render: (e) => (e.from_stage && e.from_stage !== e.to_stage ? `${stage(e.from_stage)} → ${stage(e.to_stage)}` : stage(e.to_stage) ?? '—') },
            { key: 'station', label: 'Station', render: (e) => stage(e.station) ?? '—' },
            { key: 'created_by', label: 'By', render: (e) => (e.created_by ? staff[e.created_by] ?? 'Unknown user' : 'System') },
            { key: 'method', label: 'Method', render: (e) => (e.method ? titleCase(e.method) : '—') },
            { key: 'out_of_order', label: '', render: (e) => (e.out_of_order ? <Badge value="WARNING" label="Out of order" /> : null) },
            { key: 'note', label: 'Note' },
          ]}
          rows={events}
          empty="No history."
        />
      </Card>
    </Page>
  )
}

// Fix (team leaders), hold / reactivate / cancel (Inventory, or the leader of the piece's station),
// and reprinting the label. Mirrors leader_fix and set_piece_status; the database is the real gate.
function PieceActions({ piece: p, stageLabel, onChanged }) {
  const { can, profile } = useAuth()
  const action = useAction()
  const [fixing, setFixing] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [reason, setReason] = useState('')

  const lead = can('station.lead')
  const inventory = can('receiving.manage')
  const finished = FINISHED.includes(p.stage)
  const canFix = lead && !finished && p.status !== 'CANCELED'
  const canStatus = !finished && (inventory || (lead && p.stage === profile?.station))
  const canReprint = inventory || lead
  if (!canFix && !canStatus && !canReprint) return null

  const setStatus = async (status, note, message) => {
    const ok = await action.run(() => rpc('set_piece_status', { p_serial: p.serial, p_status: status, p_reason: note ?? null }), message)
    if (ok) { setCanceling(false); setReason(''); onChanged() }
  }
  const submitCancel = (e) => {
    e.preventDefault()
    setStatus('CANCELED', reason, `${p.serial} canceled.`)
  }
  const fixed = (message) => { setFixing(false); action.setDone(message); onChanged() }

  return (
    <Card title="Actions">
      <div className="actions">
        {canFix && <button disabled={action.busy} onClick={() => { action.setError(null); action.setDone(null); setFixing(true) }}>Fix stage</button>}
        {canStatus && p.status === 'ACTIVE' && <button disabled={action.busy} onClick={() => setStatus('ON_HOLD', null, `${p.serial} put on hold.`)}>Hold</button>}
        {canStatus && p.status !== 'ACTIVE' && <button disabled={action.busy} onClick={() => setStatus('ACTIVE', null, `${p.serial} reactivated.`)}>Reactivate</button>}
        {canStatus && p.status !== 'CANCELED' && <button className="danger" disabled={action.busy} onClick={() => setCanceling((c) => !c)}>Cancel piece</button>}
        {canReprint && <Link className="button" to={`/labels?serials=${p.serial}`}>Reprint label</Link>}
      </div>
      {canceling && (
        <form className="form" onSubmit={submitCancel}>
          <Field label="Reason for canceling" hint="Required. Recorded in the piece's history." wide>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" required />
          </Field>
          <div className="form-actions"><button className="danger" disabled={action.busy || !reason.trim()}>Confirm cancel</button></div>
        </form>
      )}
      <ActionResult action={action} />
      <FixPieceModal piece={fixing ? p : null} stageLabel={stageLabel} onClose={() => setFixing(false)} onDone={fixed} />
    </Card>
  )
}
