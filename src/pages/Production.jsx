import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Tabs } from '../components/ui.jsx'
import { qty, date } from '../lib/format.js'

export default function Production() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const lookups = useLookups()
  const [view, setView] = useState(params.get('stage') ? 'list' : 'board')
  const [q, setQ] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const stage = params.get('stage') ?? ''
  const board = useLoad(() => must(supabase.rpc('production_board', { p_include_closed: includeClosed })), [includeClosed])

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (board.data ?? []).filter((r) => (!stage || r.stage === stage) &&
      words.every((w) => `${r.record_no} ${r.item_name} ${r.client_name ?? 'stock'} ${r.order_no ?? ''}`.toLowerCase().includes(w)))
  }, [board.data, stage, q])

  const stages = (lookups.data?.stages ?? []).filter((s) => includeClosed || !['SHIPPED', 'IN_STOCK'].includes(s.code))

  return (
    <Page
      title="Production"
      subtitle="Each record is a batch of units for one product, moving through RSB, wefting, ventilation and curling to QA."
      actions={can('production.manage') && <Link className="button primary" to="/production/new">New production record</Link>}
    >
      <Tabs value={view} onChange={setView} tabs={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
      <div className="filters">
        <input type="search" placeholder="Record, product, client" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setParams(e.target.value ? { stage: e.target.value } : {})} aria-label="Stage">
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <label><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include shipped / received / canceled</label>
      </div>
      <Alert>{board.error}</Alert>
      {board.loading ? <Loading /> : view === 'board' ? (
        <div className="stage-board">
          {stages.filter((s) => !stage || s.code === stage).map((s) => {
            const list = rows.filter((r) => r.stage === s.code)
            return (
              <div className="stage-col" key={s.code}>
                <h3><span>{s.label}</span><span className="muted">{qty(list.reduce((t, r) => t + r.qty, 0))}</span></h3>
                {list.length === 0 && <p className="muted small">Empty</p>}
                {list.map((r) => (
                  <Link className="job" key={r.id} to={`/production/${r.id}`}>
                    <b>{r.qty} × {r.item_name}</b>
                    <div className="meta">{r.record_no} · {r.client_name ? `${r.client_name} (${r.order_no})` : 'For stock'}</div>
                    {r.status !== 'ACTIVE' && <Badge value={r.status} />}
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <Table
            onRowClick={(r) => navigate(`/production/${r.id}`)}
            columns={[
              { key: 'record_no', label: 'Record' },
              { key: 'item_name', label: 'Product' },
              { key: 'qty', label: 'Qty', num: true },
              { key: 'stage_label', label: 'Stage', render: (r) => <Badge value={r.stage} label={r.stage_label} /> },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'client_name', label: 'For', render: (r) => (r.client_name ? `${r.client_name} · ${r.order_no}` : 'Stock') },
              { key: 'updated_at', label: 'Last update', render: (r) => date(r.updated_at) },
            ]}
            rows={rows}
            empty="No records."
          />
        </Card>
      )}
    </Page>
  )
}
