import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, must, rpc } from '../supabase.js'
import { useLoad, useStaff, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Loading, ActionResult, useAction } from '../components/ui.jsx'
import FlagTable from '../components/FlagTable.jsx'
import { dateTime, qty } from '../lib/format.js'

export default function ImportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const staff = useStaff()
  const batch = useLoad(() => must(supabase.from('import_batches').select('*').eq('id', id).single()), [id])
  const flags = useLoad(() => fetchAll(() => supabase.from('import_flags').select('*').eq('batch_id', id).order('id')), [id])
  const action = useAction()

  const resolve = (flag, note) => action.run(async () => {
    await rpc('resolve_import_flag', { p_flag_id: flag.id, p_note: note || null })
    flags.reload()
  })

  const remove = async () => {
    if (!window.confirm('Delete this import? Every movement, count, bundle, order and production record it created will be removed.')) return
    const ok = await action.run(() => rpc('delete_import_batch', { p_batch_id: Number(id) }))
    if (ok) navigate('/imports')
  }

  if (batch.loading) return <Loading />
  if (batch.error) return <Alert>{batch.error}</Alert>
  const b = batch.data
  const open = (flags.data ?? []).filter((x) => !x.resolved && x.severity !== 'INFO').length
  return (
    <Page
      title={b.file_name}
      subtitle={`Imported ${dateTime(b.imported_at)} by ${staff[b.imported_by] ?? '—'} · ${open} open error/warning flag(s)`}
      actions={<><Link to="/imports">← Imports</Link><button className="danger" onClick={remove} disabled={action.busy}>Delete import</button></>}
    >
      <div className="stats">
        {Object.entries(b.summary ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
          <div className="stat" key={k}>{k.replace(/_/g, ' ')}<b>{qty(Math.round(v))}</b></div>
        ))}
      </div>
      <ActionResult action={action} />
      <Card title="Flagged rows">
        {flags.loading ? <Loading /> : <FlagTable flags={flags.data ?? []} onResolve={resolve} busy={action.busy} />}
      </Card>
    </Page>
  )
}
