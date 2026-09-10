// Real Auth/PostgREST fixtures. Credentials remain local/in memory; no email is sent.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const project = 'mbzwchnxtskysqplqiyy'
export const url = `https://${project}.supabase.co`
const uuid = value => {
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) throw Error('Invalid fixture UUID')
  return `'${value}'::uuid`
}
export function sql(query) {
  mkdirSync('.verification.local', { recursive: true })
  writeFileSync('.verification.local/crm-fixtures.sql', query)
  const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', project, '--file', '.verification.local/crm-fixtures.sql', '--output', 'json'], { shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0) throw Error(result.stderr || 'Fixture SQL failed')
  const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))
  return parsed.rows
}
export const checked = async promise => {
  const { data, error } = await promise
  if (error) throw Error(`${error.code || error.status || 'API'}: ${error.message}`)
  return data
}
export async function realFixtures(run) {
  const bytes = readFileSync('.verification.local/api-keys.json')
  const keys = JSON.parse(bytes.toString(bytes[0] === 255 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, ''))
  const service = keys.find(key => key.name === 'service_role')?.api_key
  const anon = keys.find(key => key.name === 'anon')?.api_key
  if (!service || !anon) throw Error('Local Supabase API keys are unavailable')
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const users = [], clients = {}, sessions = {}
  const productId = randomUUID(), ticketId = randomUUID(), runId = randomUUID()
  const name = `CRM QA ${runId.slice(0, 8)}`
  const roles = { seller: ['seller'], second: ['seller'], executive: ['executive'], sdr: ['seller', 'sdr'], closer: ['seller', 'closer'], blocked: ['bdr'], suspended: ['seller'] }
  let cleaned = false
  const cleanup = async () => {
    const failures = []
    if (users.length) {
      const ids = users.map(u => uuid(u.id)).join(',')
      try {
        sql(`BEGIN;
          DELETE FROM public.vendas WHERE user_id IN (${ids});
          DELETE FROM public.crm_activities WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE created_by IN (${ids}));
          DELETE FROM public.crm_leads WHERE created_by IN (${ids});
          DELETE FROM public.product_tickets WHERE id=${uuid(ticketId)};
          DELETE FROM public.products WHERE id=${uuid(productId)};
          COMMIT; SELECT 'fixture records removed' result;`)
      } catch (error) { failures.push(error) }
      for (const u of [...users].reverse()) {
        const result = await admin.auth.admin.deleteUser(u.id)
        if (result.error) failures.push(new Error(`Failed to remove fixture user ${u.id}: ${result.error.message}`))
      }
    }
    for (const client of Object.values(clients)) await client.removeAllChannels()
    if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed; inspect local ledger')
    cleaned = true
    writeFileSync('.verification.local/crm-fixture-ledger.json', JSON.stringify({ runId, cleaned, userIds: users.map(u => u.id), productId, ticketId }))
  }
  try {
    for (const role of Object.keys(roles)) {
      const email = `crm-qa-${runId}-${role}@example.invalid`
      const data = await checked(admin.auth.admin.createUser({ email, password: randomBytes(30).toString('base64url'), email_confirm: true, user_metadata: { display_name: `${name} ${role}` } }))
      users.push({ ...data.user, fixtureRole: role })
      writeFileSync('.verification.local/crm-fixture-ledger.json', JSON.stringify({ runId, cleaned, userIds: users.map(u => u.id), productId, ticketId }))
      const link = await checked(admin.auth.admin.generateLink({ type: 'magiclink', email }))
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const verified = await checked(client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }))
      clients[role] = client; sessions[role] = verified.session
    }
    const ids = users.map(u => uuid(u.id)).join(',')
    sql(`BEGIN;
      DELETE FROM public.user_roles WHERE user_id IN (${ids});
      INSERT INTO public.user_roles(user_id,role,crm_access) VALUES ${users.flatMap(u => roles[u.fixtureRole].map(role => `(${uuid(u.id)},'${role}',false)`)).join(',')};
      UPDATE public.profiles SET suspended=true WHERE user_id=${uuid(users.find(u => u.fixtureRole === 'suspended').id)};
      SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: users.find(u => u.fixtureRole === 'executive').id, role: 'authenticated' })}',true);
      INSERT INTO public.products(id,name,active) VALUES(${uuid(productId)},'${name} Produto',true);
      INSERT INTO public.product_tickets(id,product_id,name,price,active) VALUES(${uuid(ticketId)},${uuid(productId)},'QA Ticket',10,true);
      COMMIT; SELECT 'fixture roles and catalog ready' result;`)
    await run({ clients, sessions, users, anon, name, productId, ticketId })
  } finally { await cleanup() }
}
