import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, rpc } from '../../supabase.js'
import { useAuth } from '../../auth.jsx'
import { useLoad, fetchAll, useLookups, useStaff } from '../../lib/data.js'
import { dateTime, titleCase } from '../../lib/format.js'
import { Page, Card, Table, Badge, Alert, Loading, Field, useAction, ActionResult } from '../../components/ui.jsx'
import Modal from '../../components/Modal.jsx'

const FIX_STAGES = ['RECEIVED', 'RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA']
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

  const board = useLoad(async () => (await rpc('piece_board')).filter((p) => p.stage === station), [station])
  const scans = useLoad(() => {
    const since = weekStart().toISOString()
    return fetchAll(() => supabase.from('piece_events')
      .select('id, method, out_of_order, created_by, created_at, pieces(serial)')
      .eq('event', 'SCAN').eq('station', station).gte('created_at', since)
      .order('created_at', { ascending: false }).order('id', { ascending: false }))
  }, [station])

  const action = useAction()
  const [fix, setFix] = useState(null) // { serial, to, reason }

  const reloadAll = () => { board.reload(); scans.reload() }

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

  const submitFix = async (e) => {
    e.preventDefault()
    const ok = await action.run(
      () => rpc('leader_fix', { p_serial: fix.serial, p_to_stage: fix.to, p_reason: fix.reason }).then(reloadAll),
      `${fix.serial} moved to ${stageLabel[fix.to] ?? fix.to}.`,
    )
    if (ok) setFix(null)
  }
  const openFix = (p) => { action.setError(null); action.setDone(null); setFix({ serial: p.serial, to: FIX_STAGES.find((s) => s !== p.stage), reason: '' }) }

  if (!station) {
    return <Page title="Station overview"><Alert>Your account has no station assigned. Ask an administrator to set one.</Alert></Page>
  }

  const pieceColumns = [
    { label: 'Serial', render: (p) => <code>{p.serial}</code> },
    { label: 'Product', render: (p) => p.item_name ?? '—' },
    { label: 'Order', render: (p) => (p.order_no ? `${p.order_no}${p.client_name ? ` · ${p.client_name}` : ''}` : '—') },
    { label: 'Arrived', render: (p) => dateTime(p.stage_since) },
    { label: 'Waiting', render: (p) => waiting(p.stage_since) },
    { label: 'Status', render: (p) => (p.status === 'ON_HOLD' ? <Badge value="ON_HOLD" /> : null) },
    {
      label: '', render: (p) => (
        <div className="actions">
          <button disabled={action.busy} onClick={() => openFix(p)}>Fix</button>
          <button disabled={action.busy} onClick={() => toggleHold(p)}>{p.status === 'ON_HOLD' ? 'Reactivate' : 'Hold'}</button>
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
      <Alert>{board.error || scans.error}</Alert>
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

      <Card title="Recent scans">
        {scans.loading && !scans.data ? <Loading /> : <Table columns={scanColumns} rows={scans.data?.slice(0, RECENT_SCANS)} empty="No scans at this station this week." />}
      </Card>

      <Modal
        open={!!fix}
        onClose={() => setFix(null)}
        title={fix ? `Fix ${fix.serial}` : 'Fix'}
        footer={<>
          <button type="button" onClick={() => setFix(null)}>Cancel</button>
          <button type="submit" form="fix-form" className="primary" disabled={action.busy}>Move piece</button>
        </>}
      >
        {fix && (
          <form id="fix-form" onSubmit={submitFix} className="form">
            <Alert>{action.error}</Alert>
            <Field label="Move to">
              <select value={fix.to} onChange={(e) => setFix({ ...fix, to: e.target.value })}>
                {FIX_STAGES.map((s) => <option key={s} value={s}>{stageLabel[s] ?? titleCase(s)}</option>)}
              </select>
            </Field>
            <Field label="Reason" hint="Required. Recorded with the fix." wide>
              <input value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} autoComplete="off" />
            </Field>
          </form>
        )}
      </Modal>
    </Page>
  )
}
