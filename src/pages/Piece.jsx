import { Link, useParams } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLoad, useLookups, useStaff } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge } from '../components/ui.jsx'
import { dateTime, titleCase } from '../lib/format.js'

// Read-only view of one piece: where it is now and everything that has happened to it.
export default function Piece() {
  const { serial } = useParams()
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
  if (piece.loading) return <Page title={title}><Loading /></Page>
  if (piece.error) return <Page title={title}><Alert>{piece.error}</Alert></Page>
  if (!piece.data) return <Page title={title}><Alert>No piece with serial {title}. <Link to="/production">Back to production</Link></Alert></Page>

  const { piece: p, events } = piece.data
  const stage = (code) => (code ? stageLabel[code] ?? titleCase(code) : null)
  return (
    <Page title={p.serial} subtitle={p.item_name ?? 'Product not set'} actions={<Link to="/production">Back to production</Link>}>
      <Card title="Current state">
        <dl className="dl">
          <dt>Stage</dt><dd><Badge value={p.stage} label={p.stage_label} /></dd>
          <dt>Status</dt><dd><Badge value={p.status} /></dd>
          <dt>In this stage since</dt><dd>{dateTime(p.stage_since)}</dd>
          <dt>Product</dt><dd>{p.item_name ?? '—'}</dd>
          <dt>Order</dt><dd>{p.order_id ? <Link to={`/orders/${p.order_id}`}>{p.order_no}</Link> : 'Not linked (stock)'}{p.client_name ? ` · ${p.client_name}` : ''}</dd>
          {p.group_label && <><dt>Group</dt><dd>{p.group_label}</dd></>}
        </dl>
      </Card>
      <Card title={`History (${events.length})`}>
        <Table
          columns={[
            { key: 'created_at', label: 'When', render: (e) => dateTime(e.created_at) },
            { key: 'event', label: 'Event', render: (e) => titleCase(e.event) },
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
