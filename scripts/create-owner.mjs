// Creates the first Owner account. Run once after applying the migrations:
//   npm run create-owner -- <username> "<Full Name>"
// Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment).
// The password is typed at a hidden prompt so it never lands in shell history.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import readline from 'node:readline'

const USERNAME_DOMAIN = 'users.sassystrands.invalid'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s) }
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer) })
  })
}

loadEnvFile('.env.local')
const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const [username = '', fullName = ''] = process.argv.slice(2)

if (!url || !serviceKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).')
  process.exit(1)
}
if (!/^[a-z0-9._-]{3,32}$/.test(username) || !fullName.trim()) {
  console.error('Usage: npm run create-owner -- <username> "<Full Name>"   (username: 3-32 lowercase letters, numbers, . _ -)')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'OWNER')
if (count > 0 && !process.argv.includes('--another')) {
  console.error('An Owner already exists. Sign in as that Owner and add users from the Users screen,')
  console.error('or re-run with --another if you really want a second Owner created this way.')
  process.exit(1)
}

const password = await askHidden('Password for the new Owner (min 8 characters): ')
if (password.length < 8) { console.error('Password too short.'); process.exit(1) }
const again = await askHidden('Repeat password: ')
if (again !== password) { console.error('Passwords do not match.'); process.exit(1) }

const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@${USERNAME_DOMAIN}`,
  password,
  email_confirm: true,
  user_metadata: { username, full_name: fullName.trim() },
})
if (error) { console.error('Could not create the user:', error.message); process.exit(1) }

const { error: pErr } = await admin.from('profiles')
  .insert({ id: data.user.id, username, full_name: fullName.trim(), role: 'OWNER', active: true })
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id)
  console.error('Could not create the profile:', pErr.message)
  process.exit(1)
}
console.log(`Owner "${username}" created. Sign in with that username. Remove the service key from .env.local now.`)
