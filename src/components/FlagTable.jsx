import { useMemo, useState } from 'react'
import { Table, Badge } from './ui.jsx'
import { titleCase } from '../lib/format.js'

const OUTCOME = {
  IMPORTED: 'Imported',
  IMPORTED_WITH_ASSUMPTION: 'Imported with an assumption',
  NOT_IMPORTED: 'Not imported',
}

// Row-level import problems with filters. Used for the pre-import preview and for saved imports.
export default function FlagTable({ flags, onResolve, busy }) {
  const [f, setF] = useState({ severity: 'ERROR_WARNING', code: '', sheet: '', open: true })
  const codes = useMemo(() => [...new Set(flags.map((x) => x.code))].sort(), [flags])
  const sheets = useMemo(() => [...new Set(flags.map((x) => x.sheet))], [flags])
  const rows = flags.filter((x) =>
    (f.severity === 'ERROR_WARNING' ? x.severity !== 'INFO' : !f.severity || x.severity === f.severity) &&
    (!f.code || x.code === f.code) && (!f.sheet || x.sheet === f.sheet) && (!onResolve || !f.open || !x.resolved))
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <>
      <div className="filters">
        <select value={f.severity} onChange={set('severity')} aria-label="Severity">
          <option value="ERROR_WARNING">Errors + warnings</option>
          <option value="ERROR">Errors only</option><option value="WARNING">Warnings only</option><option value="INFO">Info only</option>
          <option value="">Everything</option>
        </select>
        <select value={f.code} onChange={set('code')} aria-label="Problem type">
          <option value="">All problem types</option>
          {codes.map((c) => <option key={c} value={c}>{titleCase(c)} ({flags.filter((x) => x.code === c).length})</option>)}
        </select>
        <select value={f.sheet} onChange={set('sheet')} aria-label="Sheet">
          <option value="">All sheets</option>
          {sheets.map((s) => <option key={s}>{s}</option>)}
        </select>
        {onResolve && <label><input type="checkbox" checked={f.open} onChange={set('open')} /> Hide resolved</label>}
        <span className="muted small">{rows.length} shown</span>
      </div>
      <Table
        rowKey="_k"
        columns={[
          { key: 'severity', label: 'Level', render: (x) => <Badge value={x.severity} /> },
          { key: 'where', label: 'Where', render: (x) => <>{x.sheet}<div className="muted small">{[x.row && `row ${x.row}`, x.cell].filter(Boolean).join(' · ')}</div></> },
          { key: 'code', label: 'Problem', render: (x) => <>{titleCase(x.code)}<div className="muted small">{OUTCOME[x.outcome]}</div></> },
          { key: 'message', label: 'Details', render: (x) => <>
            {x.message}
            {x.raw && <div className="muted small">Sheet row: {Object.entries(x.raw).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>}
            {x.resolved && <div className="small"><Badge value="APPROVED" label="Resolved" /> {x.resolution_note}</div>}
          </> },
          ...(onResolve ? [{ key: 'act', label: '', render: (x) => !x.resolved && x.severity !== 'INFO' && (
            <button className="small" disabled={busy} onClick={() => { const note = window.prompt('How was this resolved? (optional)'); if (note !== null) onResolve(x, note) }}>Mark resolved</button>
          ) }] : []),
        ]}
        rows={rows.slice(0, 1000).map((x, i) => ({ ...x, _k: x.id ?? i }))}
        empty="No problems match these filters."
      />
    </>
  )
}
