import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'
import { loadHandler } from './helpers/meta-edge-harness.mjs'
import { leadDatabase } from './helpers/meta-lead-fixtures.mjs'

const payload = ids => JSON.stringify({ object: 'page', entry: [{ id: 'page1', changes: ids.map(id => ({ field: 'leadgen', value: { leadgen_id: id, page_id: 'page1', form_id: 'form1' } })) }] })
const signed = (raw, valid = true) => new Request('https://example.invalid/webhook', { method: 'POST', body: raw,
  headers: { 'x-hub-signature-256': 'sha256=' + (valid ? createHmac('sha256', 'test-secret').update(raw).digest('hex') : '0'.repeat(64)) } })
async function webhook(admin, extraEnv = {}) {
  let graphCalls = 0
  const { handler } = await loadHandler('meta-lead-webhook/index.ts', { admin, extraEnv: { META_APP_SECRET: 'test-secret', META_SYSTEM_USER_TOKEN: '', ...extraEnv },
    fetch: () => { graphCalls++; throw new Error('Graph before ACK') } })
  return { handler, graphCalls: () => graphCalls }
}
test('webhook without Graph token still persists the signed raw body before ACK', async () => {
  const admin = leadDatabase(), app = await webhook(admin)
  assert.equal((await app.handler(signed(payload(['lead1'])))).status, 200)
  assert.equal(admin.calls.filter(call => call.name === 'meta_webhook_event_receive').length, 1)
  assert.equal(app.graphCalls(), 0)
})
test('a database failure returns 503 and a replay deduplicates earlier receipts', async () => {
  const admin = leadDatabase({ failReceive: 'lead2' }), app = await webhook(admin)
  assert.equal((await app.handler(signed(payload(['lead1', 'lead2'])))).status, 503)
  assert.equal((await app.handler(signed(payload(['lead1', 'lead2'])))).status, 503)
  assert.equal(admin.events.size, 1)
  assert.equal(app.graphCalls(), 0)
})
test('invalid signature, malformed JSON or missing identity never ACK valid ingestion', async () => {
  const admin = leadDatabase(), app = await webhook(admin)
  assert.equal((await app.handler(signed(payload(['lead1']), false))).status, 403)
  assert.equal((await app.handler(signed('{'))).status, 400)
  assert.equal((await app.handler(signed(payload([''])))).status, 400)
  assert.equal(admin.events.size, 0)
})
test('empty or different allowlist persists an ignored event without fetching contacts', async () => {
  for (const pages of ['', 'other-page']) {
    const admin = leadDatabase(), app = await webhook(admin, { META_PAGE_IDS: pages })
    assert.equal((await app.handler(signed(payload(['lead1'])))).status, 200)
    assert.equal(admin.events.get('lead1').status, 'ignored')
    assert.equal(app.graphCalls(), 0)
  }
})
