import { createContext, useContext, useLayoutEffect, useMemo } from 'react'
import { Theme } from './Theme.js'

const ThemeContext = createContext(null)

const toInstance = (theme) => (theme instanceof Theme ? theme : new (theme ?? Theme)())

// Puts a theme's tokens into CSS custom properties and React context.
//
// The outermost provider writes them onto <html>, so the whole page (including <dialog>
// modals in the top layer) inherits them. A nested provider scopes a subclass to its subtree
// through a wrapper with `display: contents`, which adds no box to the layout.
//
//   <ThemeProvider>…app…</ThemeProvider>                      base theme, whole document
//   <ThemeProvider theme={ShowroomTheme}>…</ThemeProvider>     subclass, this subtree only
export function ThemeProvider({ theme = Theme, children }) {
  const parent = useContext(ThemeContext)
  const instance = useMemo(() => toInstance(theme), [theme])
  const vars = useMemo(() => instance.cssVars(), [instance])
  const isRoot = !parent

  useLayoutEffect(() => {
    if (!isRoot) return undefined
    const root = document.documentElement
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
    root.dataset.theme = instance.id
    return () => {
      Object.keys(vars).forEach((k) => root.style.removeProperty(k))
      delete root.dataset.theme
    }
  }, [isRoot, vars, instance])

  const value = useMemo(() => ({ theme: instance, tokens: instance.tokens, cssVar: Theme.var }), [instance])

  return (
    <ThemeContext.Provider value={value}>
      {isRoot ? children : <div className="theme-scope" data-theme={instance.id} style={vars}>{children}</div>}
    </ThemeContext.Provider>
  )
}

// { theme, tokens, cssVar } for the nearest provider.
// Prefer cssVar('radius.lg') over tokens.radius.lg in inline styles so nested themes still apply.
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>.')
  return ctx
}
