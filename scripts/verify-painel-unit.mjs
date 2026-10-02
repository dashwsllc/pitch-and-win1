// Verificações unitárias da Home (src/painel): escala e geometria dos gráficos, tempo em Brasília, derivações puras,
// paridade das fórmulas com o painel antigo, filtro na URL, paleta (CSS ↔ validador) e a regra "cor só por token".
// Roda com Node puro (Node 24 tira os tipos): node scripts/verify-painel-unit.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { instalarResolvedor } from './perf/ts-alias.mjs'

const raiz = path.resolve(import.meta.dirname, '..')

// Os módulos usam o alias "@/" e importações relativas sem extensão (estilo Vite): o resolvedor as leva para .ts.
instalarResolvedor(raiz)

const { niceTicks, formatarNumero, formatarPct } = await import('../src/painel/charts/scale.ts')
const { caminhoSuave, indiceMaisProximo } = await import('../src/painel/charts/geometria.ts')
const { indicesDosRotulos } = await import('../src/painel/charts/eixo.ts')
const tempo = await import('../src/painel/lib/tempo.ts')
const visao = await import('../src/painel/lib/visao.ts')
const metas = await import('../src/painel/lib/metas.ts')
const fmt = await import('../src/painel/lib/formatar.ts')
const filtro = await import('../src/painel/lib/filtro.ts')
const { iniciais } = await import('../src/painel/lib/iniciais.ts')
const { money } = await import('../src/lib/sales.ts')
const periodos = await import('../src/lib/dashboard-period.ts')
const brasilia = await import('../src/lib/brasilia-time.ts')

// Gerador determinístico para os testes de propriedade.
function rng(semente) {
  let a = semente >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const semEspacoInseparavel = (s) => s.replace(/ /g, ' ')

// ---------------------------------------------------------------------------------------------- escala
for (const [max, esperado] of [
  [0, [0, 1]],
  [1, [0, 1]],
  [3, [0, 1, 2, 3]],
  [7, [0, 2, 4, 6, 8]],
  [23, [0, 10, 20, 30]],
  [100, [0, 25, 50, 75, 100]],
  [1234, [0, 500, 1000, 1500]],
]) assert.deepEqual(niceTicks(max), esperado, `niceTicks(${max})`)
{
  const sorteio = rng(3)
  for (let i = 0; i < 500; i++) {
    const max = Math.floor(sorteio() * 5000)
    const t = niceTicks(max)
    assert.equal(t[0], 0, 'o eixo começa em zero')
    assert.ok(t[t.length - 1] >= max, `o topo cobre o máximo (${max})`)
    assert.ok(t.every((v) => Number.isInteger(v)), 'marcas inteiras (contagem não tem meio)')
    assert.ok(t.length >= 2 && t.length <= 8, `poucas marcas (${t.length})`)
    assert.ok(t.every((v, k) => k === 0 || v > t[k - 1]), 'marcas crescentes')
  }
}
assert.equal(formatarNumero(1234567), '1.234.567')
assert.equal(formatarPct(0.595), '59,5%')
assert.equal(formatarPct(0.6), '60%')
assert.equal(formatarPct(0), '0%')

// ------------------------------------------------------------------------------------------- geometria
assert.equal(indiceMaisProximo(0, 5, 400), 0)
assert.equal(indiceMaisProximo(400, 5, 400), 4)
assert.equal(indiceMaisProximo(160, 5, 400), 2)
assert.equal(indiceMaisProximo(-50, 5, 400), 0, 'o ponteiro fora do gráfico encaixa na ponta')
assert.equal(indiceMaisProximo(9999, 5, 400), 4)
assert.equal(indiceMaisProximo(10, 1, 400), 0, 'um ponto só')
assert.equal(caminhoSuave([]), '')
assert.equal(caminhoSuave([[10, 20]]), 'M10,20')
{
  // Monotônica: a curva não cria picos nem vales que não existem nos dados (nenhum ponto de controle sai do intervalo do trecho).
  const sorteio = rng(11)
  for (let rodada = 0; rodada < 200; rodada++) {
    const n = 2 + Math.floor(sorteio() * 12)
    const pontos = Array.from({ length: n }, (_, i) => [i * 10, Math.floor(sorteio() * 100)])
    const numeros = caminhoSuave(pontos).match(/-?\d+(?:\.\d+)?/g).map(Number)
    // M x0 y0 e depois, por trecho, C c1x c1y c2x c2y x y
    for (let i = 0; i < n - 1; i++) {
      const base = 2 + i * 6
      const [ya, yb] = [pontos[i][1], pontos[i + 1][1]]
      const lo = Math.min(ya, yb) - 0.01
      const hi = Math.max(ya, yb) + 0.01
      for (const y of [numeros[base + 1], numeros[base + 3]]) assert.ok(y >= lo && y <= hi, `controle fora do trecho (${y} fora de ${lo}..${hi})`)
    }
  }
}
{
  // Rótulos do eixo X: o primeiro e o último sempre aparecem, e dois vizinhos nunca ficam mais perto do que o espaço
  // pedido (a não ser o par final, que pode chegar a 60% dele para o último rótulo não sumir).
  assert.deepEqual(indicesDosRotulos(1, 300), [0])
  assert.deepEqual(indicesDosRotulos(2, 300), [0, 1])
  assert.deepEqual(indicesDosRotulos(0, 300), [])
  const sorteio = rng(17)
  for (let rodada = 0; rodada < 400; rodada++) {
    const n = 1 + Math.floor(sorteio() * 120)
    const largura = 80 + Math.floor(sorteio() * 1200)
    const espaco = [44, 64][rodada % 2]
    const ind = indicesDosRotulos(n, largura, espaco)
    assert.equal(ind[0], 0, 'começa no primeiro intervalo')
    assert.equal(ind.at(-1), n - 1, 'termina no último intervalo')
    assert.ok(ind.every((v, k) => k === 0 || v > ind[k - 1]), 'índices crescentes, sem repetir')
    const faixa = largura / n
    const cabem = Math.max(2, Math.floor(largura / espaco))
    assert.ok(ind.length <= cabem + 1, `n=${n} largura=${largura}: ${ind.length} rótulos para ${cabem} lugares`)
    for (let k = 1; k < ind.length - 1; k++) assert.ok((ind[k] - ind[k - 1]) * faixa >= Math.min(espaco, largura / 2) - 0.001 || n <= cabem, 'vizinhos afastados')
  }
}

// ---------------------------------------------------------------------------------------------- tempo
assert.equal(tempo.chaveDaHora('2026-09-30T02:30:00Z'), '2026-09-29 23', 'Brasília é UTC-3')
assert.equal(tempo.chaveDaHora('2026-09-30T03:00:00Z'), '2026-09-30 00', 'a meia-noite local vira 00, nunca 24')
assert.equal(tempo.formatarHoraMinuto('2026-10-01T14:07:46Z'), '11:07')
assert.equal(tempo.formatarHoraCompleta('2026-10-01T14:07:46Z'), '11:07:46')
assert.equal(tempo.formatarDiaMes('2026-10-01T14:07:46Z'), '01/10')
assert.equal(tempo.formatarDiaDaSemana('2026-10-01T15:00:00Z'), 'Quinta-feira, 01/10/2026')
assert.equal(tempo.formatarDiaDaSemana('2026-10-01T02:00:00Z'), 'Quarta-feira, 30/09/2026', 'o dia é o de Brasília, não o UTC')
for (const [ms, texto] of [[0, 'menos de 1 s'], [499, 'menos de 1 s'], [47_000, '47 s'], [67_000, '1 min 07 s'], [120_000, '2 min'], [3_900_000, '1 h 05 min'], [7_200_000, '2 h']]) {
  assert.equal(tempo.formatarDuracao(ms), texto, `duração ${ms}`)
}
{
  const t0 = Date.parse('2026-10-01T12:00:00Z')
  const ha = (s) => tempo.formatarHa('2026-10-01T12:00:00Z', t0 + s * 1000)
  assert.deepEqual([ha(0), ha(4), ha(5), ha(59), ha(60), ha(3599), ha(3600), ha(47 * 3600), ha(48 * 3600), ha(75 * 3600)], ['agora', 'agora', 'há 5 s', 'há 59 s', 'há 1 min', 'há 59 min', 'há 1 h', 'há 47 h', 'há 2 d', 'há 3 d'])
  assert.equal(tempo.formatarHa('2026-10-01T12:00:00Z', t0 - 5000), 'agora', 'relógio adiantado nunca dá tempo negativo')
}
assert.equal(iniciais('Maria Eduarda Silva'), 'MS')
assert.equal(iniciais('  joão  '), 'J')
assert.equal(iniciais(''), '?')
assert.equal(iniciais(null), '?')

// ----------------------------------------------------------------------------------------- visão (puras)
const UTC = (s) => new Date(s).toISOString()
const HOJE = periodos.resolveDashboardPeriod('hoje', periodos.createDefaultDashboardCustomRange())
const somaDe = (pontos, campo) => pontos.reduce((t, p) => t + p[campo], 0)
{
  // Uma linha do tempo só, para todos os gráficos: as horas de Brasília entre o primeiro e o último registro de
  // vendas, abordagens OU calls (nenhuma hora some, nem as sem evento), com as quatro contagens de cada hora.
  const v = [{ id: 'a', created_at: UTC('2026-10-01T17:50:00Z'), nome_produto: 'P', valor_venda: 10 }, { id: 'b', created_at: UTC('2026-10-01T20:05:00Z'), nome_produto: 'P', valor_venda: 20 }]
  const a = [{ id: 'x', created_at: UTC('2026-10-01T18:10:00Z'), mostrou_ia: true }, { id: 'y', created_at: UTC('2026-10-01T18:40:00Z'), mostrou_ia: false }]
  const c = [{ id: 'k', feita_em: UTC('2026-10-01T21:15:00Z') }]
  const s = visao.montarIntervalos(HOJE, true, v, a, c)
  assert.deepEqual(s.map((p) => p.rotulo), ['14h', '15h', '16h', '17h', '18h'], 'a call das 18h estende a linha do tempo')
  assert.deepEqual(s.map((p) => p.vendas), [1, 0, 0, 1, 0])
  assert.deepEqual(s.map((p) => p.abordagens), [0, 2, 0, 0, 0])
  assert.deepEqual(s.map((p) => p.mostrou), [0, 1, 0, 0, 0])
  assert.deepEqual(s.map((p) => p.calls), [0, 0, 0, 0, 1])
}
{
  const cruzando = visao.montarIntervalos(HOJE, true, [{ id: '1', created_at: UTC('2026-10-01T01:30:00Z') }, { id: '2', created_at: UTC('2026-10-01T03:30:00Z') }], [], [])
  assert.deepEqual(cruzando.map((p) => p.rotulo), ['30/09 22h', '30/09 23h', '01/10 00h'], 'cruzou o dia: rótulo com data')
  assert.deepEqual(cruzando.map((p) => p.chave), ['2026-09-30 22', '2026-09-30 23', '2026-10-01 00'])
  assert.deepEqual(visao.montarIntervalos(HOJE, true, [], [], []), [])
  assert.deepEqual(visao.montarIntervalos(HOJE, true, [{ id: 'z', created_at: 'lixo' }], [], [{ id: 'w', feita_em: 'lixo' }]), [], 'horário inválido é ignorado')
  const so = visao.montarIntervalos(HOJE, true, [], [], [{ id: '1', feita_em: UTC('2026-10-01T15:00:00Z') }])
  assert.deepEqual(so.map((p) => [p.rotulo, p.vendas, p.abordagens, p.calls]), [['12h', 0, 0, 1]], 'só calls (o dia de um Closer) também vira série')
}
{
  // Propriedade: horas contínuas, sem repetição, e cada contagem fecha com o seu total.
  const sorteio = rng(21)
  for (let rodada = 0; rodada < 150; rodada++) {
    const base = Date.parse('2026-09-28T00:00:00Z')
    const instante = () => new Date(base + Math.floor(sorteio() * 4 * 86_400_000)).toISOString()
    const vendas = Array.from({ length: Math.floor(sorteio() * 30) }, (_, i) => ({ id: String(i), created_at: instante() }))
    const abord = Array.from({ length: Math.floor(sorteio() * 60) }, (_, i) => ({ id: String(1000 + i), created_at: instante(), mostrou_ia: sorteio() < 0.6 }))
    const calls = Array.from({ length: Math.floor(sorteio() * 25) }, (_, i) => ({ id: String(5000 + i), feita_em: instante() }))
    const serie = visao.montarIntervalos(HOJE, true, vendas, abord, calls)
    assert.equal(somaDe(serie, 'vendas'), vendas.length)
    assert.equal(somaDe(serie, 'abordagens'), abord.length)
    assert.equal(somaDe(serie, 'mostrou'), visao.dividirAbordagens(abord).mostrou)
    assert.equal(somaDe(serie, 'calls'), calls.length)
    assert.ok(serie.every((p) => p.mostrou <= p.abordagens), 'mostrou cabe nas abordagens da hora')
    assert.equal(new Set(serie.map((p) => p.chave)).size, serie.length, 'sem hora repetida')
    for (let i = 1; i < serie.length; i++) {
      const [d0, h0] = serie[i - 1].chave.split(' ')
      const [d1, h1] = serie[i].chave.split(' ')
      const anterior = Date.parse(`${d0}T${h0}:00:00Z`)
      const atual = Date.parse(`${d1}T${h1}:00:00Z`)
      assert.equal(atual - anterior, 3_600_000, `horas contínuas: ${serie[i - 1].chave} → ${serie[i].chave}`)
    }
  }
}
{
  // Períodos longos: os mesmos intervalos e os mesmos números de vendas e abordagens da série que a hook calculava
  // (buildDashboardSeries); as calls e a divisão pela IA caem nesses mesmos intervalos.
  const sorteio = rng(41)
  const agoraMs = Date.now()
  const instante = (dias) => new Date(agoraMs - Math.floor(sorteio() * dias * 86_400_000)).toISOString()
  for (let rodada = 0; rodada < 60; rodada++) {
    for (const filtro of ['7dias', '30dias', 'all', 'custom']) {
      const periodo = periodos.resolveDashboardPeriod(filtro, { start: '2025-01-01', end: periodos.createDefaultDashboardCustomRange().end })
      const dentro = (iso) => periodo.allTime || (Date.parse(iso) >= periodo.start.getTime() && Date.parse(iso) < periodo.end.getTime())
      const dias = filtro === 'custom' ? 600 : 90
      const v = Array.from({ length: Math.floor(sorteio() * 40) }, (_, i) => ({ id: String(i), created_at: instante(dias) })).filter((l) => dentro(l.created_at))
      const a = Array.from({ length: Math.floor(sorteio() * 120) }, (_, i) => ({ id: String(1000 + i), created_at: instante(dias), mostrou_ia: sorteio() < 0.6 })).filter((l) => dentro(l.created_at))
      // Calls nos mesmos instantes de registros que já existem: os intervalos têm de ser exatamente os da hook.
      const c = [...v, ...a].filter(() => sorteio() < 0.3).map((l, i) => ({ id: String(9000 + i), feita_em: l.created_at }))
      const s = visao.montarIntervalos(periodo, false, v, a, c)
      if (v.length + a.length === 0) {
        assert.deepEqual(s, [], `${filtro}: sem registro, sem série`)
        continue
      }
      const hook = periodos.buildDashboardSeries(v, a, periodo)
      assert.deepEqual(s.map((p) => [p.rotulo, p.vendas, p.abordagens]), hook.map((p) => [p.month, p.vendas, p.abordagens]), `${filtro}: os intervalos e números da hook`)
      assert.equal(somaDe(s, 'calls'), c.length, `${filtro}: as calls fecham com o total`)
      assert.equal(somaDe(s, 'mostrou'), visao.dividirAbordagens(a).mostrou, `${filtro}: a divisão pela IA fecha com a legenda`)
      assert.ok(s.every((p) => p.mostrou <= p.abordagens))
    }
  }
}
{
  // Todo o período: o primeiro e o último dia saem de TODOS os registros; uma call antes da primeira venda não some.
  const tudo = periodos.resolveDashboardPeriod('all', periodos.createDefaultDashboardCustomRange())
  const v = [{ id: '1', created_at: UTC('2026-09-10T15:00:00Z') }]
  const a = [{ id: '2', created_at: UTC('2026-09-12T15:00:00Z'), mostrou_ia: true }]
  const c = [{ id: '3', feita_em: UTC('2026-09-08T15:00:00Z') }]
  const s = visao.montarIntervalos(tudo, false, v, a, c)
  assert.deepEqual(s.map((p) => p.rotulo), ['08/09', '09/09', '10/09', '11/09', '12/09'])
  assert.deepEqual(s.map((p) => [p.vendas, p.abordagens, p.mostrou, p.calls]), [[0, 0, 0, 1], [0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]])
  assert.deepEqual(visao.montarIntervalos(tudo, false, [], [], c).map((p) => [p.rotulo, p.calls]), [['08/09', 1]], 'só calls também vira série')
  assert.deepEqual(visao.montarIntervalos(tudo, false, [], [], []), [])
}
{
  // Pontos do gráfico de abordagens e calls: calls na área, abordagens na linha. Sem calls nem abordagens (só vendas),
  // a moldura vazia, nunca uma linha de zeros.
  const pontos = [
    { chave: 'a', rotulo: '14h', vendas: 3, abordagens: 5, mostrou: 2, calls: 1 },
    { chave: 'b', rotulo: '15h', vendas: 0, abordagens: 0, mostrou: 0, calls: 2 },
  ]
  assert.deepEqual(visao.serieDeCalls(pontos), [
    { chave: 'a', rotulo: '14h', principal: 1, secundaria: 5 },
    { chave: 'b', rotulo: '15h', principal: 2, secundaria: 0 },
  ])
  assert.deepEqual(visao.serieDeCalls([{ chave: 'a', rotulo: '14h', vendas: 4, abordagens: 0, mostrou: 0, calls: 0 }]), [])
  assert.deepEqual(visao.serieDeCalls([]), [])
}
{
  // Quando uma call concluída aconteceu: a hora marcada; se ela foi fechada antes (um repasse antecipado), a do
  // fechamento. Nunca no futuro, porque o fechamento já aconteceu.
  const call = (scheduled_at, completed_at) => ({ scheduled_at, completed_at })
  assert.equal(visao.momentoDaCall(call(UTC('2026-10-01T17:00:00Z'), UTC('2026-10-01T21:00:00Z'))), UTC('2026-10-01T17:00:00Z'), 'fechada depois: vale a hora marcada')
  assert.equal(visao.momentoDaCall(call(UTC('2026-10-01T19:00:00Z'), UTC('2026-10-01T13:00:00Z'))), UTC('2026-10-01T13:00:00Z'), 'fechada antes: vale o fechamento')
  assert.equal(visao.momentoDaCall(call(null, UTC('2026-10-01T13:00:00Z'))), UTC('2026-10-01T13:00:00Z'), 'sem hora marcada: o fechamento')
  assert.equal(visao.momentoDaCall(call(UTC('2026-10-01T13:00:00Z'), null)), UTC('2026-10-01T13:00:00Z'))
  assert.equal(visao.momentoDaCall(call(null, null)), null)
  assert.equal(visao.momentoDaCall(call('lixo', 'lixo')), null, 'horário inválido não vira data')
  // O recorte do período é pelo mesmo momento: uma call marcada para amanhã e fechada hoje é de hoje.
  const hoje = { allTime: false, start: new Date('2026-10-01T03:00:00Z'), end: new Date('2026-10-02T03:00:00Z') }
  const linhas = [
    { id: '1', scheduled_at: UTC('2026-10-01T15:00:00Z'), completed_at: UTC('2026-10-01T16:00:00Z') },
    { id: '2', scheduled_at: UTC('2026-10-02T15:00:00Z'), completed_at: UTC('2026-10-01T20:00:00Z') },
    { id: '3', scheduled_at: UTC('2026-09-30T23:00:00Z'), completed_at: UTC('2026-10-01T12:00:00Z') },
    { id: '4', scheduled_at: null, completed_at: null },
  ]
  assert.deepEqual(visao.callsDoPeriodo(linhas, hoje), [
    { id: '1', feita_em: UTC('2026-10-01T15:00:00Z') },
    { id: '2', feita_em: UTC('2026-10-01T20:00:00Z') },
  ], 'a 3 aconteceu ontem (hora marcada) e a 4 não tem horário')
  assert.equal(visao.callsDoPeriodo(linhas, { allTime: true }).length, 3, 'todo o período: todas com horário')
}
assert.equal(visao.passoDaSerie([{ rotulo: '14h' }], true), 'hora')
assert.equal(visao.passoDaSerie([{ rotulo: '29/09' }], false), 'dia')
assert.equal(visao.passoDaSerie([{ rotulo: 'set 26' }], false), 'mês')
assert.equal(visao.passoDaSerie([{ rotulo: '2026' }], false), 'ano')
{
  const agora = '2026-10-01T15:00:00.000Z'
  const l = [{ id: '1', created_at: '2026-10-01T14:00:00.000Z' }, { id: '2', created_at: '2026-10-01T14:00:00.001Z' }, { id: '3', created_at: '2026-10-01T13:59:59.999Z' }, { id: '4', created_at: '2026-10-01T15:00:00.000Z' }]
  assert.equal(visao.contarNaUltimaHora(l, agora), 3, 'a fronteira de uma hora é inclusiva')
  assert.equal(visao.ultimoInstante(l), '2026-10-01T15:00:00.000Z')
  assert.equal(visao.ultimoInstante([]), null)
  assert.equal(visao.somarNaUltimaHora([{ id: '1', created_at: '2026-10-01T14:30:00Z', valor_venda: 100.5, nome_produto: 'x' }, { id: '2', created_at: '2026-10-01T10:00:00Z', valor_venda: 9, nome_produto: 'x' }], agora), 100.5)
}
{
  const vendas = [{ id: '1', created_at: '2026-10-01T12:00:00Z', valor_venda: 10, nome_produto: 'A' }, { id: '2', created_at: '2026-10-01T12:05:00Z', valor_venda: 20, nome_produto: 'B' }]
  const abord = [{ id: '1', created_at: '2026-10-01T12:05:00Z' }, { id: '2', created_at: '2026-10-01T11:00:00Z' }]
  const feed = visao.montarAtividade(vendas, abord, 3)
  assert.equal(feed.length, 3, 'corte no limite')
  assert.deepEqual(feed.map((i) => i.chave), ['v2', 'a1', 'v1'], 'mais novo primeiro; empate decidido pela chave (determinístico)')
  assert.equal(feed[0].tipo, 'venda')
  assert.equal(feed[0].valor, 20)
  assert.equal(visao.montarAtividade([], []).length, 0)
  const muitos = Array.from({ length: 50 }, (_, i) => ({ id: String(i), created_at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60_000).toISOString(), valor_venda: 1, nome_produto: 'p' }))
  assert.equal(visao.montarAtividade(muitos, []).length, 9, 'o feed mostra 9 itens')
}
{
  const b = visao.barrasDeProdutos([{ nome: 'A', quantidade: 3, valor: 300 }, { nome: 'B', quantidade: 1, valor: 100 }], 400)
  assert.deepEqual(b.map((x) => x.fracao), [0.75, 0.25])
  assert.equal(visao.barrasDeProdutos([{ nome: 'A', quantidade: 0, valor: 0 }], 0)[0].fracao, null, 'sem receita não há fração')
}
{
  // Barra dividida: as duas partes somam sempre o total de abordagens (o número que o painel antigo já mostrava).
  assert.deepEqual(visao.dividirAbordagens([]), { mostrou: 0, naoMostrou: 0 })
  const a = (mostrou_ia) => ({ id: String(Math.random()), created_at: '2026-10-01T12:00:00Z', mostrou_ia })
  assert.deepEqual(visao.dividirAbordagens([a(true), a(false), a(true), a(undefined)]), { mostrou: 2, naoMostrou: 2 }, 'sem resposta conta como "não mostrou"')
  const sorteio = rng(31)
  for (let i = 0; i < 200; i++) {
    const lista = Array.from({ length: Math.floor(sorteio() * 50) }, () => a(sorteio() < 0.5))
    const d = visao.dividirAbordagens(lista)
    assert.equal(d.mostrou + d.naoMostrou, lista.length)
    assert.equal(d.mostrou, lista.filter((x) => x.mostrou_ia).length)
  }
  const feed = visao.montarAtividade([], [a(true), a(false)])
  assert.deepEqual(feed.map((i) => i.mostrouIa).sort(), [false, true], 'o feed diz se a IA foi mostrada')
}

// -------------------------------------------------------------------------------- formatação e paridade
{
  // O painel novo escreve dinheiro em centavos inteiros: tem de dar o MESMO texto que money() do painel antigo.
  const sorteio = rng(5)
  const casos = [0, 0.01, 0.1, 1, 9.99, 10, 99.995, 1234.5, 2916.35, 90407, 123456.789, 1e6, 12345678.9]
  for (let i = 0; i < 2000; i++) casos.push(Math.round(sorteio() * 1e9) / 100, sorteio() * 100000)
  for (const v of casos) {
    assert.equal(semEspacoInseparavel(fmt.formatarCentavos(fmt.emCentavos(v))), semEspacoInseparavel(money(v)), `dinheiro ${v}`)
  }
  assert.ok(!/ /.test(fmt.formatarCentavos(12345)), 'o valor pode quebrar de linha (sem espaço inseparável)')
  assert.equal(fmt.formatarReaisInteiros(90407.4), 'R$ 90.407'.replace(' ', ' '))
  assert.equal(fmt.pluralizar(1, 'venda', 'vendas'), '1 venda')
  assert.equal(fmt.pluralizar(1234, 'venda', 'vendas'), '1.234 vendas')
}
{
  // Conversão: o número é exatamente o do painel antigo (toFixed(1)); só muda o jeito de escrever (vírgula, sem zero à direita).
  const sorteio = rng(9)
  let comparados = 0
  for (let i = 0; i < 20000; i++) {
    const vendas = Math.floor(sorteio() * 400)
    const abordagens = 1 + Math.floor(sorteio() * 1500)
    const conversao = (vendas / abordagens) * 100
    const antigo = Number(conversao.toFixed(1))
    const novo = Number(fmt.formatarPercentual(conversao).replace('%', '').replaceAll('.', '').replace(',', '.'))
    assert.equal(novo, antigo, `conversão ${vendas}/${abordagens}`)
    comparados++
  }
  assert.equal(comparados, 20000)
}

// ---------------------------------------------------------------------------------- metas (antigo × novo)
{
  // Cópia literal das contas do GoalsProgress antigo, para comparar com ritmoDoDia na mesma entrada.
  const antigo = ({ tarefas, tarefasOntem, erroOntem, hoje, ontem, agora }) => {
    const completed = tarefas.filter((t) => t.is_completed).length
    const progress = tarefas.length ? Math.round((completed / tarefas.length) * 100) : 0
    const allCompleted = tarefas.length > 0 && completed === tarefas.length
    const { start, end } = brasilia.brasiliaDayBounds(hoje)
    const elapsedDayPercent = Math.min(100, Math.max(0, ((agora.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
    const { hour, minute, second } = brasilia.brasiliaParts(agora)
    const previousCutoff = brasilia.brasiliaLocalToDate(ontem, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`).getTime()
    const comparableTasks = tarefasOntem.filter((task) => Date.parse(task.created_at) <= previousCutoff)
    const previousProgress = !erroOntem && comparableTasks.length
      ? Math.round((comparableTasks.filter((task) => task.is_completed && task.completed_at && Date.parse(task.completed_at) <= previousCutoff).length / comparableTasks.length) * 100)
      : null
    const behindYesterday = previousProgress !== null && progress < previousProgress
    const belowPace = !allCompleted && (progress < elapsedDayPercent || behindYesterday)
    return { completed, progress, allCompleted, elapsedDayPercent, previousProgress, behindYesterday, belowPace }
  }
  const sorteio = rng(77)
  for (let rodada = 0; rodada < 400; rodada++) {
    const hoje = '2026-10-01'
    const ontem = '2026-09-30'
    const agora = new Date(Date.parse('2026-10-01T03:00:00Z') + Math.floor(sorteio() * 86_400_000))
    const tarefa = (dia) => {
      const criada = Date.parse(`${dia}T03:00:00Z`) + Math.floor(sorteio() * 86_400_000)
      const feita = sorteio() < 0.5
      return { is_completed: feita, created_at: new Date(criada).toISOString(), completed_at: feita ? new Date(criada + Math.floor(sorteio() * 40_000_000)).toISOString() : null }
    }
    const tarefas = Array.from({ length: Math.floor(sorteio() * 8) }, () => tarefa(hoje))
    const tarefasOntem = Array.from({ length: Math.floor(sorteio() * 8) }, () => tarefa(ontem))
    const erroOntem = sorteio() < 0.1 ? new Error('x') : null
    const a = antigo({ tarefas, tarefasOntem, erroOntem, hoje, ontem, agora })
    const n = metas.ritmoDoDia({ tarefas, tarefasOntem, erroOntem, hoje, ontem, agora })
    assert.deepEqual(
      { completed: n.concluidas, progress: n.progresso, allCompleted: n.todasConcluidas, elapsedDayPercent: n.decorridoDoDia, previousProgress: n.progressoOntem, behindYesterday: n.atrasadoEmRelacaoAOntem, belowPace: n.abaixoDoRitmo },
      a,
    )
  }
  const meiaNoite = Date.parse('2026-10-02T03:00:00Z')
  assert.equal(metas.urgenciaEm(new Date(meiaNoite - 7 * 3_600_000)), 'normal')
  assert.equal(metas.urgenciaEm(new Date(meiaNoite - 6 * 3_600_000)), 'atencao')
  assert.equal(metas.urgenciaEm(new Date(meiaNoite - 2 * 3_600_000)), 'critico')
  assert.equal(metas.urgenciaEm(new Date(meiaNoite - 1000)), 'critico')
  assert.equal(metas.rotuloDaContagem(3_725_000), '01h 02m 05s')
  assert.equal(metas.rotuloDaContagem(-5), '00h 00m 00s')
}

// ------------------------------------------------------------------------------------------ filtro (URL)
{
  const ler = (q) => filtro.lerFiltro(new URLSearchParams(q))
  assert.deepEqual(ler(''), { periodo: 'hoje', de: '', ate: '' }, 'o padrão é hoje')
  assert.equal(ler('periodo=tudo').periodo, 'all')
  assert.equal(ler('periodo=intervalo&de=2026-08-01&ate=2026-08-15').periodo, 'custom')
  assert.equal(ler('periodo=lixo').periodo, 'hoje', 'valor desconhecido cai no padrão')
  assert.equal(ler('de=2026-02-31').de, '', 'data impossível é descartada')
  for (const periodo of ['hoje', 'ontem', '7dias', '14dias', '30dias', 'all', 'custom']) {
    const gravado = filtro.escreverFiltro(new URLSearchParams('x=1'), { periodo, de: '2026-08-01', ate: '2026-08-15' })
    assert.equal(gravado.get('x'), '1', 'preserva os outros parâmetros do endereço')
    assert.equal(filtro.lerFiltro(gravado).periodo, periodo, `ida e volta: ${periodo}`)
    assert.equal(gravado.has('de'), periodo === 'custom', 'de/ate só valem com o intervalo')
    assert.equal(gravado.has('periodo'), periodo !== 'hoje', 'o padrão não é gravado')
  }
  assert.equal(filtro.escreverFiltro(new URLSearchParams('periodo=7dias&de=2026-08-01&ate=2026-08-02'), { periodo: 'hoje', de: '', ate: '' }).toString(), '', 'limpar apaga tudo')
  assert.equal(filtro.filtroAtivo({ periodo: 'hoje', de: '', ate: '' }), false)
  assert.equal(filtro.filtroAtivo({ periodo: '7dias', de: '', ate: '' }), true)
  assert.deepEqual(filtro.intervaloDoFiltro({ periodo: 'custom', de: '2026-08-01', ate: '2026-08-15' }), { start: '2026-08-01', end: '2026-08-15' })
  const padrao = filtro.intervaloDoFiltro({ periodo: 'custom', de: '', ate: '' })
  assert.deepEqual(padrao, periodos.createDefaultDashboardCustomRange(), 'sem datas valem os últimos 7 dias, como no painel antigo')
  assert.equal(periodos.validateDashboardCustomRange({ start: '2026-08-10', end: '2026-08-01' }), 'A data inicial deve ser anterior ou igual à data final.', 'intervalo invertido é dito, não aplicado')
}

// --------------------------------------------------------------------------------------------- paleta
function hslParaHex(texto) {
  const [h, s, l] = texto.trim().split(/\s+/).map((v) => parseFloat(v))
  const S = s / 100
  const L = l / 100
  const k = (n) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}
const css = readFileSync(path.join(raiz, 'src/painel/painel.css'), 'utf8')
const bloco = (seletor) => {
  const inicio = css.indexOf(`${seletor} {`)
  assert.ok(inicio >= 0, `bloco ${seletor} no painel.css`)
  return css.slice(inicio, css.indexOf('\n}', inicio))
}
const tokens = (texto) => Object.fromEntries([...texto.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const claro = tokens(bloco('html.painel'))
const escuro = { ...claro, ...tokens(bloco('html.painel.dark')) }
const hex = (t, nome) => hslParaHex(t[nome])
const luminancia = (c) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contraste = (a, b) => {
  const [alto, baixo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (alto + 0.05) / (baixo + 0.05)
}
for (const [tema, t] of [['claro', claro], ['escuro', escuro]]) {
  const card = hex(t, 'card')
  const series = ['viz-1', 'viz-2', 'viz-3'].map((n) => hex(t, n)).join(',')
  const r = spawnSync(process.execPath, [path.join(raiz, 'validar-paleta.mjs'), series, tema, card], { encoding: 'utf8' })
  assert.equal(r.status, 0, `validar-paleta (${tema}) reprovou:\n${r.stdout}${r.stderr}`)
  assert.ok(!/\[FAIL\]/.test(r.stdout), `validar-paleta (${tema}) tem FAIL`)
  // Gráfico de abordagens e calls: as calls (azul, na área) ao lado das abordagens (laranja, na linha).
  const calls = ['viz-4', 'viz-1'].map((n) => hex(t, n)).join(',')
  const rc = spawnSync(process.execPath, [path.join(raiz, 'validar-paleta.mjs'), calls, tema, card], { encoding: 'utf8' })
  assert.equal(rc.status, 0, `validar-paleta calls × abordagens (${tema}) reprovou:\n${rc.stdout}${rc.stderr}`)
  assert.ok(!/\[FAIL\]/.test(rc.stdout), `calls × abordagens (${tema}) tem FAIL`)
  // Rampa ordinal (um matiz, do claro ao escuro), validada como rampa e não como séries.
  const rampa = ['viz-ord-1', 'viz-ord-2', 'viz-ord-3'].map((n) => hex(t, n)).join(',')
  const o = spawnSync(process.execPath, [path.join(raiz, 'validar-paleta.mjs'), rampa, tema, card, '--ordinal'], { encoding: 'utf8' })
  assert.equal(o.status, 0, `validar-paleta --ordinal (${tema}) reprovou:\n${o.stdout}${o.stderr}`)
  assert.ok(!/\[FAIL\]/.test(o.stdout), `rampa ordinal (${tema}) tem FAIL`)
  // Texto: corrido ≥ 7:1 e secundário ≥ 4,5:1 sobre cartão, popover e fundo; ação com texto branco legível.
  for (const sup of ['card', 'popover', 'background']) {
    assert.ok(contraste(hex(t, 'foreground'), hex(t, sup)) >= 7, `${tema}: foreground sobre ${sup} ≥ 7:1`)
    assert.ok(contraste(hex(t, 'heading'), hex(t, sup)) >= 7, `${tema}: heading sobre ${sup} ≥ 7:1`)
    assert.ok(contraste(hex(t, 'muted-foreground'), hex(t, sup)) >= 4.5, `${tema}: muted-foreground sobre ${sup} ≥ 4,5:1`)
  }
  assert.ok(contraste(hex(t, 'muted-foreground'), hex(t, 'accent')) >= 4.5, `${tema}: muted-foreground sobre accent`)
  assert.ok(contraste(hex(t, 'primary'), hex(t, 'primary-foreground')) >= 4.5, `${tema}: primary × primary-foreground ≥ 4,5:1`)
  assert.ok(contraste(hex(t, 'sidebar-foreground'), hex(t, 'sidebar-background')) >= 7, `${tema}: texto do menu`)
  assert.ok(contraste(hex(t, 'destructive'), card) >= 4.5, `${tema}: erro em texto sobre o cartão`)
  assert.ok(contraste(hex(t, 'ok-forte'), card) >= 4.5, `${tema}: ok-forte em texto sobre o cartão`)
}
{
  const g = (nome) => claro[nome].match(/#[0-9a-f]{6}/gi)
  const [inicioAcao, fimAcao] = g('gradiente-acao')
  assert.ok(contraste('#ffffff', inicioAcao) >= 4.5, 'texto branco no início do degradê de ação ≥ 4,5:1')
  assert.ok(contraste('#ffffff', fimAcao) >= 3, 'e no fim ≥ 3:1')
  const [inicioLogo, fimLogo] = g('gradiente-corrente')
  assert.ok(contraste('#ffffff', inicioLogo) >= 3 && contraste('#ffffff', fimLogo) >= 3, 'o ícone branco do logotipo se lê (≥ 3:1)')
}

// --------------------------------------------------------------------------- cor só por token (R3)
{
  const arquivos = []
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const f = path.join(dir, nome)
      if (statSync(f).isDirectory()) varrer(f)
      else if (/\.(tsx?|jsx?)$/.test(nome)) arquivos.push(f)
    }
  }
  varrer(path.join(raiz, 'src/painel'))
  arquivos.push(path.join(raiz, 'src/pages/Dashboard.tsx'))
  const paleta = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?(?:\/\d+)?\b/g
  const achados = []
  for (const arquivo of arquivos) {
    const nome = path.relative(raiz, arquivo).replaceAll('\\', '/')
    const fonte = readFileSync(arquivo, 'utf8').split('\n')
    fonte.forEach((linha, i) => {
      const semComentario = linha.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
      for (const m of semComentario.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\((?!var\(--)/g)) achados.push(`${nome}:${i + 1} cor fixa "${m[0]}"`)
      for (const m of semComentario.matchAll(paleta)) {
        // Única exceção: texto branco sobre o degradê de ação do logotipo (regra de contraste, 5.5).
        if (m[0] === 'text-white' && nome.endsWith('PainelSidebar.tsx')) continue
        achados.push(`${nome}:${i + 1} classe de paleta "${m[0]}"`)
      }
    })
  }
  assert.deepEqual(achados, [], `cor fora de token:\n${achados.join('\n')}`)
}

console.log('PASS: escala, geometria, tempo em Brasília, série contínua por hora, derivações, paridade (dinheiro, conversão e ritmo das metas), filtro na URL, paleta validada nos dois temas e cor só por token.')
