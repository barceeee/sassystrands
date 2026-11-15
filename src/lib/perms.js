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

// Stations where pieces are scanned (RECEIVED is intake, not a station). Mirrors profiles_station_codes.
export const STATIONS = ['RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA']
