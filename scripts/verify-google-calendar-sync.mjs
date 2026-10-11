import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function loadModule(path, { fetch = () => { throw Error('Unexpected HTTP') }, admin, env = {}, imports = {} } = {}) {
  let handler
  const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder,
    crypto, fetch, AbortController, setTimeout, clearTimeout, btoa, atob,
    console: { error() {}, log() {} }, __admin: admin, __imports: imports,
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value } } })
  const cache = new Map()
  async function moduleFor(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = filename.startsWith('https:')
      ? 'export function createClient() { return globalThis.__admin }'
      : ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      } }).outputText
    const module = new vm.SourceTextModule(source, { context, identifier: filename })
    cache.set(filename, module)
    await module.link((specifier, parent) => moduleFor(specifier.startsWith('https:') ? specifier : resolve(dirname(parent.identifier), specifier)))
    return module
  }
  const module = await moduleFor(resolve(root, path))
  await module.evaluate()
  return { exports: module.namespace, handler }
}

const projectionPath = 'supabase/functions/_shared/google-calendar-projection.ts'
export const input = () => ({
  call: { id: '10000000-0000-4000-8000-000000000001', leadId: '20000000-0000-4000-8000-000000000001',
    callType: 'fechamento_closer', scheduledAt: '2026-10-12T02:50:00Z', assignedTo: 'closer1',
    isCompleted: false, cancelledAt: null, outcome: null, description: 'NOTA_INTERNA' },
  lead: { id: '20000000-0000-4000-8000-000000000001', name: 'Lead Teste', pipelineStage: 'repassado_closer' },
  closerName: 'Maria', projectId: 'test-project', dashboardOrigin: 'https://crm.example',
  binding: { id: '30000000-0000-4000-8000-000000000001', callId: '10000000-0000-4000-8000-000000000001',
    leadId: '20000000-0000-4000-8000-000000000001', calendarId: 'shared@example',
    eventId: '6e90a88cc9174071b2bf7fd789600cff', generation: 0, revision: '1', confirmedRevision: null, confirmedHash: null, etag: null },
})

test('projection: explicit lifecycle priority keeps completed results after the lead moves', async () => {
  const { exports: p } = await loadModule(projectionPath)
  const x = input()
  assert.equal(p.projectCall(x).kind, 'upsert')
  x.call.isCompleted = true; x.lead.pipelineStage = 'fechado_ganho'; x.call.outcome = 'venda_concluida'
  assert.equal(p.projectCall(x).kind, 'completed')
  assert.match(p.projectCall(x).event.description, /Venda concluída/)
  for (const outcome of ['devolvido_sdr', 'followup_sdr']) { x.call.outcome = outcome; assert.equal(p.projectCall(x).kind, 'remove') }
  x.call.outcome = 'venda_concluida'; x.call.cancelledAt = '2026-10-11T12:00:00Z'
  assert.equal(p.projectCall(x).kind, 'remove')
  x.call = null; assert.equal(p.projectCall(x).kind, 'remove')
  const y = input(); y.lead = null; assert.equal(p.projectCall(y).kind, 'remove')
  const z = input(); z.lead.pipelineStage = 'pronto_closer'; assert.equal(p.projectCall(z).kind, 'remove')
})

test('projection: absolute timestamps cross midnight identically in any host timezone and omit private notes', async () => {
  const { exports: p } = await loadModule(projectionPath)
  const x = input(), e = p.projectCall(x).event
  assert.equal(e.start.dateTime, '2026-10-12T02:50:00.000Z')
  assert.equal(e.end.dateTime, '2026-10-12T03:20:00.000Z')
  assert.equal(e.start.timeZone, 'America/Sao_Paulo')
  assert.equal(e.summary, 'Call de fechamento — Lead Teste | Maria')
  assert.match(e.description, /\/crm\?tab=closer&lead=20000000-0000-4000-8000-000000000001/)
  assert.ok(!JSON.stringify(e).includes('NOTA_INTERNA'))
  x.call.assignedTo = null; assert.equal(p.projectCall(x).kind, 'blocked')
  x.call.assignedTo = 'closer1'
  for (const date of ['2026-10-12T02:50:00', 'bad-date', '2026-99-01T00:00:00Z']) {
    x.call.scheduledAt = date; assert.equal(p.projectCall(x).kind, 'blocked')
  }
})

test('projection: stable distinct event identities and normalized hashes preserve external fields', async () => {
  const { exports: p } = await loadModule(projectionPath)
  assert.equal(p.googleEventId('6e90a88c-c917-4071-b2bf-7fd789600cff'), '6e90a88cc9174071b2bf7fd789600cff')
  assert.notEqual(p.googleEventId(input().call.id), p.googleEventId(input().lead.id))
  const e = p.projectCall(input()).event, copy = JSON.parse(JSON.stringify(e))
  copy.extendedProperties.private.revision = '99'; copy.attendees = [{ email: 'manual@example' }]
  assert.equal(await p.managedEventHash(e), await p.managedEventHash(copy))
  assert.equal(p.eventMatches({ ...copy, id: 'event', etag: 'v2' }, e), true)
  copy.extendedProperties.private.project_id = 'other-project'
  assert.equal(p.eventMatches(copy, e), false)
  assert.notEqual(await p.managedEventHash(copy), await p.managedEventHash(e))
})
