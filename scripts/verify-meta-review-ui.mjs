import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'
const calls = [], selected = []
let refreshCalls = 0, stale = false
const api = { arenaClient: { from(table) {
  const query = { select(columns) { selected.push(columns); return query }, eq() { return query },
    async single() { return { data: { rows: [{ campaign_id: 'A' }], updated_at: 'current' }, error: null } } }
  return query
} }, async arenaRpc(name, args) {
  calls.push({ name, args })
  if (stale) throw { code: 'PT409', message: 'changed' }
  if (name === 'meta_traffic_review_list') return { rows: [], count: 100 }
  if (name === 'meta_capture_review_part') return { id: args.p_id, version: args.p_version, total: 2001, rows: [], next_offset: 500 }
  return { id: args.p_id, status: 'aprovado', version: args.p_version }
} }
const load = createComponentLoader({ '@/lib/arena-api': api, '@/hooks/useAuth': { useAuth: () => ({ user: { id: 'test-user' } }) } })
const queries = load('src/lib/meta-traffic-queries.ts')
const summary = { format: 'capture-v1', kind: 'metrics', id: 'review-a', filename: 'API A', version: 5, updated_at: 'current', status: 'pendente',
  row_count: 2001, source: 'api', window_start: '2026-10-07', window_end: '2026-10-09', replaced_by_review_id: null, remove_count: 7, conflict_count: 0 }

test('review list is bounded metadata and details use the requested revision and part', async () => {
  await queries.fetchTrafficReviewList({ kind: 'metrics', status: 'pendente', offset: 0, limit: 50 })
  assert(selected.every(columns => columns !== '*' && !columns.split(',').includes('rows')))
  assert.equal(calls.at(-1).name, 'meta_traffic_review_list')
  assert.equal(calls.at(-1).args.p_limit, 50)
  await queries.fetchTrafficReviewPart({ id: 'review-a', version: 5, offset: 500, limit: 500 })
  assert.deepEqual(calls.at(-1).args, { p_id: 'review-a', p_version: 5, p_offset: 500, p_limit: 500 })
  assert.notDeepEqual(queries.trafficReviewPartKey('user', summary, 0), queries.trafficReviewPartKey('user', { ...summary, id: 'review-b' }, 0))
  assert.notDeepEqual(queries.trafficReviewPartKey('user', summary, 0), queries.trafficReviewPartKey('user', { ...summary, version: 6 }, 0))
  assert.equal(queries.trafficReviewOptions(false).refetchInterval, false)
})
test('approval requires a displayed complete summary, resolved conflicts and the seen version', async () => {
  assert.equal(queries.canApproveTrafficReview({ ...summary, remove_count: undefined }, true, true), false)
  assert.equal(queries.canApproveTrafficReview(summary, false, true), false)
  assert.equal(queries.canApproveTrafficReview(summary, true, false), false)
  assert.equal(queries.canApproveTrafficReview({ ...summary, conflict_count: 1 }, true, true), false)
  assert.equal(queries.canApproveTrafficReview(summary, true, true), true)
  const start = calls.length
  await queries.decideTrafficReviews([summary], 'aprovar', '', async () => { refreshCalls++; throw new Error('refresh offline') })
  assert.equal(calls.length - start, 1)
  assert.deepEqual(calls.at(-1), { name: 'meta_capture_review_decide', args: { p_id: 'review-a', p_version: 5, p_action: 'aprovar', p_note: '' } })
  assert.equal(refreshCalls, 1)
  const result = await queries.decideTrafficReviews([summary], 'aprovar', '', async () => { throw new Error('refresh offline') })
  assert.equal(result.recorded, 1)
  assert.equal(result.failures.length, 0)
  assert.equal(result.refreshFailed, true)
})
test('stale decisions report change and refresh without deciding an unseen version', async () => {
  stale = true
  try {
    let refresh = false
    const result = await queries.decideTrafficReviews([summary], 'aprovar', '', async () => { refresh = true })
    assert.equal(result.recorded, 0)
    assert.equal(result.failures[0].stale, true)
    assert.equal(refresh, true)
    assert.equal(calls.at(-1).args.p_version, 5)
  } finally { stale = false }
})
test('bulk decisions publish logical reviews once and retain legacy optimistic locking', async () => {
  const start = calls.length
  const result = await queries.decideTrafficReviews([summary, { ...summary, id: 'csv-b', kind: 'leads', format: 'legacy', version: null }], 'aprovar', '', async () => {})
  assert.equal(result.recorded, 2)
  assert.equal(calls.length - start, 2)
  assert.deepEqual(calls.at(-1), { name: 'meta_review_lead_import', args: { p_batch_id: 'csv-b', p_expected_updated_at: 'current', p_action: 'aprovar', p_note: '' } })
})
test('opening an edited legacy batch refuses to display an unseen snapshot', async () => {
  await assert.rejects(queries.fetchLegacyBatchRows('metrics', 'csv-b', 'previous'), cause => cause.code === 'PT409')
})
test('a slow file A cannot overwrite the successful preview for file B', async () => {
  const { createLatestFileLoader } = queries
  const jobs = new Map(); let preview = null
  const read = createLatestFileLoader(file => new Promise(resolve => jobs.set(file.name, resolve)),
    (file, data) => { preview = { filename: file.name, data } })
  const slow = read({ name: 'A.csv' }), fast = read({ name: 'B.csv' })
  jobs.get('B.csv')('B data'); await fast
  jobs.get('A.csv')('A data'); await slow
  assert.deepEqual(preview, { filename: 'B.csv', data: 'B data' })
})
test('review summary exposes all removals and conflicts before enabling approval', () => {
  const { TrafficReviewOverview } = load('src/components/traffic/MetaPendingImports.tsx')
  const html = renderToStaticMarkup(React.createElement(TrafficReviewOverview, { summary: { ...summary, conflict_count: 3, upsert_count: 1994 } }))
  assert.match(html, /7 remoções/)
  assert.match(html, /3 conflitos/)
  assert.match(html, /2001 linhas/)
  assert.match(html, /2026-10-07/)
})
