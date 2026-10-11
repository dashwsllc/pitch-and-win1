import assert from 'node:assert/strict'
import test from 'node:test'
import { metricRow, scope, cohort } from './helpers/meta-view-fixtures.mjs'
import { loadComponent } from './helpers/meta-component-harness.mjs'
const { buildTrafficView, buildTrafficCsv, crmTrafficRates, trafficCsvText } = loadComponent('src/lib/meta-traffic-view.ts')
import { classifyObjective } from '../src/lib/meta-traffic.ts'

test('one campaign selection applies to totals, groups, days and the entire CSV', () => {
  const view = buildTrafficView([metricRow(), metricRow({ campaign_id: 'B', campaign_name: 'Campaign B', spend: 500 })], { ...scope, campaignId: 'A' })
  assert.equal(view.total.spend, 100)
  assert.deepEqual(view.groups.map(row => row.campaign_id), ['A'])
  assert.equal(view.daily[0].metrics.spend, 100)
  assert.equal(buildTrafficCsv(view).rows.length, 1)
  assert.equal(trafficCsvText(buildTrafficCsv(view)).includes('Campaign B'), false)
})
test('dimensions retain distinct ads, sets and same names across accounts', () => {
  const ad = metricRow({ level: 'ad', adset_id: 'set1', adset_name: 'Set', ad_id: 'ad1', ad_name: 'Ad' })
  const view = buildTrafficView([ad, { ...ad, ad_id: 'ad2' }, { ...ad, account_id: '124' }], { ...scope, level: 'ad' })
  assert.equal(view.groups.length, 3)
  assert.equal(new Set(view.groups.map(row => row.key)).size, 3)
  assert.deepEqual(view.groups.map(row => row.ad_id).sort(), ['ad1', 'ad1', 'ad2'])
})
test('missing CSV metrics differ from explicit zero, and legacy values do not invent rates', () => {
  const omitted = metricRow({ source: 'csv', available_metrics: ['spend'], metric_metadata: null, leads: 0 })
  assert.equal(buildTrafficView([omitted], scope).total.leads, null)
  assert.equal(buildTrafficView([metricRow({ leads: 0 })], scope).total.leads, 0)
  const legacy = buildTrafficView([metricRow({ available_metrics: null, metric_metadata: null })], scope)
  assert.equal(legacy.total.leads, 10)
  assert.equal(legacy.total.cpl, null)
  assert(legacy.warnings.some(value => /legado/i.test(value)))
})
test('partial origin, mixed definitions and account calendars cannot produce consolidated rates', () => {
  const view = buildTrafficView([metricRow()], scope)
  assert.deepEqual(crmTrafficRates({ ...cohort, state: 'insufficient', reasons: ['origem parcial'] }, view), { cpa: null, roas: null, reason: 'origem parcial' })
  assert.deepEqual(crmTrafficRates(cohort, view), { cpa: 100, roas: 2, reason: null })
  const mixed = buildTrafficView([metricRow(), metricRow({ account_id: '124', metric_metadata: { definition_version: 'canonical-v1', account_timezone: 'America/Los_Angeles' } })], scope)
  assert.equal(mixed.total.cpl, null)
  assert.equal(crmTrafficRates(cohort, mixed).roas, null)
  const definitions = buildTrafficView([metricRow(), metricRow({ attribution_window: '1d_click' })], scope)
  assert.equal(definitions.total.roas, null)
})
test('impossible dates are rejected and pagination does not change totals or CSV scope', () => {
  assert.throws(() => buildTrafficView([], { ...scope, start: '2026-02-31' }), /Data|Período/)
  assert.throws(() => buildTrafficView([metricRow({ date: '2026-02-31' })], { ...scope, start: '2026-02-01', end: '2026-03-01' }), /Data/)
  const rows = Array.from({ length: 101 }, (_, i) => metricRow({ campaign_id: 'campaign-' + i }))
  const view = buildTrafficView(rows, scope)
  assert.equal(view.groups.slice(0, 50).length, 50)
  assert.equal(view.total.spend, 10100)
  assert.equal(buildTrafficCsv(view).rows.length, 101)
  assert.equal(classifyObjective('nao_informado'), 'nao_informado')
})
test('CSV retains IDs, dates, source and definition and escapes delimiters and line breaks', () => {
  const exported = buildTrafficCsv(buildTrafficView([metricRow({ campaign_name: 'A; "quoted"\nnext' })], scope))
  const content = trafficCsvText(exported)
  assert.match(content, /123/)
  assert.match(content, /2026-10-07/)
  assert.match(content, /canonical-v1/)
  assert.match(content, /api/)
  assert(content.includes('"A; ""quoted""\nnext"'))
})
