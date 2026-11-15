import { useEffect, useState } from 'react'
import { rpc } from '../supabase.js'
import { titleCase } from '../lib/format.js'
import { Alert, Field, useAction } from './ui.jsx'
import Modal from './Modal.jsx'

// Stages a leader can move a piece back to (mirrors leader_fix).
export const FIX_STAGES = ['RECEIVED', 'RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA']

// Team leader's "Fix a wrong scan": move `piece` ({ serial, stage }) to another stage with a reason.
// Open while `piece` is set; onDone(message) runs after a successful move.
export default function FixPieceModal({ piece, stageLabel = {}, onClose, onDone }) {
  const action = useAction()
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!piece) return
    setTo(FIX_STAGES.find((s) => s !== piece.stage)); setReason('')
    action.setError(null); action.setDone(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.serial])

  const submit = async (e) => {
    e.preventDefault()
    const ok = await action.run(() => rpc('leader_fix', { p_serial: piece.serial, p_to_stage: to, p_reason: reason }))
    if (ok) onDone?.(`${piece.serial} moved to ${stageLabel[to] ?? titleCase(to)}.`)
  }

  return (
    <Modal
      open={!!piece}
      onClose={onClose}
      title={piece ? `Fix ${piece.serial}` : 'Fix'}
      footer={<>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" form="fix-form" className="primary" disabled={action.busy}>Move piece</button>
      </>}
    >
      {piece && (
        <form id="fix-form" onSubmit={submit} className="form">
          <Alert>{action.error}</Alert>
          <Field label="Move to">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {FIX_STAGES.map((s) => <option key={s} value={s}>{stageLabel[s] ?? titleCase(s)}</option>)}
            </select>
          </Field>
          <Field label="Reason" hint="Required. Recorded with the fix." wide>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
          </Field>
        </form>
      )}
    </Modal>
  )
}
