import assert from 'node:assert/strict'
import test from 'node:test'
import { loadHandler } from './helpers/meta-edge-harness.mjs'

const context = (level = 'campaign') => ({ account: { id: '123', name: 'Conta', currency: 'BRL', timezone: 'America/Sao_Paulo' }, level, objective: 'OUTCOME_SALES', graphVersion: 'v26.0',
  params: { level, fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,action_values', use_unified_attribution_setting: 'true' } })
const pair = (type, value) => ({ action_type: type, value: String(value) })
async function build(input, level) {
  const { exports } = await loadHandler('_shared/meta-insights.ts', { admin: {}, fetch: () => { throw new Error('sem rede') } })
  return JSON.parse(JSON.stringify(exports.buildInsightRow(input, context(level))))
}
const base = { date_start: '2026-10-09', campaign_id: 'c1', campaign_name: 'Vendas site', spend: '100.40', impressions: '12000', reach: '9000', inline_link_clicks: '300' }

test('Sales funnel uses one canonical action per metric, never the sum of aliases', async () => {
  const row = await build({ ...base, actions: [pair('landing_page_view', 220), pair('omni_landing_page_view', 220),
    pair('add_to_cart', 40), pair('omni_add_to_cart', 40), pair('offsite_conversion.fb_pixel_add_to_cart', 40),
    pair('initiate_checkout', 12), pair('omni_initiated_checkout', 12), pair('purchase', 3), pair('omni_purchase', 3)],
    action_values: [pair('purchase', 900), pair('omni_purchase', 900)] })
  assert.equal(row.landing_page_views, 220); assert.equal(row.adds_to_cart, 40); assert.equal(row.checkouts_initiated, 12)
  assert.equal(row.purchases, 3); assert.equal(row.purchase_value, 900); assert.equal(row.spend, 100.4)
  for (const metric of ['landing_page_views', 'adds_to_cart', 'checkouts_initiated', 'purchases', 'purchase_value']) assert(row.available_metrics.includes(metric), metric)
  assert.equal(row.metric_metadata.landing_page_view_action, 'landing_page_view')
  assert.equal(row.metric_metadata.add_to_cart_action, 'add_to_cart')
  assert.equal(row.metric_metadata.checkout_action, 'initiate_checkout')
  assert.equal(row.metric_metadata.attribution_setting, 'unified')
  assert.equal(row.metric_metadata.definition_version, 'canonical-v1')
  assert.match(row.attribution_window, /Gerenciador/)
})

test('falls back to the next alias only when the first is absent', async () => {
  const row = await build({ ...base, actions: [pair('omni_landing_page_view', 150), pair('offsite_conversion.fb_pixel_add_to_cart', 25), pair('omni_initiated_checkout', 9)] })
  assert.equal(row.landing_page_views, 150); assert.equal(row.adds_to_cart, 25); assert.equal(row.checkouts_initiated, 9)
  assert.equal(row.metric_metadata.landing_page_view_action, 'omni_landing_page_view')
  assert.equal(row.metric_metadata.add_to_cart_action, 'offsite_conversion.fb_pixel_add_to_cart')
  assert.equal(row.metric_metadata.checkout_action, 'omni_initiated_checkout')
})

test('absent funnel actions are unavailable, not a confirmed zero; a reported zero stays available', async () => {
  const none = await build({ ...base, actions: [pair('link_click', 50)] })
  assert.equal(none.landing_page_views, 0)
  for (const metric of ['landing_page_views', 'adds_to_cart', 'checkouts_initiated']) assert(!none.available_metrics.includes(metric), metric)
  const zero = await build({ ...base, actions: [pair('add_to_cart', 0)] })
  assert.equal(zero.adds_to_cart, 0); assert(zero.available_metrics.includes('adds_to_cart'))
})

test('malformed funnel values fail instead of publishing guesses', async () => {
  await assert.rejects(() => build({ ...base, actions: [pair('landing_page_view', -5)] }), /inválida/)
  await assert.rejects(() => build({ ...base, actions: [pair('add_to_cart', 'abc')] }), /inválida/)
  await assert.rejects(() => build({ ...base, actions: [pair('initiate_checkout', 3), pair('initiate_checkout', 4)] }), /inválida/)
})

test('ad level keeps its own identities for funnel rows', async () => {
  const row = await build({ ...base, adset_id: 's1', adset_name: 'Conjunto', ad_id: 'a1', ad_name: 'Anúncio', actions: [pair('landing_page_view', 5)] }, 'ad')
  assert.equal(row.level, 'ad'); assert.equal(row.adset_id, 's1'); assert.equal(row.ad_id, 'a1'); assert.equal(row.landing_page_views, 5)
})
