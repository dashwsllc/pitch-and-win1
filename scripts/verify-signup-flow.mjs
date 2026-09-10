import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--run-disposable-check')) {
  throw new Error('Use --run-disposable-check to create and remove one temporary verification account.')
}

const project = 'mbzwchnxtskysqplqiyy'
const url = `https://${project}.supabase.co`
const command = spawnSync(
  'npx',
  ['supabase', 'projects', 'api-keys', '--project-ref', project, '--output', 'json'],
  { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 1024 * 1024 },
)
if (command.status !== 0) {
  throw new Error(`Could not read authorized project credentials: ${command.stderr?.trim() || 'unknown error'}`)
}

const keys = JSON.parse(command.stdout)
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
const publicKey = keys.find(key => key.name === 'anon')?.api_key
assert(serviceKey && publicKey, 'Project API keys unavailable')

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const visitor = createClient(url, publicKey, options)
const suffix = randomUUID()
const email = `qa-signup-${suffix}@example.invalid`
const password = `Signup-${suffix}!Aa1`
let userId

try {
  const signUp = await visitor.auth.signUp({
    email,
    password,
    options: { data: { display_name: 'Verificação temporária de cadastro' } },
  })
  assert.ifError(signUp.error)
  assert(signUp.data.session, 'Sign-up did not return an authenticated session')
  assert(signUp.data.user, 'Sign-up did not return a user')
  userId = signUp.data.user.id

  const profile = await admin.from('profiles').select('display_name').eq('user_id', userId).single()
  assert.ifError(profile.error)
  assert.equal(profile.data.display_name, 'Verificação temporária de cadastro')

  const roles = await admin.from('user_roles').select('role').eq('user_id', userId)
  assert.ifError(roles.error)
  assert(roles.data.some(row => row.role === 'seller'), 'New account did not receive the seller role')

  const allProfiles = await admin.from('profiles').select('user_id').limit(1000)
  assert.ifError(allProfiles.error)
  const allRoles = await admin.from('user_roles').select('user_id').limit(1000)
  assert.ifError(allRoles.error)
  const assignedUserIds = new Set(allRoles.data.map(row => row.user_id))
  assert.equal(
    allProfiles.data.filter(profile => !assignedUserIds.has(profile.user_id)).length,
    0,
    'At least one existing profile still has no assigned role',
  )

  const session = await visitor.auth.getSession()
  assert.ifError(session.error)
  assert.equal(session.data.session?.user.id, userId, 'Session was not active after sign-up')
  console.log('PASS: sign-up created a seller and returned an active session')
} finally {
  await visitor.auth.signOut().catch(() => undefined)
  if (userId) {
    const removal = await admin.auth.admin.deleteUser(userId)
    if (removal.error) throw removal.error
  }
  await visitor.removeAllChannels()
  await admin.removeAllChannels()
}
