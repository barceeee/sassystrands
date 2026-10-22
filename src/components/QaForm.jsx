import { useState } from 'react'
import { rpc } from '../supabase.js'
import { Field, ActionResult, useAction } from './ui.jsx'

// Approve / reject a record that is awaiting QA. Passed units move to Ready, rejected units
// are split off into "QA rejected – rework" for production to fix.
export default function QaForm({ record, onSaved }) {
  const [f, setF] = useState({ passed: String(record.qty), rejected: '0', defects: '', note: '' })
  const action = useAction()
  const passed = Number(f.passed || 0), rejected = Number(f.rejected || 0)
  const left = record.qty - passed - rejected

  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => rpc('record_qa_inspection', {
      p_id: record.id, p_passed: passed, p_rejected: rejected, p_defects: f.defects || null, p_note: f.note || null,
    }), 'Inspection recorded.')
    if (ok) onSaved?.()
  }
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Passed (approve)"><input type="number" min="0" max={record.qty} step="1" value={f.passed} onChange={(e) => setF({ ...f, passed: e.target.value })} /></Field>
      <Field label="Rejected"><input type="number" min="0" max={record.qty} step="1" value={f.rejected} onChange={(e) => setF({ ...f, rejected: e.target.value })} /></Field>
      <Field label={rejected > 0 ? 'Defects (required)' : 'Defects'} wide>
        <input value={f.defects} onChange={(e) => setF({ ...f, defects: e.target.value })} required={rejected > 0} placeholder="e.g. shedding, uneven weft, lace tear" />
      </Field>
      <Field label="Note" wide><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="form-actions">
        <button className="primary" disabled={action.busy || passed + rejected === 0 || left < 0}>Record inspection</button>
        <span className="muted small">{left < 0 ? `Only ${record.qty} units in this record.` : left > 0 ? `${left} unit(s) stay awaiting QA.` : 'All units inspected.'}</span>
      </div>
      <div className="wide"><ActionResult action={action} /></div>
    </form>
  )
}
