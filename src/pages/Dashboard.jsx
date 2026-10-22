import { Link } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge } from '../components/ui.jsx'
import { money, qty } from '../lib/format.js'

export default function Dashboard() {
  const { can, profile } = useAuth()
  const manager = can('inventory.view')

  const board = useLoad(() => must(supabase.rpc('production_board')), [])
  const inv = useLoad(async () => {
    if (!manager) return null
    const [stock, orders, flags] = await Promise.all([
      fetchAll(() => supabase.from('v_stock_on_hand').select('item_id, name, on_hand, stock_value, reorder_level, active')),
      must(supabase.from('v_orders').select('id, order_no, client_name, fulfillment_status, qty_ordered, qty_shipped, has_over_allocation').neq('status', 'CANCELED')),
      supabase.from('import_flags').select('id', { count: 'exact', head: true }).eq('resolved', false).in('severity', ['ERROR', 'WARNING']),
    ])
    if (flags.error) throw new Error(flags.error.message)
    return { stock, orders, openFlags: flags.count ?? 0 }
  }, [manager])

  const stages = {}
  for (const r of board.data ?? []) {
    stages[r.stage] ??= { label: r.stage_label, sort: r.stage_sort, qty: 0, records: 0 }
    stages[r.stage].qty += r.qty
    stages[r.stage].records += 1
  }
  const forQa = stages.FOR_QA?.qty ?? 0
  const rejected = stages.REJECTED?.qty ?? 0

  const s = inv.data
  const units = s?.stock.reduce((t, r) => t + r.on_hand, 0) ?? 0
  const value = s?.stock.reduce((t, r) => t + Number(r.stock_value ?? 0), 0) ?? 0
  const low = s?.stock.filter((r) => r.active && r.reorder_level > 0 && r.on_hand <= r.reorder_level) ?? []
  const negative = s?.stock.filter((r) => r.on_hand < 0) ?? []
  const openOrders = s?.orders.filter((o) => !['FULFILLED', 'NO_LINES'].includes(o.fulfillment_status)) ?? []
  const ready = s?.orders.filter((o) => o.fulfillment_status === 'READY_TO_SHIP') ?? []

  return (
    <Page title={`Hello, ${profile.full_name.split(' ')[0]}`} subtitle="Today at a glance">
      <Alert>{board.error || inv.error}</Alert>
      {manager && (s ? (
        <div className="stats">
          <Link className="stat" to="/inventory">Units in stock<b>{qty(units)}</b></Link>
          <Link className="stat" to="/reports">Stock value<b>{money(value)}</b></Link>
          <Link className={`stat ${low.length ? 'warn' : ''}`} to="/inventory?low=1">At or below reorder level<b>{low.length}</b></Link>
          <Link className={`stat ${negative.length ? 'bad' : ''}`} to="/inventory?negative=1">Negative balances<b>{negative.length}</b></Link>
          <Link className="stat" to="/orders">Open client orders<b>{openOrders.length}</b></Link>
          <Link className="stat" to="/orders?status=READY_TO_SHIP">Orders ready to ship<b>{ready.length}</b></Link>
          <Link className={`stat ${s.openFlags ? 'warn' : ''}`} to="/imports">Import issues to review<b>{s.openFlags}</b></Link>
        </div>
      ) : <Loading />)}

      <div className="stats">
        <Link className={`stat ${forQa ? 'warn' : ''}`} to="/production?stage=FOR_QA">Units awaiting QA<b>{qty(forQa)}</b></Link>
        <Link className={`stat ${rejected ? 'bad' : ''}`} to="/production?stage=REJECTED">Units rejected, needing rework<b>{qty(rejected)}</b></Link>
      </div>

      <div className="grid">
        <Card title="Work in production" actions={<Link to="/production">Open board</Link>}>
          {board.loading ? <Loading /> : (
            <Table
              rowKey="stage"
              columns={[
                { key: 'label', label: 'Stage' },
                { key: 'records', label: 'Records', num: true },
                { key: 'qty', label: 'Units', num: true },
              ]}
              rows={Object.entries(stages).map(([stage, v]) => ({ stage, ...v })).sort((a, b) => a.sort - b.sort)}
              empty="No active production records."
            />
          )}
        </Card>
        {manager && s && (
          <Card title="Orders needing attention" actions={<Link to="/orders">All orders</Link>}>
            <Table
              columns={[
                { key: 'order_no', label: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.order_no}</Link> },
                { key: 'client_name', label: 'Client' },
                { key: 'fulfillment_status', label: 'Status', render: (o) => <Badge value={o.fulfillment_status} /> },
                { key: 'progress', label: 'Shipped', num: true, render: (o) => `${o.qty_shipped} / ${o.qty_ordered}` },
              ]}
              rows={openOrders.filter((o) => o.has_over_allocation || o.fulfillment_status === 'READY_TO_SHIP').slice(0, 10)}
              empty="Nothing urgent."
            />
          </Card>
        )}
      </div>
    </Page>
  )
}
