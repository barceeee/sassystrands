// Mirrors public.has_perm() in the database. The database is the real gate; this only
// decides which navigation and buttons to show.
const MANAGERS = ['OWNER', 'ADMIN', 'INVENTORY']

export function can(role, perm) {
  if (!role) return false
  switch (perm) {
    case 'users.manage': return role === 'OWNER' || role === 'ADMIN'
    case 'production.view': return true
    case 'production.manage': return [...MANAGERS, 'PRODUCTION'].includes(role)
    case 'qa.manage':
    case 'qa.view': return [...MANAGERS, 'QA'].includes(role)
    default: return MANAGERS.includes(role)
  }
}

export const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  INVENTORY: 'Inventory',
  PRODUCTION: 'Production',
  QA: 'QA',
}
