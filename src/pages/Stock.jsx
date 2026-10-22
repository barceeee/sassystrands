import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, fetchAll, useLookups, loadItems } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table } from '../components/ui.jsx'
import MovementForm from '../components/MovementForm.jsx'
import { money, qty, date, downloadCsv } from '../lib/format.js'

export default function Stock() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const lookups = useLookups()
  const stock = useLoad(() => fetchAll(() => supabase.from('v_stock_on_hand').select('*').order('category').order('style').order('length_in').order('item_id')), [])
  const items = useLoad(loadItems, [])
  const [showForm, setShowForm] = useState(false)
  const [f, setF] = useState({
    q: '', category: '', draw: '', style: '',
    inStock: params.get('low') || params.get('negative') ? false : true,
    low: !!params.get('low'), negative: !!params.get('negative'), inactive: false,
  })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const rows = useMemo(() => {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
    return (stock.data ?? []).filter((r) =>
      (f.inactive || r.active) &&
      (!f.category || r.category === f.category) &&
      (!f.draw || r.draw === f.draw) &&
      (!f.style || r.style === f.style) &&
      (!f.inStock || r.on_hand !== 0) &&
      (!f.low || (r.reorder_level > 0 && r.on_hand <= r.reorder_level)) &&
      (!f.negative || r.on_hand < 0) &&
      words.every((w) => `${r.name} ${r.sku}`.toLowerCase().includes(w)))
  }, [stock.data, f])

  const totalUnits = rows.reduce((t, r) => t + r.on_hand, 0)
  const totalValue = rows.reduce((t, r) => t + Number(r.stock_value ?? 0), 0)
  const unpriced = rows.filter((r) => r.unit_price === null && r.on_hand !== 0).length

  const exportCsv = () => downloadCsv('stock-levels.csv', rows, [
    { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'on_hand', label: 'On hand' },
    { key: 'unit_price', label: 'Unit price' }, { key: 'stock_value', label: 'Value' }, { key: 'last_movement', label: 'Last movement' },
  ])

  return (
    <Page
      title="Stock"
      subtitle="On-hand quantities are calculated from every IN, OUT, opening and adjustment movement."
      actions={<>
        {can('inventory.manage') && <button className="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : 'Record movement'}</button>}
        {can('inventory.manage') && <Link className="button" to="/inventory/items/new">New product</Link>}
        <button onClick={exportCsv}>Export CSV</button>
      </>}
    >
      {showForm && (
        <Card title="Record a stock movement">
          <MovementForm items={items.data} locations={lookups.data?.locations} onSaved={stock.reload} />
        </Card>
      )}
      <Card>
        <div className="filters">
          <input type="search" placeholder="Search product" value={f.q} onChange={set('q')} aria-label="Search product" />
          <select value={f.category} onChange={set('category')} aria-label="Category">
            <option value="">All categories</option><option value="BUNDLE">Bundles</option><option value="CLOSURE">Closures</option>
          </select>
          <select value={f.draw} onChange={set('draw')} aria-label="Draw">
            <option value="">SD + DD</option><option value="SD">Single drawn</option><option value="DD">Double drawn</option>
          </select>
          <select value={f.style} onChange={set('style')} aria-label="Texture">
            <option value="">All textures</option>
            {lookups.data?.styles.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <label><input type="checkbox" checked={f.inStock} onChange={set('inStock')} /> Hide zero stock</label>
          <label><input type="checkbox" checked={f.low} onChange={set('low')} /> Low stock</label>
          <label><input type="checkbox" checked={f.negative} onChange={set('negative')} /> Negative</label>
          <label><input type="checkbox" checked={f.inactive} onChange={set('inactive')} /> Include inactive</label>
        </div>
        <Alert>{stock.error}</Alert>
        {unpriced > 0 && <Alert kind="warning">{unpriced} product(s) shown have stock but no price; their value counts as ₱0.</Alert>}
        {stock.loading ? <Loading /> : (
          <Table
            rowKey="item_id"
            onRowClick={(r) => navigate(`/inventory/items/${r.item_id}`)}
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'sku', label: 'SKU', render: (r) => <span className="muted small">{r.sku}</span> },
              { key: 'on_hand', label: 'On hand', num: true, render: (r) => <span style={{ color: r.on_hand < 0 ? 'var(--red)' : undefined }}>{qty(r.on_hand)}</span> },
              { key: 'reorder_level', label: 'Reorder at', num: true, render: (r) => (r.reorder_level ? r.reorder_level : '—') },
              { key: 'unit_price', label: 'Unit price', num: true, render: (r) => money(r.unit_price) },
              { key: 'stock_value', label: 'Value', num: true, render: (r) => money(r.stock_value) },
              { key: 'last_movement', label: 'Last movement', render: (r) => date(r.last_movement) },
            ]}
            rows={rows}
            footer={<>
              <td colSpan={2}>{rows.length} products</td>
              <td className="num">{qty(totalUnits)}</td><td /><td />
              <td className="num">{money(totalValue)}</td><td />
            </>}
          />
        )}
      </Card>
    </Page>
  )
}
