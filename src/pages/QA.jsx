import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, must } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { useLoad, useStaff } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Badge } from '../components/ui.jsx'
import QaForm from '../components/QaForm.jsx'
import { dateTime } from '../lib/format.js'

export default function QA() {
  const { can } = useAuth()
  const staff = useStaff()
  const board = useLoad(() => must(supabase.rpc('production_board')), [])
  const recent = useLoad(() => must(supabase.from('v_qa_inspections').select('*').order('inspected_at', { ascending: false }).limit(200)), [])
  const [open, setOpen] = useState(null)

  const queue = (board.data ?? []).filter((r) => r.stage === 'FOR_QA' && r.status === 'ACTIVE')
  const rework = (board.data ?? []).filter((r) => r.stage === 'REJECTED')
  const reload = () => { setOpen(null); board.reload(); recent.reload() }

  return (
    <Page title="QA inspection" subtitle="Approve finished products into Ready, or reject them back to production for rework.">
      <Alert>{board.error || recent.error}</Alert>
      <Card title={`Awaiting inspection (${queue.length})`}>
        {board.loading ? <Loading /> : (
          <Table
            columns={[
              { key: 'record_no', label: 'Record', render: (r) => <Link to={`/production/${r.id}`}>{r.record_no}</Link> },
              { key: 'item_name', label: 'Product' },
              { key: 'qty', label: 'Units', num: true },
              { key: 'client_name', label: 'For', render: (r) => (r.client_name ? `${r.client_name} · ${r.order_no}` : 'Stock') },
              { key: 'updated_at', label: 'Sent to QA', render: (r) => dateTime(r.updated_at) },
              { key: 'act', label: '', render: (r) => can('qa.manage') && <button className="small primary" onClick={() => setOpen(open?.id === r.id ? null : r)}>{open?.id === r.id ? 'Close' : 'Inspect'}</button> },
            ]}
            rows={queue}
            empty="Nothing waiting for QA."
          />
        )}
      </Card>
      {open && (
        <Card title={`Inspect ${open.record_no}: ${open.qty} × ${open.item_name}`}>
          <QaForm key={open.id} record={open} onSaved={reload} />
        </Card>
      )}
      <Card title={`Rejected, waiting for rework (${rework.length})`}>
        <Table
          columns={[
            { key: 'record_no', label: 'Record', render: (r) => <Link to={`/production/${r.id}`}>{r.record_no}</Link> },
            { key: 'item_name', label: 'Product' },
            { key: 'qty', label: 'Units', num: true },
            { key: 'client_name', label: 'For', render: (r) => r.client_name ?? 'Stock' },
          ]}
          rows={rework}
          empty="No rejected units."
        />
      </Card>
      <Card title="Recent inspections">
        <Table
          columns={[
            { key: 'inspected_at', label: 'When', render: (x) => dateTime(x.inspected_at) },
            { key: 'record_no', label: 'Record', render: (x) => <Link to={`/production/${x.production_id}`}>{x.record_no}</Link> },
            { key: 'item_name', label: 'Product' },
            { key: 'result', label: 'Result', render: (x) => <Badge value={x.result} /> },
            { key: 'passed_qty', label: 'Passed', num: true },
            { key: 'rejected_qty', label: 'Rejected', num: true },
            { key: 'defects', label: 'Defects' },
            { key: 'inspected_by', label: 'Inspector', render: (x) => staff[x.inspected_by] ?? '—' },
          ]}
          rows={recent.data ?? []}
          empty="No inspections yet."
        />
      </Card>
    </Page>
  )
}
