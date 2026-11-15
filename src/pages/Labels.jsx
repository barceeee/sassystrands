import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rpc, supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad } from '../lib/data.js'
import { date } from '../lib/format.js'
import { Page, Alert, Loading } from '../components/ui.jsx'
import Barcode from '../components/Barcode.jsx'
import './Labels.css'

// Printable barcode labels for the pieces of one receipt (?receipt=ID) or a list of serials (?serials=SS-000001,SS-000002).
export default function Labels() {
  const { can } = useAuth()
  const [params] = useSearchParams()
  const receipt = params.get('receipt')
  const serials = (params.get('serials') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const key = `${receipt ?? ''}|${serials.join(',')}`

  const pieces = useLoad(async () => {
    if (!receipt && !serials.length) return []
    const board = await rpc('piece_board', { p_include_closed: true })
    const rows = receipt ? board.filter((p) => String(p.receipt_id) === receipt) : serials.map((s) => board.find((p) => p.serial === s)).filter(Boolean)
    const ids = [...new Set(rows.map((p) => p.receipt_id).filter(Boolean))]
    const dates = ids.length ? Object.fromEntries((await must(supabase.from('receipts').select('id, received_at').in('id', ids))).map((r) => [r.id, r.received_at])) : {}
    return rows.map((p) => ({ ...p, received_at: dates[p.receipt_id] ?? null }))
  }, [key])

  useEffect(() => {
    document.body.classList.add('printing-labels')
    return () => document.body.classList.remove('printing-labels')
  }, [])

  if (pieces.loading) return <Loading />
  if (pieces.error) return <Alert>{pieces.error}</Alert>
  if (!receipt && !serials.length) return <Page title="Labels"><Alert>Nothing to print. Open this page from a receipt or a piece.</Alert></Page>

  const list = pieces.data
  const title = receipt ? `Labels · receipt #${receipt}` : 'Labels'
  const missing = serials.filter((s) => !list.some((p) => p.serial === s))

  return (
    <Page
      title={title}
      subtitle={`${list.length} label(s)`}
      actions={<>
        {can('receiving.manage') && <Link to="/receiving">← Receiving</Link>}
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
