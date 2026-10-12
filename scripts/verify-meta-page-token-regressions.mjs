import assert from 'node:assert/strict'
import test from 'node:test'
import { loadHandler } from './helpers/meta-edge-harness.mjs'
import { leadDatabase, leadsGraph, json } from './helpers/meta-lead-fixtures.mjs'

const request = discover => new Request('https://example.invalid', { method: 'POST',
  headers: { 'x-cron-secret': 'test-cron', 'Content-Type': 'application/json' }, body: JSON.stringify({ discover }) })

test('an expired configured Page token is recovered before discovery and ingestion', async () => {
  const admin = leadDatabase(), requests = []
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, extraEnv: { META_PAGE_ACCESS_TOKEN: 'expired-page', META_SYSTEM_USER_TOKEN: 'system-token' },
    fetch: address => {
      const url = new URL(address), token = url.searchParams.get('access_token')
      requests.push({ path: url.pathname, token })
      if (token === 'expired-page') return json({ error: { code: 190, error_subcode: 463, message: 'Session has expired' } }, 400)
      if (url.pathname.endsWith('/page1') && url.searchParams.get('fields') === 'id,access_token' && token === 'system-token') {
        return json({ id: 'page1', access_token: 'derived-page' })
      }
      if (token !== 'derived-page') return json({ error: { code: 190, message: 'Page Access Token required' } }, 400)
      return leadsGraph(address)
    },
  })
  const response = await handler(request(true)), body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  assert.equal(body.results[0].leadsProcessed, 2)
  assert.equal(admin.events.get('lead1').status, 'processed')
  assert.equal(admin.events.get('lead2').status, 'processed')
  assert.equal(admin.discoveries.get('page1').last_completed_until, '2026-10-11T12:00:00Z')
  assert.equal(requests.filter(row => row.path.endsWith('/page1')).length, 1)
  assert(!JSON.stringify({ body, persisted: admin.calls }).includes('derived-page'))
  assert(!JSON.stringify({ body, persisted: admin.calls }).includes('system-token'))
})

test('a valid configured Page token retains priority over the system credential', async () => {
  const admin = leadDatabase()
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, extraEnv: { META_PAGE_ACCESS_TOKEN: 'valid-page', META_SYSTEM_USER_TOKEN: 'denied-system' },
    fetch: address => {
      const url = new URL(address), token = url.searchParams.get('access_token')
      assert.equal(token, 'valid-page')
      if (url.pathname.endsWith('/me')) return json({ id: 'page1' })
      return leadsGraph(address)
    },
  })
  const response = await handler(request(true))
  assert.equal(response.status, 200)
  assert.equal(admin.events.get('lead2').status, 'processed')
})

test('empty drain does not resolve credentials or make Graph requests', async () => {
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin: leadDatabase(), fetch: () => { throw Error('No Graph request expected') },
    extraEnv: { META_PAGE_ACCESS_TOKEN: 'expired-page' },
  })
  assert.equal((await handler(request(false))).status, 200)
})

test('a derived token for a different Page never reads or imports leads', async () => {
  const admin = leadDatabase()
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, fetch: address => {
      const url = new URL(address)
      if (url.pathname.endsWith('/page1') && url.searchParams.get('fields') === 'id,access_token') {
        return json({ id: 'another-page', access_token: 'wrong-page-secret' })
      }
      return json({ error: { code: 190, message: 'Page token required' } }, 400)
    },
  })
  const response = await handler(request(true)), body = await response.json()
  assert.equal(response.status, 502)
  assert.equal(body.ok, false)
  assert.equal(admin.events.size, 0)
  assert.match(body.results[0].error, /Página|página/)
  assert(!JSON.stringify({ body, persisted: admin.calls }).includes('wrong-page-secret'))
})

test('receipt draining recovers the Page credential without marking the lead as failed', async () => {
  const admin = leadDatabase()
  await admin.rpc('meta_webhook_event_receive', { p_leadgen_id: 'lead1', p_page_id: 'page1', p_form_id: 'form1' })
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, extraEnv: { META_PAGE_ACCESS_TOKEN: 'expired-page' }, fetch: address => {
      const url = new URL(address)
      if (url.searchParams.get('access_token') === 'expired-page') return json({ error: { code: 190, message: 'Expired' } }, 400)
      return leadsGraph(address)
    },
  })
  const response = await handler(request(false)), body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.results[0].leadsProcessed, 1)
  assert.equal(body.results[0].leadsFailed, 0)
  assert.equal(admin.events.get('lead1').status, 'processed')
  assert.equal(admin.discoveries.size, 0)
})

test('permission errors on a configured Page are preserved without fallback', async () => {
  const admin = leadDatabase(), paths = []
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, extraEnv: { META_PAGE_ACCESS_TOKEN: 'configured-page' }, fetch: address => {
      const url = new URL(address); paths.push(url.pathname)
      return json({ error: { code: 200, message: 'Missing pages_manage_ads' } }, 403)
    },
  })
  const response = await handler(request(true)), body = await response.json()
  assert.equal(response.status, 502)
  assert.match(body.results[0].error, /pages_manage_ads/)
  assert(paths.every(path => path.endsWith('/me')))
  assert.equal(admin.events.size, 0)
  assert.equal(admin.finishes[0].p_status, 'error')
})

test('an expired Page token without a system credential keeps configuration backoff', async () => {
  const admin = leadDatabase()
  await admin.rpc('meta_webhook_event_receive', { p_leadgen_id: 'lead1', p_page_id: 'page1', p_form_id: 'form1' })
  const { handler } = await loadHandler('meta-leads-reconciliation/index.ts', {
    admin, extraEnv: { META_PAGE_ACCESS_TOKEN: 'expired-page', META_SYSTEM_USER_TOKEN: '' },
    fetch: () => json({ error: { code: 190, error_subcode: 463, message: 'Session expired' } }, 400),
  })
  const response = await handler(request(false))
  assert.equal(response.status, 502)
  assert.equal(admin.events.get('lead1').status, 'error')
  assert.equal(admin.events.get('lead1').error_class, 'configuration')
})
