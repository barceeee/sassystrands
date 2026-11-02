import { useState } from 'react'
import { Card } from '../components/ui.jsx'
import Modal from '../components/Modal.jsx'
import { ThemeProvider, useTheme } from './ThemeProvider.jsx'
import { ShowroomTheme } from './themes.js'

// Example: a card, buttons and a modal all inheriting glass from the theme, then the same
// markup inside a subclass that overrides a single token.
// Preview it without signing in: npm run dev → http://localhost:5173/theme-preview.html
export default function ThemeShowcase() {
  return (
    <div className="page" style={{ padding: 'var(--ss-space-8)', margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <h1>Theme</h1>
          <p className="muted">Minimal &amp; neutral elegance, glass on every card, button and modal.</p>
        </div>
      </div>

      <div className="grid">
        <Demo label="Theme (base)" />
        {/* Subclass: only glass.strong.bg differs, so only the primary button changes. */}
        <ThemeProvider theme={ShowroomTheme}>
          <Demo label="ShowroomTheme extends Theme" />
        </ThemeProvider>
      </div>
    </div>
  )
}

function Demo({ label }) {
  const [open, setOpen] = useState(false)
  const { theme, tokens, cssVar } = useTheme()

  return (
    <Card title="Silk press, 18 in" actions={<span className="badge badge-green">In stock</span>}>
      <div
        aria-hidden="true"
        style={{
          height: 140,
          borderRadius: cssVar('radius.md'),
          marginBottom: cssVar('space.4'),
          background: `linear-gradient(135deg, ${cssVar('color.stone')}, ${cssVar('color.stoneDeep')})`,
        }}
      />
      <p className="muted small" style={{ margin: 0 }}>{label}</p>
      <p style={{ marginTop: 4 }}>
        Primary fill: <code>{tokens.glass.strong.bg}</code>
      </p>
      <div className="actions">
        <button className="primary" onClick={() => setOpen(true)}>Reserve</button>
        <button>Details</button>
        <button className="danger">Remove</button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reserve this piece?"
        footer={
          <>
            <button onClick={() => setOpen(false)}>Not now</button>
            <button className="primary" onClick={() => setOpen(false)}>Reserve</button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>We'll hold it for 48 hours at HQ.</p>
        <p className="muted small" style={{ marginBottom: 0 }}>Rendered by the <code>{theme.id}</code> theme.</p>
      </Modal>
    </Card>
  )
}
