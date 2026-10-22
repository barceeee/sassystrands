import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLoad, useStaff, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Tabs } from '../components/ui.jsx'
import { money, qty, dateTime, titleCase, downloadCsv } from '../lib/format.js'

const TABS = [
  { value: 'stock', label: 'Stock levels & value' },
  { value: 'movements', label: 'Movement history' },
  { value: 'orders', label: 'Order fulfillment' },
  { value: 'production', label: 'Production & QA' },
  { value: 'reconcile', label: 'Reconciliation' },
  { value: 'audit', label: 'Audit trail' },
]

export default function Reports() {
  const [tab, setTab] = useState('stock')
  return (
    <Page title="Reports" subtitle="All totals are calculated from the underlying records.">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'stock' && <StockReport />}
      {tab === 'movements' && <MovementReport />}
      {tab === 'orders' && <OrderReport />}
      {tab === 'production' && <ProductionReport />}
      {tab === 'reconcile' && <ReconcileReport />}
      {tab === 'audit' && <AuditReport />}
    </Page>
  )
}

function group(rows, keyFn, init, add) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!m.has(k)) m.set(k, init(r))
    add(m.get(k), r)
  }
  return [...m.values()]
}

function StockReport() {
  const stock = useLoad(() => fetchAll(() => supabase.from('v_stock_on_hand').select('*')), [])
  const bundles = useLoad(() => must(supabase.from('v_sale_bundles').select('price, status')), [])
  if (stock.loading) return <Loading />
  const rows = stock.data ?? []
  const groups = group(rows, (r) => `${r.category}|${r.draw ?? r.lace_type}|${r.style_label}`,
    (r) => ({ key: `${r.category}|${r.draw ?? r.lace_type}|${r.style_label}`, category: r.category, kind: r.draw ?? r.lace_type, style: r.style_label, products: 0, units: 0, value: 0, unpriced: 0 }),
    (g, r) => { g.products += r.on_hand ? 1 : 0; g.units += r.on_hand; g.value += Number(r.stock_value ?? 0); g.unpriced += r.unit_price === null && r.on_hand ? r.on_hand : 0 })
    .filter((g) => g.units !== 0)
    .sort((a, b) => a.key.localeCompare(b.key))
  const totals = { units: groups.reduce((t, g) => t + g.units, 0), value: groups.reduce((t, g) => t + g.value, 0), unpriced: groups.reduce((t, g) => t + g.unpriced, 0) }
  const available = (bundles.data ?? []).filter((b) => b.status === 'AVAILABLE')
  return (
    <>
      <div className="stats">
        <div className="stat">Units on hand<b>{qty(totals.units)}</b></div>
        <div className="stat">Stock value<b>{money(totals.value)}</b></div>
        <div className={`stat ${totals.unpriced ? 'warn' : ''}`}>Units without a price<b>{qty(totals.unpriced)}</b></div>
        <div className="stat">Sale bundles available (separate)<b>{available.length} · {money(available.reduce((t, b) => t + Number(b.price ?? 0), 0))}</b></div>
      </div>
      <Card title="By category and texture" actions={<button onClick={() => downloadCsv('stock-by-texture.csv', groups, [
        { key: 'category', label: 'Category' }, { key: 'kind', label: 'Draw / lace' }, { key: 'style', label: 'Texture' },
        { key: 'units', label: 'Units' }, { key: 'value', label: 'Value' }, { key: 'unpriced', label: 'Units without price' },
      ])}>Export CSV</button>}>
        <Table
          rowKey="key"
          columns={[
            { key: 'category', label: 'Category', render: (g) => titleCase(g.category) },
            { key: 'kind', label: 'Draw / lace', render: (g) => titleCase(g.kind) },
            { key: 'style', label: 'Texture' },
            { key: 'products', label: 'Lengths/sizes in stock', num: true },
            { key: 'units', label: 'Units', num: true, render: (g) => qty(g.units) },
            { key: 'value', label: 'Value', num: true, render: (g) => money(g.value) },
            { key: 'unpriced', label: 'Unpriced units', num: true, render: (g) => (g.unpriced ? <span style={{ color: 'var(--amber)' }}>{g.unpriced}</span> : '') },
          ]}
          rows={groups}
          footer={<><td colSpan={4}>Total</td><td className="num">{qty(totals.units)}</td><td className="num">{money(totals.value)}</td><td className="num">{totals.unpriced || ''}</td></>}
        />
      </Card>
    </>
  )
}

function MovementReport() {
  const now = new Date()
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA'))
  const [to, setTo] = useState(now.toLocaleDateString('en-CA'))
  const data = useLoad(async () => {
    const [moves, items] = await Promise.all([
      fetchAll(() => supabase.from('stock_movements').select('item_id, movement_type, signed_qty, movement_date').lte('movement_date', to)),
      fetchAll(() => supabase.from('v_items').select('id, name, sku')),
    ])
    return { moves, items }
  }, [to])
  const rows = useMemo(() => {
    if (!data.data) return []
    const names = Object.fromEntries(data.data.items.map((i) => [i.id, i]))
    const m = new Map()
    for (const mv of data.data.moves) {
      if (!m.has(mv.item_id)) m.set(mv.item_id, { id: mv.item_id, name: names[mv.item_id]?.name, sku: names[mv.item_id]?.sku, opening: 0, inn: 0, out: 0, adjust: 0 })
      const r = m.get(mv.item_id)
      if (mv.movement_date < from) r.opening += mv.signed_qty
      else if (mv.movement_type === 'OUT') r.out += -mv.signed_qty
      else if (mv.movement_type === 'ADJUST') r.adjust += mv.signed_qty
      else r.inn += mv.signed_qty // IN and OPENING
    }
    return [...m.values()].map((r) => ({ ...r, closing: r.opening + r.inn - r.out + r.adjust }))
      .filter((r) => r.opening || r.inn || r.out || r.adjust).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  }, [data.data, from])
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  return (
    <Card title="Starting balance, IN, OUT and ending balance per product" actions={<button onClick={() => downloadCsv(`movements-${from}-to-${to}.csv`, rows, [
      { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'opening', label: 'Starting' }, { key: 'inn', label: 'Total in' },
      { key: 'out', label: 'Total out' }, { key: 'adjust', label: 'Adjustments' }, { key: 'closing', label: 'Ending' },
    ])}>Export CSV</button>}>
      <div className="filters">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <Alert>{data.error}</Alert>
      {data.loading ? <Loading /> : (
        <Table
          columns={[
            { key: 'name', label: 'Product', render: (r) => <Link to={`/inventory/items/${r.id}`}>{r.name}</Link> },
            { key: 'opening', label: 'Starting', num: true },
            { key: 'inn', label: 'Total in', num: true },
            { key: 'out', label: 'Total out', num: true },
            { key: 'adjust', label: 'Adjustments', num: true },
            { key: 'closing', label: 'Ending', num: true, render: (r) => <b style={{ color: r.closing < 0 ? 'var(--red)' : undefined }}>{r.closing}</b> },
          ]}
          rows={rows}
          footer={<><td>Total</td><td className="num">{sum('opening')}</td><td className="num">{sum('inn')}</td><td className="num">{sum('out')}</td><td className="num">{sum('adjust')}</td><td className="num">{sum('closing')}</td></>}
        />
      )}
    </Card>
  )
}

function OrderReport() {
  const orders = useLoad(() => fetchAll(() => supabase.from('v_orders').select('*').order('client_name')), [])
  if (orders.loading) return <Loading />
  const rows = (orders.data ?? []).filter((o) => o.status !== 'CANCELED')
  const byStatus = group(rows, (o) => o.fulfillment_status, (o) => ({ status: o.fulfillment_status, orders: 0, ordered: 0, shipped: 0, value: 0 }),
    (g, o) => { g.orders++; g.ordered += o.qty_ordered; g.shipped += o.qty_shipped; g.value += Number(o.order_value) })
  return (
    <>
      <Card title="Orders by fulfillment status">
        <Table rowKey="status" columns={[
          { key: 'status', label: 'Status', render: (g) => <Badge value={g.status} /> },
          { key: 'orders', label: 'Orders', num: true },
          { key: 'ordered', label: 'Units ordered', num: true },
          { key: 'shipped', label: 'Units shipped', num: true },
          { key: 'value', label: 'List value', num: true, render: (g) => money(g.value) },
        ]} rows={byStatus} />
      </Card>
      <Card title="Every order" actions={<button onClick={() => downloadCsv('order-fulfillment.csv', rows, [
        { key: 'order_no', label: 'Order' }, { key: 'client_name', label: 'Client' }, { key: 'qty_ordered', label: 'Ordered' },
        { key: 'qty_unallocated', label: 'Not started' }, { key: 'qty_in_production', label: 'In pipeline' }, { key: 'qty_ready', label: 'Ready' },
        { key: 'qty_shipped', label: 'Shipped' }, { key: 'fulfillment_status', label: 'Status' },
      ])}>Export CSV</button>}>
        <Table columns={[
          { key: 'order_no', label: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.order_no}</Link> },
          { key: 'client_name', label: 'Client' },
          { key: 'qty_ordered', label: 'Ordered', num: true },
          { key: 'qty_unallocated', label: 'Not started', num: true },
          { key: 'qty_in_production', label: 'In pipeline', num: true },
          { key: 'qty_ready', label: 'Ready', num: true },
          { key: 'qty_shipped', label: 'Shipped', num: true },
          { key: 'pct', label: '% shipped', num: true, render: (o) => (o.qty_ordered ? `${Math.round((100 * o.qty_shipped) / o.qty_ordered)}%` : '—') },
          { key: 'fulfillment_status', label: 'Status', render: (o) => <Badge value={o.fulfillment_status} /> },
        ]} rows={rows} />
      </Card>
    </>
  )
}

function ProductionReport() {
  const data = useLoad(async () => {
    const [board, qa] = await Promise.all([
      must(supabase.rpc('production_board', { p_include_closed: true })),
      fetchAll(() => supabase.from('qa_inspections').select('passed_qty, rejected_qty, result, defects, inspected_at')),
    ])
    return { board, qa }
  }, [])
  if (data.loading) return <Loading />
  if (data.error) return <Alert>{data.error}</Alert>
  const stages = group(data.data.board, (r) => r.stage, (r) => ({ stage: r.stage, label: r.stage_label, sort: r.stage_sort, active: 0, onHold: 0, canceled: 0 }),
    (g, r) => { if (r.status === 'ACTIVE') g.active += r.qty; else if (r.status === 'ON_HOLD') g.onHold += r.qty; else g.canceled += r.qty })
    .sort((a, b) => a.sort - b.sort)
  const months = group(data.data.qa, (q) => q.inspected_at.slice(0, 7), (q) => ({ month: q.inspected_at.slice(0, 7), inspections: 0, passed: 0, rejected: 0 }),
    (g, q) => { g.inspections++; g.passed += q.passed_qty; g.rejected += q.rejected_qty })
    .sort((a, b) => b.month.localeCompare(a.month))
  const defects = group(data.data.qa.filter((q) => q.rejected_qty > 0), (q) => (q.defects ?? '').trim().toLowerCase() || '(not stated)',
    (q) => ({ defect: (q.defects ?? '').trim().toLowerCase() || '(not stated)', units: 0 }), (g, q) => { g.units += q.rejected_qty })
    .sort((a, b) => b.units - a.units).slice(0, 15)
  return (
    <div className="grid">
      <Card title="Units by production stage">
        <Table rowKey="stage" columns={[
          { key: 'label', label: 'Stage' },
          { key: 'active', label: 'Active', num: true },
          { key: 'onHold', label: 'On hold', num: true },
          { key: 'canceled', label: 'Canceled', num: true },
        ]} rows={stages} />
      </Card>
      <Card title="QA outcomes by month">
        <Table rowKey="month" columns={[
          { key: 'month', label: 'Month' },
          { key: 'inspections', label: 'Inspections', num: true },
          { key: 'passed', label: 'Passed', num: true },
          { key: 'rejected', label: 'Rejected', num: true },
          { key: 'rate', label: 'Pass rate', num: true, render: (g) => `${Math.round((100 * g.passed) / Math.max(1, g.passed + g.rejected))}%` },
        ]} rows={months} empty="No inspections yet." />
      </Card>
      <Card title="Most common rejection reasons">
        <Table rowKey="defect" columns={[{ key: 'defect', label: 'Defect' }, { key: 'units', label: 'Units rejected', num: true }]} rows={defects} empty="No rejections." />
      </Card>
    </div>
  )
}

function ReconcileReport() {
  const counts = useLoad(() => fetchAll(() => supabase.from('v_count_variance').select('source, source_label, count_date, counted_qty, computed_qty, variance, unit_price')), [])
  if (counts.loading) return <Loading />
  const rows = group(counts.data ?? [], (c) => `${c.source}|${c.source_label}|${c.count_date}`,
    (c) => ({ key: `${c.source}|${c.source_label}|${c.count_date}`, source: c.source, label: c.source_label, date: c.count_date, lines: 0, counted: 0, computed: 0, off: 0, sheetValue: 0 }),
    (g, c) => { g.lines++; g.counted += c.counted_qty; g.computed += c.computed_qty; g.off += c.variance ? 1 : 0; g.sheetValue += c.counted_qty * Number(c.unit_price ?? 0) })
    .sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card title="Counts and spreadsheet snapshots vs. computed stock">
      <p className="muted small">Each row is one count or sheet. "Computed" is the balance from movements on that date. Review and post adjustments on the <Link to="/inventory/counts">Counts & audit</Link> page.</p>
      <Table rowKey="key" columns={[
        { key: 'date', label: 'Date' },
        { key: 'source', label: 'Source' },
        { key: 'label', label: 'Sheet / label' },
        { key: 'lines', label: 'Products', num: true },
        { key: 'counted', label: 'Counted units', num: true },
        { key: 'computed', label: 'Computed units', num: true },
        { key: 'off', label: 'Products with variance', num: true },
        { key: 'sheetValue', label: 'Value at sheet prices', num: true, render: (g) => (g.sheetValue ? money(g.sheetValue) : '—') },
      ]} rows={rows} empty="No counts recorded." />
    </Card>
  )
}

function AuditReport() {
  const staff = useStaff()
  const [table, setTable] = useState('')
  const log = useLoad(() => {
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
    if (table) q = q.eq('table_name', table)
    return must(q)
  }, [table])
  const describe = (e) => {
    if (e.action !== 'UPDATE' || !e.old_data || !e.new_data) return null
    return Object.keys(e.new_data).filter((k) => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(e.old_data[k]) !== JSON.stringify(e.new_data[k]))
      .map((k) => `${k}: ${e.old_data[k] ?? '∅'} → ${e.new_data[k] ?? '∅'}`).join('; ')
  }
  return (
    <Card title="Who changed what (latest 300)">
      <div className="filters">
        <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Table">
          <option value="">All records</option>
          {['items', 'stock_movements', 'stock_counts', 'orders', 'order_lines', 'production_records', 'qa_inspections', 'or_numbers', 'profiles', 'import_batches'].map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <Alert>{log.error}</Alert>
      {log.loading ? <Loading /> : (
        <Table columns={[
          { key: 'at', label: 'When', render: (e) => dateTime(e.at) },
          { key: 'actor', label: 'Who', render: (e) => staff[e.actor] ?? (e.actor ? 'Unknown user' : 'System / import') },
          { key: 'action', label: 'Action', render: (e) => <Badge value={e.action === 'DELETE' ? 'REJECTED' : e.action === 'INSERT' ? 'IN' : 'ADJUST'} label={titleCase(e.action)} /> },
          { key: 'table_name', label: 'Record', render: (e) => `${e.table_name} #${e.record_id}` },
          { key: 'detail', label: 'Change', render: (e) => <span className="small">{describe(e) ?? ''}</span> },
        ]} rows={log.data ?? []} />
      )}
    </Card>
  )
}
