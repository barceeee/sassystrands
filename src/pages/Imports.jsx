import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useLoad, useStaff } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge, ActionResult, useAction } from '../components/ui.jsx'
import FlagTable from '../components/FlagTable.jsx'
import { dateTime, qty } from '../lib/format.js'

const KIND_LABELS = {
  TRACKER: 'Bundle & closure inventory tracker',
  LEDGER: 'Available stocks / price ledger',
  ORDERS: 'Client order monitoring',
}

// Recommended order: tracker first (quantities), then the ledger (prices, bundles), then orders.
export default function Imports() {
  const navigate = useNavigate()
  const staff = useStaff()
  const batches = useLoad(() => must(supabase.from('import_batches').select('*').order('imported_at', { ascending: false })), [])
  const [parsed, setParsed] = useState(null)
  const [file, setFile] = useState(null)
  const parse = useAction()
  const save = useAction()

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    setParsed(null); setFile(f ?? null)
    if (!f) return
    await parse.run(async () => {
      const { parseWorkbook } = await import('../import/index.js') // ExcelJS is large; load it only here
      setParsed(await parseWorkbook(await f.arrayBuffer()))
    })
  }

  const doImport = async () => {
    const { toPayload } = await import('../import/index.js')
    const id = await save.run(() => rpc('import_batch', { p_kind: parsed.kind, p_file_name: file.name, p_sha256: parsed.sha256, p_payload: toPayload(parsed) }))
    if (typeof id === 'number') navigate(`/imports/${id}`)
  }

  const counts = parsed ? parsed.flags.reduce((a, x) => ({ ...a, [x.severity]: (a[x.severity] ?? 0) + 1 }), {}) : {}
  const notImported = parsed?.flags.filter((x) => x.outcome === 'NOT_IMPORTED' && x.severity === 'ERROR').length ?? 0

  return (
    <Page title="Spreadsheet import" subtitle="Bring the client's existing Excel files in. Rows that cannot be read cleanly are flagged, never silently dropped.">
      <Card title="1. Choose a file">
        <div className="dropzone">
          <input type="file" accept=".xlsx" onChange={onFile} aria-label="Excel file" />
          <p className="muted small">Supported: HAIR BUNDLE AND CLOSURE INVENTORY · AVAILABLE STOCKS · MONITORING CLIENTS ORDER. Import the inventory tracker first, then available stocks, then client orders.</p>
        </div>
        {parse.busy && <Loading />}
        <Alert>{parse.error}</Alert>
      </Card>

      {parsed && (
        <Card title={`2. Review: ${KIND_LABELS[parsed.kind]}`} actions={<button className="primary" onClick={doImport} disabled={save.busy}>{save.busy ? 'Importing…' : 'Import now'}</button>}>
          <div className="stats">
            {Object.entries(parsed.summary).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
              <div className="stat" key={k}>{k.replace(/_/g, ' ')}<b>{k.includes('value') ? `₱${qty(Math.round(v))}` : qty(v)}</b></div>
            ))}
            <div className={`stat ${counts.ERROR ? 'bad' : ''}`}>Errors<b>{counts.ERROR ?? 0}</b></div>
            <div className={`stat ${counts.WARNING ? 'warn' : ''}`}>Warnings<b>{counts.WARNING ?? 0}</b></div>
            <div className="stat">Info<b>{counts.INFO ?? 0}</b></div>
          </div>
          {notImported > 0 && <Alert kind="warning">{notImported} row(s) have errors and will not be imported. They stay listed on the import page so you can fix them later (in the app, or in the sheet and re-import).</Alert>}
          <ActionResult action={save} />
          <FlagTable flags={parsed.flags} />
        </Card>
      )}

      <Card title="Previous imports">
        <Alert>{batches.error}</Alert>
        <Table
          onRowClick={(b) => navigate(`/imports/${b.id}`)}
          columns={[
            { key: 'imported_at', label: 'When', render: (b) => dateTime(b.imported_at) },
            { key: 'file_name', label: 'File' },
            { key: 'file_kind', label: 'Type', render: (b) => KIND_LABELS[b.file_kind] },
            { key: 'flags', label: 'Flags', render: (b) => <>
              {b.summary?.flags?.ERROR ? <Badge value="ERROR" label={`${b.summary.flags.ERROR} errors`} /> : null}{' '}
              {b.summary?.flags?.WARNING ? <Badge value="WARNING" label={`${b.summary.flags.WARNING} warnings`} /> : null}
            </> },
            { key: 'imported_by', label: 'By', render: (b) => staff[b.imported_by] ?? '—' },
          ]}
          rows={batches.data ?? []}
          empty="Nothing imported yet."
        />
        <p className="muted small">Open an import to review its flags or roll it back. <Link to="/inventory/counts">Counts & audit</Link> compares the imported snapshots with computed stock.</p>
      </Card>
    </Page>
  )
}
