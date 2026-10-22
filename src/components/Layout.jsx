import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { ROLE_LABELS } from '../lib/perms.js'

// Navigation entries are hidden unless the signed-in role has the permission.
export const NAV = [
  { to: '/', label: 'Dashboard', perm: 'production.view', end: true },
  { to: '/inventory', label: 'Stock', perm: 'inventory.view' },
  { to: '/inventory/movements', label: 'Stock movements', perm: 'inventory.view' },
  { to: '/inventory/counts', label: 'Counts & audit', perm: 'inventory.view' },
  { to: '/inventory/bundles', label: 'Sale bundles', perm: 'inventory.view' },
  { to: '/orders', label: 'Client orders', perm: 'orders.view' },
  { to: '/production', label: 'Production', perm: 'production.view' },
  { to: '/qa', label: 'QA inspection', perm: 'qa.view' },
  { to: '/or-numbers', label: 'OR numbers', perm: 'or.manage' },
  { to: '/reports', label: 'Reports', perm: 'reports.view' },
  { to: '/imports', label: 'Spreadsheet import', perm: 'imports.manage' },
  { to: '/settings/lookups', label: 'Lists & locations', perm: 'lookups.manage' },
  { to: '/users', label: 'Users', perm: 'users.manage' },
]

export default function Layout() {
  const { profile, role, can, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const links = NAV.filter((n) => can(n.perm))
  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">☰</button>
        <div className="brand"><img src="/favicon.svg" alt="" /> Sassy Strands</div>
        <div className="who">
          <NavLink to="/account">{profile?.full_name}</NavLink>
          <span className="role">{ROLE_LABELS[role]}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <nav className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        {links.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end ?? n.to === '/inventory'}>{n.label}</NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
