import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLookups } from '../lib/data.js'
import { Page, Card, Field, ActionResult, useAction, Loading } from '../components/ui.jsx'

// New product. Products are defined by controlled values, so "DD Manila Curls 16"" can only exist once.
export default function ItemForm() {
  const navigate = useNavigate()
  const lookups = useLookups()
  const action = useAction()
  const [f, setF] = useState({ category: 'BUNDLE', draw: 'DD', style: '', lace_type: 'TRANSPARENT', lace_size: '5X5', length_in: '', variant: '', unit_price: '', reorder_level: '0' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const L = lookups.data

  const submit = async (e) => {
    e.preventDefault()
    const bundle = f.category === 'BUNDLE'
    const row = {
      category: f.category,
      draw: bundle ? f.draw : null,
      style: f.style,
      lace_type: bundle ? null : f.lace_type,
      lace_size: bundle ? null : f.lace_size,
      length_in: Number(f.length_in),
      variant: f.variant.trim().toUpperCase(),
      unit_price: f.unit_price === '' ? null : Number(f.unit_price),
      reorder_level: Number(f.reorder_level || 0),
    }
    const created = await action.run(async () => {
      const data = await must(supabase.from('items').insert(row).select('id').single())
      return data
    })
    if (created?.id) navigate(`/inventory/items/${created.id}`)
  }

  if (!L) return <Loading />
  return (
    <Page title="New product">
      <Card>
        <form className="form" onSubmit={submit}>
          <Field label="Category">
            <select value={f.category} onChange={set('category')}><option value="BUNDLE">Wefted bundle</option><option value="CLOSURE">Closure</option></select>
          </Field>
          {f.category === 'BUNDLE' ? (
            <Field label="Draw">
              <select value={f.draw} onChange={set('draw')}><option value="SD">Single drawn (SD)</option><option value="DD">Double drawn (DD)</option></select>
            </Field>
          ) : (<>
            <Field label="Lace">
              <select value={f.lace_type} onChange={set('lace_type')}>{L.laceTypes.filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select>
            </Field>
            <Field label="Lace size">
              <select value={f.lace_size} onChange={set('lace_size')}>{L.laceSizes.filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select>
            </Field>
          </>)}
          <Field label="Texture / style">
            <select value={f.style} onChange={set('style')} required>
              <option value="">— choose —</option>
              {L.styles.filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="Length (inches)"><input type="number" min="1" max="40" step="1" value={f.length_in} onChange={set('length_in')} required /></Field>
          <Field label="Variant" hint="Optional, e.g. BROWN, BULK, JETBLACK"><input value={f.variant} onChange={set('variant')} /></Field>
          <Field label="Unit price (₱)"><input type="number" min="0" step="0.01" value={f.unit_price} onChange={set('unit_price')} /></Field>
          <Field label="Reorder level" hint="Warn when stock is at or below this"><input type="number" min="0" step="1" value={f.reorder_level} onChange={set('reorder_level')} /></Field>
          <div className="form-actions"><button className="primary" disabled={action.busy}>Create product</button></div>
          <div className="wide"><ActionResult action={action} /></div>
        </form>
      </Card>
    </Page>
  )
}
