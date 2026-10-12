// Recebimentos e decisões simultâneos nas levas, com duas conexões PostgreSQL reais.
// Só roda num banco local descartável (META_TRAFFIC_TEST_DB_URL apontando para 127.0.0.1/traffic_*).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function connect(count) {
  const address = process.env.META_TRAFFIC_TEST_DB_URL
  assert(address, 'META_TRAFFIC_TEST_DB_URL must point to a disposable local database')
  const url = new URL(address)
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/traffic_'), 'synthetic test is restricted to a local traffic test database')
  const module = process.env.META_TEST_PG_MODULE
  const { default: pg } = await import(module ? pathToFileURL(module).href : 'pg')
  const clients = Array.from({ length: count }, () => new pg.Client({ connectionString: address }))
  await Promise.all(clients.map(client => client.connect()))
  return clients
}
const asService = "SELECT set_config('request.jwt.claim.role','service_role',true)"
const lead = (key, minute) => ({ meta_lead_id: key, page_id: 'qa-page', form_id: 'qa-form', created_time: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
  full_name: 'Lead ' + key.slice(-6), phone: '+5511999990000', field_data: [] })
const ingest = (client, data) => client.query('SELECT public.meta_ingest_form_lead($1::jsonb) AS id', [JSON.stringify(data)])
async function waveSizes(client, prefix) {
  const { rows } = await client.query(`SELECT w.number, count(l.id)::int AS n FROM public.meta_lead_waves w JOIN public.meta_form_leads l ON l.wave_id=w.id
    WHERE l.meta_lead_id LIKE $1 GROUP BY w.number ORDER BY w.number`, [prefix + '%'])
  return rows.map(row => row.n)
}

test('two simultaneous deliveries at the 19/20 boundary never put 21 leads in a wave', async () => {
  const [setup, first, second] = await connect(3)
  const prefix = 'qa-boundary-' + randomUUID() + '-'
  try {
    await setup.query('BEGIN'); await setup.query(asService)
    // Começa de uma leva vazia, sem depender de dados anteriores do banco local.
    await setup.query("UPDATE public.meta_lead_waves SET is_open=false WHERE is_open")
    for (let n = 0; n < 19; n++) await ingest(setup, lead(prefix + n, n))
    await setup.query('COMMIT')
    for (const client of [first, second]) { await client.query("BEGIN; SET LOCAL statement_timeout='10s'"); await client.query(asService) }
    await ingest(first, lead(prefix + 'a', 30))
    const blocked = ingest(second, lead(prefix + 'b', 31))
    await new Promise(resolve => setTimeout(resolve, 300))
    await first.query('COMMIT')
    await blocked
    await second.query('COMMIT')
    assert.deepEqual(await waveSizes(setup, prefix), [20, 1])
    const open = await setup.query('SELECT count(*)::int AS n FROM public.meta_lead_waves WHERE is_open')
    assert.equal(open.rows[0].n, 1)
  } finally {
    await Promise.allSettled([first, second].map(client => client.query('ROLLBACK')))
    await Promise.allSettled([setup, first, second].map(client => client.end()))
  }
})

test('a lead arriving while a wave is being decided goes to the next wave, never into the decision', async () => {
  const [setup, decider, receiver] = await connect(3)
  const prefix = 'qa-decision-' + randomUUID() + '-', actor = randomUUID()
  try {
    await setup.query('BEGIN'); await setup.query(asService)
    await setup.query("UPDATE public.meta_lead_waves SET is_open=false WHERE is_open")
    for (let n = 0; n < 3; n++) await ingest(setup, lead(prefix + n, n))
    await setup.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [actor, 'qa-' + actor + '@example.invalid'])
    await setup.query("INSERT INTO public.profiles(user_id,display_name,suspended) VALUES($1,'QA concorrência',false)", [actor])
    await setup.query("INSERT INTO public.registration_requests(user_id,display_name,email,status,requested_role) VALUES($1,'QA concorrência',$2,'approved','seller')", [actor, 'qa-' + actor + '@example.invalid'])
    await setup.query("INSERT INTO public.user_roles(user_id,role) VALUES($1,'executive')", [actor])
    await setup.query('COMMIT')
    const { rows: [{ wave_id: wave }] } = await setup.query('SELECT wave_id FROM public.meta_form_leads WHERE meta_lead_id=$1', [prefix + '0'])
    const { rows: members } = await setup.query('SELECT id FROM public.meta_form_leads WHERE wave_id=$1', [wave])
    await decider.query("BEGIN; SET LOCAL statement_timeout='10s'")
    await decider.query("SELECT set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub',$1,true)", [actor])
    await decider.query('SELECT public.meta_wave_decide($1,$2,$3::uuid[],$4::jsonb,$5)', [wave, 'rejeitar', members.map(row => row.id), '[]', 'Teste de concorrência'])
    await receiver.query("BEGIN; SET LOCAL statement_timeout='10s'"); await receiver.query(asService)
    const arriving = ingest(receiver, lead(prefix + 'late', 40))
    await new Promise(resolve => setTimeout(resolve, 300))
    await decider.query('COMMIT')
    await arriving
    await receiver.query('COMMIT')
    const late = await setup.query('SELECT l.approval_status, l.wave_id, w.status FROM public.meta_form_leads l JOIN public.meta_lead_waves w ON w.id=l.wave_id WHERE l.meta_lead_id=$1', [prefix + 'late'])
    assert.equal(late.rows[0].approval_status, 'pendente')
    assert.notEqual(late.rows[0].wave_id, wave)
    assert.equal(late.rows[0].status, 'pendente')
    const decided = await setup.query("SELECT count(*) FILTER (WHERE approval_status='rejeitado')::int AS rejected, count(*)::int AS total FROM public.meta_form_leads WHERE wave_id=$1", [wave])
    assert.deepEqual(decided.rows[0], { rejected: 3, total: 3 })
  } finally {
    await Promise.allSettled([decider, receiver].map(client => client.query('ROLLBACK')))
    await Promise.allSettled([setup, decider, receiver].map(client => client.end()))
  }
})
