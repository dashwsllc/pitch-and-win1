// Proteções de carga do navegador (sem navegador nem backend): cadência das atualizações automáticas, disjuntor que pausa tudo quando o servidor sofre,
// política de retentativa e limitação de ritmo da releitura geral. Contexto: em 22-23/10 o banco (instância Nano) travou e cada aba aberta continuou repetindo
// todas as consultas (3 tentativas cada, a cada 20-30 s, tudo ao mesmo tempo), o que mantinha o banco saturado.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { globSync } from '../node_modules/tinyglobby/dist/index.mjs'
import { MIN_POLL_MS, POLL, jittered, nextRefreshDelay, pollEvery, REMOTE_REFRESH_JITTER_MS, REMOTE_REFRESH_MIN_GAP_MS } from '../src/lib/polling.ts'
import { createOutageGuard, isBackendOverload, retryDelay, retryDelayWith, retryPolicy } from '../src/lib/outage-guard.ts'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'

const root = resolve(import.meta.dirname, '..')

// ---------- cadência ----------
test('toda cadência configurada é de pelo menos 45 s e o sorteio nunca diminui o intervalo', () => {
  assert.equal(MIN_POLL_MS, 45_000)
  for (const [name, ms] of Object.entries(POLL)) assert(ms >= MIN_POLL_MS, `${name}: ${ms} ms < 45 s`)
  for (const ms of [45_000, 60_000, 120_000]) {
    assert.equal(jittered(ms, 0.25, () => 0), ms, 'sorteio 0 = intervalo base')
    assert.equal(jittered(ms, 0.25, () => 0.999999), Math.round(ms * 1.25), 'sorteio máximo = +25%')
    for (let i = 0; i < 200; i++) { const v = pollEvery(ms)(); assert(v >= ms && v <= Math.round(ms * 1.25), `${v} fora de [${ms}, ${ms * 1.25}]`) }
  }
  assert.equal(typeof pollEvery(60_000), 'function'); assert(Number.isFinite(pollEvery(60_000)()), 'sempre devolve número (o ciclo nunca para)')
})

test('nenhuma atualização automática do app (refetchInterval) fica abaixo de 45 s', async () => {
  const files = await globSync(['src/**/*.ts', 'src/**/*.tsx'], { cwd: root, absolute: true })
  const found = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8'), rel = file.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', '')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'refetchInterval') found.push({ rel, expr: node.initializer.getText(source) })
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert(found.length >= 18, `esperava achar os pollers do app (achei ${found.length})`)
  // única exceção documentada: a aba VOXEN relê o estado de 15 em 15 s SÓ enquanto há envio em andamento (acaba sozinho quando termina)
  const allowed = new Set(['src/hooks/useCRMVoxen.ts'])
  const bad = found.filter(f => !allowed.has(f.rel) && !/\bpollEvery\(/.test(f.expr) && !/^false$/.test(f.expr.trim()))
  assert.deepEqual(bad, [], `refetchInterval sem pollEvery(...) / abaixo do mínimo:\n${bad.map(b => `${b.rel}: ${b.expr}`).join('\n')}`)
  assert(found.some(f => f.rel === 'src/hooks/useCRMVoxen.ts'), 'a exceção documentada ainda existe (se saiu, remova-a da lista)')
  // quem recebe o intervalo de fora também respeita o piso
  const op = readFileSync(resolve(root, 'src/hooks/useTrafficOperation.ts'), 'utf8')
  assert.match(op, /Math\.max\(refetchInterval, MIN_POLL_MS\)/, 'useTrafficOperation aplica o piso de 45 s')
})

test('quem usa setInterval no app continua só com os temporizadores conhecidos (relógios, não consultas)', async () => {
  const files = await globSync(['src/**/*.ts', 'src/**/*.tsx'], { cwd: root, absolute: true })
  const queryTimers = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    // ArenaView: o setInterval de 1 s só atualiza o relógio local (setNow) e o arquivo não fala com o servidor; o "refetch" dali é o botão manual de recarregar
    const onlyLocalClock = file.replaceAll('\\', '/').endsWith('src/components/arena/ArenaView.tsx') && /setInterval\(\(\) => setNow\(/.test(text) && !/arenaRpc|supabase\./.test(text)
    if (!onlyLocalClock && /setInterval\(/.test(text) && /\b(supabase|arenaRpc|arenaClient|invalidateQueries|refetch)\b/.test(text)) queryTimers.push(file.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''))
  }
  // temporizadores que tocam o servidor, cada um com intervalo >= 10 s e protegido por aba visível (revisão do cursor, sessão, agenda)
  assert.deepEqual(queryTimers.sort(), ['src/components/DataSync.tsx', 'src/hooks/useAuth.tsx', 'src/pages/Agenda.tsx'].sort(), 'surgiu um temporizador novo que toca o servidor: confira o intervalo e inclua aqui')
  const agenda = readFileSync(resolve(root, 'src/pages/Agenda.tsx'), 'utf8')
  assert.match(agenda, /realtimeUnavailable\s*\?\s*15_000\s*:\s*30_000/, 'a Agenda só relê a cada 15 s quando o Realtime está fora')
})

// ---------- limitação de ritmo da releitura geral ----------
test('releitura geral: a primeira é quase imediata, as seguintes respeitam o intervalo mínimo e uma rajada vira uma só', () => {
  const base = { minGapMs: REMOTE_REFRESH_MIN_GAP_MS, baseMs: 120, jitterMs: REMOTE_REFRESH_JITTER_MS }
  assert.equal(REMOTE_REFRESH_MIN_GAP_MS, 10_000)
  assert.equal(nextRefreshDelay({ ...base, now: 1_000_000, lastStartedAt: 0, random: () => 0 }), 120, 'primeira vez: 120 ms')
  assert.equal(nextRefreshDelay({ ...base, now: 1_000_000, lastStartedAt: 0, random: () => 0.999999 }), 120 + REMOTE_REFRESH_JITTER_MS - 1, 'folga máxima só soma o sorteio')
  assert.equal(nextRefreshDelay({ ...base, now: 1_000_000, lastStartedAt: 999_000, random: () => 0 }), 9_000, '1 s depois da última: espera os 9 s que faltam')
  assert.equal(nextRefreshDelay({ ...base, now: 1_010_000, lastStartedAt: 1_000_000, random: () => 0 }), 120, 'passado o intervalo: volta ao atraso base')
  assert.equal(nextRefreshDelay({ ...base, now: 2_000_000, lastStartedAt: 1_000_000, random: () => 0 }), 120, 'muito tempo depois: base')
  for (let i = 0; i < 100; i++) { const d = nextRefreshDelay({ ...base, now: 1_003_000, lastStartedAt: 1_000_000 }); assert(d >= 7_000 && d <= 8_700, `${d}`) }
  // simulação: 40 avisos em 30 s => no máximo 4 releituras (uma a cada ~10 s), e a última mudança sempre entra numa releitura posterior
  let t = 0, last = 0, runs = 0, pending = false, dueAt = 0
  for (let ms = 0; ms <= 40_000; ms += 750) {
    t = ms
    if (pending && t >= dueAt) { pending = false; runs++; last = t }
    if (ms <= 30_000 && !pending) { pending = true; dueAt = t + nextRefreshDelay({ ...base, now: t, lastStartedAt: last, random: () => 0 }) }
  }
  assert(runs >= 3 && runs <= 5, `rajada de 30 s deveria virar ~3-4 releituras, virou ${runs}`)
})

test('DataSync usa a limitação de ritmo, nunca re-lê na hora depois de uma falha e a releitura enfileirada respeita o intervalo', () => {
  const src = readFileSync(resolve(root, 'src/components/DataSync.tsx'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(src, /nextRefreshDelay\(\{/); assert.match(src, /REMOTE_REFRESH_MIN_GAP_MS/)
  assert.match(src, /if \(pendingRefresh\) return/, 'throttle: nao reagenda enquanto ha uma agendada')
  assert.doesNotMatch(src, /window\.clearTimeout\(debounce\)\n\s*debounce = window\.setTimeout\(async/, 'o debounce que adiava para sempre sumiu')
  assert.match(src, /lastRunAt/, 'relógio da limitação separado do da reconciliação')
  assert.match(src, /refreshQueued && !disposed\) \{ refreshQueued = false; refresh\(\) \}/, 'a enfileirada volta pelo refresh() (com intervalo), não em laço imediato')
  assert.doesNotMatch(src, /while \(refreshQueued/, 'sem laço imediato de repetição')
})

// ---------- sobrecarga do servidor ----------
test('isBackendOverload: reconhece sobrecarga e indisponibilidade, e só isso', () => {
  const yes = [
    { status: 504 }, { status: 503, message: 'x' }, { status: 502 }, { status: 429 }, { status: 408 }, { status: 522 }, { context: { status: 504 } },
    { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }, { code: 'PGRST002' }, { code: '57014', message: 'canceling statement due to statement timeout' },
    // cada código de sobrecarga sozinho (sem texto), para o teste não passar pelo caminho da mensagem
    ...['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014', '53300', '57P01', '57P03', '08000', '08003', '08006', '55P03'].map(code => ({ code })),
    ...[408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524].map(status => ({ status })),
    { code: '53300' }, { code: '57P01' }, { code: '55P03' }, { message: 'upstream request timeout' }, { message: 'Failed to fetch' }, { name: 'TypeError', message: 'NetworkError when attempting to fetch resource.' },
    { message: 'FATAL: remaining connection slots are reserved for non-replication superuser connections' }, { name: 'AbortError', message: 'The operation timed out' },
  ]
  for (const e of yes) assert.equal(isBackendOverload(e), true, `deveria contar: ${JSON.stringify(e)}`)
  const no = [
    null, undefined, 'x', 42, {}, { status: 400 }, { status: 401 }, { status: 403 }, { status: 404 }, { status: 409 }, { status: 422 },
    { code: '42501', message: 'permission denied for table' }, { code: 'PT409', message: 'A leva mudou' }, { code: '40001' }, { code: '23505', message: 'duplicate key' }, { code: '22023' },
    { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, { message: 'Acesso não autorizado' }, { message: 'Importação alterada; recarregue' },
  ]
  for (const e of no) assert.equal(isBackendOverload(e), false, `NÃO deveria contar: ${JSON.stringify(e)}`)
})

function harness(over = {}) {
  let now = 1_000_000, nextId = 1
  const timers = new Map(), online = []
  const guard = createOutageGuard({ setOnline: v => online.push(v), now: () => now, random: () => 0, setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id }, clearTimer: id => timers.delete(id), ...over })
  const advance = ms => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn() } }
  return { guard, online, timers, advance, tick: ms => { now += ms }, get now() { return now } }
}
const OVERLOAD = { status: 504, message: 'upstream request timeout' }

test('disjuntor: abre depois de 5 falhas de sobrecarga em 30 s, pausa e volta sozinho', () => {
  const h = harness(), seen = []
  h.guard.subscribe(() => seen.push(h.guard.getState().open))
  for (let i = 0; i < 4; i++) { h.guard.recordFailure(OVERLOAD); h.tick(1_000) }
  assert.equal(h.guard.getState().open, false, '4 falhas: ainda fechado'); assert.deepEqual(h.online, [])
  h.guard.recordFailure(OVERLOAD)
  assert.equal(h.guard.getState().open, true, '5ª falha abre'); assert.deepEqual(h.online, [false], 'atualizações automáticas pausadas')
  assert.equal(h.guard.getState().level, 1); assert.equal(h.guard.getState().resumeAt, h.now + 20_000, 'primeira pausa: 20 s (sorteio 0)')
  assert.equal(h.timers.size, 1)
  h.advance(19_999); assert.equal(h.guard.getState().open, true, 'ainda pausado')
  h.advance(1); assert.equal(h.guard.getState().open, false, 'voltou'); assert.deepEqual(h.online, [false, true], 'atualizações automáticas religadas')
  assert.deepEqual(seen, [true, false], 'quem escuta (o aviso na tela) é avisado nas duas viradas')
})

test('disjuntor: falhas fora da janela, erros de regra e falhas durante a pausa não contam', () => {
  const h = harness()
  for (let i = 0; i < 4; i++) { h.guard.recordFailure(OVERLOAD); h.tick(10_000) }   // espaçadas de 10 s: só 3-4 cabem em 30 s
  h.guard.recordFailure(OVERLOAD); assert.equal(h.guard.getState().open, false, 'janela de 30 s: as falhas antigas expiraram')
  const h2 = harness()
  for (let i = 0; i < 20; i++) h2.guard.recordFailure({ code: '42501', message: 'permission denied' })
  for (let i = 0; i < 20; i++) h2.guard.recordFailure({ code: 'PT409' })
  for (let i = 0; i < 20; i++) h2.guard.recordFailure({ status: 400 })
  assert.equal(h2.guard.getState().open, false, 'erro de regra nunca abre o disjuntor'); assert.deepEqual(h2.online, [])
  const h3 = harness(); for (let i = 0; i < 5; i++) h3.guard.recordFailure(OVERLOAD)
  const resumeAt = h3.guard.getState().resumeAt, timers = h3.timers.size
  for (let i = 0; i < 50; i++) h3.guard.recordFailure(OVERLOAD)
  assert.equal(h3.guard.getState().resumeAt, resumeAt, 'durante a pausa nada muda'); assert.equal(h3.timers.size, timers, 'e não cria outro temporizador')
})

test('disjuntor: pausas crescem se o servidor continua mal (20, 40, 80, 120 s) e voltam ao começo quando uma consulta dá certo', () => {
  const h = harness(), pauses = []
  const trip = () => { for (let i = 0; i < 5; i++) h.guard.recordFailure(OVERLOAD); pauses.push(h.guard.getState().resumeAt - h.now); h.advance(pauses.at(-1)) }
  trip(); trip(); trip(); trip(); trip()
  assert.deepEqual(pauses, [20_000, 40_000, 80_000, 120_000, 120_000], 'dobra a cada reabertura seguida e para em 120 s')
  h.guard.recordSuccess(); assert.equal(h.guard.getState().level, 0, 'sucesso zera o nível')
  trip(); assert.equal(pauses.at(-1), 20_000, 'depois de um sucesso a pausa volta a 20 s')
})

test('disjuntor: o sorteio espalha a volta das abas (até +50%) e dispose cancela o temporizador', () => {
  const h = harness({ random: () => 0.999999 })
  for (let i = 0; i < 5; i++) h.guard.recordFailure(OVERLOAD)
  assert.equal(h.guard.getState().resumeAt - h.now, 30_000, '20 s + 50% = 30 s no máximo')
  h.guard.dispose(); assert.equal(h.timers.size, 0, 'sem temporizador depois de dispose')
  const sorted = Array.from({ length: 500 }, () => { const x = harness({ random: Math.random }); for (let i = 0; i < 5; i++) x.guard.recordFailure(OVERLOAD); return x.guard.getState().resumeAt - x.now })
  assert(Math.min(...sorted) >= 20_000 && Math.max(...sorted) <= 30_000, 'dentro de [20 s, 30 s]'); assert(new Set(sorted).size > 100, 'e de fato espalhado')
})

test('retentativa: uma só nova tentativa, com espera de 1,5 a 4 s', () => {
  assert.equal(retryPolicy(0), true); assert.equal(retryPolicy(1), false, 'a segunda falha não repete (o padrão eram 3 repetições)'); assert.equal(retryPolicy(2), false)
  assert.equal(retryDelayWith(() => 0), 1_500); assert.equal(retryDelayWith(() => 0.999999), 4_000)
  for (let i = 0; i < 200; i++) { const d = retryDelay(1); assert(d >= 1_500 && d <= 4_000) }
})

// ---------- ligação com o React Query de verdade ----------
test('createAppQueryClient: falhas de sobrecarga abrem o disjuntor pelo QueryCache real; gravações nunca são pausadas', async () => {
  const load = createComponentLoader()
  const { createAppQueryClient, outageGuard } = load('src/lib/outage-client.ts')
  const { onlineManager } = createRequire(import.meta.url)('@tanstack/react-query')   // a MESMA cópia (CJS) que o carregador entrega ao outage-client
  const client = createAppQueryClient()
  client.mount()   // o QueryClientProvider faz isto no app: é o que religa as consultas pausadas quando volta a ficar online
  const d = client.getDefaultOptions()
  assert.equal(typeof d.queries.retry, 'function'); assert.equal(d.queries.retry(0, {}), true, 'retry = 1 nova tentativa'); assert.equal(d.queries.retry(1, {}), false)
  assert.equal(d.queries.refetchOnWindowFocus, false); assert.equal(d.queries.refetchOnReconnect, false)
  assert.equal(d.mutations.networkMode, 'always', 'a gravação da pessoa sai mesmo com o disjuntor aberto')
  assert.equal(outageGuard.getState().open, false)
  // erro de regra não conta (sem repetição, para o teste ser rápido)
  for (let i = 0; i < 8; i++) await client.fetchQuery({ queryKey: ['regra', i], queryFn: () => Promise.reject({ code: '42501', message: 'permission denied' }), retry: false }).catch(() => undefined)
  assert.equal(outageGuard.getState().open, false, 'erro de permissão não abre o disjuntor'); assert.equal(onlineManager.isOnline(), true)
  // uma consulta que dá certo no meio não atrapalha
  assert.equal(await client.fetchQuery({ queryKey: ['ok'], queryFn: async () => 'ok', retry: false }), 'ok')
  // 5 consultas que falham por sobrecarga: o QueryCache avisa o disjuntor
  for (let i = 0; i < 5; i++) await client.fetchQuery({ queryKey: ['falha', i], queryFn: () => Promise.reject({ status: 504, message: 'upstream request timeout' }), retry: false }).catch(() => undefined)
  assert.equal(outageGuard.getState().open, true, 'o disjuntor abriu pelo caminho real (QueryCache.onError)')
  assert.equal(onlineManager.isOnline(), false, 'e pausou as atualizações automáticas do React Query')
  // com o disjuntor aberto, uma nova consulta FICA PAUSADA (não martela o servidor)...
  let ran = false
  const paused = client.fetchQuery({ queryKey: ['durante-pausa'], queryFn: async () => { ran = true; return 1 }, retry: false })
  await new Promise(r => setTimeout(r, 120))
  assert.equal(ran, false, 'nenhuma consulta sai durante a pausa'); assert.equal(client.getQueryCache().find({ queryKey: ['durante-pausa'] })?.state.fetchStatus, 'paused')
  // ...e uma GRAVAÇÃO da pessoa sai normalmente
  let sent = false
  const saved = await client.getMutationCache().build(client, { mutationFn: async () => { sent = true; return 'salvo' } }).execute(undefined)
  assert.equal(sent, true, 'a gravação saiu mesmo com o disjuntor aberto'); assert.equal(saved, 'salvo')
  // quando o disjuntor fecha, a consulta pausada segue
  outageGuard.dispose(); onlineManager.setOnline(true)
  const resumed = await Promise.race([paused, new Promise(r => setTimeout(() => r('TRAVOU'), 3_000))])
  assert.equal(resumed, 1, 'a consulta pausada volta a executar quando o disjuntor fecha'); assert.equal(ran, true)
  client.unmount(); client.clear()
})
