import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'

// Envio de leads sem cadastro na VOXEN pelo CRM: botao no lead e secao VOXEN (selecionar varios). Sem janela de confirmacao.
const STAGES = [{ value: 'novo', label: 'Novo' }, { value: 'em_qualificacao', label: 'Em qualificação' }]
const toasts = []
const load = createComponentLoader({
  '@/hooks/useAuth': { useAuth: () => ({ user: { id: 'synthetic' } }) },
  '@/hooks/useRoles': { useRoles: () => ({ hasCRMAccess: true }) },
  '@/hooks/use-toast': { useToast: () => ({ toast: t => toasts.push(t) }) },
  '@/hooks/useCRM': { PIPELINE_STAGES: STAGES, useCRMContextSummary: () => ({ leadIds: new Set() }) },
  '@/hooks/useCRMVoxen': {},
  '@/lib/arena-api': {},
})
const lib = () => load('src/lib/voxen-send.ts')
const text = markup => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** Percorre a arvore de elementos de um componente sem hooks e devolve todos os elementos que tem onClick/onCheckedChange. */
function interactive(node, out = []) {
  if (Array.isArray(node)) { node.forEach(child => interactive(child, out)); return out }
  if (!node || typeof node !== 'object' || !node.props) return out
  if (typeof node.props.onClick === 'function' || typeof node.props.onCheckedChange === 'function') out.push(node)
  interactive(node.props.children, out)
  return out
}
const labelOf = node => text(renderToStaticMarkup(React.createElement(React.Fragment, null, node.props.children ?? ''))).trim()
const ids = n => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)

test('estados: validador, funcao ausente, textos e quem pode enviar ou parar', () => {
  const l = lib()
  const ok = { ready: true, rows: [{ lead_id: 'a', state: 'sent', at: '2026-10-22T01:10:00+00:00' }, { lead_id: 'b', state: 'waiting', at: null }] }
  assert(l.isVoxenSyncStates(ok)); assert(l.isVoxenSyncStates({ ready: false, rows: [] }))
  for (const bad of [null, undefined, 'x', [], {}, { ready: 'sim', rows: [] }, { ready: true }, { ready: true, rows: [{ lead_id: 1, state: 'sent', at: null }] }, { ready: true, rows: [{ lead_id: 'a', state: 'inventado', at: null }] },
    { ready: true, rows: [{ lead_id: 'a', state: 'sent', at: 'ontem' }] }, { ready: true, rows: [null] }]) assert.equal(l.isVoxenSyncStates(bad), false, JSON.stringify(bad))
  assert.equal(l.isMissingRpc({ code: 'PGRST202' }), true); assert.equal(l.isMissingRpc({ code: '42883' }), true); assert.equal(l.isMissingRpc({ code: '42501' }), false); assert.equal(l.isMissingRpc(null), false)
  const map = new Map(ok.rows.map(r => [r.lead_id, r]))
  assert.equal(l.voxenViewOf(map, 'a'), 'sent'); assert.equal(l.voxenViewOf(map, 'zzz'), 'available')
  const label = (view, at) => l.voxenStatusText(view, at).label
  assert.deepEqual(['available', 'registered', 'waiting', 'pending', 'sent', 'quarantined', 'blocked', 'stopped'].map(v => label(v)),
    ['Não enviado', 'Cadastrado na VOXEN', 'Marcado para enviar', 'Enviando para a VOXEN', 'Enviado e em sincronia', 'A VOXEN não guardou o envio', 'A VOXEN recusou o envio', 'Sincronização parada'])
  assert.match(l.voxenStatusText('sent', '2026-10-22T01:10:00+00:00').detail, /Último envio em 21\/10\/2026.*22:10:00/); assert.equal(l.voxenStatusText('quarantined').tone, 'problem'); assert.equal(l.voxenStatusText('sent').tone, 'ok')
  // enviar: so lead ainda nao escolhido (ou parado), com o que enviar, e depois que a VOXEN liberou
  for (const view of ['available', 'registered', 'waiting', 'pending', 'sent', 'quarantined', 'blocked', 'stopped']) for (const ctx of [true, false]) for (const ready of [true, false])
    assert.equal(l.canSendToVoxen(view, ctx, ready), ready && ctx && (view === 'available' || view === 'stopped'), `${view} ctx=${ctx} ready=${ready}`)
  for (const view of ['available', 'registered', 'waiting', 'pending', 'sent', 'quarantined', 'blocked', 'stopped']) assert.equal(l.canStopVoxen(view), ['waiting', 'pending', 'sent', 'quarantined', 'blocked'].includes(view), view)
  assert.deepEqual([['registered', true], ['stopped', true], ['quarantined', false], ['blocked', true], ['waiting', true], ['pending', false], ['sent', true], ['available', true], ['available', false]].map(([v, c]) => l.voxenFilterOf(v, c)),
    ['registered', 'stopped', 'problem', 'problem', 'sent', 'sent', 'sent', 'available', 'nocontext'])
})

test('blocos: 15 por chamada (o banco aceita 25), sem repetir, na ordem, e para no primeiro erro mostrando o que ja foi', async () => {
  const l = lib()
  assert(l.VOXEN_SEND_CHUNK <= 25 && l.VOXEN_SEND_CHUNK > 0)
  const all = ids(127)
  const chunks = l.chunkLeadIds([...all, ...all.slice(0, 10)])
  assert.deepEqual(chunks.map(c => c.length), [15, 15, 15, 15, 15, 15, 15, 15, 7], '127 leads, repetidos contam uma vez'); assert.deepEqual(chunks.flat(), all)
  assert.deepEqual(l.chunkLeadIds([]), []); assert.deepEqual(l.chunkLeadIds(['a', 'a']), [['a']])
  const calls = [], progress = []
  const out = await l.runVoxenBatch(all, async chunk => { calls.push(chunk.length); return chunk.map((id, i) => ({ lead_id: id, result: i % 5 === 0 ? 'nothing_to_send' : 'sent' })) }, (done, total) => progress.push([done, total]))
  assert.deepEqual(calls, [15, 15, 15, 15, 15, 15, 15, 15, 7]); assert.equal(out.requested, 127); assert.equal(out.done, 127); assert.equal(out.error, null)
  assert.equal(out.counts.sent + out.counts.nothing_to_send, 127); assert.deepEqual(progress.at(-1), [127, 127]); assert.equal(progress.length, 9)
  let n = 0
  const partial = await l.runVoxenBatch(all, async chunk => { if (++n === 3) throw Object.assign(new Error('Acesso ao CRM necessário'), { code: '42501' }); return chunk.map(id => ({ lead_id: id, result: 'sent' })) })
  assert.equal(partial.done, 30); assert.equal(partial.counts.sent, 30); assert.equal(partial.error.message, 'Acesso ao CRM necessário'); assert.equal(n, 3, 'erro de regra: nao repete e nao chama mais')
  const d = l.describeSend(partial); assert.equal(d.variant, 'destructive'); assert.match(d.description, /Acesso ao CRM necessário.*Já enviados: 30.*Tente de novo em instantes/)
  assert.deepEqual(l.describeSend({ requested: 3, done: 3, counts: { sent: 1 }, error: null }), { title: '1 lead enviado para a VOXEN', description: undefined })
  const mixed = l.describeSend({ requested: 6, done: 6, counts: { sent: 2, nothing_to_send: 1, registered: 2, not_found: 1 }, error: null })
  assert.equal(mixed.title, '2 leads enviados para a VOXEN'); assert.match(mixed.description, /1 lead ficou marcado sem nada para enviar ainda/); assert.match(mixed.description, /2 leads já estão cadastrados na VOXEN e sincronizam sozinhos/); assert.match(mixed.description, /1 lead não foi encontrado/)
  assert.equal(l.describeSend({ requested: 1, done: 1, counts: { registered: 1 }, error: null }).title, 'Nada novo foi enviado')
  assert.equal(l.describeStop({ requested: 2, done: 2, counts: { stopped: 2 }, error: null }).title, 'Sincronização parada em 2 leads'); assert.match(l.describeStop({ requested: 2, done: 2, counts: { stopped: 2 }, error: null }).description, /continua na VOXEN/)
  assert.equal(l.describeStop({ requested: 1, done: 1, counts: { not_enabled: 1 }, error: null }).title, 'Nada para parar')
})

test('falha passageira: o bloco repete (o envio e idempotente), erro de regra nao, e o que insiste em falhar para mostrando o que ja foi', async () => {
  const l = lib()
  for (const transient of [{ code: '57014', message: 'canceling statement due to statement timeout' }, { message: 'upstream request timeout' }, { code: '', message: 'Bad Gateway' }, new TypeError('Failed to fetch'),
    Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' }), { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, { code: 'voxen_timeout', message: 'x' }, { code: '40P01', message: 'deadlock detected' }])
    assert.equal(l.isTransientVoxenError(transient), true, String(transient?.message))
  for (const rule of [{ code: '42501', message: 'Acesso ao CRM necessário' }, { code: '22023', message: 'Envie de 1 a 25 leads por vez' }, { code: '55000', message: 'A VOXEN ainda não confirmou o recebimento de leads sem cadastro' },
    { code: 'PGRST202', message: 'Could not find the function public.crm_voxen_send(p_leads) in the schema cache' }, { code: '42883', message: 'function does not exist' }, null, undefined, 'texto', 42])
    assert.equal(l.isTransientVoxenError(rule), false, JSON.stringify(rule))
  const all = ids(40), sleeps = [], retries = []
  const options = { delaysMs: [2000, 6000], sleep: async ms => { sleeps.push(ms) }, onRetry: (attempt, of) => retries.push([attempt, of]) }
  // o gateway cai duas vezes no segundo bloco e volta: o envio termina inteiro, sem repetir lead e sem pular nenhum
  const seen = []; let tries = 0
  const ok = await l.runVoxenBatch(all, async chunk => { if (chunk[0] === all[15] && ++tries <= 2) throw Object.assign(new Error('upstream request timeout'), { code: '' }); seen.push(...chunk); return chunk.map(id => ({ lead_id: id, result: 'sent' })) }, undefined, options)
  assert.equal(ok.error, null); assert.equal(ok.done, 40); assert.equal(ok.counts.sent, 40); assert.deepEqual(seen, all); assert.deepEqual(sleeps, [2000, 6000]); assert.deepEqual(retries, [[1, 2], [2, 2]])
  // insiste em falhar: a chamada e mais duas novas tentativas no mesmo bloco; depois para e mostra o que ja foi
  sleeps.length = 0; let hits = 0
  const down = await l.runVoxenBatch(all, async chunk => { if (chunk[0] === all[15]) { hits++; throw new Error('upstream request timeout') } return chunk.map(id => ({ lead_id: id, result: 'sent' })) }, undefined, options)
  assert.equal(hits, 3); assert.equal(down.done, 15); assert.equal(down.counts.sent, 15); assert.equal(down.error.message, 'upstream request timeout'); assert.deepEqual(sleeps, [2000, 6000])
  assert.match(l.describeSend(down).description, /upstream request timeout.*Já enviados: 15.*não se repete/)
  // erro de regra: uma chamada so
  let calls = 0
  const denied = await l.runVoxenBatch(all, async () => { calls++; throw Object.assign(new Error('Acesso ao CRM necessário'), { code: '42501' }) }, undefined, options)
  assert.equal(calls, 1); assert.equal(denied.done, 0)
  assert.deepEqual([...l.VOXEN_RETRY_DELAYS_MS], [2000, 6000]); assert(l.VOXEN_CALL_TIMEOUT_MS > 8000 && l.VOXEN_CALL_TIMEOUT_MS <= 30000, 'passa do corte de 8 s do banco, mas nao espera para sempre')
})

test('tempo-limite: servidor que nao responde vira erro em vez de deixar o clique preso', async () => {
  const l = lib()
  let seenSignal = null
  await assert.rejects(l.withVoxenTimeout(signal => { seenSignal = signal; return new Promise(() => {}) }, 30), error => error.code === 'voxen_timeout' && /demorou para responder/.test(error.message) && l.isTransientVoxenError(error))
  assert.equal(seenSignal.aborted, true, 'a chamada de rede e cancelada junto')
  assert.equal(await l.withVoxenTimeout(async signal => { assert.equal(signal.aborted, false); return 'ok' }, 1000), 'ok')
  await assert.rejects(l.withVoxenTimeout(async () => { throw Object.assign(new Error('regra'), { code: '42501' }) }, 1000), error => error.code === '42501', 'o erro da propria chamada passa como esta')
  // ponta a ponta: servidor que nunca responde -> tres tentativas, cada uma cortada, e o envio devolve o erro depressa em vez de ficar em "Enviando 0 de N" para sempre
  const started = Date.now(); let attempts = 0
  const out = await l.runVoxenBatch(ids(20), () => l.withVoxenTimeout(() => { attempts++; return new Promise(() => {}) }, 20), undefined, { delaysMs: [5, 5] })
  assert.equal(attempts, 3); assert.equal(out.done, 0); assert.equal(out.error.code, 'voxen_timeout'); assert(Date.now() - started < 2000)
  assert.match(l.describeSend(out).description, /O servidor demorou para responder\. Tente de novo em instantes/)
})

test('fila: a tela so consulta o banco de tempos em tempos enquanto ha lead na fila', () => {
  const l = lib()
  assert.equal(l.hasVoxenInFlight(null), false); assert.equal(l.hasVoxenInFlight(undefined), false); assert.equal(l.hasVoxenInFlight({ ready: true, rows: [] }), false)
  const rows = state => ({ ready: true, rows: [{ lead_id: 'a', state, at: null }] })
  for (const state of ['registered', 'waiting', 'sent', 'quarantined', 'blocked', 'stopped']) assert.equal(l.hasVoxenInFlight(rows(state)), false, state)
  assert.equal(l.hasVoxenInFlight(rows('pending')), true)
})

const control = (over = {}) => ({ view: 'available', at: null, ready: true, hasContext: true, busy: false, onSend() {}, onStop() {}, ...over })
test('botao do lead: um clique envia, sem confirmacao; cada estado mostra o que e verdade', () => {
  const { VoxenSendControl } = load('src/components/crm/CRMVoxenSend.tsx')
  const view = over => renderToStaticMarkup(React.createElement(VoxenSendControl, control(over)))
  let html = view(); assert.match(html, /Enviar para a VOXEN/); assert.doesNotMatch(html, / disabled=""/); assert.match(html, /Não enviado/); assert.doesNotMatch(html, /Parar de sincronizar/)
  html = view({ ready: false }); assert.match(html, / disabled=""/); assert.match(text(html), /Aguardando a Zyron liberar o recebimento de leads sem cadastro/)
  html = view({ hasContext: false }); assert.match(html, / disabled=""/); assert.match(text(html), /ainda não tem respostas, notas nem dados do atleta/)
  html = view({ view: 'registered' }); assert.match(html, /Cadastrado na VOXEN/); assert.doesNotMatch(html, /<button/, 'quem ja esta na VOXEN nao tem botao')
  html = view({ view: 'pending' }); assert.match(html, /Enviando para a VOXEN/); assert.match(html, /Parar de sincronizar/); assert.doesNotMatch(html, /Enviar para a VOXEN</)
  html = view({ view: 'sent', at: '2026-10-22T01:10:00+00:00' }); assert.match(html, /Enviado e em sincronia/); assert.match(text(html), /Último envio em 21\/10\/2026/); assert.match(html, /Parar de sincronizar/)
  html = view({ view: 'waiting' }); assert.match(text(html), /Segue sozinho assim que houver respostas/); assert.match(html, /Parar de sincronizar/)
  html = view({ view: 'stopped' }); assert.match(html, /Sincronização parada/); assert.match(html, /Enviar para a VOXEN/); assert.doesNotMatch(html, /Parar de sincronizar/)
  html = view({ view: 'quarantined' }); assert.match(html, /role="alert"/); assert.match(text(html), /Avise a Zyron/)
  html = view({ view: 'blocked' }); assert.match(html, /role="alert"/); assert.match(text(html), /A VOXEN recusou o envio/)
  html = view({ busy: true }); assert.match(html, /Enviando…/); assert.match(html, / disabled=""/); assert.doesNotMatch(text(html), /Tentando de novo/)
  html = view({ busy: true, notice: 'O servidor demorou para responder. Tentando de novo (1 de 2)…' }); assert.match(text(html), /Tentando de novo \(1 de 2\)/)
  // o clique age na hora: uma chamada, sem janela no meio
  let sends = 0, stops = 0
  const send = interactive(VoxenSendControl(control({ onSend: () => sends++ }))).find(node => /Enviar para a VOXEN/.test(labelOf(node)))
  send.props.onClick(); assert.equal(sends, 1)
  const stop = interactive(VoxenSendControl(control({ view: 'sent', onStop: () => stops++ }))).find(node => /Parar de sincronizar/.test(labelOf(node)))
  stop.props.onClick(); assert.equal(stops, 1)
})

const LEADS = [
  { id: 'l1', name: 'Mae Um', athlete_name: 'Atleta Um', phone: '11999990001', email: 'um@example.invalid', pipeline_stage: 'novo' },
  { id: 'l2', name: 'Pai Dois', athlete_name: 'Atleta Dois', phone: '11999990002', email: 'dois@example.invalid', pipeline_stage: 'em_qualificacao' },
  { id: 'l3', name: 'Tio Tres', athlete_name: null, phone: '11999990003', email: 'tres@example.invalid', pipeline_stage: 'novo' },
  { id: 'l4', name: 'Mae Quatro', athlete_name: 'Atleta Quatro', phone: '11999990004', email: 'quatro@example.invalid', pipeline_stage: 'novo' },
  { id: 'l5', name: 'Mae Cinco', athlete_name: 'Atleta Cinco', phone: '11999990005', email: 'cinco@example.invalid', pipeline_stage: 'novo' },
  { id: 'l6', name: 'Mae Seis', athlete_name: 'Atleta Seis', phone: '11999990006', email: 'seis@example.invalid', pipeline_stage: 'novo' },
]
const row = (lead, view, hasContext = true, at = null) => ({ lead, view, at, hasContext, filter: lib().voxenFilterOf(view, hasContext) })
const ROWS = [row(LEADS[0], 'available'), row(LEADS[1], 'available'), row(LEADS[2], 'available', false), row(LEADS[3], 'sent', true, '2026-10-22T01:10:00+00:00'), row(LEADS[4], 'registered'), row(LEADS[5], 'blocked')]
const section = (over = {}) => ({ rows: ROWS, filter: 'available', search: '', selected: new Set(), ready: true, supported: true, busy: false, progress: null, loading: false, failure: null,
  onFilter() {}, onSearch() {}, onToggle() {}, onToggleAll() {}, onClear() {}, onSend() {}, onStop() {}, onRead() {}, onRetry() {}, ...over })

test('secao VOXEN: contagens, o que da para selecionar e os avisos de cada situacao', () => {
  const { VoxenSectionView } = load('src/components/crm/CRMVoxenSection.tsx')
  const view = over => renderToStaticMarkup(React.createElement(VoxenSectionView, section(over)))
  let html = view(); const t = text(html)
  assert.match(t, /Disponíveis · 2/); assert.match(t, /Enviados · 1/); assert.match(t, /Com problema · 1/); assert.match(t, /Parados · 0/); assert.match(t, /Cadastrados na VOXEN · 1/); assert.match(t, /Sem contexto · 1/)
  assert.match(t, /Atleta Um/); assert.match(t, /Atleta Dois/); assert.doesNotMatch(t, /Tio Tres/, 'sem contexto fica em outra aba'); assert.doesNotMatch(t, /Atleta Quatro/)
  assert.match(t, /Responsável: Mae Um/); assert.match(t, /Novo/); assert.match(t, /Em qualificação/)
  assert.match(t, /Selecionar todos \(2\)/); assert.match(t, /Enviar para a VOXEN \(0\)/); assert.match(html, /aria-pressed="true"/)
  assert.doesNotMatch(html, /11999990001|um@example.invalid/, 'nenhum telefone nem e-mail na tela')
  assert.doesNotMatch(html, /role="dialog"|alertdialog/, 'nao existe janela de confirmacao')
  html = view({ selected: new Set(['l1']) }); assert.match(text(html), /Enviar para a VOXEN \(1\)/); assert.match(text(html), /Limpar seleção/)
  html = view({ selected: new Set(['l1', 'l5', 'l3']) }); assert.match(text(html), /Enviar para a VOXEN \(1\)/, 'so conta quem pode ser enviado: cadastrado e sem contexto ficam de fora mesmo que estejam marcados')
  html = view({ ready: false }); assert.match(text(html), /Aguardando a Zyron liberar o recebimento de leads sem cadastro\. Os botões de envio ficam desativados até lá/); assert.match(text(html), /Selecionar todos \(0\)/)
  html = view({ supported: false }); assert.match(text(html), /ainda não está disponível neste ambiente/); assert.doesNotMatch(html, /Situação dos leads/)
  html = view({ failure: new Error('rede caiu') }); assert.match(html, /role="alert"/); assert.match(text(html), /rede caiu/); assert.match(text(html), /Tentar novamente/)
  html = view({ loading: true }); assert.match(html, /Carregando/); assert.doesNotMatch(html, /Situação dos leads/)
  html = view({ progress: { done: 30, total: 127 } }); assert.match(text(html), /Enviando 30 de 127…/); assert.doesNotMatch(text(html), /Tentando de novo/)
  html = view({ progress: { done: 30, total: 127 }, notice: 'O servidor demorou para responder. Tentando de novo (2 de 2)…' }); assert.match(text(html), /Enviando 30 de 127….*Tentando de novo \(2 de 2\)/)
  html = view({ search: 'dois' }); assert.match(text(html), /Atleta Dois/); assert.doesNotMatch(text(html), /Atleta Um/)
  html = view({ search: 'zzz' }); assert.match(text(html), /Nenhum lead nesta situação para essa busca/)
  html = view({ filter: 'sent' }); assert.match(text(html), /Atleta Quatro/); assert.match(text(html), /Enviado e em sincronia/); assert.match(text(html), /Parar de sincronizar \(0\)/); assert.match(text(html), /Parar/); assert.doesNotMatch(text(html), /Enviar para a VOXEN \(/)
  html = view({ filter: 'problem' }); assert.match(text(html), /Atleta Seis/); assert.match(text(html), /A VOXEN recusou o envio/)
  html = view({ filter: 'registered' }); assert.match(text(html), /Atleta Cinco/); assert.doesNotMatch(html, /type="button" role="checkbox"[^>]*aria-label="Selecionar Atleta Cinco"[^>]*aria-checked="false"(?![^>]*disabled)/, 'cadastrado nao se seleciona')
  html = view({ filter: 'nocontext' }); assert.match(text(html), /Tio Tres/); assert.match(text(html), /Sem contexto/)
  html = view({ busy: true }); assert.match(html, / disabled=""/)
})

test('secao VOXEN: os botoes agem na hora, com os ids certos e sem janela', () => {
  const { VoxenSectionView } = load('src/components/crm/CRMVoxenSection.tsx')
  const calls = []
  const props = section({ selected: new Set(['l1', 'l2']), onSend: x => calls.push(['send', x]), onStop: x => calls.push(['stop', x]), onToggleAll: x => calls.push(['all', x]), onToggle: x => calls.push(['toggle', x]), onFilter: x => calls.push(['filter', x]), onRead: x => calls.push(['read', x]), onClear: () => calls.push(['clear']) })
  const tree = VoxenSectionView(props), nodes = interactive(tree)
  const by = re => nodes.filter(node => re.test(labelOf(node)) || re.test(node.props['aria-label'] ?? ''))
  by(/Enviar para a VOXEN \(2\)/)[0].props.onClick(); assert.deepEqual(calls.pop(), ['send', ['l1', 'l2']])
  by(/^Enviar$/).forEach((node, i) => { node.props.onClick(); assert.deepEqual(calls.pop(), ['send', [i === 0 ? 'l1' : 'l2']]) })
  by(/Selecionar todos \(2\)/)[0].props.onCheckedChange(true); assert.deepEqual(calls.pop(), ['all', ['l1', 'l2']])
  by(/Selecionar Atleta Um/)[0].props.onCheckedChange(true); assert.deepEqual(calls.pop(), ['toggle', 'l1'])
  by(/Atleta Um/).find(node => typeof node.props.onClick === 'function' && node.type === 'button').props.onClick(); assert.deepEqual(calls.pop(), ['read', 'l1'])
  by(/Limpar seleção/)[0].props.onClick(); assert.deepEqual(calls.pop(), ['clear'])
  by(/Enviados · 1/)[0].props.onClick(); assert.deepEqual(calls.pop(), ['filter', 'sent'])
  const sentTree = VoxenSectionView({ ...props, filter: 'sent', selected: new Set(['l4']) }), sentNodes = interactive(sentTree)
  sentNodes.find(node => /Parar de sincronizar \(1\)/.test(labelOf(node))).props.onClick(); assert.deepEqual(calls.pop(), ['stop', ['l4']])
  sentNodes.find(node => /^Parar$/.test(labelOf(node))).props.onClick(); assert.deepEqual(calls.pop(), ['stop', ['l4']])
  // quem ja esta na VOXEN, quem esta sem contexto e quem nao foi liberado nao se seleciona
  for (const filter of ['registered', 'nocontext']) {
    const boxes = interactive(VoxenSectionView({ ...props, filter })).filter(node => typeof node.props.onCheckedChange === 'function' && /Selecionar Atleta|Selecionar Tio/.test(node.props['aria-label'] ?? ''))
    assert(boxes.length > 0 && boxes.every(node => node.props.disabled === true), filter + ': caixas desativadas')
  }
  const notReadyBoxes = interactive(VoxenSectionView({ ...props, ready: false })).filter(node => typeof node.props.onCheckedChange === 'function')
  assert(notReadyBoxes.length > 0 && notReadyBoxes.every(node => node.props.disabled === true), 'sem o recebimento liberado nada se seleciona')
  // sem o recebimento liberado nada envia
  const notReady = interactive(VoxenSectionView({ ...props, ready: false })).filter(node => /Enviar/.test(labelOf(node)))
  assert(notReady.length > 0 && notReady.every(node => node.props.disabled === true), 'botoes de envio desativados')
})

test('guardas de codigo: aba no CRM, botao na ficha, sem confirmacao, blocos e funcao ausente tratada', () => {
  const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const crm = read('src/pages/CRM.tsx')
  assert.match(crm, /<TabsTrigger[^>]*value="voxen">VOXEN<\/TabsTrigger>/); assert.match(crm, /\["leads", "results", "importados", "voxen"\]\.includes\(tab\)/)
  assert.match(crm, /tab === "voxen" \? \(\s*<CRMVoxenSection leads=\{crm\.leads\} contextIds=\{contextSummary\.leadIds\} loading=\{loading\} failure=\{failure\} onRetry=\{retry\} onRead=\{setReadId\} \/>/)
  assert.match(read('src/components/crm/CRMLeadDetail.tsx'), /<CRMVoxenSend lead=\{lead\} \/>/)
  for (const file of ['src/components/crm/CRMVoxenSend.tsx', 'src/components/crm/CRMVoxenSection.tsx']) {
    const code = read(file)
    assert.doesNotMatch(code, /AlertDialog|\bDialog\b|window\.confirm|confirm\(/, file + ' nao pode ter janela de confirmacao')
    assert.match(code, /Enviar para a VOXEN/)
  }
  const hook = read('src/hooks/useCRMVoxen.ts')
  assert.match(hook, /queryKey: \['crm', 'voxen', 'states', user\?\.id\]/, 'sob ["crm"]: mudancas em lead, nota e contexto renovam o estado'); assert.match(hook, /isMissingRpc\(error\)\) return null/)
  assert.match(hook, /refetchInterval: poll \? query => \(hasVoxenInFlight\(query\.state\.data\) \? 15_000 : false\) : false/, 'so consulta de tempos em tempos enquanto ha fila')
  assert.match(hook, /runVoxenBatch\(ids, chunk => withVoxenTimeout\(signal => arenaRpc<VoxenRpcRow\[\]>\(name, \{ p_leads: chunk \}, \{ signal \}\)\)/, 'cada bloco com tempo-limite')
  assert.match(hook, /void client\.invalidateQueries\(\{ queryKey: \['crm', 'voxen'\] \}\)/, 'o aviso do resultado nao espera a releitura')
  const api = read('src/lib/arena-api.ts')
  assert.match(api, /options\?\.signal \? call\.abortSignal\(options\.signal\) : call/)
  for (const name of ['crm_voxen_send', 'crm_voxen_stop', 'crm_voxen_sync_states']) assert.match(api, new RegExp(name + ': FunctionDef'))
})
