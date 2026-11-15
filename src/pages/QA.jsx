import { Link } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useLoad, useStaff, fetchAll } from '../lib/data.js'
import { Page, Card, Alert, Table, Badge } from '../components/ui.jsx'
import { CardSkeleton } from '../components/Skeleton.jsx'
import { dateTime, pieceFor, PRODUCT_NOT_SET } from '../lib/format.js'

// Read-only: inspections are recorded by the QA station's scanner, not here.
export default function QA() {
  const staff = useStaff()
  const board = useLoad(async () => {
    const [queue, rework] = await Promise.all(['FOR_QA', 'REJECTED'].map((stage) => fetchAll(() => supabase.rpc('piece_board', { p_stage: stage }))))
    return { queue: queue.filter((r) => r.status === 'ACTIVE'), rework }
  }, [])
  const recent = useLoad(async () => {
    const rows = await must(supabase.from('qa_results').select('id, passed, defects, inspected_by, inspected_at, pieces(serial, item_id)').order('inspected_at', { ascending: false }).limit(200))
    return rows
  }, [])

  const queue = board.data?.queue ?? []
  const rework = board.data?.rework ?? []
  const forColumns = [
    { key: 'serial', label: 'Serial', render: (r) => <Link to={`/pieces/${r.serial}`}>{r.serial}</Link> },
    { key: 'item_name', label: 'Product', render: (r) => r.item_name ?? <span className="muted">{PRODUCT_NOT_SET}</span> },
    { key: 'client_name', label: 'For', render: (r) => pieceFor(r) },
  ]

  return (
    <Page title="QA inspection" subtitle="Pieces are passed or rejected by scanning at the QA station. This page only shows progress.">
      <Alert>{board.error || recent.error}</Alert>
      <Card title={`At the QA station (${queue.length})`}>
        {board.loading ? <CardSkeleton cols={5} /> : (
          <Table columns={[...forColumns, { key: 'stage_since', label: 'Arrived', render: (r) => dateTime(r.stage_since) }]} rows={queue} empty="Nothing waiting for QA." />
        )}
      </Card>
      <Card title={`Rejected, waiting for rework (${rework.length})`}>
        <Table columns={[...forColumns, { key: 'stage_since', label: 'Rejected', render: (r) => dateTime(r.stage_since) }]} rows={rework} empty="No rejected pieces." />
      </Card>
      <Card title="Recent inspections">
        {recent.loading ? <CardSkeleton cols={5} /> : (
          <Table
            columns={[
              { key: 'inspected_at', label: 'When', render: (x) => dateTime(x.inspected_at) },
              { key: 'serial', label: 'Serial', render: (x) => (x.pieces?.serial ? <Link to={`/pieces/${x.pieces.serial}`}>{x.pieces.serial}</Link> : '—') },
              { key: 'passed', label: 'Result', render: (x) => <Badge value={x.passed ? 'READY' : 'REJECTED'} label={x.passed ? 'Passed' : 'Rejected'} /> },
              { key: 'defects', label: 'Defects' },
              { key: 'inspected_by', label: 'Inspector', render: (x) => (x.inspected_by ? staff[x.inspected_by] ?? 'Unknown user' : '—') },
            ]}
            rows={recent.data ?? []}
            empty="No inspections yet."
          />
        )}
      </Card>
    </Page>
  )
}
