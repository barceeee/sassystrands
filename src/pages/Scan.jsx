import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLookups } from '../lib/data.js'
import { Page, Card, Field, Loading, Alert, Badge } from '../components/ui.jsx'
import { dateTime } from '../lib/format.js'
import './Scan.css'

const STATION_KEY = 'scan.station'

// Station mode: pick what this station does once, then every scanned piece gets that action.
// The database applies the same rules as moving a record by hand (move_production / record_qa_inspection).
function stationOptions(stages, can) {
  const out = []
  if (can('production.manage')) {
    for (const s of stages.filter((s) => s.production_can_set)) out.push({ value: `MOVE:${s.code}`, label: `Move to ${s.label}`, group: 'Production' })
  }
  if (can('qa.manage')) {
    out.push({ value: 'QA:PASS', label: 'QA — approve (Ready)', group: 'QA' })
    out.push({ value: 'QA:FAIL', label: 'QA — reject (rework)', group: 'QA' })
  }
  if (can('inventory.manage')) {
    out.push({ value: 'MOVE:SHIPPED', label: 'Ship to client', group: 'Inventory' })
    out.push({ value: 'MOVE:IN_STOCK', label: 'Receive to stock', group: 'Inventory' })
  }
  return out
}

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

export default function Scan() {
  const { can } = useAuth()
  const lookups = useLookups()
  const options = useMemo(() => stationOptions(lookups.data?.stages ?? [], can), [lookups.data, can])
  const [station, setStation] = useState(() => { try { return localStorage.getItem(STATION_KEY) ?? '' } catch { return '' } })
  const [defects, setDefects] = useState('')
  const [location, setLocation] = useState('HQ')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [log, setLog] = useState([])
  const input = useRef(null)

  const valid = options.some((o) => o.value === station)
  useEffect(() => { try { localStorage.setItem(STATION_KEY, station) } catch { /* ignore */ } }, [station])
  useEffect(() => { if (valid) input.current?.focus() }, [valid, busy])

  const [kind, target] = station.split(':')
  const needsDefects = station === 'QA:FAIL'
  const stageLabel = lookups.data?.stageLabel ?? {}

  const submit = async (e) => {
    e.preventDefault()
    const serial = code.trim().toUpperCase()
    if (!serial || busy) return
    if (needsDefects && !defects.trim()) { setFlash({ ok: false, text: 'Describe the defects before scanning rejected pieces.' }); beep(false); return }
    setBusy(true); setCode('')
    try {
      const recId = kind === 'QA'
        ? await rpc('scan_qa_unit', { p_serial: serial, p_passed: target === 'PASS', p_defects: needsDefects ? defects.trim() : null })
        : await rpc('scan_move_unit', { p_serial: serial, p_to_stage: target, p_location: location })
      const rec = (await must(supabase.rpc('production_board', { p_id: recId })))[0]
      const text = `${serial} → ${rec?.stage_label ?? stageLabel[target] ?? target}`
      setFlash({ ok: true, text })
      setLog((l) => [{ at: new Date(), serial, ok: true, text: rec ? `${rec.item_name} · ${rec.record_no}` : '', stage: rec?.stage, stageText: rec?.stage_label, recId }, ...l].slice(0, 50))
      beep(true)
    } catch (err) {
      setFlash({ ok: false, text: `${serial}: ${err.message}` })
      setLog((l) => [{ at: new Date(), serial, ok: false, text: err.message }, ...l].slice(0, 50))
      beep(false)
    } finally {
      setBusy(false)
    }
  }

  if (lookups.loading) return <Loading />
  if (lookups.error) return <Alert>{lookups.error}</Alert>

  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <Page title="Scan pieces" subtitle="Choose your station once, then scan each piece's barcode.">
      <Card title="Station">
        <div className="form">
          <Field label="This station">
            <select value={valid ? station : ''} onChange={(e) => setStation(e.target.value)}>
              <option value="">— choose —</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          {needsDefects && (
            <Field label="Defects (required)" hint="Applied to every piece you scan as rejected.">
              <input value={defects} onChange={(e) => setDefects(e.target.value)} placeholder="e.g. shedding, uneven weft, lace tear" />
            </Field>
          )}
          {station === 'MOVE:IN_STOCK' && (
            <Field label="Into location">
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {(lookups.data?.locations ?? []).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
          )}
        </div>
      </Card>

      <Card title="Scan">
        <form onSubmit={submit}>
          <input
            ref={input}
            className="scan-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={valid ? 'Scan a barcode or type a serial, e.g. SS-000001' : 'Choose a station first'}
            disabled={!valid || busy}
            autoComplete="off"
            spellCheck={false}
            aria-label="Serial number"
          />
        </form>
        {flash && <div className={`scan-flash ${flash.ok ? 'ok' : 'err'}`} role={flash.ok ? 'status' : 'alert'}>{flash.text}</div>}
      </Card>

      <Card title="This session">
        {log.length === 0 ? <p className="muted">No scans yet.</p> : (
          <ul className="scan-log">
            {log.map((x, i) => (
              <li key={i}>
                <code>{x.serial}</code>
                {x.ok ? <Badge value={x.stage} label={x.stageText} /> : <Badge value="ERROR" label="Not moved" />}
                <span>{x.recId ? <Link to={`/production/${x.recId}`}>{x.text}</Link> : x.text}</span>
                <span className="muted small">{dateTime(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  )
}
