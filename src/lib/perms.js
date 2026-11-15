// Mirrors public.has_perm() in the database. The database is the real gate; this only
// decides which navigation and buttons to show.
const MANAGERS = ['OWNER', 'ADMIN', 'INVENTORY']

export function isStationRole(role) {
  return role === 'STATION' || role === 'LEADER'
}

export function can(role, perm) {
  if (!role) return false
  switch (perm) {
    case 'users.manage': return role === 'OWNER' || role === 'ADMIN'
    case 'production.view': return true
    case 'station.scan': return isStationRole(role)
    case 'station.lead': return role === 'LEADER'
    case 'receiving.manage': return MANAGERS.includes(role)
    // Retired: kept so old callers fail closed (mirrors has_perm).
    case 'production.manage':
    case 'qa.manage': return false
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
  STATION: 'Station',
  LEADER: 'Team leader',
}
