import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, useStaff } from '../lib/data.js'
import { Page, Card, Alert, Loading, Badge, Field, ActionResult, useAction, Table } from '../components/ui.jsx'
import QaForm from '../components/QaForm.jsx'
import { dateTime } from '../lib/format.js'

export default function ProductionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const staff = useStaff()
  const lookups = useLookups()
  const rec = useLoad(async () => (await must(supabase.rpc('production_board', { p_id: Number(id) })))[0] ?? null, [id])
  const events = useLoad(() => must(supabase.from('production_events').select('*').eq('production_id', id).order('created_at', { ascending: false }).order('id', { ascending: false })), [id])
  const qa = useLoad(() => must(supabase.from('qa_inspections').select('*').eq('production_id', id).order('inspected_at', { ascending: false })), [id])
  const reload = () => { rec.reload(); events.reload(); qa.reload() }

  if (rec.loading) return <Loading />
  if (rec.error) return <Alert>{rec.error}</Alert>
  if (!rec.data) return <Alert>Production record not found.</Alert>
  const r = rec.data
  const label = lookups.data?.stageLabel ?? {}
  const closed = ['SHIPPED', 'IN_STOCK'].includes(r.stage)

  return (
    <Page
      title={`${r.record_no} · ${r.qty} × ${r.item_name}`}
      subtitle={<>{r.client_name ? <>For {r.client_name} · {can('orders.view') ? <Link to={`/orders/${r.order_id}`}>{r.order_no}</Link> : r.order_no}{r.group_label && ` · ${r.group_label}`}</> : 'For stock'}{r.source_ref && ` · imported from ${r.source_ref}`}</>}
      actions={<Link to="/production">← Production</Link>}
    >
      <div className="stats">
        <div className="stat">Stage<b><Badge value={r.stage} label={r.stage_label} /></b></div>
        <div className="stat">Status<b><Badge value={r.status} /></b></div>
        <div className="stat">Units<b>{r.qty}</b></div>
        {r.parent_id && <Link className="stat" to={`/production/${r.parent_id}`}>Split from<b>PR-{String(r.parent_id).padStart(5, '0')}</b></Link>}
      </div>
      {r.notes && <p>{r.notes}</p>}

      {!closed && r.status === 'ACTIVE' && r.stage === 'FOR_QA' && can('qa.manage') && (
        <Card title="QA inspection"><QaForm record={r} onSaved={reload} /></Card>
      )}
      {!closed && <MoveRecord record={r} stages={lookups.data?.stages ?? []} locations={lookups.data?.locations ?? []} onSaved={(newId) => (newId && newId !== r.id ? navigate(`/production/${newId}`) : reload())} />}

      <Card title="QA results">
        <Table
          columns={[
            { key: 'inspected_at', label: 'When', render: (x) => dateTime(x.inspected_at) },
            { key: 'result', label: 'Result', render: (x) => <Badge value={x.result} /> },
            { key: 'passed_qty', label: 'Passed', num: true },
            { key: 'rejected_qty', label: 'Rejected', num: true },
            { key: 'defects', label: 'Defects / notes', render: (x) => [x.defects, x.note].filter(Boolean).join(' — ') },
            { key: 'inspected_by', label: 'Inspector', render: (x) => staff[x.inspected_by] ?? '—' },
          ]}
          rows={qa.data ?? []}
          empty="Not inspected yet."
        />
      </Card>

      <Card title="History">
        <ul className="timeline">
          {(events.data ?? []).map((e) => (
            <li key={e.id}>
              <b>{e.event === 'MOVED' || e.event === 'QA' ? `${label[e.from_stage] ?? e.from_stage} → ${label[e.to_stage] ?? e.to_stage}` : e.event === 'CREATED' || e.event === 'IMPORTED' ? `${e.event === 'CREATED' ? 'Created' : 'Imported'} in ${label[e.to_stage] ?? e.to_stage}` : e.event === 'SPLIT' ? 'Split' : 'Status change'}</b>
              {e.qty != null && <> · {e.qty} unit(s)</>}
              {e.note && <> · {e.note}</>}
              <div className="muted small">{staff[e.created_by] ?? (e.event === 'IMPORTED' ? 'Import' : '—')} · {dateTime(e.created_at)}</div>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  )
}

function MoveRecord({ record, stages, locations, onSaved }) {
  const { can } = useAuth()
  const manager = can('inventory.manage')
  const action = useAction()
  const [f, setF] = useState({ to: '', qty: '', note: '', location: 'HQ', status: '', statusNote: '' })

  // Stages offered match what the database allows for this role and record.
  const options = stages.filter((s) => {
    if (s.code === record.stage) return false
    if (['READY', 'REJECTED'].includes(s.code)) return false
    if (s.code === 'SHIPPED') return manager && record.stage === 'READY' && !!record.order_line_id
    if (s.code === 'IN_STOCK') return manager && record.stage === 'READY' && !record.order_line_id
    if (!can('production.manage')) return false
    if (!manager && ['FOR_QA', 'READY'].includes(record.stage)) return false
    return s.production_can_set
  })

  const move = async (e) => {
    e.preventDefault()
    const newId = await action.run(() => rpc('move_production', {
      p_id: record.id, p_to_stage: f.to, p_qty: f.qty === '' || Number(f.qty) === record.qty ? null : Number(f.qty), p_note: f.note || null, p_location: f.location,
    }), 'Moved.')
    if (newId) { setF({ ...f, to: '', qty: '', note: '' }); onSaved(newId) }
  }
  const setStatus = async (status) => {
    const note = status === 'CANCELED' ? window.prompt('Reason for canceling?') : f.statusNote
    if (status === 'CANCELED' && !note) return
    const ok = await action.run(() => rpc('set_production_status', { p_id: record.id, p_status: status, p_note: note || null }), 'Status updated.')
    if (ok) onSaved()
  }

  if (!can('production.manage') && options.length === 0) return null
  return (
    <Card title="Update this record">
      {record.status === 'ACTIVE' && options.length > 0 && (
        <form className="form" onSubmit={move}>
          <Field label="Move to stage">
            <select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required>
              <option value="">— choose —</option>
              {options.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="How many units" hint={`Leave blank to move all ${record.qty}. Fewer splits the record.`}>
            <input type="number" min="1" max={record.qty} step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
          {f.to === 'IN_STOCK' && (
            <Field label="Into location">
              <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>{locations.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
            </Field>
          )}
          <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <div className="form-actions"><button className="primary" disabled={action.busy}>Move</button></div>
        </form>
      )}
      {can('production.manage') && (
        <div className="actions" style={{ marginTop: 12 }}>
          {record.status === 'ACTIVE' && <button onClick={() => setStatus('ON_HOLD')} disabled={action.busy}>Put on hold</button>}
          {record.status !== 'ACTIVE' && (record.status !== 'CANCELED' || manager) && <button onClick={() => setStatus('ACTIVE')} disabled={action.busy}>Reactivate</button>}
          {record.status !== 'CANCELED' && <button className="danger" onClick={() => setStatus('CANCELED')} disabled={action.busy}>Cancel record</button>}
        </div>
      )}
      <ActionResult action={action} />
    </Card>
  )
}
