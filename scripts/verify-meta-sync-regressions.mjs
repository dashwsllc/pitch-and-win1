import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase/functions')

// Run the deployed handlers and shared modules. Only network/database boundaries
// are substituted; no API credentials, server sockets or persistent fixtures.
async function loadHandler(path, { fetch, admin, extraEnv = {} }) {
  let handler
  const env = { META_SYNC_CRON_SECRET: 'test-cron', META_SYSTEM_USER_TOKEN: 'test-token',
    META_PAGE_IDS: 'page1', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', ...extraEnv }
  const context = vm.createContext({ URL, Request, Response, TextEncoder, crypto, fetch,
    console: { error() {}, log() {} },
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value } },
    __admin: admin })
  const cache = new Map()
  async function moduleFor(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = filename.startsWith('https:')
      ? 'export function createClient() { return globalThis.__admin }'
      : ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      } }).outputText
    const module = new vm.SourceTextModule(source, { context, identifier: filename })
    cache.set(filename, module)
    await module.link((specifier, parent) => moduleFor(specifier.startsWith('https:')
      ? specifier : resolve(dirname(parent.identifier), specifier)))
    return module
  }
  const module = await moduleFor(resolve(root, path))
  await module.evaluate()
  return { handler, exports: module.namespace }
}

function database({ failLead = '', failFinish = false } = {}) {
  const imported = [], finishes = []
  return { imported, finishes,
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ account_id: '123' }], error: null }) }) }),
    async rpc(name, args) {
      if (name === 'meta_sync_run_start') return { data: 'run1', error: null }
      if (name === 'meta_import_daily_system') { imported.push(...args.p_rows); return { data: { rows: args.p_rows.length }, error: null } }
      if (name === 'meta_sync_run_finish') { finishes.push(args); return { data: null, error: failFinish ? { message: 'finish unavailable' } : null } }
      if (name === 'meta_webhook_event_receive') return { data: `event-${args.p_leadgen_id}`, error: null }
      if (name === 'meta_ingest_form_lead') return { data: args.p_data.meta_lead_id,
        error: args.p_data.meta_lead_id === failLead ? { code: '22023', message: 'invalid lead data' } : null }
      if (name === 'meta_webhook_event_complete') return { data: null, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    },
  }
}

const cronRequest = () => new Request('https://example.invalid/sync', {
  method: 'POST', headers: { 'x-cron-secret': 'test-cron', 'Content-Type': 'application/json' }, body: '{}',
})
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

function insightsGraph(failure = false) {
  return async address => {
    const url = new URL(address)
    if (failure) return json({ error: { code: 200, message: 'Missing ads_read' } }, 403)
    if (url.searchParams.has('ids')) return json({ error: { code: 100, message: 'The ids query parameter is deprecated in v26.0+.' } }, 400)
    if (url.pathname.endsWith('/insights')) return json({ data: [{
      date_start: '2026-10-09', campaign_id: 'campaign1', campaign_name: 'Test', spend: '12.50', actions: [{ action_type: 'lead', value: '2' }],
    }] })
    if (url.pathname.endsWith('/campaign1') && url.searchParams.get('fields') === 'objective') return json({ id: 'campaign1', objective: 'OUTCOME_LEADS' })
    throw new Error(`Unexpected Graph path ${url.pathname}`)
  }
}

function leadsGraph(address) {
  const url = new URL(address)
  if (url.pathname.endsWith('/leadgen_forms')) return json({ data: [{ id: 'form1', name: 'Test' }] })
  if (url.pathname.endsWith('/leads')) return json({ data: [{ id: 'lead1' }, { id: 'lead2' }] })
  if (url.pathname.endsWith('/form1')) return json({ id: 'form1', name: 'Test' })
  if (/\/lead[12]$/.test(url.pathname)) return json({ id: url.pathname.split('/').at(-1),
    created_time: '2026-10-09T12:00:00Z', form_id: 'form1', field_data: [
      { name: 'full_name', values: ['Test Person'] }, { name: 'phone_number', values: ['11999990000'] },
    ] })
  throw new Error(`Unexpected Graph path ${url.pathname}`)
}

test('v26 metrics sync stores campaign objectives without the removed ids query', async () => {
  const admin = database()
  const { handler } = await loadHandler('meta-insights-sync/index.ts', { admin, fetch: insightsGraph() })
  const response = await handler(cronRequest())
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.results.filter(row => row.error).length, 0)
  assert.equal(admin.imported.length, 3)
  assert(admin.imported.every(row => row.objective === 'OUTCOME_LEADS' && row.leads === 2 && row.spend === 12.5))
})

test('metrics API failures return a failing HTTP status and keep error runs', async () => {
  const admin = database()
  const { handler } = await loadHandler('meta-insights-sync/index.ts', { admin, fetch: insightsGraph(true) })
  const response = await handler(cronRequest())
  assert.equal(response.status, 502)
  assert.equal((await response.json()).ok, false)
  assert.equal(admin.imported.length, 0)
  assert.equal(admin.finishes.filter(row => row.p_status === 'error').length, 3)
})

test('failed lead persistence is returned to the reconciliation caller', async () => {
  const admin = database({ failLead: 'lead2' })
  const { exports } = await loadHandler('_shared/meta-lead-ingest.ts', { admin, fetch: leadsGraph })
  const outcome = await exports.ingestLeadgenId(admin, 'lead2', 'page1', 'form1', 'test-token')
  assert.equal(outcome?.status, 'error')
  assert.match(outcome.error, /invalid lead data/)
})

test('reconciliation counts successful persistence and reports an individual lead failure', async () => {
  const admin = database({ failLead: 'lead2' })
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', { admin, fetch: leadsGraph })
  const response = await handler(cronRequest())
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.results[0].leadsFound, 2)
  assert.equal(body.results[0].leadsProcessed, 1)
  assert.equal(body.results[0].leadsFailed, 1)
  assert.equal(admin.finishes[0].p_rows_synced, 1)
  assert.equal(admin.finishes[0].p_status, 'error')
})

test('a failed sync-run finalization cannot be reported as success', async () => {
  const admin = database({ failFinish: true })
  const { handler } = await loadHandler('meta-insights-sync/index.ts', { admin, fetch: insightsGraph() })
  const response = await handler(cronRequest())
  assert.equal(response.status, 502)
  assert.match((await response.json()).results[0].error, /finish unavailable/)
})

test('missing page configuration is an explicit reconciliation failure', async () => {
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin: database(), fetch: leadsGraph, extraEnv: { META_PAGE_IDS: '' },
  })
  assert.equal((await handler(cronRequest())).status, 500)
})

test('the configured page token covers form listing and lead retrieval', async () => {
  const seen = []
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin: database(), extraEnv: { META_PAGE_ACCESS_TOKEN: 'test-page-token' },
    fetch: address => { seen.push(new URL(address).searchParams.get('access_token')); return leadsGraph(address) },
  })
  assert.equal((await handler(cronRequest())).status, 200)
  assert(seen.length >= 4)
  assert(seen.every(token => token === 'test-page-token'))
})

test('reconciliation still rejects requests without the cron secret', async () => {
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', { admin: database(), fetch: leadsGraph })
  assert.equal((await handler(new Request('https://example.invalid', { method: 'POST' }))).status, 403)
})
