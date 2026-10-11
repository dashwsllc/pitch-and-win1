import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'
const load = createComponentLoader({ '@/lib/arena-api': {}, '@/hooks/useAuth': {}, '@/hooks/useRoles': {}, '@/integrations/supabase/client': {} })
const connection = load('src/lib/meta-connection.ts')
const complete = { id: 'complete', kind: 'insights', account_id: '123', level: 'campaign', status: 'success', coverage_state: 'complete', started_at: '2026-10-10T10:00:00Z', window_start: '2026-10-01', window_end: '2026-10-09', rows_synced: 300, error_message: null }
const partial = { ...complete, id: 'partial', status: 'partial', coverage_state: 'partial', started_at: '2026-10-11T10:00:00Z', error_message: 'pages_manage_ads authorization failed access_token=secret' }
test('a partial attempt remains distinct from the last completed capture, even with unsorted input', () => {
  const summary = connection.trafficRunSummary([complete, partial], '123')
  assert.equal(summary.lastAttempt.id, 'partial')
  assert.equal(summary.lastComplete.id, 'complete')
  assert.equal(summary.partial.id, 'partial')
  assert.match(summary.error, /autoriza/i)
  assert.doesNotMatch(summary.error, /secret|access_token/)
  assert.equal(connection.trafficRunSummary([complete], '999').lastComplete, null)
  assert.equal(connection.trafficRunSummary([{ ...complete, coverage_state: 'legacy' }], '123').lastComplete, null)
})
test('operation UI separates capture, publication and pending review and preserves manual import guidance', () => {
  const { TrafficOperationStatus } = load('src/components/traffic/MetaTrafficConnection.tsx')
  const html = renderToStaticMarkup(React.createElement(TrafficOperationStatus, { runs: [partial, complete], accountId: '123', pending: 2, published: { window_start: '2026-09-01', window_end: '2026-09-30' } }))
  assert.match(html, /Captura parcial/)
  assert.match(html, /Última captura completa/)
  assert.match(html, /2026-09-30/)
  assert.match(html, /2 revisões pendentes/)
  assert.match(html, /importação manual/i)
  assert.doesNotMatch(html, /secret|access_token/)
})

test('audit names capture decisions and removals and displays their immutable snapshots', () => {
 const event={id:'audit1',created_at:'2026-10-11T12:00:00Z',entity_type:'capture_review',entity_id:'review1',action:'capture.aprovado',origin:'api',actor_id:'actor',actor_name:'QA',actor_roles:[],summary:{removed:1,before:{spend:100},after:{spend:90},reason:'Conferido'}}
 const loadAudit=createComponentLoader({'@/lib/arena-api':{},'@/hooks/useAuth':{useAuth:()=>({user:{id:'actor'}})},'@/hooks/useRoles':{ROLE_LABELS:{}},'@tanstack/react-query':{useQuery:()=>({data:{events:[event],count:1},isFetching:false})}})
 const {MetaAudit}=loadAudit('src/components/traffic/MetaAudit.tsx')
 const html=renderToStaticMarkup(React.createElement(MetaAudit))
 assert.match(html,/Captura aprovada/)
 assert.match(html,/Revisão de captura/)
 assert.match(html,/1 remoções/)
 assert.match(html,/100/)
 assert.match(html,/90/)
})
