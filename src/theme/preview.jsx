import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './ThemeProvider.jsx'
import ThemeShowcase from './ThemeShowcase.jsx'
import './theme.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ThemeShowcase />
    </ThemeProvider>
  </StrictMode>,
)
