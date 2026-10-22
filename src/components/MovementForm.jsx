import { useState } from 'react'
import { rpc } from '../supabase.js'
import { Field, ItemPicker, ActionResult, useAction } from './ui.jsx'
import { today } from '../lib/format.js'

const TYPES = [
  { value: 'IN', label: 'IN — stock received' },
  { value: 'OUT', label: 'OUT — stock released' },
  { value: 'ADJUST', label: 'ADJUST — correction (+/−)' },
  { value: 'OPENING', label: 'OPENING — opening balance' },
]

// Records one stock movement through record_movement(), which rejects OUTs larger than the balance.
export default function MovementForm({ items, locations, itemId, onSaved }) {
  const [form, setForm] = useState({ item: itemId ?? null, type: 'IN', qty: '', date: today(), location: 'HQ', reference: '', note: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const action = useAction()

  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => rpc('record_movement', {
      p_item_id: form.item, p_type: form.type, p_qty: Number(form.qty), p_date: form.date,
      p_location: form.location, p_reference: form.reference || null, p_note: form.note || null,
    }), 'Movement saved.')
    if (ok) {
      setForm((f) => ({ ...f, qty: '', reference: '', note: '' }))
      onSaved?.()
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {!itemId && (
        <Field label="Product" wide>
          <ItemPicker items={items} value={form.item} onChange={set('item')} required />
        </Field>
      )}
      <Field label="Type">
        <select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </Field>
      <Field label="Quantity" hint={form.type === 'ADJUST' ? 'Use a minus sign to reduce stock' : null}>
        <input type="number" step="1" min={form.type === 'ADJUST' ? undefined : 1} value={form.qty} onChange={set('qty')} required />
      </Field>
      <Field label="Date"><input type="date" value={form.date} onChange={set('date')} required /></Field>
      <Field label="Location">
        <select value={form.location} onChange={set('location')}>
          {(locations ?? []).filter((l) => l.active).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Field>
      <Field label="Reference" hint="Order no., OR no., supplier, etc."><input value={form.reference} onChange={set('reference')} /></Field>
      <Field label={form.type === 'ADJUST' ? 'Reason (required)' : 'Note'} wide>
        <input value={form.note} onChange={set('note')} required={form.type === 'ADJUST'} />
      </Field>
      <div className="form-actions">
        <button className="primary" disabled={action.busy || !form.item}>{action.busy ? 'Saving…' : 'Save movement'}</button>
      </div>
      <div className="wide"><ActionResult action={action} /></div>
    </form>
  )
}
