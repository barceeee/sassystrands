import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useLookups, loadItems, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Field, ItemPicker, ActionResult, useAction, Badge } from '../components/ui.jsx'
import { date, today, money } from '../lib/format.js'

const SOURCES = {
  AUDIT: 'Physical audit (e.g. BEGINNING AUDIT column)',
  SNAPSHOT: 'Closure sheet snapshot',
  LEDGER: 'Available-stocks ledger line',
  MANUAL: 'Count entered here',
}

// Counts never change stock by themselves. Each shows the computed balance on its date and the
// variance; "Post adjustment" turns a verified count into an ADJUST movement.
export default function Counts() {
  const { can } = useAuth()
  const lookups = useLookups()
  const items = useLoad(loadItems, [])
  const counts = useLoad(() => fetchAll(() => supabase.from('v_count_variance').select('*').order('count_date', { ascending: false }).order('id')), [])
  const [f, setF] = useState({ source: '', label: '', onlyVariance: true, q: '' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const apply = useAction()

  const labels = useMemo(() => [...new Set((counts.data ?? []).map((c) => c.source_label).filter(Boolean))].sort(), [counts.data])
  const rows = (counts.data ?? []).filter((c) =>
    (!f.source || c.source === f.source) && (!f.label || c.source_label === f.label) &&
    (!f.onlyVariance || c.variance !== 0) && (!f.q || c.item_name.toLowerCase().includes(f.q.toLowerCase())))

  const post = (c) => {
    if (!window.confirm(`Post an adjustment of ${c.variance > 0 ? '+' : ''}${c.variance} for ${c.item_name} dated ${c.count_date}?`)) return
    apply.run(async () => { await rpc('apply_count', { p_count_id: c.id }); counts.reload() }, 'Adjustment posted.')
  }

  return (
    <Page title="Counts & audit" subtitle="Compare physical counts and spreadsheet snapshots with the balance calculated from movements.">
      {can('inventory.manage') && <NewCount items={items.data} locations={lookups.data?.locations} onSaved={counts.reload} />}
      <Card>
        <div className="filters">
          <select value={f.source} onChange={set('source')} aria-label="Source">
            <option value="">All sources</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={f.label} onChange={set('label')} aria-label="Sheet">
            <option value="">All sheets / labels</option>
            {labels.map((l) => <option key={l}>{l}</option>)}
          </select>
          <input type="search" placeholder="Product" value={f.q} onChange={set('q')} />
          <label><input type="checkbox" checked={f.onlyVariance} onChange={set('onlyVariance')} /> Only rows with a variance</label>
        </div>
        <ActionResult action={apply} />
        <Alert>{counts.error}</Alert>
        {counts.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'count_date', label: 'Date', render: (c) => date(c.count_date) },
              { key: 'item_name', label: 'Product', render: (c) => <Link to={`/inventory/items/${c.item_id}`}>{c.item_name}</Link> },
              { key: 'source', label: 'Source', render: (c) => <>{c.source}<div className="muted small">{c.source_label}</div></> },
              { key: 'counted_qty', label: 'Counted', num: true },
              { key: 'computed_qty', label: 'Computed', num: true },
              { key: 'variance', label: 'Variance', num: true, render: (c) => <b style={{ color: c.variance ? 'var(--amber)' : undefined }}>{c.variance > 0 ? `+${c.variance}` : c.variance}</b> },
              { key: 'unit_price', label: 'Sheet price', num: true, render: (c) => money(c.unit_price) },
              {
                key: 'act', label: '', render: (c) => c.adjustment_id ? <Badge value="APPROVED" label="Adjusted" />
                  : can('inventory.manage') && c.variance !== 0 ? <button className="small" disabled={apply.busy} onClick={() => post(c)}>Post adjustment</button> : null,
              },
            ]}
            rows={rows}
            empty="No counts match."
          />
        )}
      </Card>
    </Page>
  )
}

function NewCount({ items, locations, onSaved }) {
  const [f, setF] = useState({ item: null, qty: '', date: today(), location: 'HQ', note: '' })
  const action = useAction()
  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => must(supabase.from('stock_counts').insert({
      item_id: f.item, counted_qty: Number(f.qty), count_date: f.date, location: f.location, source: 'MANUAL', source_label: 'Manual count', note: f.note || null,
    })), 'Count saved. Review the variance below.')
    if (ok) { setF((x) => ({ ...x, qty: '', note: '' })); onSaved() }
  }
  return (
    <Card title="Enter a physical count">
      <form className="form" onSubmit={submit}>
        <Field label="Product" wide><ItemPicker items={items} value={f.item} onChange={(v) => setF({ ...f, item: v })} required /></Field>
        <Field label="Counted quantity"><input type="number" min="0" step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required /></Field>
        <Field label="Count date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="Location">
          <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
            {(locations ?? []).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="form-actions"><button className="primary" disabled={action.busy || !f.item}>Save count</button></div>
        <div className="wide"><ActionResult action={action} /></div>
      </form>
    </Card>
  )
}
