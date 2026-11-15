// Where each role lands after sign-in, and which URLs it may stay on. The database is the real
// gate; this keeps station users inside their screens.

export function homeFor(role) {
  if (role === 'STATION') return '/station'
  if (role === 'LEADER') return '/station/overview'
  return '/'
}

// True when `path` is `base` or sits under it ("/production" matches "/production/1", not "/productionx").
const under = (path, base) => path === base || path.startsWith(`${base}/`)

export function allowedPath(role, path) {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path
  if (role === 'STATION') return p === '/station'
  if (role === 'LEADER') {
    return under(p, '/station') || p === '/account' || under(p, '/production') || under(p, '/pieces') || p === '/labels'
  }
  return !under(p, '/station')
}

