import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, fetchAll } from '../lib/data.js'
import { date } from '../lib/format.js'
import { Page, Alert } from '../components/ui.jsx'
import { PAGE_SKELETONS } from '../components/pageSkeletons.jsx'
import Barcode from '../components/Barcode.jsx'
import './Labels.css'

// Printable barcode labels for the pieces of one receipt (?receipt=ID), one spreadsheet import (?import=ID)
// or a list of serials (?serials=SS-000001,SS-000002).
export default function Labels() {
  const { can } = useAuth()
  const [params] = useSearchParams()
  const receipt = params.get('receipt')
  const batch = params.get('import')
  const serials = (params.get('serials') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const key = `${receipt ?? ''}|${batch ?? ''}|${serials.join(',')}`
  const nothing = !receipt && !batch && !serials.length

  const pieces = useLoad(async () => {
    if (nothing) return []
    // A malformed id must not fall through to an unfiltered board.
    const board = async (param, id) => (/^\d+$/.test(id) ? fetchAll(() => supabase.rpc('piece_board', { p_include_closed: true, [param]: Number(id) })) : [])
    let rows
    if (receipt) rows = await board('p_receipt_id', receipt)
    else if (batch) rows = await board('p_import_batch_id', batch)
    else {
      const found = await fetchAll(() => supabase.rpc('piece_board', { p_include_closed: true }).in('serial', serials))
      rows = serials.map((s) => found.find((p) => p.serial === s)).filter(Boolean)
    }
    const ids = [...new Set(rows.map((p) => p.receipt_id).filter(Boolean))]
    const dates = ids.length ? Object.fromEntries((await must(supabase.from('receipts').select('id, received_at').in('id', ids))).map((r) => [r.id, r.received_at])) : {}
    return rows.map((p) => ({ ...p, received_at: dates[p.receipt_id] ?? null }))
  }, [key])

  useEffect(() => {
    document.body.classList.add('printing-labels')
    return () => document.body.classList.remove('printing-labels')
  }, [])

  if (pieces.loading) return PAGE_SKELETONS.labels
  if (pieces.error) return <Alert>{pieces.error}</Alert>
  if (nothing) return <Page title="Labels"><Alert>Nothing to print. Open this page from a receipt, an import or a piece.</Alert></Page>

  const list = pieces.data
  const title = receipt ? `Labels · receipt #${receipt}` : batch ? `Labels · import #${batch}` : 'Labels'
  const missing = serials.filter((s) => !list.some((p) => p.serial === s))

  return (
    <Page
      title={title}
      subtitle={`${list.length} label(s)`}
      actions={<>
        {batch && can('imports.manage') && <Link to={`/imports/${batch}`}>← Import</Link>}
        {!batch && can('receiving.manage') && <Link to="/receiving">← Receiving</Link>}
        <button className="primary" onClick={() => window.print()} disabled={!list.length}>Print labels</button>
      </>}
    >
      {missing.length > 0 && <Alert>Not found: {missing.join(', ')}</Alert>}
      {list.length === 0 ? <p className="muted">No pieces to print.</p> : (
        <div className="labels">
          {list.map((p) => (
            <div className="label" key={p.id}>
              <Barcode value={p.serial} />
              <div className="label-meta">
                {p.received_at && <>Received {date(p.received_at)}</>}
                {p.item_name && <><br /><b>{p.item_name}</b></>}
                {p.order_no && <><br />{p.order_no}{p.client_name ? ` · ${p.client_name}` : ''}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}
