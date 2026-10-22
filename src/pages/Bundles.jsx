import { useState } from 'react'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, loadItems } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, Field, ItemPicker, ActionResult, useAction } from '../components/ui.jsx'
import { money, date, today } from '../lib/format.js'

// Pre-packed "for sale" bundles (SSKB codes). Kept separate from stock balances: see README assumptions.
export default function Bundles() {
  const { can } = useAuth()
  const bundles = useLoad(() => must(supabase.from('v_sale_bundles').select('*').order('code')), [])
  const items = useLoad(loadItems, [])
  const [status, setStatus] = useState('AVAILABLE')
  const action = useAction()
  const rows = (bundles.data ?? [])
    .filter((b) => !status || b.status === status)
    .sort((a, b) => (Number(a.code.replace(/\D/g, '')) || 0) - (Number(b.code.replace(/\D/g, '')) || 0))
  const available = (bundles.data ?? []).filter((b) => b.status === 'AVAILABLE')

  const toggle = (b) => action.run(async () => {
    const sold = b.status === 'AVAILABLE'
    await must(supabase.from('sale_bundles').update({ status: sold ? 'SOLD' : 'AVAILABLE', sold_on: sold ? today() : null }).eq('id', b.id))
    bundles.reload()
  }, `${b.code} updated.`)

  return (
    <Page title="Sale bundles" subtitle={`${available.length} available · ${money(available.reduce((t, b) => t + Number(b.price ?? 0), 0))} total asking price`}>
      {can('inventory.manage') && <NewBundle items={items.data} onSaved={bundles.reload} />}
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="AVAILABLE">Available</option><option value="SOLD">Sold</option><option value="">All</option>
          </select>
        </div>
        <ActionResult action={action} />
        <Alert>{bundles.error}</Alert>
        {bundles.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'contents', label: 'Contents', render: (b) => b.contents ?? <span className="muted">{b.note ?? '—'}</span> },
              { key: 'total_qty', label: 'Pieces', num: true },
              { key: 'price', label: 'Price', num: true, render: (b) => money(b.price) },
              { key: 'status', label: 'Status', render: (b) => <><Badge value={b.status} />{b.sold_on && <div className="muted small">{date(b.sold_on)}</div>}</> },
              { key: 'act', label: '', render: (b) => can('inventory.manage') && <button className="small" disabled={action.busy} onClick={() => toggle(b)}>{b.status === 'AVAILABLE' ? 'Mark sold' : 'Mark available'}</button> },
            ]}
            rows={rows}
          />
        )}
      </Card>
    </Page>
  )
}

function NewBundle({ items, onSaved }) {
  const [code, setCode] = useState('SSKB#')
  const [price, setPrice] = useState('')
  const [lines, setLines] = useState([{ item: null, qty: 1 }])
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(async () => {
      const b = await must(supabase.from('sale_bundles').insert({ code: code.trim().toUpperCase(), price: price === '' ? null : Number(price) }).select('id').single())
      await must(supabase.from('sale_bundle_items').insert(lines.filter((l) => l.item).map((l) => ({ bundle_id: b.id, item_id: l.item, qty: Number(l.qty) }))))
    }, 'Bundle created.')
    if (ok) { setCode('SSKB#'); setPrice(''); setLines([{ item: null, qty: 1 }]); onSaved() }
  }
  return (
    <Card title="New sale bundle">
      <form className="form" onSubmit={submit}>
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} required pattern=".*\d.*" /></Field>
        <Field label="Bundle price (₱)"><input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        {lines.map((l, i) => (
          <div key={i} className="wide form" style={{ gridTemplateColumns: '3fr 1fr auto' }}>
            <Field label={`Product ${i + 1}`}><ItemPicker items={items} value={l.item} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, item: v } : x)))} /></Field>
            <Field label="Qty"><input type="number" min="1" step="1" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></Field>
            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>Remove</button>
          </div>
        ))}
        <div className="form-actions">
          <button type="button" onClick={() => setLines([...lines, { item: null, qty: 1 }])}>Add product</button>
          <button className="primary" disabled={action.busy || !lines.some((l) => l.item)}>Create bundle</button>
        </div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
