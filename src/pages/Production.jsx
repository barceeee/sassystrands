import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, loadItems, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ItemPicker, ActionResult, useAction } from '../components/ui.jsx'
import { qty, dateTime, pieceFor, PRODUCT_NOT_SET } from '../lib/format.js'

// Read-only progress board. Pieces only move when a station scans them.
export default function Production() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const lookups = useLookups()
  const { can } = useAuth()
  const receiving = can('receiving.manage')
  const [q, setQ] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const stage = params.get('stage') ?? ''
  // The table pages through the board (filtered by stage on the server); the tiles use stage totals.
  const board = useLoad(() => fetchAll(() => supabase.rpc('piece_board', { p_include_closed: includeClosed, p_stage: stage || null })), [includeClosed, stage])
  const totals = useLoad(() => must(supabase.rpc('piece_stage_counts')), [])
  const readyForStock = useLoad(async () => (receiving
    ? (await fetchAll(() => supabase.rpc('piece_board', { p_stage: 'READY' }).is('order_line_id', null))).filter((r) => r.status === 'ACTIVE')
    : []), [receiving])

  const stages = (lookups.data?.stages ?? []).filter((s) => includeClosed || !['SHIPPED', 'IN_STOCK'].includes(s.code))
  const counts = useMemo(() => {
    const c = {}
    for (const r of totals.data ?? []) {
      if (!includeClosed && (r.status === 'CANCELED' || ['SHIPPED', 'IN_STOCK'].includes(r.stage))) continue
      c[r.stage] = (c[r.stage] ?? 0) + r.pieces
    }
    return c
  }, [totals.data, includeClosed])

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (board.data ?? []).filter((r) =>
      words.every((w) => `${r.serial} ${r.item_name ?? ''} ${pieceFor(r)} ${r.group_label ?? ''}`.toLowerCase().includes(w)))
  }, [board.data, q])
  const reloadAll = () => { board.reload(); totals.reload(); readyForStock.reload() }

  const pick = (code) => setParams(code && code !== stage ? { stage: code } : {})

  return (
    <Page title="Production" subtitle="Every piece has its own serial and moves through RSB, wefting, ventilation and curling to QA when a station scans it.">
      <div className="stats">
        {stages.map((s) => (
          <button type="button" key={s.code} className={`stat ${stage === s.code ? 'warn' : ''}`} aria-pressed={stage === s.code} onClick={() => pick(s.code)}>
            {s.label}<b>{totals.data ? qty(counts[s.code] ?? 0) : '…'}</b>
          </button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="Serial, product, client, order" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => pick(e.target.value)} aria-label="Stage">
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <label><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include shipped / in stock / canceled</label>
      </div>
      <Alert>{board.error || totals.error || readyForStock.error}</Alert>
      {receiving && <ReceiveToStock pieces={readyForStock.data ?? []} locations={lookups.data?.locations ?? []} onDone={reloadAll} />}
      {board.loading ? <Loading /> : (
        <Card title={`Pieces (${rows.length})`}>
          <Table
            onRowClick={(r) => navigate(`/pieces/${r.serial}`)}
            columns={[
              { key: 'serial', label: 'Serial', render: (r) => <Link to={`/pieces/${r.serial}`} onClick={(e) => e.stopPropagation()}>{r.serial}</Link> },
              { key: 'item_name', label: 'Product', render: (r) => r.item_name ?? <span className="muted">{PRODUCT_NOT_SET}</span> },
              { key: 'stage_label', label: 'Stage', render: (r) => <Badge value={r.stage} label={r.stage_label} /> },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'client_name', label: 'For', render: (r) => pieceFor(r) },
              { key: 'stage_since', label: 'In stage since', render: (r) => dateTime(r.stage_since) },
            ]}
            rows={rows}
            empty="No pieces."
          />
        </Card>
      )}
    </Page>
  )
}

function ReceiveToStock({ pieces, locations, onDone }) {
  const items = useLoad(loadItems, [])
  const [sel, setSel] = useState([])
  const [item, setItem] = useState(null)
  const [location, setLocation] = useState('HQ')
  const action = useAction()
  const chosen = sel.filter((s) => pieces.some((p) => p.serial === s))
  const toggle = (serial) => setSel(chosen.includes(serial) ? chosen.filter((s) => s !== serial) : [...chosen, serial])
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => rpc('receive_to_stock', { p_serials: chosen, p_item_id: item, p_location: location }),
      (n) => `Received ${n} piece${n === 1 ? '' : 's'} to stock.`)
    if (ok) { setSel([]); onDone() }
  }
  return (
    <Card title={`Receive to stock (${pieces.length} ready, not linked to an order)`}>
      {pieces.length === 0 ? <p className="muted">No ready pieces waiting for stock.</p> : (
        <form className="form" onSubmit={submit}>
          <Field label="Pieces" wide>
            <div>{pieces.map((p) => (
              <label key={p.serial} style={{ display: 'inline-block', marginRight: 12 }}>
                <input type="checkbox" checked={chosen.includes(p.serial)} onChange={() => toggle(p.serial)} /> {p.serial}
              </label>
            ))}</div>
          </Field>
          <Field label="Product" wide><ItemPicker items={items.data} value={item} onChange={setItem} required /></Field>
          <Field label="Location">
            <select value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </Field>
          <div className="form-actions"><button className="primary" disabled={action.busy || !item || chosen.length === 0}>Receive {chosen.length} to stock</button></div>
        </form>
      )}
      <ActionResult action={action} />
    </Card>
  )
}
