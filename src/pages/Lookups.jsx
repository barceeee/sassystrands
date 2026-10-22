import { useState } from 'react'
import { supabase, must } from '../supabase.js'
import { useLoad, loadLookups } from '../lib/data.js'
import { Page, Card, Alert, Loading, Table, Field, ActionResult, useAction } from '../components/ui.jsx'

// Controlled lists used everywhere instead of free text. Codes are permanent; labels and
// active flags can change. Values are deactivated, never deleted, so history stays readable.
const LISTS = [
  { table: 'styles', title: 'Textures / styles', codeHint: 'e.g. BODY_WAVE', key: 'styles' },
  { table: 'lace_types', title: 'Lace types', codeHint: 'e.g. HD', key: 'laceTypes' },
  { table: 'lace_sizes', title: 'Lace sizes', codeHint: 'e.g. 13X6', key: 'laceSizes' },
  { table: 'locations', title: 'Stock locations / branches', codeHint: 'e.g. ALABANG', key: 'locations' },
]

export default function Lookups() {
  const data = useLoad(() => loadLookups(true), [])
  if (data.loading) return <Loading />
  return (
    <Page title="Lists & locations" subtitle="The fixed choices staff pick from. Spelling variants in imported sheets are mapped onto these.">
      <Alert>{data.error}</Alert>
      <div className="grid">
        {LISTS.map((l) => <LookupList key={l.table} list={l} rows={data.data?.[l.key] ?? []} onSaved={data.reload} />)}
      </div>
    </Page>
  )
}

function LookupList({ list, rows, onSaved }) {
  const [f, setF] = useState({ code: '', label: '' })
  const action = useAction()
  const add = async (e) => {
    e.preventDefault()
    const code = f.code.trim().toUpperCase().replace(/\s+/g, '_')
    const ok = await action.run(() => must(supabase.from(list.table).insert({ code, label: f.label.trim(), sort_order: 500 })), 'Added.')
    if (ok) { setF({ code: '', label: '' }); onSaved() }
  }
  const update = (row, patch) => action.run(async () => { await must(supabase.from(list.table).update(patch).eq('code', row.code)); onSaved() })
  return (
    <Card title={list.title}>
      <Table
        rowKey="code"
        columns={[
          { key: 'code', label: 'Code', render: (r) => <span className="small">{r.code}</span> },
          { key: 'label', label: 'Label', render: (r) => <input defaultValue={r.label} onBlur={(e) => e.target.value.trim() && e.target.value !== r.label && update(r, { label: e.target.value.trim() })} aria-label={`Label for ${r.code}`} /> },
          { key: 'active', label: 'Active', render: (r) => <input type="checkbox" checked={r.active} onChange={(e) => update(r, { active: e.target.checked })} aria-label={`${r.code} active`} /> },
        ]}
        rows={rows}
      />
      <form className="form" onSubmit={add} style={{ marginTop: 12 }}>
        <Field label="New code" hint={list.codeHint}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required /></Field>
        <Field label="Label"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required /></Field>
        <div className="form-actions"><button disabled={action.busy}>Add</button></div>
      </form>
      <ActionResult action={action} />
    </Card>
  )
}
