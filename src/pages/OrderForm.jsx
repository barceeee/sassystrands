import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLoad, loadItems } from '../lib/data.js'
import { Page, Card, Field, ItemPicker, ActionResult, useAction } from '../components/ui.jsx'
import { today } from '../lib/format.js'

export default function OrderForm() {
  const navigate = useNavigate()
  const items = useLoad(loadItems, [])
  const clients = useLoad(() => must(supabase.from('clients').select('id, name').order('name')), [])
  const [f, setF] = useState({ client_id: '', new_client: '', order_date: today(), order_no: '', notes: '' })
  const [lines, setLines] = useState([{ item: null, qty: '', group_label: '' }])
  const action = useAction()

  const submit = async (e) => {
    e.preventDefault()
    const order = await action.run(async () => {
      let clientId = f.client_id ? Number(f.client_id) : null
      if (!clientId) {
        const name = f.new_client.trim().toUpperCase()
        const existing = (clients.data ?? []).find((c) => c.name.toUpperCase() === name)
        clientId = existing?.id ?? (await must(supabase.from('clients').insert({ name }).select('id').single())).id
      }
      const o = await must(supabase.from('orders').insert({
        client_id: clientId, order_date: f.order_date || null, order_no: f.order_no.trim() || null, notes: f.notes || null,
      }).select('id').single())
      await must(supabase.from('order_lines').insert(lines.filter((l) => l.item && Number(l.qty) > 0).map((l) => ({
        order_id: o.id, item_id: l.item, qty_ordered: Number(l.qty), group_label: l.group_label.trim() || null,
      }))))
      return o
    })
    if (order?.id) navigate(`/orders/${order.id}`)
  }

  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <Page title="New client order">
      <Card>
        <form className="form" onSubmit={submit}>
          <Field label="Existing client">
            <select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
              <option value="">— new client —</option>
              {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {!f.client_id && <Field label="New client name"><input value={f.new_client} onChange={(e) => setF({ ...f, new_client: e.target.value })} required /></Field>}
          <Field label="Order date"><input type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} /></Field>
          <Field label="Order no." hint="Leave blank to number automatically (SO-00001)"><input value={f.order_no} onChange={(e) => setF({ ...f, order_no: e.target.value })} /></Field>
          <Field label="Notes" wide><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <h2 className="wide">Lines</h2>
          {lines.map((l, i) => (
            <div key={i} className="wide form" style={{ gridTemplateColumns: '3fr 1fr 1.5fr auto' }}>
              <Field label={`Product ${i + 1}`}><ItemPicker items={items.data} value={l.item} onChange={(v) => setLine(i, { item: v })} /></Field>
              <Field label="Qty"><input type="number" min="1" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
              <Field label="Group (optional)" hint="e.g. SAMBIA"><input value={l.group_label} onChange={(e) => setLine(i, { group_label: e.target.value })} /></Field>
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>Remove</button>
            </div>
          ))}
          <div className="form-actions">
            <button type="button" onClick={() => setLines([...lines, { item: null, qty: '', group_label: lines.at(-1)?.group_label ?? '' }])}>Add line</button>
            <button className="primary" disabled={action.busy || !lines.some((l) => l.item && Number(l.qty) > 0)}>Create order</button>
          </div>
          <div className="wide"><ActionResult action={action} /></div>
        </form>
      </Card>
    </Page>
  )
}
