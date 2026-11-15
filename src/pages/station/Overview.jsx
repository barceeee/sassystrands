import { Link } from 'react-router-dom'
import { Page, Card } from '../../components/ui.jsx'

// Placeholder: the leader's station dashboard is built in a later task.
export default function Overview() {
  return (
    <Page title="Station overview">
      <Card><p className="muted">Station figures are coming soon.</p><Link to="/station">Open the scanner</Link></Card>
    </Page>
  )
}
