import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, rpc } from '../../supabase.js'
import { useAuth } from '../../auth.jsx'
import { useLoad, fetchAll, useLookups, useStaff } from '../../lib/data.js'
import { dateTime, titleCase } from '../../lib/format.js'
import { Page, Card, Table, Badge, Alert, Loading, useAction, ActionResult } from '../../components/ui.jsx'
import FixPieceModal from '../../components/FixPieceModal.jsx'

const RECENT_SCANS = 15

// Monday 00:00 local time of the current week.
function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function waiting(since, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h} h ${mins % 60} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

export default function Overview() {
  const { profile } = useAuth()
  const station = profile?.station
  const lookups = useLookups()
  const staff = useStaff()
  const stageLabel = lookups.data?.stageLabel ?? {}
  const stationLabel = stageLabel[station] ?? station ?? 'No station'

  const board = useLoad(() => (station ? fetchAll(() => supabase.rpc('piece_board', { p_stage: station })) : []), [station])
  // The QA leader also fixes pieces that already left QA: passed (not yet shipped) or rejected.
  const isQaStation = station === 'FOR_QA'
  const outcomes = useLoad(async () => {
    if (!isQaStation) return []
    const [ready, rejected] = await Promise.all(['READY', 'REJECTED'].map((stage) => fetchAll(() => supabase.rpc('piece_board', { p_stage: stage }))))
    return [...ready, ...rejected]
  }, [isQaStation])
  const scans = useLoad(() => {
    const since = weekStart().toISOString()
    return fetchAll(() => supabase.from('piece_events')
      .select('id, method, out_of_order, created_by, created_at, pieces(serial)')
      .eq('event', 'SCAN').eq('station', station).gte('created_at', since)
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
  }, [station])

  const action = useAction()
  const [fix, setFix] = useState(null) // piece being fixed

  const reloadAll = () => { board.reload(); scans.reload(); outcomes.reload() }

  const stats = useMemo(() => {
    const pieces = board.data ?? []
    const rows = scans.data ?? []
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const oldest = pieces.reduce((min, p) => (!min || new Date(p.stage_since) < new Date(min) ? p.stage_since : min), null)
    return {
      here: pieces.length,
      today: rows.filter((r) => new Date(r.created_at) >= midnight).length,
      week: rows.length,
      outOfOrder: rows.filter((r) => r.out_of_order).length,
      oldest,
    }
  }, [board.data, scans.data])

  const toggleHold = (p) => action.run(
    () => rpc('set_piece_status', { p_serial: p.serial, p_status: p.status === 'ON_HOLD' ? 'ACTIVE' : 'ON_HOLD' }).then(reloadAll),
    p.status === 'ON_HOLD' ? `${p.serial} reactivated.` : `${p.serial} put on hold.`,
  )

  const openFix = (p) => { action.setError(null); action.setDone(null); setFix(p) }
  const fixed = (message) => { setFix(null); action.setDone(message); reloadAll() }

  if (!station) {
    return <Page title="Station overview"><Alert>Your account has no station assigned. Ask an administrator to set one.</Alert></Page>
  }

  const pieceColumns = [
    { label: 'Serial', render: (p) => <Link to={`/pieces/${p.serial}`}><code>{p.serial}</code></Link> },
    { label: 'Product', render: (p) => p.item_name ?? '—' },
    { label: 'Order', render: (p) => (p.order_no ? `${p.order_no}${p.client_name ? ` · ${p.client_name}` : ''}` : '—') },
    { label: 'Arrived', render: (p) => dateTime(p.stage_since) },
    { label: 'Waiting', render: (p) => waiting(p.stage_since) },
    { label: 'Status', render: (p) => (p.status === 'ON_HOLD' ? <Badge value="ON_HOLD" /> : null) },
    {
      label: '', render: (p) => (
        <div className="actions">
          <Link className="button" to={`/labels?serials=${p.serial}`}>Reprint label</Link>
          <button disabled={action.busy} onClick={() => openFix(p)}>Fix</button>
          <button disabled={action.busy} onClick={() => toggleHold(p)}>{p.status === 'ON_HOLD' ? 'Reactivate' : 'Hold'}</button>
        </div>
      ),
    },
  ]

  const outcomeColumns = [
    { label: 'Serial', render: (p) => <Link to={`/pieces/${p.serial}`}><code>{p.serial}</code></Link> },
    { label: 'Stage', render: (p) => <Badge value={p.stage} label={p.stage_label} /> },
    { label: 'Product', render: (p) => p.item_name ?? '—' },
    { label: 'Order', render: (p) => (p.order_no ? `${p.order_no}${p.client_name ? ` · ${p.client_name}` : ''}` : '—') },
    { label: 'Since', render: (p) => dateTime(p.stage_since) },
    {
      label: '', render: (p) => (
        <div className="actions">
          <Link className="button" to={`/labels?serials=${p.serial}`}>Reprint label</Link>
          <button disabled={action.busy} onClick={() => openFix(p)}>Fix</button>
        </div>
      ),
    },
  ]

  const scanColumns = [
    { label: 'Serial', render: (r) => <code>{r.pieces?.serial ?? '—'}</code> },
    { label: 'By', render: (r) => staff[r.created_by] ?? '—' },
    { label: 'Method', render: (r) => titleCase(r.method) },
    { label: 'Out of order', render: (r) => (r.out_of_order ? <Badge value="WARNING" label="Out of order" /> : null) },
    { label: 'Time', render: (r) => dateTime(r.created_at) },
  ]

  return (
    <Page title={`${stationLabel} overview`} actions={<Link to="/station">Open the scanner</Link>}>
      <Alert>{board.error || scans.error || outcomes.error}</Alert>
      <ActionResult action={action} />

      <div className="stats">
        <div className="stat">At this station now<b>{board.data ? stats.here : '…'}</b></div>
        <div className="stat">Scanned in today<b>{scans.data ? stats.today : '…'}</b></div>
        <div className="stat">Scanned in this week<b>{scans.data ? stats.week : '…'}</b></div>
        <div className="stat">Oldest waiting<b>{board.data ? (stats.oldest ? waiting(stats.oldest) : '—') : '…'}</b></div>
        <div className={`stat ${stats.outOfOrder ? 'warn' : ''}`}>Out-of-order scans this week<b>{scans.data ? stats.outOfOrder : '…'}</b></div>
      </div>

      <Card title="Pieces at this station">
        {board.loading && !board.data ? <Loading /> : <Table columns={pieceColumns} rows={board.data} empty="No pieces at this station." />}
      </Card>

      {isQaStation && (
        <Card title="Passed or rejected (not shipped yet)">
          {outcomes.loading && !outcomes.data ? <Loading /> : <Table columns={outcomeColumns} rows={outcomes.data} empty="No passed or rejected pieces waiting." />}
        </Card>
      )}

      <Card title="Recent scans">
        {scans.loading && !scans.data ? <Loading /> : <Table columns={scanColumns} rows={scans.data?.slice(0, RECENT_SCANS)} empty="No scans at this station this week." />}
      </Card>

      <FixPieceModal piece={fix} stageLabel={stageLabel} onClose={() => setFix(null)} onDone={fixed} />
    </Page>
  )
}
