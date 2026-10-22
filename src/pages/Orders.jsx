import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge } from '../components/ui.jsx'
import { date, money } from '../lib/format.js'

const STATUSES = ['NOT_STARTED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'PARTIALLY_SHIPPED', 'FULFILLED', 'CANCELED']

export default function Orders() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'OPEN'
  const [q, setQ] = useState('')
  const orders = useLoad(() => fetchAll(() => supabase.from('v_orders').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })), [])

  const rows = (orders.data ?? []).filter((o) =>
    (status === 'ALL' || (status === 'OPEN' ? !['FULFILLED', 'CANCELED'].includes(o.fulfillment_status) : o.fulfillment_status === status)) &&
    (!q || `${o.order_no} ${o.client_name}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <Page title="Client orders" actions={can('orders.manage') && <Link className="button primary" to="/orders/new">New order</Link>}>
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => setParams({ status: e.target.value })} aria-label="Status">
            <option value="OPEN">Open (not fulfilled)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
            <option value="ALL">All</option>
          </select>
          <input type="search" placeholder="Order no. or client" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Alert>{orders.error}</Alert>
        {orders.loading ? <Loading /> : (
          <Table
            onRowClick={(o) => navigate(`/orders/${o.id}`)}
            columns={[
              { key: 'order_no', label: 'Order' },
              { key: 'client_name', label: 'Client' },
              { key: 'order_date', label: 'Date', render: (o) => date(o.order_date ?? o.created_at) },
              { key: 'qty_ordered', label: 'Ordered', num: true },
              { key: 'qty_unallocated', label: 'Not started', num: true },
              { key: 'qty_in_production', label: 'In pipeline', num: true },
              { key: 'qty_shipped', label: 'Shipped', num: true },
              { key: 'order_value', label: 'List value', num: true, render: (o) => money(o.order_value) },
              { key: 'fulfillment_status', label: 'Status', render: (o) => <>
                <Badge value={o.fulfillment_status} />
                {o.has_over_allocation && <> <Badge value="WARNING" label="Over-allocated" /></>}
              </> },
            ]}
            rows={rows}
            empty="No orders match."
          />
        )}
      </Card>
    </Page>
  )
}
