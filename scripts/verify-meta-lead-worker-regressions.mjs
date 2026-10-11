import assert from 'node:assert/strict'
import test from 'node:test'
import { loadHandler } from './helpers/meta-edge-harness.mjs'
import { leadDatabase, leadsGraph, json } from './helpers/meta-lead-fixtures.mjs'

test('compatibility ingestion uses atomic claimed completion and never refetches a processed event', async () => {
  const admin = leadDatabase(); let fetched = 0
  const { exports } = await loadHandler('_shared/meta-lead-ingest.ts', { admin, fetch: address => { fetched++; return leadsGraph(address) } })
  assert.equal((await exports.ingestLeadgenId(admin, 'lead1', 'page1', 'form1', 'test-token')).status, 'processed')
  const first = fetched
  assert.equal((await exports.ingestLeadgenId(admin, 'lead1', 'page1', 'form1', 'test-token')).status, 'processed')
  assert.equal(fetched, first)
  assert.equal(admin.calls.filter(call => call.name === 'meta_lead_event_ingest').length, 1)
  assert.equal(admin.calls.filter(call => call.name === 'meta_webhook_event_complete').length, 0)
})
test('worker recovers an old pending receipt without discovery and reports page permissions', async () => {
  const admin = leadDatabase()
  await admin.rpc('meta_webhook_event_receive', { p_leadgen_id: 'lead1', p_page_id: 'page1', p_form_id: 'form1' })
  admin.events.get('lead1').received_at = '2020-01-01T00:00:00Z'
  const { exports } = await loadHandler('_shared/meta-lead-worker.ts', { admin, fetch: () => json({ error: { code: 200, message: 'Missing pages_manage_ads' } }, 403) })
  const result = await exports.runLeadWorker(admin, { pageIds: ['page1'], token: 'test-token', deadlineMs: Date.now() + 45000, discover: false })
  assert.equal(result.failed, 1)
  assert.match(result.errors[0], /pages_manage_ads/)
  assert.equal(admin.events.get('lead1').error_class, 'permission')
  assert.equal(admin.events.get('lead1').status, 'error')
})
test('discovery persists whole receipts before advancing and resumes saved forms/leads cursor', async () => {
  const admin = leadDatabase(); let now = Date.now(), leadPages = 0
  class Clock extends Date { static now() { return now } }
  const fetch = address => {
    const url = new URL(address)
    if (url.pathname.endsWith('/leadgen_forms')) return json({ data: [{ id: 'form1' }, { id: 'form2' }] })
    if (url.pathname.endsWith('/form1/leads')) {
      leadPages++
      if (!url.searchParams.has('after')) {
        const next = new URL(url); next.searchParams.set('after', 'page2')
        now += 39000
        return json({ data: [{ id: 'lead1' }], paging: { next: next.toString() } })
      }
      return json({ data: [{ id: 'lead2' }] })
    }
    if (url.pathname.endsWith('/form2/leads')) return json({ data: [] })
    return leadsGraph(address)
  }
  const { exports } = await loadHandler('_shared/meta-lead-worker.ts', { admin, fetch, clock: Clock })
  const result = await exports.runLeadWorker(admin, { pageIds: ['page1'], token: 'test-token', deadlineMs: now + 45000, discover: true })
  assert.equal(result.partial, true)
  assert.equal(admin.events.size, 1)
  assert.equal(admin.discoveries.get('page1').leads_next.params.after, 'page2')
  assert.equal(admin.discoveries.get('page1').form_queue[0].id, 'form2')
  await exports.runLeadWorker(admin, { pageIds: ['page1'], token: 'test-token', deadlineMs: now + 45000, discover: true })
  assert.equal(leadPages, 2)
  assert.equal(admin.discoveries.get('page1').last_completed_until, '2026-10-11T12:00:00Z')
})
test('failed receipt never advances discovery and missing configuration keeps pending events', async () => {
  const admin = leadDatabase({ failReceive: 'lead2' })
  const { exports } = await loadHandler('_shared/meta-lead-worker.ts', { admin, fetch: leadsGraph })
  const result = await exports.runLeadWorker(admin, { pageIds: ['page1'], token: 'test-token', deadlineMs: Date.now() + 45000, discover: true })
  assert.match(result.errors[0], /receipt unavailable/)
  assert.equal(admin.discoveries.get('page1').form_id, 'form1')
  assert(admin.discoveries.get('page1').leads_next)
  const noToken = await exports.runLeadWorker(admin, { pageIds: ['page1'], token: null, deadlineMs: Date.now() + 45000, discover: false })
  assert.equal(noToken.failed, 0)
  assert.match(noToken.errors[0], /Token/)
})
