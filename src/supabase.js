import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, key)

// Staff sign in with a username; Supabase Auth stores it as an address on a reserved,
// never-deliverable domain. Users created with a real email can sign in with that email.
export const USERNAME_DOMAIN = 'users.sassystrands.invalid'
export const loginEmail = (login) => (login.includes('@') ? login.trim().toLowerCase() : `${login.trim().toLowerCase()}@${USERNAME_DOMAIN}`)

// Throws the database's own message (e.g. "Not enough stock: 3 on hand at HQ") so screens can show it.
export async function must(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}

export const rpc = (fn, args) => must(supabase.rpc(fn, args))
