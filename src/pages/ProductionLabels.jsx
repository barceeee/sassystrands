import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLoad } from '../lib/data.js'
import { Page, Alert, Loading } from '../components/ui.jsx'
import Barcode from '../components/Barcode.jsx'
import './ProductionLabels.css'

// Printable barcode labels, one per piece in a production record.
export default function ProductionLabels() {
  const { id } = useParams()
  const rec = useLoad(async () => (await must(supabase.rpc('production_board', { p_id: Number(id) })))[0] ?? null, [id])
  const units = useLoad(() => must(supabase.from('production_units').select('id, serial').eq('production_id', id).order('id')), [id])

  useEffect(() => {
    document.body.classList.add('printing-labels')
    return () => document.body.classList.remove('printing-labels')
  }, [])

  if (rec.loading || units.loading) return <Loading />
  if (rec.error || units.error) return <Alert>{rec.error ?? units.error}</Alert>
  if (!rec.data) return <Alert>Production record not found.</Alert>
  const r = rec.data

  return (
    <Page
      title={`Labels · ${r.record_no}`}
      subtitle={`${units.data.length} piece(s) · ${r.item_name}`}
      actions={<>
        <Link to={`/production/${r.id}`}>← {r.record_no}</Link>
        <button className="primary" onClick={() => window.print()} disabled={!units.data.length}>Print labels</button>
      </>}
    >
      {units.data.length === 0 ? <p className="muted">This record has no pieces.</p> : (
        <div className="labels">
          {units.data.map((u) => (
            <div className="label" key={u.id}>
              <Barcode value={u.serial} />
              <div className="label-meta">
                <b>{r.item_name}</b><br />
                {r.record_no}{r.client_name ? ` · ${r.client_name}` : ' · Stock'}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}
