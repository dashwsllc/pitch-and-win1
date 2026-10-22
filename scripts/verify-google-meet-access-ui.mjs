// Tela de Configurações do Google Agenda: estado do acesso aberto do Meet (quem tem o link entra sem pedir para entrar). Sem navegador nem backend.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as zod from 'zod'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function load(path, imports = {}) {
  const context = vm.createContext({ URL, URLSearchParams, Map, Set, console, __imports: { zod, ...imports } }), cache = new Map()
  function moduleFor(name) {
    if (cache.has(name)) return cache.get(name)
    const external = context.__imports[name]
    const source = external ? '' : ts.transpileModule(readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const m = external ? new vm.SyntheticModule(Object.keys(external), function () { for (const k of Object.keys(external)) this.setExport(k, external[k]) }, { context, identifier: name }) : new vm.SourceTextModule(source, { context, identifier: name })
    cache.set(name, m); return m
  }
  const m = moduleFor(resolve(root, path)); await m.link((s, p) => moduleFor(context.__imports[s] ? s : s.startsWith('@/') ? resolve(root, 'src', s.slice(2)) + '.ts' : resolve(dirname(p.identifier), s)))
  await m.evaluate(); return m.namespace
}
const STATES = ['unknown', 'open', 'scope_missing', 'api_disabled', 'not_permitted', 'error']
const base = { configured: true, connection: 'connected', calendar: { id: 'shared@group.calendar.google.com', name: 'agenda - closers', accessRole: 'writer', timeZone: 'America/Sao_Paulo' }, destinationLocked: true, activatedAt: '2026-10-12T04:18:58Z', lastRunAt: null, pendingCount: 0, errorCount: 0, backfillPending: false, errorCode: null }
const db = data => ({ '@/integrations/supabase/client': { supabase: { functions: { invoke: async () => ({ data, error: null }) } } } })

test('textos: cada estado diz o que acontece e o que fazer; só falta de permissão pede reconexão', async () => {
  const lib = await load('src/lib/google-calendar-meet.ts')
  const views = Object.fromEntries(STATES.map(state => [state, lib.meetAccessView(state)]))
  assert.deepEqual(STATES.filter(state => views[state].reconnect), ['scope_missing'])
  assert.equal(views.open.tone, 'ok'); assert.match(views.open.detail, /sem precisar pedir para entrar/)
  assert.match(views.scope_missing.detail, /Reconecte o Google/); assert.match(views.api_disabled.detail, /https:\/\/console\.cloud\.google\.com\/apis\/library\/meet\.googleapis\.com/)
  assert.equal(views.not_permitted.tone, 'problem'); assert.match(views.not_permitted.detail, /admitido na sala/); assert.equal(views.unknown.tone, 'neutral')
  for (const state of STATES) { assert.ok(views[state].label && views[state].detail, state); assert.doesNotMatch(JSON.stringify(views[state]), /token|secret|undefined/i) }
  assert.equal(lib.meetAccessView('qualquer-coisa').label, views.unknown.label, 'estado desconhecido cai em "ainda não verificado"')
})

test('contrato: o status aceita meetAccess (opcional), recusa estado inventado e continua recusando campo estranho', async () => {
  const api = await load('src/lib/google-calendar-api.ts', db(base))
  assert.equal((await api.manageCalendar({ action: 'status' })).connection, 'connected')
  for (const state of STATES) {
    const ok = await load('src/lib/google-calendar-api.ts', db({ ...base, meetAccess: { state, checkedAt: state === 'unknown' ? null : '2026-10-22T20:00:00+00:00' } }))
    assert.equal((await ok.manageCalendar({ action: 'status' })).meetAccess.state, state)
  }
  for (const bad of [{ state: 'aberto', checkedAt: null }, { state: 'open' }, { state: 'open', checkedAt: 'ontem' }, { state: 'open', checkedAt: null, token: 'SECRET' }, 'open'])
    await assert.rejects((await load('src/lib/google-calendar-api.ts', db({ ...base, meetAccess: bad }))).manageCalendar({ action: 'status' }), /invalid_calendar_response/, JSON.stringify(bad))
  await assert.rejects((await load('src/lib/google-calendar-api.ts', db({ ...base, accessToken: 'SECRET' }))).manageCalendar({ action: 'status' }), /invalid_calendar_response/)
})

async function render(status, requests = []) {
  const passthrough = ({ children, ...p }) => React.createElement('div', p, children)
  const cells = []; let index = 0
  const ui = await load('src/components/settings/GoogleCalendarIntegration.tsx', {
    react: { useCallback: fn => fn, useEffect: () => {}, useState: initial => { const k = index++; if (!(k in cells)) cells[k] = initial; return [cells[k], v => cells[k] = typeof v === 'function' ? v(cells[k]) : v] } }, 'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { useSearchParams: () => [new URLSearchParams(), () => {}] },
    '@/hooks/useGoogleCalendar': { useGoogleCalendarAdmin: () => ({ allowed: true, sessionKey: 'A:0', isCurrent: () => true, status, query: { isLoading: false, error: null }, isPending: false, mutateAsync: async r => { requests.push(r); return r.action === 'start_oauth' ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } : status } }) },
    '@/components/ui/card': { Card: passthrough, CardContent: passthrough, CardHeader: passthrough, CardTitle: passthrough },
    '@/components/ui/button': { Button: passthrough }, '@/components/ui/label': { Label: passthrough },
  }, undefined)
  index = 0; return ui.GoogleCalendarIntegration()
}
const elements = tree => { const found = []; const walk = v => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach(walk); return } if (v.props) { found.push(v); walk(v.props.children) } }; walk(tree); return found }
const textOf = tree => elements(tree).map(n => { const c = n.props.children; return typeof c === 'string' ? c : Array.isArray(c) && c.every(x => typeof x === 'string') ? c.join('') : '' }).join(' ').replace(/\s+/g, ' ')
const flat = tree => JSON.stringify(tree, (_k, v) => typeof v === 'function' ? undefined : v)

test('tela: mostra o acesso aberto só com a sincronização ativa; reconectar aparece só quando falta a permissão', async () => {
  const none = await render({ ...base }); assert.doesNotMatch(flat(none), /Acesso aberto do Meet/, 'banco sem a migration: nada novo na tela')
  const inactive = await render({ ...base, activatedAt: null, meetAccess: { state: 'open', checkedAt: null } }); assert.doesNotMatch(flat(inactive), /Acesso aberto do Meet/, 'sem sincronização ativa não há o que mostrar')
  const open = await render({ ...base, meetAccess: { state: 'open', checkedAt: '2026-10-22T20:00:00+00:00' } })
  assert.match(textOf(open), /Acesso aberto do Meet: ativo/); assert.match(flat(open), /sem precisar pedir para entrar/)
  assert.ok(!elements(open).some(n => n.props.children === 'Reconectar Google'), 'tudo certo: sem botão de reconectar')
  for (const state of STATES.filter(s => s !== 'scope_missing')) assert.ok(!elements(await render({ ...base, meetAccess: { state, checkedAt: null } })).some(n => n.props.children === 'Reconectar Google'), state)
  const requests = [], missing = await render({ ...base, meetAccess: { state: 'scope_missing', checkedAt: '2026-10-22T20:00:00+00:00' } }, requests)
  assert.match(textOf(missing), /Acesso aberto do Meet: falta uma permissão/)
  const button = elements(missing).find(n => n.props.children === 'Reconectar Google'); assert.ok(button, 'botão de reconectar')
  const hadNavigation = { assigned: null }; globalThis.window = { location: { assign: url => { hadNavigation.assigned = url } } }
  try { await button.props.onClick(); await new Promise(resolve => setImmediate(resolve)) } finally { delete globalThis.window }
  assert.deepEqual(requests.map(r => r.action), ['start_oauth'], 'o botão inicia a autorização, sem tocar em mais nada')
  assert.equal(JSON.stringify(requests[0]), JSON.stringify({ action: 'start_oauth' }))
  const problem = elements(await render({ ...base, meetAccess: { state: 'not_permitted', checkedAt: null } })).find(n => n.props.role === 'alert' && /Acesso aberto/.test(flat(n.props.children)))
  assert.ok(problem, 'recusa do Google é alerta')
  const api = await render({ ...base, meetAccess: { state: 'api_disabled', checkedAt: null } }); assert.match(flat(api), /meet\.googleapis\.com/)
})

test('tela: o texto do cabeçalho continua dizendo de quem é a agenda e o resto da tela não mudou', async () => {
  const code = readFileSync(resolve(root, 'src/components/settings/GoogleCalendarIntegration.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(code, /Agenda compartilhada da empresa/); assert.match(code, /Desconectar e pausar/); assert.match(code, /Tentar pendências novamente/)
  assert.match(code, /\{active&&status\.meetAccess&&/, 'só aparece com a sincronização ativa e o campo presente')
})
