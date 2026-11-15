import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, rpc } from '../../supabase.js'
import { useAuth } from '../../auth.jsx'
import { useLoad, useLookups, fetchAll } from '../../lib/data.js'
import { SCAN_MAX_MS, createScanGate, isSubmitKey, normaliseSerial } from '../../lib/scan.js'
import CameraScanner from '../../components/CameraScanner.jsx'
import './Station.css'

const SLOW_MESSAGE = 'Please scan the barcode.'
// A gap this short after a discarded burst still looks like a person typing (not a stray key long ago).
const TYPING_GAP_MS = 2000
const LOG_SIZE = 10
const DEFECTS = ['Shedding', 'Uneven weft', 'Lace tear', 'Colour mismatch', 'Other']

function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = ok ? 880 : 220
    g.gain.value = 0.08
    o.connect(g).connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.35))
    o.onended = () => ctx.close()
  } catch { /* no audio available */ }
}

const isEditable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')

export default function Scanner() {
  const { profile, role } = useAuth()
  const lookups = useLookups()
  const station = profile?.station
  const stationLabel = lookups.data?.stageLabel?.[station] ?? station ?? 'No station'
  const isQaStation = station === 'FOR_QA'

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text, piece }
  const [log, setLog] = useState([])
  const [camera, setCamera] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [qa, setQa] = useState(null) // { serial, rejecting }
  const [defect, setDefect] = useState(DEFECTS[0])
  const [defectNote, setDefectNote] = useState('')
  const [manual, setManual] = useState('')
  const capture = useRef(null)
  const gate = useRef(createScanGate())
  const lastKeyAt = useRef(0)
  const tainted = useRef(false)
  const busyRef = useRef(false)

  // QA station: every piece still waiting for Pass / Reject, so none is stranded by a second scan or a reload.
  const waiting = useLoad(async () => {
    if (!isQaStation) return []
    const rows = await fetchAll(() => supabase.rpc('piece_board', { p_stage: 'FOR_QA' }))
    return rows.filter((p) => p.status === 'ACTIVE')
  }, [isQaStation])
  const reloadWaiting = waiting.reload
  const openQa = (serial) => setQa((cur) => (cur?.serial === serial ? cur : { serial, rejecting: false }))
  // A different piece starts with a clean defect form.
  const qaSerial = qa?.serial
  useEffect(() => { setDefectNote(''); setDefect(DEFECTS[0]) }, [qaSerial])

  const focusCapture = useCallback(() => capture.current?.focus({ preventScroll: true }), [])
  const resetGate = useCallback(() => { gate.current.reset(); tainted.current = false; lastKeyAt.current = 0 }, [])

  const record = useCallback((entry) => setLog((l) => [{ at: new Date(), ...entry }, ...l].slice(0, LOG_SIZE)), [])

  const send = useCallback(async (serial, method) => {
    if (!serial || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const piece = await rpc('station_scan', { p_serial: serial, p_method: method })
      const text = piece.already_here ? 'Already at the QA station: record the result' : piece.stage_label
      setResult({ ok: true, piece, text })
      record({ serial: piece.serial ?? serial, ok: true, text: piece.already_here ? text : [piece.item_name, piece.order_no].filter(Boolean).join(' · ') || piece.stage_label })
      if (piece.stage === 'FOR_QA') {
        setQa((cur) => (cur?.serial === piece.serial ? cur : { serial: piece.serial ?? serial, rejecting: false }))
        reloadWaiting()
      }
      beep(true)
    } catch (err) {
      setResult({ ok: false, text: err.message })
      record({ serial, ok: false, text: err.message })
      beep(false)
    } finally {
      busyRef.current = false; setBusy(false); focusCapture()
    }
  }, [record, focusCapture, reloadWaiting])

  const refuseSlow = useCallback(() => {
    setResult({ ok: false, text: SLOW_MESSAGE })
    beep(false)
  }, [])

  // Hardware scanners type like a keyboard: collect keys, submit on Enter/Tab, accept only at scanner speed.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditable(e.target) && e.target !== capture.current) return // manual field, defect note, etc.
      const g = gate.current
      if (isSubmitKey(e.key)) {
        if (lastKeyAt.current === 0) return // nothing typed: let Enter/Tab act normally
        e.preventDefault()
        const slowTyped = tainted.current
        const r = g.submit()
        resetGate()
        if (slowTyped) return refuseSlow()
        if (!r || !r.code) return
        if (!r.scanned) return refuseSlow()
        send(r.code, 'scanner')
        return
      }
      if (e.key.length !== 1 || e.key === ' ') return // only single printable characters feed the gate (Space stays a button press)
      const now = performance.now()
      if (lastKeyAt.current !== 0 && now - lastKeyAt.current > SCAN_MAX_MS) {
        // A pause mid-code: drop what was collected so a stray key cannot poison the next scan.
        // A short pause means a person is typing, so the eventual Enter must be refused.
        tainted.current = now - lastKeyAt.current <= TYPING_GAP_MS
        g.reset()
      }
      lastKeyAt.current = now
      g.key(e.key)
      e.preventDefault()
    }
    const onFocus = () => { resetGate(); focusCapture() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('focus', onFocus)
    focusCapture()
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('focus', onFocus) }
  }, [send, refuseSlow, resetGate, focusCapture])

  const onBlur = () => setTimeout(() => {
    const a = document.activeElement
    if (!a || a === document.body) focusCapture()
  }, 0)

  const submitQa = async (passed) => {
    if (!qa || busyRef.current) return
    let defects = null
    if (!passed) {
      const note = defectNote.trim()
      if (defect === 'Other' && !note) { setResult({ ok: false, text: 'Describe the defect when you choose Other.' }); return }
      defects = defect === 'Other' ? note : note ? `${defect}: ${note}` : defect
    }
    busyRef.current = true; setBusy(true)
    try {
      const piece = await rpc('qa_result', { p_serial: qa.serial, p_passed: passed, p_defects: defects })
      setResult({ ok: true, piece, text: passed ? 'Passed: Ready' : 'Rejected' })
      record({ serial: qa.serial, ok: true, text: passed ? 'QA passed' : `QA rejected: ${defects}` })
      setQa(null)
      reloadWaiting()
      beep(true)
    } catch (err) {
      setResult({ ok: false, text: err.message })
      beep(false)
    } finally {
      busyRef.current = false; setBusy(false); focusCapture()
    }
  }

  const onCameraCode = useCallback((raw) => { send(normaliseSerial(raw), 'camera') }, [send])
  const onCameraError = useCallback((msg) => { setCamera(false); setCameraError(msg) }, [])
  const toggleCamera = () => { setCameraError(null); setCamera((c) => !c); focusCapture() }

  const submitManual = (e) => {
    e.preventDefault()
    const serial = normaliseSerial(manual)
    if (!serial) return
    setManual('')
    send(serial, 'manual')
  }

  const piece = result?.piece
  return (
    <div className="scanner">
      <h1 className="scanner-station">{stationLabel}</h1>

      <input
        ref={capture}
        className="scan-capture"
        onBlur={onBlur}
        readOnly
        inputMode="none"
        tabIndex={-1}
        autoComplete="off"
        aria-label="Barcode scanner input"
      />

      <p className="scanner-hint">Scan a piece's barcode with the scanner{camera ? '' : ' or use the camera'}.</p>

      <div className="scanner-actions">
        <button className="primary big" onClick={toggleCamera}>{camera ? 'Close camera' : 'Use camera'}</button>
      </div>
      {cameraError && <div className="scan-result err" role="alert">{cameraError}</div>}
      {camera && <CameraScanner onCode={onCameraCode} onError={onCameraError} />}

      {result && (
        <div className={`scan-result ${result.ok ? 'ok' : 'err'}`} role={result.ok ? 'status' : 'alert'}>
          <div className="scan-result-main">{result.text}</div>
          {piece && (
            <div className="scan-result-detail">
              <b>{piece.serial}</b>
              {piece.item_name && <span>{piece.item_name}</span>}
              {piece.order_no && <span>Order {piece.order_no}{piece.client_name ? ` · ${piece.client_name}` : ''}</span>}
            </div>
          )}
        </div>
      )}

      {isQaStation && qa && (
        <div className="qa-panel">
          <h2 className="qa-for">Result for <code>{qa.serial}</code></h2>
          <div className="qa-buttons">
            <button className="primary big" disabled={busy} onClick={() => submitQa(true)}>Pass</button>
            <button className="danger big" disabled={busy} onClick={() => setQa({ ...qa, rejecting: !qa.rejecting })}>Reject</button>
          </div>
          {qa.rejecting && (
            <div className="qa-defects">
              <label className="field"><span>Defect</span>
                <select value={defect} onChange={(e) => setDefect(e.target.value)}>
                  {DEFECTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="field"><span>{defect === 'Other' ? 'Describe the defect' : 'Note (optional)'}</span>
                <input value={defectNote} onChange={(e) => setDefectNote(e.target.value)} autoComplete="off" />
              </label>
              <button className="danger big" disabled={busy} onClick={() => submitQa(false)}>Confirm reject</button>
            </div>
          )}
        </div>
      )}

      {isQaStation && (
        <section className="qa-waiting">
          <h2>Waiting for a result{waiting.data ? ` (${waiting.data.length})` : ''}</h2>
          {waiting.error && <p className="scan-result err" role="alert">{waiting.error}</p>}
          {waiting.data?.length === 0 ? <p className="muted">No pieces waiting at QA.</p> : (
            <ul>
              {(waiting.data ?? []).map((p) => (
                <li key={p.id}>
                  <button type="button" className={qa?.serial === p.serial ? 'primary' : ''} aria-pressed={qa?.serial === p.serial} disabled={busy} onClick={() => openQa(p.serial)}>
                    <code>{p.serial}</code>
                    {(p.item_name || p.order_no) && <span>{[p.item_name, p.order_no].filter(Boolean).join(' · ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {role === 'LEADER' && (
        <form className="scanner-manual" onSubmit={submitManual}>
          <label className="field"><span>Enter serial manually (damaged label)</span>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="SS-000001" autoComplete="off" spellCheck={false} />
          </label>
          <button disabled={busy || !manual.trim()}>Scan serial</button>
        </form>
      )}

      <section className="scan-recent">
        <h2>Recent scans</h2>
        {log.length === 0 ? <p className="muted">No scans yet.</p> : (
          <ul>
            {log.map((x, i) => (
              <li key={i} className={x.ok ? 'ok' : 'err'}>
                <code>{x.serial}</code><span>{x.text}</span>
                <span className="muted small">{x.at.toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
