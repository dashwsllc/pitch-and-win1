// Paridade antes × depois da Home: o MESMO backend falso, o MESMO relógio e os MESMOS filtros nos dois builds, e cada
// número do painel antigo comparado com o do novo. Nada toca em produção (os dois builds apontam para o Supabase falso).
//   VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
//     npx vite build --outDir .verification.local/perf/dist-depois --emptyOutDir      (e o mesmo a partir do commit antigo)
//   node scripts/verify-painel-paridade.mjs --antes .verification.local/perf/dist-antes --depois .verification.local/perf/dist-depois
// Sai com código 1 se algum número diverge sem estar na lista de diferenças deliberadas (formato pt-BR, "—" sem base).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './perf/pw.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY, USER_ID } from './perf/mock.mjs'
import { startServer } from './perf/server.mjs'
import { instalarResolvedor } from './perf/ts-alias.mjs'

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)
if (!argv.antes || !argv.depois) throw new Error('Informe --antes <dist> e --depois <dist>')
const raiz = path.resolve(import.meta.dirname, '..')
const SAIDA = path.resolve(argv.out ?? '.verification.local/painel-paridade')
fs.mkdirSync(SAIDA, { recursive: true })
const FIXED = new Date('2026-09-29T18:00:00Z') // 15:00 em Brasília
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

instalarResolvedor(raiz)
const periodos = await import('../src/lib/dashboard-period.ts')
const { brasiliaDateKey } = await import('../src/lib/brasilia-time.ts')

function comRelogioFixo(fn) {
  const Original = Date
  globalThis.Date = class extends Original {
    constructor(...args) {
      if (args.length === 0) super(FIXED.getTime())
      else super(...args)
    }
    static now() {
      return FIXED.getTime()
    }
  }
  try {
    return fn()
  } finally {
    globalThis.Date = Original
  }
}

const FILTROS = [
  ['hoje', 'Hoje'],
  ['ontem', 'Ontem'],
  ['7dias', '7 dias'],
  ['14dias', '14 dias'],
  ['30dias', '30 dias'],
  ['all', 'Todo o período'],
  ['custom', 'Tempo personalizado'],
]
const INTERVALO = { start: '2026-09-01', end: '2026-09-15' }

/**
 * O que o gráfico antigo recebia (metrics.vendasMes = buildDashboardSeries), refeito sobre as mesmas linhas do mock e
 * com a mesma regra de escopo da hook (o vendedor só vê as próprias linhas).
 */
function serieAntiga(f, filtro, soDoUsuario) {
  return comRelogioFixo(() => {
    const periodo = periodos.resolveDashboardPeriod(filtro, INTERVALO)
    const dentro = (iso) => periodo.allTime || (Date.parse(iso) >= periodo.start.getTime() && Date.parse(iso) < periodo.end.getTime())
    const meu = (r) => !soDoUsuario || r.user_id === USER_ID
    const vendas = f.tables.vendas.filter((v) => v.approval_status === 'aprovada' && dentro(v.created_at) && meu(v))
    const abordagens = f.tables.abordagens.filter((a) => dentro(a.created_at) && meu(a))
    return periodos.buildDashboardSeries(vendas, abordagens, periodo).map((p) => [p.month, p.vendas, p.abordagens])
  })
}

/**
 * Calls feitas que o gráfico novo tem de mostrar, refeitas sobre o mock: qualificação ou fechamento concluída no CRM
 * (com resultado) e sem cancelamento, no momento em que aconteceu (a hora marcada, ou a do fechamento se veio antes), no
 * período, e só as da própria pessoa para quem não é Executive (assigned_to). Por dia, mês ou ano, nos mesmos intervalos;
 * em "todo o período", do primeiro ao último registro de tudo.
 */
function callsEsperadas(f, filtro, soDoUsuario) {
  return comRelogioFixo(() => {
    const periodo = periodos.resolveDashboardPeriod(filtro, INTERVALO)
    const dentro = (iso) => periodo.allTime || (Date.parse(iso) >= periodo.start.getTime() && Date.parse(iso) < periodo.end.getTime())
    const meu = (r) => !soDoUsuario || r.user_id === USER_ID
    const feita = (c) => ['qualificacao', 'fechamento_closer'].includes(c.call_type) && c.is_completed && !c.cancelled_at
    const momento = (c) => new Date(Math.min(...[c.scheduled_at, c.completed_at].filter(Boolean).map((v) => Date.parse(v)))).toISOString()
    const calls = f.tables.crm_activities
      .filter((c) => feita(c) && dentro(momento(c)) && (!soDoUsuario || c.assigned_to === USER_ID))
      .map((c) => ({ created_at: momento(c) }))
    let fixo = periodo
    if (periodo.allTime) {
      const vendas = f.tables.vendas.filter((v) => v.approval_status === 'aprovada' && meu(v))
      const abordagens = f.tables.abordagens.filter(meu)
      const dias = [...vendas, ...abordagens, ...calls].map((l) => brasiliaDateKey(l.created_at)).sort()
      fixo = { ...periodo, startKey: dias[0], endKey: dias[dias.length - 1] }
    }
    return { total: calls.length, serie: calls.length ? periodos.buildDashboardSeries([], calls, fixo).map((p) => [p.month, p.abordagens]) : [] }
  })
}

// ------------------------------------------------------------------------------------------------- leitura da tela
const EXTRAI_ANTES = () => {
  const limpo = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const kpi = (titulo) => {
    const p = [...document.querySelectorAll('p')].find((x) => limpo(x.textContent) === titulo)
    return p ? { valor: limpo(p.nextElementSibling?.textContent), detalhe: limpo(p.nextElementSibling?.nextElementSibling?.textContent) } : null
  }
  const cartao = (titulo) => [...document.querySelectorAll('h3, div, p')].find((x) => limpo(x.textContent) === titulo && x.className.includes('font-medium'))?.closest('.rounded-2xl')
  const produtos = (() => {
    const c = cartao('Produtos em destaque')
    return c ? [...c.querySelectorAll('p[title]')].map((p) => {
      const linha = p.closest('.relative.flex')
      const ps = linha.querySelectorAll('p')
      return [limpo(p.textContent), limpo(ps[1]?.textContent), limpo(ps[ps.length - 1]?.textContent)]
    }) : null
  })()
  const ranking = (() => {
    const c = cartao('Top Closers · mês atual')
    return c ? [...c.querySelectorAll('.group.flex')].map((l) => [limpo(l.querySelector('.truncate')?.textContent), limpo(l.querySelector('.text-right span')?.textContent), limpo(l.querySelector('.text-right p')?.textContent)]) : null
  })()
  const ultimas = [...document.querySelectorAll('section[aria-label="Últimas dez vendas aprovadas"] article')].map((a) => [
    limpo(a.querySelector('.truncate.text-sm')?.textContent),
    limpo(a.querySelector('.text-2xl')?.textContent),
    limpo(a.querySelector('p[title]')?.textContent),
    a.querySelector('time')?.getAttribute('datetime'),
  ])
  const time = document.querySelector('section[aria-label="Vendas do time"]')
  const vendasDoTime = time ? [...time.querySelectorAll('article')].map((a) => [
    limpo(a.querySelector('p.text-sm')?.firstChild?.textContent),
    limpo(a.querySelector('.text-lg')?.textContent),
    limpo(a.querySelector('.break-words')?.firstChild?.textContent),
    a.querySelector('time')?.getAttribute('datetime'),
  ]) : null
  const totalDoTime = time ? limpo([...time.querySelectorAll('p')].find((p) => /resultados/.test(p.textContent))?.textContent).replace(/ · consulta.*/, '') : null
  const texto = limpo(document.body.innerText)
  const checklist = texto.match(/(\d+)\/(\d+) concluídas/)?.[0] ?? null
  const turno = [...document.querySelectorAll('section[aria-label="Metas de abordagens por turno"] article')].map((a) => limpo(a.querySelector('.tabular-nums')?.textContent))
  return {
    kpis: Object.fromEntries(['Total de Vendas', 'Quantidade de Vendas', 'Ticket Médio', 'Abordagens', 'Taxa Conversão', 'Posição Ranking'].map((t) => [t, kpi(t)])),
    produtos,
    ranking,
    ultimas,
    vendasDoTime,
    totalDoTime,
    checklist,
    turno,
  }
}

const EXTRAI_DEPOIS = () => {
  const limpo = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const regiao = (nome) => document.querySelector(`section[aria-label="${nome}"]`)
  const kpi = (nome) => {
    const r = regiao(nome)
    return r ? { valor: limpo(r.querySelector('.mt-3 p')?.textContent), detalhe: limpo(r.querySelector('.mt-3 .mt-2')?.textContent) } : null
  }
  const produtos = [...document.querySelectorAll('ul[aria-label="Receita aprovada por produto"] > li')].map((li) => [
    limpo(li.querySelector('span[title]')?.textContent),
    limpo(li.querySelector('p')?.textContent),
    limpo(li.querySelector('strong')?.textContent),
  ])
  const podio = (nome) =>
    [...document.querySelectorAll(`ol[aria-label="${nome}"] > li:not(.opacity-50)`)].map((li) => [
      limpo(li.querySelector('.truncate')?.textContent),
      limpo(li.querySelector('.painel-numero-subiu')?.textContent),
      limpo(li.querySelector('.text-\\[11px\\]')?.textContent),
    ])
  const linha = (li) => [
    limpo(li.querySelector('p.font-medium .truncate')?.textContent),
    limpo(li.querySelector('.font-semibold.tabular-nums')?.textContent),
    limpo((li.querySelector('p.truncate.text-xs') ?? li.querySelector('.col-start-2.row-start-2'))?.textContent),
    li.querySelector('time')?.getAttribute('datetime'),
  ]
  const ultimas = [...document.querySelectorAll('ol[aria-label="Últimas dez vendas aprovadas"] > li')].map(linha)
  const time = regiao('Vendas do time')
  const vendasDoTime = time ? [...time.querySelectorAll('ol > li')].map(linha) : null
  const totalDoTime = time ? limpo([...time.querySelectorAll('p')].find((p) => /resultados/.test(p.textContent))?.textContent).replace(/ · consulta.*/, '') : null
  const checklist = limpo(regiao('Checklist de hoje')?.querySelector('h2 + p')?.textContent) || null
  const turno = [...(regiao('Metas de abordagens por turno')?.querySelectorAll('li') ?? [])].map((li) => limpo(li.querySelector('.tabular-nums')?.textContent))
  // Gráfico de abordagens e calls: a tabela alternativa traz [intervalo, calls feitas, abordagens]; a legenda, os totais.
  const serie = [...document.querySelectorAll('[data-dashboard-section="commercial-evolution"] details tbody tr')].map((tr) => [...tr.cells].map((c) => limpo(c.textContent)))
  const legenda = limpo(regiao('Abordagens e calls')?.querySelector('ul[aria-label="Legenda"]')?.textContent)
  const divisao = limpo(document.querySelector('ul[aria-label="Abordagens por demonstração da IA"]')?.textContent)
  // Gráficos dos indicadores: cada coluna traz o intervalo (data-rotulo) e o total (data-total).
  const colunas = (nome) => [...(regiao(nome)?.querySelectorAll('g[data-coluna]') ?? [])].map((g) => [g.getAttribute('data-rotulo'), Number(g.getAttribute('data-total'))])
  // O gráfico de vendas (área) traz cada intervalo na tabela gêmea: [intervalo, vendas, acumulado].
  const colunasDeVendas = [...(regiao('Quantidade de Vendas')?.querySelectorAll('details tbody tr') ?? [])].map((tr) => [limpo(tr.cells[0].textContent), Number(limpo(tr.cells[1].textContent))])
  const colunasDeAbordagens = colunas('Abordagens')
  const somar = (lista) => lista.reduce((s, [, v]) => s + v, 0)
  return {
    kpis: Object.fromEntries(
      [['Total de Vendas', 'Total de Vendas'], ['Quantidade de Vendas', 'Quantidade de Vendas'], ['Ticket Médio', 'Ticket Médio'], ['Abordagens', 'Abordagens'], ['Taxa Conversão', 'Conversão'], ['Posição Ranking', 'Posição no ranking']].map(([antigo, novo]) => [antigo, kpi(novo)]),
    ),
    produtos,
    ranking: podio('Pódio dos Closers'),
    rankingSdr: podio('Pódio dos SDRs'),
    legenda,
    colunasDeVendas,
    ultimas,
    vendasDoTime,
    totalDoTime,
    checklist,
    turno,
    serie,
    divisao,
    colunasVendas: somar(colunasDeVendas),
    colunasAbordagens: somar(colunasDeAbordagens),
  }
}

// ------------------------------------------------------------------------------------------------------ navegação
async function abrir(navegador, url, fixtures) {
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  })
  installMock(contexto, fixtures, { latencyMs: 10 })
  await contexto.addInitScript(
    ({ chave, sessao }) => {
      sessionStorage.setItem(chave, JSON.stringify(sessao))
      localStorage.setItem('theme', 'dark')
    },
    { chave: STORAGE_KEY, sessao: fakeSession(FIXED.getTime()) },
  )
  const pagina = await contexto.newPage()
  await pagina.clock.setFixedTime(FIXED)
  const erros = []
  pagina.on('pageerror', (e) => erros.push(String(e.message).slice(0, 200)))
  return { contexto, pagina, erros }
}

const pedidoDasMetricas = (r) => r.url().includes('/rest/v1/vendas') && decodeURIComponent(r.url()).includes('valor_venda')

/** Espera a carga das métricas que o clique dispara (e o desenho dela). */
async function aposCarga(pagina, acao) {
  const resposta = pagina.waitForResponse(pedidoDasMetricas, { timeout: 20_000 })
  await acao()
  await resposta
  await sleep(900)
}

async function lerTudo(pagina, versao) {
  return pagina.evaluate(versao === 'antes' ? EXTRAI_ANTES : EXTRAI_DEPOIS)
}

async function percorrer(navegador, url, versao, fixtures) {
  const { contexto, pagina, erros } = await abrir(navegador, url, fixtures)
  const papel = versao === 'antes' ? 'tab' : 'radio'
  const leituras = {}
  try {
    await aposCarga(pagina, () => pagina.goto(url + '/', { waitUntil: 'load' }))
    // Ranking, metas e vendas do time vêm de consultas próprias: espera elas também.
    await sleep(1500)
    for (const [filtro, rotulo] of FILTROS) {
      if (filtro !== 'hoje') await aposCarga(pagina, () => pagina.getByRole(papel, { name: rotulo, exact: true }).click())
      if (filtro === 'custom') {
        await pagina.getByLabel('Data inicial').fill(INTERVALO.start)
        await pagina.getByLabel('Data final').fill(INTERVALO.end)
        await aposCarga(pagina, () => pagina.getByRole('button', { name: 'Aplicar período', exact: true }).click())
      }
      leituras[filtro] = await lerTudo(pagina, versao)
    }
  } finally {
    await contexto.close()
  }
  return { leituras, erros }
}

// ------------------------------------------------------------------------------------------------------ comparação
const normalizar = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const numero = (s) => {
  const t = normalizar(s).replace(/[^\d.,-]/g, '')
  if (!t) return null
  // pt-BR ("1.234,5" e "1.564") ou o antigo "31.3" de toFixed (uma casa) e "1564" sem separador.
  if (t.includes(',')) return Number(t.replaceAll('.', '').replace(',', '.'))
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replaceAll('.', ''))
  return Number(t)
}
const linhas = []
let falhas = 0
function comparar(cenario, filtro, metrica, antes, depois, { modo = 'texto', nota = '' } = {}) {
  let igual
  let observacao = nota
  if (modo === 'numero') {
    igual = numero(antes) === numero(depois)
    if (igual && normalizar(antes) !== normalizar(depois)) observacao = 'mesmo número; separador de milhar pt-BR (R7)'
  }
  else if (modo === 'conversao') {
    // Antigo: toFixed(1) com ponto ("0.0%" mesmo sem abordagens). Novo: pt-BR com vírgula e "—" sem abordagens.
    if (normalizar(depois) === '—') {
      igual = numero(antes) === 0
      observacao = 'sem abordagens: antes "0.0%", agora "—" (sem base não há taxa; spec 8.1)'
    } else igual = numero(antes) === numero(depois)
    if (igual && !observacao && normalizar(antes) !== normalizar(depois)) observacao = 'mesmo número; vírgula decimal pt-BR (R7)'
  } else igual = JSON.stringify(antes) === JSON.stringify(depois)
  if (!igual) falhas++
  linhas.push({ cenario, filtro, metrica, antes, depois, igual, observacao })
}

const resumo = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

// ------------------------------------------------------------------------------------------------------------ roda
const navegador = await chromium.launch({ headless: true })
const servidorAntes = await startServer(path.resolve(argv.antes))
const servidorDepois = await startServer(path.resolve(argv.depois))
const cenarios = [
  ['executivo (time inteiro)', () => buildFixtures({ role: 'super_admin', now: FIXED })],
  [
    'executivo no ranking (2º)',
    () => {
      const f = buildFixtures({ role: 'super_admin', now: FIXED })
      const ranking = f.rpc.get_team_ranking()
      ranking.splice(1, 0, { user_id: USER_ID, name: 'Bench Admin', avatarUrl: null, totalVendas: 85000.5, quantidadeVendas: 38, abordagens: 280, conversao: 11 })
      f.rpc.get_team_ranking = () => ranking
      return f
    },
  ],
  ['vendedor (só os próprios números)', () => buildFixtures({ role: 'seller', now: FIXED })],
]
const saida = {}
try {
  for (const [nome, fabricar] of cenarios) {
    const antes = await percorrer(navegador, servidorAntes.url, 'antes', fabricar())
    const depois = await percorrer(navegador, servidorDepois.url, 'depois', fabricar())
    const f = fabricar()
    saida[nome] = { antes, depois }
    for (const [filtro] of FILTROS) {
      const a = antes.leituras[filtro]
      const d = depois.leituras[filtro]
      for (const k of ['Total de Vendas', 'Quantidade de Vendas', 'Ticket Médio', 'Abordagens']) comparar(nome, filtro, k, normalizar(a.kpis[k]?.valor), normalizar(d.kpis[k]?.valor), { modo: 'numero' })
      comparar(nome, filtro, 'Conversão', normalizar(a.kpis['Taxa Conversão']?.valor), normalizar(d.kpis['Taxa Conversão']?.valor), { modo: 'conversao' })
      comparar(nome, filtro, 'Posição no ranking', [normalizar(a.kpis['Posição Ranking']?.valor), normalizar(a.kpis['Posição Ranking']?.detalhe)], [normalizar(d.kpis['Posição Ranking']?.valor), normalizar(d.kpis['Posição Ranking']?.detalhe)])
      // Série: a antiga é a de buildDashboardSeries (vendas e abordagens por intervalo). Na nova, as vendas de cada
      // intervalo estão nas colunas do indicador e as abordagens na tabela do gráfico de abordagens e calls; num dia só
      // as duas abrem por hora e a soma das horas é o ponto do dia. Um intervalo que só a linha nova tem (uma call fora do
      // alcance das vendas e abordagens, em "todo o período") só pode vir zerado de vendas e abordagens.
      const soDoUsuario = nome.startsWith('vendedor')
      const antiga = serieAntiga(f, filtro, soDoUsuario)
      const tabela = d.serie.map(([rotulo, calls, ab]) => [rotulo, Number(calls), Number(ab)])
      const vendasPorRotulo = new Map(d.colunasDeVendas)
      const abordagensPorRotulo = new Map(tabela.map(([r, , ab]) => [r, ab]))
      const umDia = antiga.length === 1
      if (umDia) {
        const soma = (mapa) => [...mapa.values()].reduce((t, v) => t + v, 0)
        comparar(nome, filtro, 'Evolução (vendas, abordagens)', [antiga[0][1], antiga[0][2]], [soma(vendasPorRotulo), soma(abordagensPorRotulo)], { nota: antiga[0][1] + antiga[0][2] ? 'um dia: a nova abre por hora; a soma das horas = o ponto do dia' : 'sem movimento: moldura vazia' })
      } else {
        const nova = antiga.map(([r]) => [r, vendasPorRotulo.get(r) ?? 0, abordagensPorRotulo.get(r) ?? 0])
        const sobra = [...vendasPorRotulo, ...abordagensPorRotulo].filter(([r, v]) => v !== 0 && !antiga.some(([ra]) => ra === r))
        comparar(nome, filtro, `Evolução (${antiga.length} pontos)`, antiga, sobra.length ? [...nova, ...sobra] : nova, { nota: 'vendas na tabela do gráfico do indicador; abordagens na do gráfico de abordagens e calls' })
      }
      // Calls feitas (bloco novo): a tabela fecha com o mock intervalo a intervalo, e a legenda traz o mesmo total.
      const ce = callsEsperadas(f, filtro, soDoUsuario)
      const callsNaTela = tabela.map(([r, c]) => [r, c])
      const notaCalls = 'bloco novo: calls concluídas no CRM, sem as só marcadas e as canceladas'
      if (umDia || ce.total === 0) comparar(nome, filtro, 'Calls feitas (soma do gráfico)', ce.total, callsNaTela.reduce((t, [, c]) => t + c, 0), { nota: notaCalls })
      else comparar(nome, filtro, `Calls feitas (${ce.serie.length} pontos)`, ce.serie, callsNaTela, { nota: notaCalls })
      const totalNaLegenda = (rotulo) => numero(normalizar(d.legenda).match(new RegExp(`${rotulo}\\s*([\\d.]+)`))?.[1])
      comparar(nome, filtro, 'Legenda: calls feitas', ce.total, totalNaLegenda('Calls feitas'), { nota: notaCalls })
      comparar(nome, filtro, 'Legenda: abordagens', numero(a.kpis.Abordagens?.valor), totalNaLegenda('Abordagens'), { nota: 'bloco novo: o total da legenda = o indicador antigo' })
      // Produtos: o antigo mostrava os 3 primeiros da mesma lista (top 5); o novo mostra os 5.
      const pa = (a.produtos ?? []).map(([n, q, v]) => [n, q, normalizar(v)])
      const pd = (d.produtos ?? []).slice(0, pa.length).map(([n, q, v]) => [n, q, normalizar(v)])
      comparar(nome, filtro, 'Produtos (top 3)', pa, pd, { nota: d.produtos?.length > pa.length ? `o novo mostra também o 4º e o 5º da mesma lista (${d.produtos.length} itens)` : '' })
      // Divisão das abordagens (nova): soma = o total do indicador antigo.
      // Gráficos dos indicadores (novos): a soma das colunas fecha com os totais do painel antigo.
      comparar(nome, filtro, 'Gráfico de vendas: soma das colunas', numero(a.kpis['Quantidade de Vendas']?.valor), d.colunasVendas, { nota: 'bloco novo: soma das colunas = total antigo' })
      comparar(nome, filtro, 'Gráfico de abordagens: soma das colunas', numero(a.kpis.Abordagens?.valor), d.colunasAbordagens, { nota: 'bloco novo: soma das colunas = total antigo' })
      const m = normalizar(d.divisao).match(/Mostrou a IA\s*([\d.]+)\s*(?:\([\d,]+%\))?\s*Não mostrou\s*([\d.]+)/)
      comparar(nome, filtro, 'Abordagens: Mostrou a IA + Não mostrou', numero(a.kpis.Abordagens?.valor), m ? numero(m[1]) + numero(m[2]) : null, { nota: 'bloco novo: as duas partes somam o total antigo' })
      if (filtro === 'hoje') {
        // Blocos com janela própria (não dependem do filtro): uma comparação basta.
        const ra = (a.ranking ?? []).slice(0, 3).map(([n, v]) => [n, normalizar(v)])
        const rd = d.ranking.map(([n, v]) => [n, normalizar(v)])
        comparar(nome, '—', 'Pódio dos Closers (top 3)', ra, rd, { nota: 'o pódio compacto mostra os 3 primeiros da mesma lista; a lista toda fica em Ranking' })
        const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
        const sdrs = f.rpc.get_sdr_ranking().slice(0, 3).map((s) => [s.name, plural(s.repasses, 'repasse', 'repasses'), plural(s.abordagens, 'abordagem', 'abordagens')])
        comparar(nome, '—', 'Pódio dos SDRs (top 3)', sdrs, d.rankingSdr.map(([n, v, ap]) => [n, normalizar(v), normalizar(ap)]), { nota: 'bloco novo: a ordem e os números de get_sdr_ranking (o mesmo ranking da tela Ranking)' })
        comparar(nome, '—', 'Últimas vendas (10)', a.ultimas.map(([s, v, p, t]) => [s, normalizar(v), p, t]), d.ultimas.map(([s, v, p, t]) => [s, normalizar(v), p, t]))
        comparar(nome, '—', 'Vendas do time (pág. 1)', a.vendasDoTime?.map(([s, v, p, t]) => [s, normalizar(v), p, t]), d.vendasDoTime?.map(([s, v, p, t]) => [s, normalizar(v), p, t]))
        comparar(nome, '—', 'Vendas do time (total)', a.totalDoTime, d.totalDoTime)
        comparar(nome, '—', 'Checklist de hoje', a.checklist, d.checklist)
        comparar(nome, '—', 'Metas de turno', a.turno, d.turno)
      }
    }
    for (const [versao, r] of [['antes', antes], ['depois', depois]]) if (r.erros.length) console.log(`erros na página (${nome}, ${versao}):`, r.erros)
  }
} finally {
  await navegador.close()
  servidorAntes.server.close()
  servidorDepois.server.close()
}

fs.writeFileSync(path.join(SAIDA, 'paridade.json'), JSON.stringify({ linhas, leituras: saida }, null, 2))
const md = [
  '| Cenário | Filtro | Número | Antes | Depois | Igual | Observação |',
  '|---|---|---|---|---|---|---|',
  ...linhas.map((l) => `| ${l.cenario} | ${l.filtro} | ${l.metrica} | ${resumo(l.antes).slice(0, 90)} | ${resumo(l.depois).slice(0, 90)} | ${l.igual ? 'sim' : '**NÃO**'} | ${l.observacao} |`),
].join('\n')
fs.writeFileSync(path.join(SAIDA, 'paridade.md'), md)
console.log(md)
console.log(`\n${linhas.length - falhas}/${linhas.length} comparações iguais.`)
assert.equal(falhas, 0, `${falhas} número(s) divergem entre o painel antigo e o novo (ver ${path.join(SAIDA, 'paridade.md')})`)
