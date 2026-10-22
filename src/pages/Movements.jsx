import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, useStaff, loadItems, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge } from '../components/ui.jsx'
import MovementForm from '../components/MovementForm.jsx'
import { date, dateTime, qty, downloadCsv } from '../lib/format.js'

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA') }

export default function Movements() {
  const { can } = useAuth()
  const staff = useStaff()
  const lookups = useLookups()
  const items = useLoad(loadItems, [])
  const [f, setF] = useState({ from: monthStart(), to: '', type: '', q: '' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const moves = useLoad(() => fetchAll(() => {
    let q = supabase.from('v_movements').select('*').order('movement_date', { ascending: false }).order('id', { ascending: false })
    if (f.from) q = q.gte('movement_date', f.from)
    if (f.to) q = q.lte('movement_date', f.to)
    if (f.type) q = q.eq('movement_type', f.type)
    if (f.q) {
      const term = f.q.replace(/[%*,()."]/g, ' ').trim()
      if (term) q = q.or(`item_name.ilike.*${term}*,reference.ilike.*${term}*`)
    }
    return q
  }), [f.from, f.to, f.type, f.q])

  const rows = moves.data ?? []
  const sum = (t) => rows.filter((m) => m.movement_type === t).reduce((a, m) => a + m.qty, 0)

  return (
    <Page title="Stock movements" subtitle="Every change to stock, with who recorded it and when.">
      {can('inventory.manage') && (
        <Card title="Record a movement">
          <MovementForm items={items.data} locations={lookups.data?.locations} onSaved={moves.reload} />
        </Card>
      )}
      <Card>
        <div className="filters">
          <label>From <input type="date" value={f.from} onChange={set('from')} /></label>
          <label>To <input type="date" value={f.to} onChange={set('to')} /></label>
          <select value={f.type} onChange={set('type')} aria-label="Type">
            <option value="">All types</option>
            {['OPENING', 'IN', 'OUT', 'ADJUST'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="search" placeholder="Product or reference" value={f.q} onChange={set('q')} />
          <button onClick={() => downloadCsv('movements.csv', rows, [
            { key: 'movement_date', label: 'Date' }, { key: 'movement_type', label: 'Type' }, { key: 'sku', label: 'SKU' },
            { key: 'item_name', label: 'Product' }, { key: 'signed_qty', label: 'Qty' }, { key: 'location', label: 'Location' },
            { key: 'reference', label: 'Reference' }, { key: 'note', label: 'Note' },
            { label: 'Recorded by', value: (m) => staff[m.created_by] ?? (m.import_batch_id ? 'Import' : '') }, { key: 'created_at', label: 'Recorded at' },
          ])}>Export CSV</button>
        </div>
        <p className="muted small">In: {qty(sum('IN'))} · Out: {qty(sum('OUT'))} · Opening: {qty(sum('OPENING'))} · Adjustments (net): {qty(rows.filter((m) => m.movement_type === 'ADJUST').reduce((a, m) => a + m.qty, 0))}</p>
        <Alert>{moves.error}</Alert>
        {moves.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'movement_date', label: 'Date', render: (m) => date(m.movement_date) },
              { key: 'movement_type', label: 'Type', render: (m) => <Badge value={m.movement_type} /> },
              { key: 'item_name', label: 'Product', render: (m) => <Link to={`/inventory/items/${m.item_id}`}>{m.item_name}</Link> },
              { key: 'signed_qty', label: 'Qty', num: true, render: (m) => (m.signed_qty > 0 ? `+${m.signed_qty}` : m.signed_qty) },
              { key: 'location', label: 'Location' },
              { key: 'reference', label: 'Reference' },
              { key: 'note', label: 'Note', render: (m) => <>{m.note}{m.source_ref && <div className="muted small">{m.source_ref}</div>}</> },
              { key: 'created_by', label: 'Recorded', render: (m) => <>{staff[m.created_by] ?? (m.import_batch_id ? 'Import' : '—')}<div className="muted small">{dateTime(m.created_at)}</div></> },
            ]}
            rows={rows}
            empty="No movements in this period."
          />
        )}
      </Card>
    </Page>
  )
}
