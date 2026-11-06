// Temporary accounts for trying the app as each role.
//   npm run test-users            create test.owner, test.admin, test.inventory, test.production, test.qa
//   npm run test-users -- --remove  delete them again
// Passwords are random and written only to test-accounts.local.txt (git-ignored), never printed.
// Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment).
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const USERNAME_DOMAIN = 'users.sassystrands.invalid'
const OUT_FILE = 'test-accounts.local.txt'
const ROLES = ['OWNER', 'ADMIN', 'INVENTORY', 'PRODUCTION', 'QA']
const usernameFor = (role) => `test.${role.toLowerCase()}`

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

loadEnvFile('.env.local')
const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).')
  process.exit(1)
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function findProfile(username) {
  const { data } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  return data
}

if (process.argv.includes('--remove')) {
  for (const role of ROLES) {
    const username = usernameFor(role)
    const p = await findProfile(username)
    if (!p) { console.log(`${username}: not found`); continue }
    const { error } = await admin.auth.admin.deleteUser(p.id) // profile is removed by ON DELETE CASCADE
    console.log(`${username}: ${error ? `could not delete (${error.message})` : 'deleted'}`)
  }
  if (existsSync(OUT_FILE)) rmSync(OUT_FILE)
  process.exit(0)
}

const lines = [`# Temporary test accounts created ${new Date().toISOString()}. Remove with: npm run test-users -- --remove`]
for (const role of ROLES) {
  const username = usernameFor(role)
  if (await findProfile(username)) {
    console.log(`${username}: already exists, skipped (run with --remove first to recreate)`)
    continue
  }
  const password = randomBytes(12).toString('base64url')
  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@${USERNAME_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: `Test ${role[0]}${role.slice(1).toLowerCase()}`, temporary: true },
  })
  if (error) { console.error(`${username}: could not create (${error.message})`); continue }
  const { error: pErr } = await admin.from('profiles')
    .insert({ id: data.user.id, username, full_name: `Test ${role[0]}${role.slice(1).toLowerCase()}`, role, active: true })
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id)
    console.error(`${username}: could not create profile (${pErr.message})`)
    continue
  }
  lines.push(`${role.padEnd(10)} username: ${username}  password: ${password}`)
  console.log(`${username}: created (${role})`)
}
if (lines.length > 1) {
  writeFileSync(OUT_FILE, lines.join('\n') + '\n', { flag: 'a' })
  console.log(`Sign-in details saved to ${OUT_FILE} (git-ignored).`)
}
