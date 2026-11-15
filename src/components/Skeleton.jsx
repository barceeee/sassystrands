import './Skeleton.css'

// Skeleton loaders built from the same blocks as real pages (.page-head, .stats/.stat, .card),
// so a page keeps its shape while its code or data loads.

const widths = ['70%', '45%', '85%', '55%', '35%', '65%']
export const Bar = ({ className = '', width }) => <span className={`sk-bar ${className}`} style={width ? { width } : undefined} />

export function SkeletonTable({ rows = 6, cols = 4 }) {
  return (
    <div className="sk-table" style={{ '--sk-cols': cols }}>
      <div className="sk-row sk-head">{Array.from({ length: cols }, (_, c) => <Bar key={c} />)}</div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="sk-row" key={r}>{Array.from({ length: cols }, (_, c) => <Bar key={c} width={widths[(r + c) % widths.length]} />)}</div>
      ))}
    </div>
  )
}

export const SkeletonStats = ({ count = 4 }) => (
  <div className="stats">
    {Array.from({ length: count }, (_, i) => <div className="stat" key={i}><Bar width="60%" /><Bar className="sk-num" /></div>)}
  </div>
)

export const SkeletonForm = ({ fields = 4 }) => (
  <div className="form">
    {Array.from({ length: fields }, (_, i) => <div className="field" key={i}><Bar width="40%" /><Bar className="sk-input" /></div>)}
    <div className="form-actions"><Bar className="sk-btn" /></div>
  </div>
)

const Block = ({ b }) => {
  if (b.type === 'stats') return <SkeletonStats count={b.count} />
  if (b.type === 'tabs') {
    return <div className="tabs">{Array.from({ length: b.count ?? 5 }, (_, i) => <Bar key={i} className="sk-tab" />)}</div>
  }
  if (b.type === 'labels') {
    return <div className="sk-labels">{Array.from({ length: b.count ?? 6 }, (_, i) => <div className="card" key={i}><Bar className="sk-big" /><Bar width="60%" /></div>)}</div>
  }
  if (b.type === 'scanner') {
    return <><div className="card"><Bar className="sk-big" /></div><div className="card"><Bar width="40%" /><SkeletonTable rows={4} cols={3} /></div></>
  }
  return (
    <section className="card">
      <div className="card-head"><Bar width="9em" /></div>
      {b.type === 'form' ? <SkeletonForm fields={b.fields} /> : b.type === 'details' ? <SkeletonStats count={b.count ?? 4} /> : <SkeletonTable rows={b.rows} cols={b.cols} />}
    </section>
  )
}

// A whole page: header (title, optional subtitle and action button) then its blocks in order.
// blocks: [{ type: 'stats'|'table'|'form'|'details'|'labels'|'scanner', ...size }]
export function SkeletonPage({ blocks = [{ type: 'table' }], subtitle = true, action = false }) {
  return (
    <div className="page sk-page" role="status" aria-busy="true">
      <span className="sk-hidden">Loading…</span>
      <div className="page-head">
        <div style={{ flex: 1 }}><Bar className="sk-title" />{subtitle && <Bar className="sk-sub" />}</div>
        {action && <Bar className="sk-btn" />}
      </div>
      {blocks.map((b, i) => <Block b={b} key={i} />)}
    </div>
  )
}

// Inline loader for one card's table or form while its data loads.
export const CardSkeleton = ({ type = 'table', ...size }) => (
  <div role="status" aria-busy="true"><span className="sk-hidden">Loading…</span>{type === 'form' ? <SkeletonForm {...size} /> : type === 'stats' ? <SkeletonStats {...size} /> : <SkeletonTable {...size} />}</div>
)
