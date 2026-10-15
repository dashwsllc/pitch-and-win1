import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { enrichMetaCapture, fetchFormRaw, fetchLeadRaw, FORM_FIELD_TIERS, LEAD_FIELD_TIERS } from './meta-lead-raw.ts'
import { MetaGraphError } from './meta-graph.ts'

type Reply = { status?: number; body: unknown }
// Graph falsa: responde por caminho + lista de campos pedidos e registra tudo que foi pedido.
function fakeGraph(handler: (path: string, fields: string) => Reply) {
  const requests: { path: string; fields: string }[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const path = url.pathname.replace(/^\/v[\d.]+/, ''), fields = url.searchParams.get('fields') ?? ''
    requests.push({ path, fields })
    const reply = handler(path, fields)
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } }))
  }) as typeof fetch
  return { requests, restore: () => { globalThis.fetch = original } }
}
const graphError = (code: number, message: string): Reply => ({ status: 400, body: { error: { code, message } } })
function fakeAdmin(replies: Record<string, unknown>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const admin = { rpc: (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: replies[name] ?? null, error: null }) } }
  return { admin: admin as unknown as SupabaseClient, calls }
}
const far = () => Date.now() + 60000

Deno.test('lead: pede todos os campos conhecidos e guarda o retorno inteiro, inclusive campos novos', async () => {
  const raw = { id: '1', ad_name: 'A', adset_name: 'B', platform: 'ig', is_organic: false, campo_que_a_meta_criar_amanha: { x: 1 }, field_data: [] }
  const graph = fakeGraph(() => ({ body: raw }))
  try {
    const got = await fetchLeadRaw('1', 'token', { deadlineMs: far() })
    assertEquals(got.raw, raw); assertEquals(got.fields, LEAD_FIELD_TIERS[0])
    assertEquals(graph.requests.length, 1)
    for (const field of ['field_data', 'custom_disclaimer_responses', 'ad_name', 'adset_name', 'adset_id', 'platform', 'is_organic', 'campaign_name']) assert(graph.requests[0].fields.split(',').includes(field), field)
  } finally { graph.restore() }
})

Deno.test('lead: campo que a Meta nao aceita (erro 100) cai para a lista anterior e a captura continua', async () => {
  const graph = fakeGraph((_path, fields) => fields === LEAD_FIELD_TIERS[0] ? graphError(100, '(#100) Tried accessing nonexisting field (partner_name)') : { body: { id: '1', field_data: [{ name: 'a', values: ['b'] }] } })
  try {
    const got = await fetchLeadRaw('1', 'token', { deadlineMs: far() })
    assertEquals(got.fields, LEAD_FIELD_TIERS[1]); assertEquals(graph.requests.map(r => r.fields), [LEAD_FIELD_TIERS[0], LEAD_FIELD_TIERS[1]])
    assertEquals((got.raw.field_data as unknown[]).length, 1)
  } finally { graph.restore() }
})

Deno.test('lead: sem nenhum dos campos extras, ainda pega as respostas (lista basica)', async () => {
  const graph = fakeGraph((_path, fields) => fields === LEAD_FIELD_TIERS[2] ? { body: { id: '1', field_data: [] } } : graphError(100, 'campo invalido'))
  try { assertEquals((await fetchLeadRaw('1', 'token', { deadlineMs: far() })).fields, LEAD_FIELD_TIERS[2]); assertEquals(graph.requests.length, 3) } finally { graph.restore() }
})

Deno.test('lead: erro de credencial nao e confundido com campo invalido (nao tenta outras listas)', async () => {
  const graph = fakeGraph(() => graphError(190, 'token expirado'))
  try {
    const error = await assertRejects(() => fetchLeadRaw('1', 'token', { deadlineMs: far() }), MetaGraphError)
    assertEquals(error.code, 190); assertEquals(graph.requests.length, 1)
  } finally { graph.restore() }
})

Deno.test('lead que a Meta nao devolve: todas as listas dao erro 100 e o erro chega a quem chamou', async () => {
  const graph = fakeGraph(() => graphError(100, 'Unsupported get request. Object does not exist'))
  try { const error = await assertRejects(() => fetchLeadRaw('1', 'token', { deadlineMs: far() }), MetaGraphError); assertEquals(error.code, 100); assertEquals(graph.requests.length, 3) } finally { graph.restore() }
})

Deno.test('formulario: pede as perguntas com o texto das opcoes e cai para listas menores se preciso', async () => {
  const graph = fakeGraph((_path, fields) => fields === FORM_FIELD_TIERS[0] ? graphError(100, 'campo invalido') : { body: { id: 'F', name: 'Form', questions: [{ key: 'k', label: 'L' }] } })
  try {
    const got = await fetchFormRaw('F', 'token', { deadlineMs: far() })
    assertEquals(got.fields, FORM_FIELD_TIERS[1]); assert(FORM_FIELD_TIERS[0].includes('options{key,value}') && FORM_FIELD_TIERS[0].includes('questions'))
  } finally { graph.restore() }
})

Deno.test('recuperacao: grava o retorno de cada lead, marca o que a Meta nao devolve e para em erro de credencial', async () => {
  const graph = fakeGraph(path => path === '/A' ? { body: { id: 'A', ad_name: 'X' } } : path === '/B' ? graphError(100, 'Object does not exist') : graphError(190, 'token expirado'))
  const { admin, calls } = fakeAdmin({ meta_lead_raw_missing: [{ meta_lead_id: 'A', page_id: 'P', form_id: 'F' }, { meta_lead_id: 'B', page_id: 'P', form_id: 'F' }, { meta_lead_id: 'C', page_id: 'P', form_id: 'F' },
    { meta_lead_id: 'D', page_id: 'P', form_id: 'F' }] })
  try {
    const result = await enrichMetaCapture(admin, () => Promise.resolve('token'), far())
    assertEquals([result.leads, result.unavailable], [1, 1]); assertEquals(result.attention.length, 1)
    const stores = calls.filter(c => c.name === 'meta_lead_raw_store')
    assertEquals(stores.map(c => [c.args.p_meta_lead_id, c.args.p_fields]), [['A', LEAD_FIELD_TIERS[0]], ['B', 'unavailable']])
    assertEquals(stores[0].args.p_raw, { id: 'A', ad_name: 'X' }); assert(String((stores[1].args.p_raw as { _unavailable: string })._unavailable).includes('does not exist'))
    assert(!graph.requests.some(r => r.path === '/D'), 'para depois do erro de credencial')
    assert(!calls.some(c => c.name === 'meta_form_definition_missing'), 'nao segue para os formularios depois de erro de credencial')
  } finally { graph.restore() }
})

Deno.test('recuperacao: guarda a definicao de cada formulario e marca o que a Meta nao devolve', async () => {
  const graph = fakeGraph(path => path === '/F1' ? { body: { id: 'F1', name: 'Formulario Um', questions: [{ key: 'q', label: 'Pergunta?', options: [{ key: 'a', value: 'Opcao A' }] }] } } : graphError(100, 'Object does not exist'))
  const { admin, calls } = fakeAdmin({ meta_lead_raw_missing: [], meta_form_definition_missing: [{ form_id: 'F1', page_id: 'P' }, { form_id: 'F2', page_id: 'P' }] })
  try {
    const result = await enrichMetaCapture(admin, () => Promise.resolve('token'), far())
    assertEquals(result.forms, 1)
    const stores = calls.filter(c => c.name === 'meta_form_definition_store')
    assertEquals(stores.map(c => c.args.p_form_id), ['F1', 'F2']); assertEquals(stores[0].args.p_name, 'Formulario Um')
    assertEquals((stores[0].args.p_raw as { questions: { options: unknown[] }[] }).questions[0].options.length, 1)
    assertEquals(stores[1].args.p_raw, { id: 'F2', _unavailable: (stores[1].args.p_raw as { _unavailable: string })._unavailable })
  } finally { graph.restore() }
})

Deno.test('recuperacao: sem tempo, nao chama a Meta nem grava nada', async () => {
  const graph = fakeGraph(() => ({ body: {} }))
  const { admin, calls } = fakeAdmin({ meta_lead_raw_missing: [{ meta_lead_id: 'A', page_id: 'P', form_id: 'F' }] })
  try {
    const result = await enrichMetaCapture(admin, () => Promise.resolve('token'), Date.now() + 1000)
    assertEquals([result.leads, result.forms], [0, 0]); assertEquals(graph.requests.length, 0); assert(!calls.some(c => c.name === 'meta_lead_raw_store'))
  } finally { graph.restore() }
})

Deno.test('recuperacao: falha ao gravar um lead nao impede os seguintes', async () => {
  const graph = fakeGraph(path => ({ body: { id: path.slice(1) } }))
  let n = 0
  const admin = { rpc: (name: string, _args: Record<string, unknown>) => Promise.resolve(name === 'meta_lead_raw_missing'
    ? { data: [{ meta_lead_id: 'A', page_id: 'P', form_id: 'F' }, { meta_lead_id: 'B', page_id: 'P', form_id: 'F' }], error: null }
    : name === 'meta_lead_raw_store' && n++ === 0 ? { data: null, error: new Error('banco indisponivel') } : { data: [], error: null }) } as unknown as SupabaseClient
  try { const result = await enrichMetaCapture(admin, () => Promise.resolve('token'), far()); assertEquals(result.leads, 1) } finally { graph.restore() }
})
