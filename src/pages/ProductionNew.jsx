import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useLoad, useLookups, loadItems } from '../lib/data.js'
import { Page, Card, Field, ItemPicker, ActionResult, useAction, Loading } from '../components/ui.jsx'

export default function ProductionNew() {
  const navigate = useNavigate()
  const lookups = useLookups()
  const items = useLoad(loadItems, [])
  const lines = useLoad(() => must(supabase.rpc('open_order_lines_for_production')), [])
  const [f, setF] = useState({ for: 'order', line: '', item: null, qty: '', stage: 'ALLOCATED', notes: '' })
  const action = useAction()
  const line = (lines.data ?? []).find((l) => l.order_line_id === Number(f.line))

  const submit = async (e) => {
    e.preventDefault()
    const id = await action.run(() => rpc('create_production_record', {
      p_item_id: f.for === 'order' ? line?.item_id : f.item,
      p_qty: Number(f.qty),
      p_order_line_id: f.for === 'order' ? Number(f.line) : null,
      p_stage: f.stage,
      p_notes: f.notes || null,
    }))
    if (typeof id === 'number') navigate(`/production/${id}`)
  }

  if (!lookups.data) return <Loading />
  return (
    <Page title="New production record">
      <Card>
        <form className="form" onSubmit={submit}>
          <Field label="Produce for">
            <select value={f.for} onChange={(e) => setF({ ...f, for: e.target.value })}>
              <option value="order">A client order</option>
              <option value="stock">Stock (no client yet)</option>
            </select>
          </Field>
          {f.for === 'order' ? (
            <Field label="Order line" wide hint={lines.data && lines.data.length === 0 ? 'No open order lines with units left to allocate.' : null}>
              <select value={f.line} onChange={(e) => { const l = lines.data.find((x) => x.order_line_id === Number(e.target.value)); setF({ ...f, line: e.target.value, qty: l?.remaining ?? '' }) }} required>
                <option value="">— choose —</option>
                {(lines.data ?? []).map((l) => (
                  <option key={l.order_line_id} value={l.order_line_id}>{l.client_name} · {l.order_no} · {l.item_name} · {l.remaining} left</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Product" wide><ItemPicker items={items.data} value={f.item} onChange={(v) => setF({ ...f, item: v })} required /></Field>
          )}
          <Field label="Quantity"><input type="number" min="1" max={line?.remaining} step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required /></Field>
          <Field label="Starting stage">
            <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
              {lookups.data.stages.filter((s) => s.production_can_set).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Notes" wide><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="form-actions"><button className="primary" disabled={action.busy}>Create</button></div>
          <div className="wide"><ActionResult action={action} /></div>
        </form>
      </Card>
    </Page>
  )
}
