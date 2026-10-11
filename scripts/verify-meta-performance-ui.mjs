import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadComponent } from './helpers/meta-component-harness.mjs'
import { metricRow, scope, cohort } from './helpers/meta-view-fixtures.mjs'
const { buildTrafficView } = loadComponent('src/lib/meta-traffic-view.ts')
const { MetaTrafficPerformance } = loadComponent('src/components/traffic/MetaTrafficPerformance.tsx')
const render = props => renderToStaticMarkup(React.createElement(MetaTrafficPerformance, { onRetry() {}, ...props }))

test('CRM query error renders a visible alert, retry and unavailable real rates', () => {
  const rows = [metricRow()]
  const html = render({ view: buildTrafficView(rows, scope), queryState: { state: 'ready', data: rows }, cohortState: { state: 'error', message: 'CRM temporariamente indisponível' } })
  assert.match(html, /role="alert"/)
  assert.match(html, /CRM temporariamente indisponível/)
  assert.match(html, /Tentar novamente/)
  const crm = html.slice(html.indexOf('CPA real'))
  assert.match(crm, /—/)
  assert.doesNotMatch(crm, /0\.00x|0,00x/)
})
test('metric query failure does not render an empty successful performance', () => {
  const html = render({ view: null, queryState: { state: 'error', message: 'Métricas indisponíveis' }, cohortState: null })
  assert.match(html, /Métricas indisponíveis/)
  assert.doesNotMatch(html, /Nenhum dado|R\$.*0,00/)
})
test('selected campaign excludes other names and ad level shows its actual entities', () => {
  const rows = [metricRow(), metricRow({ campaign_id: 'B', campaign_name: 'Campaign B' })]
  const html = render({ view: buildTrafficView(rows, { ...scope, campaignId: 'A' }), queryState: { state: 'ready', data: rows }, cohortState: { state: 'ready', data: cohort } })
  assert.match(html, /Campaign A/)
  assert.doesNotMatch(html, /Campaign B/)
  const ads = [metricRow({ level: 'ad', adset_id: 'set1', ad_id: 'ad1', ad_name: 'Anúncio único' })]
  const adHtml = render({ view: buildTrafficView(ads, { ...scope, level: 'ad' }), queryState: { state: 'ready', data: ads }, cohortState: null })
  assert.match(adHtml, /Anúncios/)
  assert.match(adHtml, /Anúncio único/)
  assert.doesNotMatch(adHtml, /CPA real/)
})
test('rendered table has fifty rows while its total retains all 101 entities', () => {
  const rows = Array.from({ length: 101 }, (_, i) => metricRow({ campaign_id: 'id-' + i, campaign_name: 'Entity ' + i }))
  const html = render({ view: buildTrafficView(rows, scope), queryState: { state: 'ready', data: rows }, cohortState: null })
  assert.equal(html.match(/<tr[ >]/g).length, 51)
  assert.match(html, /101 entidades/)
  assert.match(html, /10\.100,00/)
  assert.match(html, /Página 1 de 3/)
})
