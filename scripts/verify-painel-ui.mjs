// Verificação de interface da Home (Visão geral) num navegador real, com backend FALSO (nada toca em produção).
// O build tem de ser o de benchmark (VITE_SUPABASE_URL=https://benchmock.supabase.co), como em scripts/perf/README.md:
//   VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
//     npx vite build --outDir .verification.local/perf/dist-depois --emptyOutDir
//   node scripts/verify-painel-ui.mjs --dist .verification.local/perf/dist-depois
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY, USER_ID } from './perf/mock.mjs'
import { startServer } from './perf/server.mjs'
import { instalarResolvedor } from './perf/ts-alias.mjs'

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)
if (!argv.dist) throw new Error('Informe --dist <pasta do build de benchmark>')
const raiz = path.resolve(import.meta.dirname, '..')
const SAIDA = path.resolve(argv.out ?? '.verification.local/painel-ui')
fs.mkdirSync(SAIDA, { recursive: true })
const expect = baseExpect.configure({ timeout: 15_000 })
const FIXED = new Date('2026-09-29T18:00:00Z') // 15:00 em Brasília, uma terça
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

instalarResolvedor(raiz)
const periodos = await import('../src/lib/dashboard-period.ts')
const tempo = await import('../src/painel/lib/tempo.ts')
const { money } = await import('../src/lib/sales.ts')

/** Roda `fn` com o relógio do Node congelado em FIXED (as funções de período leem "agora" sozinhas). */
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

/** Milissegundos do momento de uma call concluída: o mais cedo entre a hora marcada e a do fechamento. */
const momentoDaCall = (c) => Math.min(...[c.scheduled_at, c.completed_at].filter(Boolean).map((v) => Date.parse(v)))

/** Os números que o painel ANTIGO calculava (useDashboardData), refeitos sobre as linhas do mock. */
function esperado(fixtures, filtro, intervalo = { start: '2026-09-01', end: '2026-09-15' }) {
  const periodo = comRelogioFixo(() => periodos.resolveDashboardPeriod(filtro, intervalo))
  const dentro = (iso) => periodo.allTime || (Date.parse(iso) >= periodo.start.getTime() && Date.parse(iso) < periodo.end.getTime())
  const vendas = fixtures.tables.vendas.filter((v) => v.approval_status === 'aprovada' && dentro(v.created_at))
  const abordagens = fixtures.tables.abordagens.filter((a) => dentro(a.created_at))
  const total = vendas.reduce((s, v) => s + Number(v.valor_venda), 0)
  const quantidade = vendas.length
  const conversao = abordagens.length > 0 ? (quantidade / abordagens.length) * 100 : 0
  // A barra dividida: as abordagens do mesmo recorte, pela resposta "Mostrou a IA funcionando?".
  const mostrou = abordagens.filter((a) => a.mostrou_ia === true).length
  // Calls feitas: qualificação ou fechamento concluída no CRM (com resultado), sem cancelamento, no momento em que
  // aconteceu (a hora marcada, ou a do fechamento se veio antes); só marcadas e canceladas ficam de fora.
  const calls = fixtures.tables.crm_activities.filter(
    (c) => ['qualificacao', 'fechamento_closer'].includes(c.call_type) && c.is_completed && !c.cancelled_at && dentro(new Date(momentoDaCall(c)).toISOString()),
  )
  return { periodo, vendas, abordagens, calls, total, quantidade, ticket: quantidade > 0 ? total / quantidade : 0, conversao, mostrou, naoMostrou: abordagens.length - mostrou }
}
/** "1 call feita", "3 calls feitas": como o gráfico escreve na dica e no rótulo de acessibilidade. */
const callsFeitas = (n) => `${inteiro(n)} ${n === 1 ? 'call feita' : 'calls feitas'}`
const normalizar = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const inteiro = (n) => n.toLocaleString('pt-BR')
const percentual = (c) => `${Number(c.toFixed(1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

const { server, url } = await startServer(path.resolve(argv.dist))
const navegador = await chromium.launch({ headless: true })

// A Home SEMPRE abre nos últimos 30 dias numa carga nova da página (vendas anteriores à vista), mesmo que o endereço traga
// outro filtro. Quase todos os testes foram escritos para o recorte de um dia só (por hora, "na última hora"), então
// `periodo` (padrão 'hoje') escolhe esse recorte clicando no filtro depois que a Home abre, como a pessoa faria. Passe
// `periodo: null` para ficar no padrão da abertura (30 dias): o teste do filtro, o da primeira pintura e os de animação.
const ROTULO_DO_PERIODO = { hoje: 'Hoje', ontem: 'Ontem', '7dias': '7 dias', '14dias': '14 dias', '30dias': '30 dias', all: 'Todo o período' }

async function abrir({ tema = 'dark', largura = 1440, altura = 900, movimento = 'reduce', fixtures, ws = 'normal', caminho = '/', periodo = 'hoje', comSessao = true, latencia = 15, esperarTitulo = true } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: movimento,
    colorScheme: tema,
  })
  const f = fixtures ?? buildFixtures({ role: 'super_admin', now: FIXED })
  const mock = installMock(contexto, f, { latencyMs: latencia, ws })
  const pedidosDeVendas = []
  // Aprovadas NO período e compradas antes dele (p_late): alimentam o aviso e o feed, nunca os totais.
  const pedidosDeAprovacoes = []
  const pedidosDeCalls = []
  // Os números da Home saem das funções dashboard_home_* (o time todo, para qualquer conta); cada pedido guarda os
  // argumentos que foram no corpo (p_start, p_end e, nas aprovações tardias, p_late).
  contexto.on('request', (r) => {
    const u = new URL(r.url())
    const funcao = u.pathname.split('/rest/v1/rpc/')[1]
    if (!funcao?.startsWith('dashboard_home_')) return
    const args = JSON.parse(r.postData() || '{}')
    if (funcao === 'dashboard_home_sales') (args.p_late ? pedidosDeAprovacoes : pedidosDeVendas).push(args)
    if (funcao === 'dashboard_home_calls') pedidosDeCalls.push(args)
  })
  await contexto.addInitScript(
    ({ chave, sessao, tema, comSessao }) => {
      try {
        if (comSessao) localStorage.setItem(chave, JSON.stringify(sessao))
        localStorage.setItem('theme', tema)
      } catch {
        /* sem armazenamento */
      }
    },
    { chave: STORAGE_KEY, sessao: fakeSession(FIXED.getTime()), tema, comSessao },
  )
  const pagina = await contexto.newPage()
  await pagina.clock.setFixedTime(FIXED)
  const erros = []
  pagina.on('pageerror', (e) => erros.push(`pageerror: ${String(e.message).slice(0, 220)}`))
  pagina.on('console', (m) => {
    if (m.type() === 'error') erros.push(`console: ${m.text().slice(0, 220)}`)
  })
  await pagina.goto(url + caminho, { waitUntil: 'load' })
  if (esperarTitulo) await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
  if (esperarTitulo && periodo) {
    const radio = pagina.getByRole('radio', { name: ROTULO_DO_PERIODO[periodo], exact: true })
    await expect(regiao(pagina, 'Total de Vendas')).toBeVisible({ timeout: 20_000 })
    const resposta = pagina.waitForResponse((r) => r.url().includes('/rest/v1/rpc/dashboard_home_sales') && !(r.request().postData() ?? '').includes('"p_late":true'), { timeout: 20_000 })
    await radio.click()
    await expect(radio).toHaveAttribute('aria-checked', 'true')
    await resposta
    await new Promise((resolver) => setTimeout(resolver, 400))
  }
  return { contexto, pagina, mock, f, erros, pedidosDeVendas, pedidosDeAprovacoes, pedidosDeCalls, fechar: () => contexto.close() }
}

const regiao = (pagina, nome) => pagina.getByRole('region', { name: nome, exact: true })
const textoDe = async (pagina, nome) => normalizar(await regiao(pagina, nome).innerText())
const KPIS = ['Quantidade de Vendas', 'Abordagens', 'Conversão', 'Meta do dia', 'Total de Vendas', 'Ticket Médio', 'Posição no ranking']
/** Legenda da barra dividida das abordagens: os dois totais escritos ao lado dos pontos coloridos. */
async function divisaoNaTela(pagina) {
  const texto = await textoDe(pagina, 'Abordagens')
  const m = texto.match(/Mostrou a IA ([\d.]+)(?: \([\d,]+%\))? Não mostrou ([\d.]+)/)
  assert.ok(m, `legenda da barra dividida (veio "${texto}")`)
  return { mostrou: Number(m[1].replaceAll('.', '')), naoMostrou: Number(m[2].replaceAll('.', '')) }
}
/** Tabela alternativa do gráfico de abordagens e calls: [intervalo, calls feitas, abordagens]. */
const linhasDaTabela = (pagina) =>
  pagina.locator('[data-dashboard-section="commercial-evolution"] details tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())))
const GRAFICO = 'Abordagens e calls'
const PODIOS = ['Pódio dos Closers', 'Pódio dos SDRs']
/** Tabela do gráfico de vendas: [intervalo, vendas, acumulado]. */
const pontosDeVendas = (pagina) =>
  regiao(pagina, 'Quantidade de Vendas')
    .locator('details tbody tr')
    .evaluateAll((trs) => trs.map((tr) => [tr.cells[0].textContent.trim(), Number(tr.cells[1].textContent), Number(tr.cells[2].textContent)]))

const resultados = []
async function teste(nome, fn) {
  // --so <trecho>: roda só os testes cujo nome contém o trecho (útil para investigar uma falha).
  if (argv.so && !nome.includes(argv.so)) return
  const inicio = Date.now()
  try {
    await fn()
    resultados.push({ nome, ok: true, ms: Date.now() - inicio })
    console.log(`PASS  ${nome}`)
  } catch (e) {
    resultados.push({ nome, ok: false, ms: Date.now() - inicio, erro: String(e.message ?? e).split('\n').slice(0, 6).join(' | ') })
    console.log(`FAIL  ${nome}\n      ${String(e.message ?? e).split('\n').slice(0, 8).join('\n      ')}`)
  }
}

// ---------------------------------------------------------------------------------------------------------------
await teste('estrutura, ordem das seções, tokens escopados e navegação intacta', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const secoes = await pagina.locator('[data-dashboard-section]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-dashboard-section')))
    // As 5 primeiras na ordem que os testes antigos do repositório conferem (verify-sales-management-ui).
    assert.deepEqual(secoes, ['greeting', 'commercial-indicators', 'goals-in-progress', 'commercial-evolution', 'featured-products', 'transparent-operation', 'recent-sales'])
    for (const nome of [...KPIS, GRAFICO, ...PODIOS]) await expect(regiao(pagina, nome)).toBeVisible()
    // Os indicadores conservam sua linha; os DOIS pódios ficam ao lado de calls/abordagens.
    const caixa = (nome) => regiao(pagina, nome).boundingBox()
    const [qv, closers, grafico, sdrs, conv, meta, abord] = await Promise.all(['Quantidade de Vendas', PODIOS[0], GRAFICO, PODIOS[1], 'Conversão', 'Meta do dia', 'Abordagens'].map(caixa))
    for (const [dir, nome] of [[closers, PODIOS[0]], [sdrs, PODIOS[1]]]) {
      assert.ok(dir.x >= grafico.x + grafico.width, `${nome}: ao lado do gráfico de calls e abordagens`)
    }
    assert.ok(Math.abs(closers.y - grafico.y) <= 1, 'Closers começa junto com o gráfico')
    assert.ok(sdrs.y > closers.y + closers.height && Math.abs(sdrs.x - closers.x) <= 1, 'SDRs logo abaixo dos Closers')
    assert.ok(Math.abs(sdrs.y + sdrs.height - (grafico.y + grafico.height)) <= 1, 'o gráfico ocupa a altura dos dois pódios')
    assert.ok(Math.abs(qv.y - abord.y) <= 1 && Math.abs(qv.y - conv.y) <= 1, 'indicadores permanecem na mesma linha')
    assert.ok(Math.abs(conv.x - meta.x) < 1 && meta.y > conv.y + conv.height, 'Meta do dia logo abaixo da Conversão')
    assert.ok(Math.abs(meta.y + meta.height - (abord.y + abord.height)) <= 1, 'a coluna dos dois termina com o cartão de abordagens')
    const desenho = await regiao(pagina, GRAFICO).getByRole('img').locator('svg').boundingBox()
    assert.ok(desenho.height >= 380, `gráfico ampliado: desenho de ${desenho.height}px`)
    assert.ok(grafico.y + grafico.height - (desenho.y + desenho.height) < 75, 'desenho preenche o cartão até a tabela, sem vão embaixo')
    // Medidas da referência: cartão de 18 px, chip de 14 px, controle segmentado de 14 px e botão interno de 9,6 px.
    const raio = (loc) => loc.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
    assert.equal(await raio(regiao(pagina, 'Total de Vendas')), '18px')
    assert.equal(await raio(regiao(pagina, 'Total de Vendas').locator('span[aria-hidden="true"]').first()), '14px')
    assert.equal(await raio(pagina.getByRole('radiogroup', { name: 'Período' })), '14px')
    assert.equal(await raio(pagina.getByRole('radio', { name: 'Hoje', exact: true })), '9.6px')
    assert.equal(await pagina.locator('h1').count(), 1, 'um <h1> por página')
    assert.match(await pagina.evaluate(() => document.documentElement.className), /\bpainel\b/)
    assert.match(await pagina.evaluate(() => document.documentElement.className), /\bdark\b/)
    const token = (nome) => pagina.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), nome)
    assert.equal(await token('--card'), '257.14 24.14% 11.37%', 'tokens do painel ligados')
    const fonte = await pagina.evaluate(() => getComputedStyle(document.body).fontFamily)
    assert.match(fonte, /DM Sans Variable/, 'fonte do painel')

    const itens = await pagina.locator('[data-sidebar="content"] [data-sidebar="menu-button"]').allInnerTexts()
    for (const n of ['Dashboard', 'Executive', 'Arena Comercial', 'Metas', 'Ranking', 'Perfil', 'Configurações']) assert.ok(itens.map((t) => t.trim()).includes(n), `item de menu ${n} (veio ${itens.join(', ')})`)
    assert.equal(await pagina.locator('[data-sidebar="menu-button"][data-active="true"]').count(), 1)
    assert.equal((await pagina.locator('[data-sidebar="menu-button"][data-active="true"]').innerText()).trim(), 'Dashboard')

    // Sair da Home devolve os tokens globais (e as outras telas continuam como estavam).
    await pagina.locator('[data-sidebar="menu-button"]', { hasText: 'Ranking' }).first().click()
    await expect(pagina).toHaveURL(/\/ranking$/)
    await expect.poll(() => pagina.evaluate(() => document.documentElement.classList.contains('painel'))).toBe(false)
    assert.equal(await token('--card'), '261 24% 11%', 'fora da Home valem os tokens de sempre')
    await pagina.goBack()
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    assert.match(await pagina.evaluate(() => document.documentElement.className), /\bpainel\b/)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('login (/auth) e demais telas não ganham o escopo do painel', async () => {
  const { pagina, erros, fechar } = await abrir({ caminho: '/auth', comSessao: false, esperarTitulo: false })
  try {
    await sleep(1500)
    assert.equal(await pagina.evaluate(() => document.documentElement.classList.contains('painel')), false)
    assert.equal(await pagina.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--card').trim()), '261 24% 11%')
    assert.equal(await pagina.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--radius-2xl').trim()), '', 'raios novos só dentro do painel')
    assert.deepEqual(erros.filter((e) => !/Failed to load resource|401|403/.test(e)), [])
  } finally {
    await fechar()
  }
})

await teste('KPIs batem com as fórmulas do painel antigo em todos os filtros, e o filtro vive na URL', async () => {
  const { pagina, f, erros, pedidosDeVendas, pedidosDeAprovacoes, pedidosDeCalls, fechar } = await abrir({ periodo: null })
  try {
    // O primeiro é o padrão (30 dias): sem clique e sem gravar nada no endereço. Os demais saem por clique.
    const nomes = { '30dias': '30 dias', hoje: 'Hoje', ontem: 'Ontem', '7dias': '7 dias', '14dias': '14 dias', all: 'Todo o período' }
    const enderecos = { '30dias': null, hoje: 'hoje', ontem: 'ontem', '7dias': '7dias', '14dias': '14dias', all: 'tudo' }
    for (const [filtro, rotulo] of Object.entries(nomes)) {
      const e = esperado(f, filtro)
      pedidosDeVendas.length = 0
      pedidosDeAprovacoes.length = 0
      pedidosDeCalls.length = 0
      if (filtro !== '30dias') await pagina.getByRole('radio', { name: rotulo, exact: true }).click()
      await expect(pagina.getByRole('radio', { name: rotulo, exact: true })).toHaveAttribute('aria-checked', 'true')
      const url = new URL(pagina.url())
      assert.equal(url.searchParams.get('periodo'), enderecos[filtro], `URL do filtro ${filtro}`)
      await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(e.total)))
      assert.ok((await textoDe(pagina, 'Quantidade de Vendas')).includes(inteiro(e.quantidade)), `quantidade ${filtro}`)
      assert.ok((await textoDe(pagina, 'Ticket Médio')).includes(normalizar(money(e.ticket))), `ticket ${filtro}`)
      assert.ok((await textoDe(pagina, 'Abordagens')).includes(inteiro(e.abordagens.length)), `abordagens ${filtro}`)
      // A barra dividida reparte exatamente as mesmas abordagens do indicador (nenhuma a mais, nenhuma a menos).
      const divisao = await divisaoNaTela(pagina)
      assert.deepEqual(divisao, { mostrou: e.mostrou, naoMostrou: e.naoMostrou }, `divisão das abordagens ${filtro}`)
      assert.equal(divisao.mostrou + divisao.naoMostrou, e.abordagens.length)
      const conv = await textoDe(pagina, 'Conversão')
      assert.ok(e.abordagens.length > 0 ? conv.includes(percentual(e.conversao)) : conv.includes('—'), `conversão ${filtro}: ${conv}`)
      // Mesma fonte, mesma consulta: a janela pedida ao banco é a do período (nula em "todo o período").
      const [de, ate] = e.periodo.allTime ? [null, null] : [e.periodo.start.toISOString(), e.periodo.end.toISOString()]
      const janela = pedidosDeVendas.at(-1)
      assert.ok(janela, `pedido de vendas para ${filtro}`)
      assert.deepEqual([janela.p_start, janela.p_end], [de, ate], `janela do filtro ${filtro}`)
      assert.deepEqual(Object.keys(janela).sort(), ['p_end', 'p_start'], 'o pedido não leva filtro de usuário: é o time todo')
      // As aprovações do período de compras anteriores a ele (p_late: aprovadas na janela, compradas antes dela).
      // Em "todo o período" não existe compra anterior, então nem se pergunta.
      if (e.periodo.allTime) assert.equal(pedidosDeAprovacoes.length, 0, 'todo o período não tem compra anterior a buscar')
      else {
        const aprovacoes = pedidosDeAprovacoes.at(-1)
        assert.ok(aprovacoes, `pedido das aprovações de compras anteriores para ${filtro}`)
        assert.deepEqual([aprovacoes.p_start, aprovacoes.p_end, aprovacoes.p_late], [de, ate, true], `aprovadas na janela do filtro ${filtro}, compradas antes dela`)
      }
      // As calls saem na mesma carga, do time todo; quais contam (concluídas e não canceladas) é regra da função no
      // banco (supabase/tests/home_team_rows.sql). A janela pega a hora marcada ou a do fechamento; o momento exato
      // (o mais cedo dos dois) é recortado na tela.
      const calls = pedidosDeCalls.at(-1)
      assert.ok(calls, `pedido de calls para ${filtro}`)
      assert.deepEqual([calls.p_start, calls.p_end], [de, ate], `janela das calls ${filtro}`)
      assert.deepEqual(Object.keys(calls).sort(), ['p_end', 'p_start'], 'o Executive e o vendedor veem as calls do time todo')
    }

    // Tempo personalizado: valida, aplica e vai para o endereço. Invertido no formulário, o próprio navegador barra o
    // envio (min/max dos campos, como no painel antigo) e nada é aplicado.
    await pagina.getByRole('radio', { name: 'Tempo personalizado', exact: true }).click()
    await pagina.getByLabel('Data inicial').fill('2026-09-10')
    await pagina.getByLabel('Data final').fill('2026-09-01')
    await pagina.getByRole('button', { name: 'Aplicar período', exact: true }).click()
    assert.equal(await pagina.getByLabel('Data final').evaluate((el) => el.validity.rangeUnderflow), true, 'o fim antes do início é barrado no campo')
    assert.equal(new URL(pagina.url()).searchParams.has('de'), false, 'intervalo inválido não é aplicado')
    await pagina.getByLabel('Data inicial').fill('2026-09-01')
    await pagina.getByLabel('Data final').fill('2026-09-15')
    await pagina.getByRole('button', { name: 'Aplicar período', exact: true }).click()
    await expect(pagina.getByText(/Período aplicado: 01\/09\/2026 a 15\/09\/2026/)).toBeVisible()
    const u = new URL(pagina.url())
    assert.deepEqual([u.searchParams.get('periodo'), u.searchParams.get('de'), u.searchParams.get('ate')], ['intervalo', '2026-09-01', '2026-09-15'])
    const e = esperado(f, 'custom')
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(e.total)))

    // Navegação DENTRO da visita (o botão voltar do navegador, por exemplo) respeita o filtro do endereço, e um intervalo
    // invertido não filtra em silêncio: a mensagem vermelha diz o que vale enquanto isso.
    const origem = new URL(pagina.url()).origin
    const irPara = (caminho) => pagina.evaluate((c) => { history.pushState({}, '', c); window.dispatchEvent(new PopStateEvent('popstate')) }, caminho)
    await irPara('/?periodo=intervalo&de=2026-09-10&ate=2026-09-01')
    await expect(pagina.getByRole('alert').filter({ hasText: 'A data inicial deve ser anterior ou igual à data final. Enquanto isso, valem os últimos 7 dias.' })).toBeVisible()
    const invertido = esperado(f, 'custom', { start: '2026-09-10', end: '2026-09-01' })
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(invertido.total)))
    assert.equal(invertido.total, esperado(f, '7dias').total, 'o que vale é o mesmo recorte dos últimos 7 dias')
    await irPara('/?periodo=intervalo&de=2026-09-01&ate=2026-09-15')
    await expect(pagina.getByText(/Período aplicado: 01\/09\/2026 a 15\/09\/2026/)).toBeVisible()

    // Limpar filtros volta ao padrão e apaga o endereço.
    await pagina.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    assert.equal(new URL(pagina.url()).search, '')
    // Uma carga NOVA da página (link salvo, colado ou F5) começa sempre nos 30 dias, mesmo com um filtro no endereço, e o
    // limpa; os outros parâmetros do endereço ficam.
    await pagina.goto(`${origem}/?periodo=ontem&outro=1`)
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    assert.equal(new URL(pagina.url()).searchParams.has('periodo'), false, 'o filtro velho do endereço foi limpo')
    assert.equal(new URL(pagina.url()).searchParams.get('outro'), '1', 'preserva os outros parâmetros do endereço')
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    assert.equal(new URL(pagina.url()).searchParams.get('periodo'), '7dias')
    assert.equal(new URL(pagina.url()).searchParams.get('outro'), '1', 'preserva os outros parâmetros do endereço')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('gráfico de abordagens e calls: teclado, mira, legenda com os totais, tabela e horas fechando com os totais', async () => {
  const { pagina, f, erros, fechar } = await abrir()
  try {
    const e = esperado(f, 'hoje')
    assert.ok(e.calls.length > 0 && e.abordagens.length > 0, 'o mock tem calls feitas e abordagens hoje')
    const soMarcadasHoje = f.tables.crm_activities.filter((c) => !c.is_completed && Date.parse(c.created_at) >= e.periodo.start.getTime())
    assert.ok(soMarcadasHoje.length > 0, 'o mock também tem calls só marcadas hoje, que não podem entrar na conta')
    assert.ok(e.calls.some((c) => !c.performed_at), 'concluídas sem presença registrada também contam (como em produção)')
    assert.ok(e.calls.some((c) => Date.parse(c.completed_at) < Date.parse(c.scheduled_at)), 'e há call fechada antes da hora marcada')
    const grafico = pagina.getByRole('img', { name: /Calls feitas e abordagens por hora, no horário de Brasília/ })
    await expect(grafico).toBeVisible()
    assert.match((await grafico.getAttribute('aria-label')) ?? '', /Use as setas para percorrer os pontos\. Último ponto \(\d{2}h\): \d+ calls? feitas? e \d+ abordage(m|ns)\./)
    const linhas = await linhasDaTabela(pagina)
    assert.ok(linhas.length >= 2)
    assert.equal(linhas.reduce((t, l) => t + Number(l[1]), 0), e.calls.length, 'a soma das calls por hora fecha com as calls feitas do dia (sem as só marcadas e as canceladas)')
    assert.equal(linhas.reduce((t, l) => t + Number(l[2]), 0), e.abordagens.length, 'e a das abordagens com o indicador')
    // A legenda traz os dois totais do período: os mesmos números da tabela e do indicador de abordagens.
    const legenda = normalizar(await regiao(pagina, GRAFICO).getByRole('list', { name: 'Legenda' }).innerText())
    assert.ok(legenda.includes(`Calls feitas ${inteiro(e.calls.length)}`), `legenda com o total de calls (veio "${legenda}")`)
    assert.ok(legenda.includes(`Abordagens ${inteiro(e.abordagens.length)}`), `legenda com o total de abordagens (veio "${legenda}")`)

    await grafico.focus()
    // A dica fica dentro do contêiner role="img", como na referência: para o ARIA os filhos de uma imagem são
    // apresentacionais (o leitor de tela lê o rótulo do gráfico), então ela é achada pelo atributo, não pelo papel.
    const dica = pagina.locator('[data-dashboard-section="commercial-evolution"] [role="tooltip"]')
    await expect(dica).toBeVisible()
    const ultima = linhas.at(-1)
    await expect(dica).toContainText(ultima[0])
    await expect(dica).toContainText(new RegExp(`${ultima[1]}\\s*calls? feitas?`))
    await expect(dica).toContainText(new RegExp(`${ultima[2]}\\s*abordage(m|ns)`))
    await pagina.keyboard.press('ArrowLeft')
    await expect(dica).toContainText(linhas.at(-2)[0])
    await pagina.keyboard.press('Home')
    await expect(dica).toContainText(linhas[0][0])
    await pagina.keyboard.press('ArrowLeft')
    await expect(dica).toContainText(linhas[0][0], { timeout: 2000 })
    await pagina.keyboard.press('End')
    await expect(dica).toContainText(ultima[0])
    await pagina.keyboard.press('ArrowRight')
    await expect(dica).toContainText(ultima[0])
    await pagina.keyboard.press('Enter') // sem página de destino, Enter não faz nada (e não quebra)
    await pagina.locator('body').click({ position: { x: 5, y: 5 } })
    await expect(dica).toHaveCount(0)

    // Mouse: a mira acompanha o ponteiro. O clique acima rolou a página para o topo, e o gráfico fica abaixo da
    // dobra: rolar até ele antes de medir, senão o ponteiro iria para fora da janela.
    await grafico.scrollIntoViewIfNeeded()
    const caixa = await grafico.boundingBox()
    await pagina.mouse.move(caixa.x + caixa.width * 0.5, caixa.y + caixa.height * 0.4)
    await expect(dica).toBeVisible()
    await pagina.mouse.move(5, 5)
    await expect(dica).toHaveCount(0)

    // Um dia só = série por hora; vários dias = um ponto por dia, também com tabela.
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    await expect(pagina.getByRole('img', { name: /Calls feitas e abordagens ao longo do período/ })).toBeVisible()
    const e7 = esperado(f, '7dias')
    const linhas7 = await linhasDaTabela(pagina)
    assert.equal(linhas7.length, 7, 'um ponto por dia')
    assert.equal(linhas7.reduce((t, l) => t + Number(l[1]), 0), e7.calls.length)
    assert.equal(linhas7.reduce((t, l) => t + Number(l[2]), 0), e7.abordagens.length)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('gráficos dos indicadores: as colunas são as horas do gráfico grande, somam os totais e têm dica e teclado', async () => {
  const { pagina, f, erros, fechar } = await abrir()
  try {
    const e = esperado(f, 'hoje')
    const colunas = (nome) => regiao(pagina, nome).locator('g[data-coluna]').evaluateAll((gs) => gs.map((g) => [g.getAttribute('data-rotulo'), Number(g.getAttribute('data-total'))]))
    const soma = (lista) => lista.reduce((t, [, v]) => t + v, 0)
    // Só compara depois da primeira carga (antes dela não há tabela nem colunas: as duas listas viriam vazias).
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(e.total)))
    await expect(pagina.getByRole('img', { name: /Calls feitas e abordagens por hora/ })).toBeVisible()
    const linhas = await linhasDaTabela(pagina)
    await expect.poll(async () => (await pontosDeVendas(pagina)).length).toBe(linhas.length)
    // Uma linha do tempo só: os pontos de vendas e as colunas de abordagens são as horas do gráfico grande.
    const vendasPorHora = new Map()
    for (const v of e.vendas) {
      const rotulo = `${tempo.chaveDaHora(v.created_at).slice(11)}h`
      vendasPorHora.set(rotulo, (vendasPorHora.get(rotulo) ?? 0) + 1)
    }
    const vendas = await pontosDeVendas(pagina)
    assert.deepEqual(vendas.map(([r, v]) => [r, v]), linhas.map((l) => [l[0], vendasPorHora.get(l[0]) ?? 0]), 'cada ponto de vendas é a mesma hora do gráfico grande, com as vendas dela')
    let corrida = 0
    assert.deepEqual(vendas.map(([, , ac]) => ac), vendas.map(([, v]) => (corrida += v)), 'o acumulado de cada hora é a soma até ela')
    assert.equal(vendas.at(-1)[2], e.quantidade, 'o acumulado termina no indicador de vendas')
    assert.deepEqual(await colunas('Abordagens'), linhas.map((l) => [l[0], Number(l[2])]), 'cada coluna de abordagens é a mesma hora (e o mesmo número) do gráfico grande')
    assert.equal(soma(await colunas('Abordagens')), e.abordagens.length, 'e as de abordagens, o indicador de abordagens')
    // O gráfico de vendas é de área (o modelo do gráfico de abordagens e calls), com o pico e o último ponto escritos.
    const qv = regiao(pagina, 'Quantidade de Vendas')
    await expect(qv.locator('svg path[data-area]')).toHaveCount(1)
    assert.equal(await qv.locator('rect.painel-coluna').count(), 0, 'sem colunas no gráfico de vendas')
    assert.equal(await qv.locator('svg text[data-rotulo-ponto="ultimo"]').textContent(), String(vendas.at(-1)[1]), 'o último ponto escrito')
    const pico = Math.max(...vendas.map(([, v]) => v))
    if (vendas.at(-1)[1] !== pico) assert.equal(await qv.locator('svg text[data-rotulo-ponto="pico"]').textContent(), String(pico), 'e o pico')
    await expect(regiao(pagina, 'Quantidade de Vendas').getByText('Vendas por hora', { exact: true })).toBeVisible()
    await expect(regiao(pagina, 'Quantidade de Vendas').getByText(/^média [\d,]+ por hora$/)).toBeVisible()
    await expect(regiao(pagina, 'Abordagens').getByText('Abordagens por hora', { exact: true })).toBeVisible()

    // Teclado e dica: o foco mostra o último intervalo; Home vai ao primeiro. A dica de vendas traz o acumulado.
    const grafVendas = regiao(pagina, 'Quantidade de Vendas').getByRole('img', { name: /^Vendas por hora: / })
    await grafVendas.focus()
    const dicaVendas = regiao(pagina, 'Quantidade de Vendas').locator('[role="tooltip"]')
    await expect(dicaVendas).toContainText(linhas.at(-1)[0])
    await expect(dicaVendas).toContainText(`${inteiro(e.quantidade)} ${e.quantidade === 1 ? 'venda' : 'vendas'} no acumulado`)
    await pagina.keyboard.press('Home')
    await expect(dicaVendas).toContainText(linhas[0][0])
    const grafAbordagens = regiao(pagina, 'Abordagens').getByRole('img', { name: /^Abordagens por hora: / })
    await grafAbordagens.focus()
    const dicaAbordagens = regiao(pagina, 'Abordagens').locator('[role="tooltip"]')
    await expect(dicaAbordagens).toContainText(linhas.at(-1)[0])
    const textoDaDica = normalizar(await dicaAbordagens.innerText())
    const partes = textoDaDica.match(/(\d+) mostraram a IA (\d+) não mostraram/)
    assert.ok(partes, `a dica reparte as abordagens (veio "${textoDaDica}")`)
    assert.equal(Number(partes[1]) + Number(partes[2]), (await colunas('Abordagens')).at(-1)[1], 'as duas partes somam a hora')
    await pagina.locator('body').click({ position: { x: 5, y: 5 } })
    await expect(dicaAbordagens).toHaveCount(0)

    // Vários dias: um intervalo por dia, ainda somando os indicadores.
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    await expect(regiao(pagina, 'Quantidade de Vendas').getByText('Vendas por dia', { exact: true })).toBeVisible()
    await expect.poll(async () => (await pontosDeVendas(pagina)).length).toBe(7)
    const e7 = esperado(f, '7dias')
    assert.equal((await pontosDeVendas(pagina)).at(-1)[2], e7.quantidade)
    assert.equal(soma(await colunas('Abordagens')), e7.abordagens.length)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('mira sincronizada: apontar uma hora num gráfico acende a mesma hora nos outros dois, com uma dica só', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const qv = regiao(pagina, 'Quantidade de Vendas')
    const grafVendas = qv.getByRole('img', { name: /^Vendas por hora: / })
    await expect(grafVendas).toBeVisible()
    await expect(pagina.getByRole('img', { name: /Calls feitas e abordagens por hora/ })).toBeVisible()
    const linhas = await linhasDaTabela(pagina)
    const dicas = pagina.locator('[role="tooltip"]')
    const miraGrande = pagina.locator('[data-dashboard-section="commercial-evolution"] [data-mira]')
    const miraVendas = qv.locator('[data-mira]')
    const colunasAcesas = () =>
      regiao(pagina, 'Abordagens').locator('g[data-coluna]').evaluateAll((gs) => gs.filter((g) => g.getAttribute('opacity') === '1').map((g) => g.getAttribute('data-coluna')))

    // Mouse no gráfico de vendas: a dica é dele; o gráfico grande ganha a mira na mesma hora, e a coluna da mesma hora
    // fica acesa no de abordagens (as outras apagam).
    await grafVendas.scrollIntoViewIfNeeded()
    const caixa = await grafVendas.boundingBox()
    await pagina.mouse.move(caixa.x + caixa.width * 0.6, caixa.y + caixa.height * 0.5)
    await expect(qv.locator('[role="tooltip"]')).toBeVisible()
    await expect(dicas).toHaveCount(1)
    await expect(miraGrande).toHaveCount(1)
    const chave = await miraGrande.getAttribute('data-chave')
    await expect(miraVendas).toHaveAttribute('data-chave', chave)
    assert.deepEqual(await colunasAcesas(), [chave], 'só a coluna da mesma hora fica acesa')
    const rotulo = normalizar(await qv.locator('[role="tooltip"] p').first().innerText())
    assert.ok(linhas.some((l) => l[0] === rotulo), `a hora da dica (${rotulo}) é uma hora do gráfico grande`)

    // Sair apaga a mira de todos.
    await pagina.mouse.move(5, 5)
    await expect(dicas).toHaveCount(0)
    await expect(miraGrande).toHaveCount(0)
    await expect(miraVendas).toHaveCount(0)
    assert.equal((await colunasAcesas()).length, linhas.length, 'todas as colunas voltam ao normal')

    // Teclado no gráfico grande: Home vai à primeira hora em todos; a dica continua só no gráfico com o foco.
    await pagina.getByRole('img', { name: /Calls feitas e abordagens por hora/ }).focus()
    await pagina.keyboard.press('Home')
    await expect(miraGrande).toHaveCount(1)
    const primeira = await miraGrande.getAttribute('data-chave')
    await expect(miraVendas).toHaveAttribute('data-chave', primeira)
    await expect(dicas).toHaveCount(1)
    await expect(pagina.locator('[data-dashboard-section="commercial-evolution"] [role="tooltip"]')).toContainText(linhas[0][0])
    await pagina.keyboard.press('ArrowRight')
    await expect(miraVendas).not.toHaveAttribute('data-chave', primeira)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('estado vazio: moldura sem valor inventado, em todos os blocos', async () => {
  const vazio = buildFixtures({ role: 'super_admin', now: FIXED })
  vazio.tables.vendas = []
  vazio.tables.abordagens = []
  vazio.tables.crm_activities = []
  vazio.tables.daily_goal_tasks = []
  vazio.rpc.get_team_ranking = () => []
  vazio.rpc.get_sdr_ranking = () => []
  vazio.rpc.arena_shift_approach_progress = () => []
  vazio.rpc.get_sales_board = () => ({ items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: FIXED.toISOString() })
  const { pagina, erros, fechar } = await abrir({ fixtures: vazio })
  try {
    await expect(pagina.getByText('Sem abordagens nem calls no período.')).toBeVisible()
    assert.equal(await pagina.getByRole('img', { name: /Calls feitas e abordagens/ }).count(), 0, 'sem pontos não há gráfico')
    await expect(regiao(pagina, GRAFICO).getByRole('list', { name: 'Legenda' })).toBeVisible()
    assert.ok((await textoDe(pagina, 'Quantidade de Vendas')).includes('+0 na última hora'))
    assert.ok(!(await textoDe(pagina, 'Quantidade de Vendas')).includes('última às'), 'sem venda não há "última às"')
    assert.equal(await regiao(pagina, 'Quantidade de Vendas').locator('svg').count(), 1, 'só o ícone: sem venda não há colunas, só a moldura')
    assert.ok((await textoDe(pagina, 'Conversão')).includes('—'))
    assert.ok((await textoDe(pagina, 'Conversão')).includes('0 vendas para 0 abordagens'))
    assert.equal(await pagina.getByRole('meter', { name: 'Vendas por abordagem' }).count(), 0, 'sem taxa não há anel')
    assert.ok((await textoDe(pagina, 'Total de Vendas')).includes('R$ 0,00'))
    assert.ok(!(await textoDe(pagina, 'Total de Vendas')).includes('na última hora'), 'sem venda não há receita da última hora')
    // Gráficos dos indicadores vazios: moldura sem nenhuma coluna e a legenda com 0 e 0.
    assert.deepEqual(await divisaoNaTela(pagina), { mostrou: 0, naoMostrou: 0 })
    assert.equal(await pagina.locator('rect.painel-coluna').count(), 0, 'nenhuma coluna inventada')
    for (const texto of ['Sem vendas no período.', 'Sem abordagens no período.']) await expect(pagina.getByText(texto, { exact: true })).toBeVisible()
    for (const texto of [
      'Nenhum produto vendido no período',
      'As vendas aprovadas e as abordagens aparecem aqui assim que acontecem.',
      'A primeira venda aprovada abre a competição.',
      'Nenhuma tarefa definida para hoje',
      'Nenhuma meta de turno para esta seleção.',
      'Nenhum Closer elegível no ranking.',
      'Nenhum SDR elegível no ranking.',
      'Nenhuma venda neste filtro',
    ]) await expect(pagina.getByText(texto, { exact: true }).first()).toBeVisible()
    // Os dois pódios vazios: os três degraus "em aberto" em cada um.
    for (const lugar of ['1º', '2º', '3º']) await expect(pagina.getByText(`${lugar} lugar em aberto`)).toHaveCount(2)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('pódios dos Closers e dos SDRs: 0, 1, 2, 3 e 6 posições, só o top 3, na ordem de leitura 1º, 2º, 3º', async () => {
  const closers = (n) =>
    Array.from({ length: n }, (_, i) => ({ user_id: `00000000-0000-4000-8000-0000000000${20 + i}`, name: `Closer ${i + 1}`, avatarUrl: null, totalVendas: 1000 - i * 100, quantidadeVendas: 10 - i, abordagens: 50, conversao: 10 }))
  // A ordem é a do servidor (repasses, depois conversão e abordagens): o pódio não reordena.
  const sdrs = (n) =>
    Array.from({ length: n }, (_, i) => ({ user_id: `00000000-0000-4000-8000-0000000000${40 + i}`, name: `SDR ${i + 1}`, avatarUrl: null, totalLeads: 90, leadsAbordados: 80, abordagens: 70 - i, repasses: 12 - i, vendasOriginadas: 3, receitaOriginada: 9000, conversao: 15 }))
  for (const n of [0, 1, 2, 3, 6]) {
    const f = buildFixtures({ role: 'super_admin', now: FIXED })
    f.rpc.get_team_ranking = () => closers(n)
    f.rpc.get_sdr_ranking = () => sdrs(n)
    const { pagina, erros, fechar } = await abrir({ fixtures: f })
    try {
      for (const nome of PODIOS) {
        const podio = regiao(pagina, nome).getByRole('list', { name: nome })
        await expect(podio).toBeVisible()
        await expect(regiao(pagina, nome)).toContainText(nome === PODIOS[0] ? 'Receita aprovada no mês' : 'Repasses para Closers · todo o período')
        const lugares = await podio.locator('li').evaluateAll((lis) => lis.map((li) => ({ lugar: li.dataset.lugar, ordemVisual: li.style.order })))
        assert.deepEqual(lugares.map((l) => l.lugar), ['1', '2', '3'], `${nome}: a ordem do DOM é 1º, 2º, 3º`)
        assert.deepEqual(lugares.map((l) => l.ordemVisual), ['2', '1', '3'], `${nome}: a ordem visual é 2º, 1º, 3º`)
        for (let lugar = 1; lugar <= 3; lugar++) {
          const aberto = await regiao(pagina, nome).getByText(`${lugar}º lugar em aberto`).count()
          assert.equal(aberto, lugar > n ? 1 : 0, `${nome}, n=${n}: ${lugar}º ${lugar > n ? 'em aberto' : 'preenchido'}`)
        }
        assert.equal(await regiao(pagina, nome).locator('ol[start="4"] li').count(), 0, `${nome}: compacto, só o top 3 (a lista completa fica em Ranking)`)
      }
      if (n > 0) {
        const closer = regiao(pagina, 'Pódio dos Closers').locator('li[data-lugar="1"]')
        await expect(closer).toContainText('Closer 1')
        await expect(closer).toContainText('R$ 1.000')
        await expect(closer).toContainText('10 vendas')
        // SDRs: o número grande é o critério do ranking (repasses), com as abordagens embaixo.
        const sdr = regiao(pagina, 'Pódio dos SDRs').locator('li[data-lugar="1"]')
        await expect(sdr).toContainText('SDR 1')
        await expect(sdr).toContainText('12 repasses')
        await expect(sdr).toContainText('70 abordagens')
      }
      if (n >= 3) await expect(regiao(pagina, 'Pódio dos SDRs').locator('li[data-lugar="3"]')).toContainText('SDR 3')
      assert.deepEqual(erros, [])
    } finally {
      await fechar()
    }
  }
})

await teste('ao vivo: um evento novo muda KPI, gráfico, feed e tabela juntos, sem recarregar', async () => {
  const { pagina, mock, f, erros, fechar } = await abrir()
  try {
    // O evento só pode nascer depois da primeira pintura (senão ele já viria na carga inicial, sem realce) e com o
    // canal ao vivo inscrito.
    const antes = esperado(f, 'hoje')
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(antes.total)))
    await expect(pagina.getByRole('status').filter({ hasText: 'Ao vivo' })).toBeVisible({ timeout: 12_000 })
    await expect(pagina.getByRole('list', { name: 'Atividade ao vivo' })).toBeVisible()
    await pagina.evaluate(() => {
      window.__marcador = 'mesma-pagina'
      // Registra cada item do feed que aparece com o realce (a lavagem dura 2,6 s; conferir depois seria uma corrida).
      window.__realcados = new Set()
      new MutationObserver(() => {
        for (const li of document.querySelectorAll('ol[aria-label="Atividade ao vivo"] li.painel-linha-nova')) window.__realcados.add(li.textContent)
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    })
    const iso = new Date(FIXED.getTime() - 60_000).toISOString()
    const usuario = f.closers[0].id
    f.tables.vendas.push({
      id: '00000000-0000-4000-8000-0000000fffff', user_id: usuario, nome_produto: 'Venda ao vivo QA', valor_venda: 1234.56, approval_status: 'aprovada',
      created_at: iso, updated_at: iso, reviewed_at: iso, nome_comprador: 'QA', email_comprador: 'qa@example.test', whatsapp_comprador: '11900000000',
      commission_amount: 123.45, withdrawn: false, withdrawal_id: null, consideracoes_gerais: null,
    })
    f.tables.abordagens.push({ id: '00000000-0000-4000-8000-0000000eeeee', user_id: usuario, created_at: iso })
    // E uma call feita agora (o CRM registra a presença): entra no gráfico de abordagens e calls na mesma atualização.
    f.tables.crm_activities.push({
      id: '00000000-0000-4000-8000-0000000ddddd', lead_id: f.tables.crm_leads[0].id, user_id: f.sdrs[0].id, assigned_to: usuario, activity_type: 'call',
      call_type: 'fechamento_closer', title: 'Call ao vivo QA', description: null, author_name: null, scheduled_at: iso, created_at: iso, updated_at: iso,
      is_completed: true, completed_at: iso, outcome: 'venda_perdida', performed_at: iso, performed_by: usuario, cancelled_at: null, cancelled_by: null,
      cancellation_reason: null, is_pinned: false, previous_state: null, new_state: null,
    })
    assert.ok(mock.bumpRevision('sales') > 0, 'o canal Realtime estava inscrito')
    const depois = esperado(f, 'hoje')
    assert.equal(depois.quantidade, antes.quantidade + 1)
    assert.equal(depois.calls.length, antes.calls.length + 1)
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(depois.total)), { timeout: 12_000 })
    // Tudo no mesmo instante: indicador, abordagens (e a barra dividida), feed, gráfico e tabela.
    assert.ok((await textoDe(pagina, 'Quantidade de Vendas')).includes(inteiro(depois.quantidade)))
    assert.ok((await textoDe(pagina, 'Abordagens')).includes(inteiro(depois.abordagens.length)))
    assert.deepEqual(await divisaoNaTela(pagina), { mostrou: depois.mostrou, naoMostrou: depois.naoMostrou })
    assert.equal(depois.naoMostrou, antes.naoMostrou + 1, 'a abordagem nova (sem demonstração) entrou no grupo certo')
    const feed = pagina.getByRole('list', { name: 'Atividade ao vivo' })
    await expect(feed.locator('li').first()).toContainText('Venda ao vivo QA')
    const realcados = await pagina.evaluate(() => [...window.__realcados])
    assert.ok(realcados.some((t) => t.includes('Venda ao vivo QA')), `o que chega ao vivo ganha o realce (vieram: ${realcados.join(' | ')})`)
    assert.ok(realcados.every((t) => t.includes('Venda ao vivo QA') || t.includes('Abordagem registrada')), 'só os itens novos ganham o realce')
    await expect(feed.locator('li.painel-linha-nova')).toHaveCount(0, { timeout: 6000 })
    const linhas = await linhasDaTabela(pagina)
    assert.equal(linhas.reduce((t, l) => t + Number(l[1]), 0), depois.calls.length, 'a call nova já está no gráfico')
    assert.equal(linhas.reduce((t, l) => t + Number(l[2]), 0), depois.abordagens.length)
    // Os gráficos dos indicadores mudam junto.
    const somaDasColunas = (nome) => regiao(pagina, nome).locator('g[data-coluna]').evaluateAll((gs) => gs.reduce((t, g) => t + Number(g.getAttribute('data-total')), 0))
    assert.equal((await pontosDeVendas(pagina)).reduce((t, [, v]) => t + v, 0), depois.quantidade)
    assert.equal(await somaDasColunas('Abordagens'), depois.abordagens.length)
    assert.equal(await pagina.evaluate(() => window.__marcador), 'mesma-pagina', 'sem recarregar a página')
    await expect(pagina.getByText(/^atualizado (agora|há)/)).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('primeira pintura do feed não pisca e a carga inicial mostra o carregando do painel', async () => {
  const { pagina, erros, fechar } = await abrir({ latencia: 600, periodo: null })
  try {
    await expect(pagina.getByRole('status').filter({ hasText: 'Carregando os indicadores…' })).toBeAttached()
    await expect(regiao(pagina, 'Total de Vendas')).toBeVisible({ timeout: 20_000 })
    await expect(pagina.getByRole('list', { name: 'Atividade ao vivo' }).locator('li').first()).toBeVisible()
    assert.equal(await pagina.locator('li.painel-linha-nova').count(), 0, 'nada do que já estava na tela ganha o realce')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('falha de rede: os dados anteriores ficam na tela e o erro aparece na barra superior', async () => {
  const { pagina, contexto, erros, fechar } = await abrir()
  try {
    const antes = await textoDe(pagina, 'Total de Vendas')
    let falhar = false
    await contexto.route(/benchmock\.supabase\.co\/rest\/v1\/rpc\/dashboard_home_sales/, (route) => (falhar ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falha simulada' }) }) : route.fallback()))
    falhar = true
    await pagina.evaluate(() => window.dispatchEvent(new Event('dashboard-data-changed')))
    const aviso = pagina.getByRole('alert').filter({ hasText: 'Falha ao atualizar' })
    await expect(aviso).toBeVisible({ timeout: 12_000 })
    assert.equal(await textoDe(pagina, 'Total de Vendas'), antes, 'os números anteriores continuam')
    assert.equal(await pagina.getByRole('heading', { level: 1 }).count(), 1, 'a tela não esvaziou')
    falhar = false
    await pagina.evaluate(() => window.dispatchEvent(new Event('dashboard-data-changed')))
    await expect(aviso).toHaveCount(0, { timeout: 12_000 })
    assert.ok(erros.every((e) => /500|falha simulada|Erro ao buscar dados/.test(e)), `só o erro simulado é esperado: ${erros.join(' / ')}`)
  } finally {
    await fechar()
  }
})

await teste('selo "Ao vivo" só aparece com o canal inscrito', async () => {
  const comCanal = await abrir()
  try {
    await expect(comCanal.pagina.getByRole('status').filter({ hasText: 'Ao vivo' })).toBeVisible({ timeout: 12_000 })
  } finally {
    await comCanal.fechar()
  }
  const semCanal = await abrir({ ws: 'closed' })
  try {
    await sleep(4500)
    const selo = semCanal.pagina.getByRole('status').filter({ hasText: /Ao vivo|Conectando…|Offline — reconectando/ })
    const texto = normalizar(await selo.first().innerText())
    assert.ok(/Conectando…|Offline — reconectando/.test(texto) && !/^Ao vivo$/.test(texto), `sem canal o selo diz a verdade (veio "${texto}")`)
  } finally {
    await semCanal.fechar()
  }
})

await teste('tema: Claro, Escuro e Sistema pelo menu da conta, com os tokens de cada tema', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const bg = () => pagina.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())
    assert.equal(await bg(), '260 45.45% 6.47%')
    await pagina.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click()
    await pagina.getByRole('menuitemradio', { name: 'Claro' }).click()
    await expect.poll(() => pagina.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
    assert.equal(await bg(), '260 37.5% 96.86%')
    assert.equal(await pagina.evaluate(() => localStorage.getItem('theme')), 'light')
    const corDoCorpo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor)
    assert.equal(corDoCorpo, 'rgb(246, 244, 250)', 'fundo claro do painel')
    await pagina.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click()
    await pagina.getByRole('menuitemradio', { name: 'Escuro' }).click()
    await expect.poll(() => pagina.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    assert.equal(await bg(), '260 45.45% 6.47%')
    await pagina.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click()
    await pagina.getByRole('menuitemradio', { name: 'Sistema' }).click()
    assert.equal(await pagina.evaluate(() => localStorage.getItem('theme')), 'system')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('responsivo: sem rolagem horizontal em 390, 820, 1280, 1440 e 1920; menu vira gaveta no celular', async () => {
  for (const [largura, altura] of [[390, 844], [820, 1180], [1280, 800], [1440, 900], [1920, 1080]]) {
    for (const tema of ['dark', 'light']) {
      const { pagina, erros, fechar } = await abrir({ largura, altura, tema })
      try {
        await expect(regiao(pagina, 'Total de Vendas')).toBeVisible()
        await sleep(700)
        const estouro = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        assert.ok(estouro <= 0, `${largura}px ${tema}: rolagem horizontal de ${estouro}px`)
        // Nada dentro de um cartão vaza para fora dele.
        const vazando = await pagina.evaluate(() =>
          // Os agrupadores com display: contents não têm caixa própria (os cartões ficam direto na grade).
          [...document.querySelectorAll('main section')].filter((s) => getComputedStyle(s).display !== 'contents').flatMap((s) => {
            const r = s.getBoundingClientRect()
            return [...s.querySelectorAll('*')].filter((el) => {
              const c = el.getBoundingClientRect()
              return c.width > 0 && (c.right > r.right + 1 || c.left < r.left - 1) && !el.closest('[role="img"], svg, details, [role="tooltip"], .sr-only')
            }).slice(0, 2).map((el) => `${s.getAttribute('aria-label') ?? s.className.slice(0, 30)} › ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
          }),
        )
        assert.deepEqual(vazando, [], `${largura}px ${tema}: conteúdo vazando do cartão`)
        if (largura < 768) {
          assert.equal(await pagina.locator('[data-sidebar="menu-button"]:visible').count(), 0, 'menu fechado no celular')
          await pagina.getByRole('button', { name: 'Mostrar ou ocultar o menu' }).click()
          const gaveta = pagina.getByRole('dialog')
          await expect(gaveta).toBeVisible()
          await expect(gaveta.getByText('Arena Comercial')).toBeVisible()
          await pagina.keyboard.press('Escape')
          await expect(gaveta).toHaveCount(0)
        } else {
          await expect(pagina.locator('[data-sidebar="menu-button"]', { hasText: 'Arena Comercial' }).first()).toBeVisible()
        }
        assert.deepEqual(erros, [])
      } finally {
        await fechar()
      }
    }
  }
})

await teste('menu recolhe com Ctrl+B e a página segue dentro dos limites', async () => {
  const { pagina, fechar } = await abrir()
  try {
    const largura = () => pagina.locator('[data-sidebar="sidebar"]').first().evaluate((el) => el.getBoundingClientRect().width)
    assert.ok((await largura()) >= 250, 'menu aberto (16 rem)')
    await pagina.keyboard.press('Control+b')
    await expect.poll(largura).toBeLessThan(80)
    await pagina.keyboard.press('Control+b')
    await expect.poll(largura).toBeGreaterThan(250)
  } finally {
    await fechar()
  }
})

await teste('acessibilidade: papéis, rótulos, anéis, tempos e foco visível', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const grupo = pagina.getByRole('radiogroup', { name: 'Período' })
    await expect(grupo).toBeVisible()
    assert.equal(await grupo.getByRole('radio').count(), 7)
    assert.equal(await grupo.locator('[aria-checked="true"]').count(), 1)
    const medidores = pagina.getByRole('meter')
    await expect(pagina.getByRole('meter', { name: 'Vendas por abordagem' })).toBeVisible()
    assert.ok((await medidores.count()) >= 2, 'anéis são role=meter')
    for (const m of await medidores.all()) {
      assert.ok((await m.getAttribute('aria-label'))?.length > 3, 'anel com rótulo')
      assert.match((await m.getAttribute('aria-valuenow')) ?? '', /^\d+$/)
      assert.equal(await m.getAttribute('aria-valuemax'), '100')
    }
    const tempos = await pagina.getByRole('list', { name: 'Atividade ao vivo' }).locator('time').evaluateAll((ts) => ts.map((t) => [t.getAttribute('datetime'), t.getAttribute('title')]))
    assert.ok(tempos.length >= 5 && tempos.every(([iso, titulo]) => /^\d{4}-\d{2}-\d{2}T/.test(iso) && /^\d{2}:\d{2}:\d{2}$/.test(titulo)), '<time dateTime title> nas horas do feed')
    await expect(pagina.getByRole('list', { name: 'Últimas dez vendas aprovadas' })).toBeVisible()
    assert.ok(await pagina.getByRole('figure').count() >= 2, 'gráficos são <figure>')
    assert.equal(await pagina.locator('svg[aria-hidden="true"]').count() > 0, true)
    // Foco visível: Tab até um botão de filtro e conferir o anel.
    let achou = false
    for (let i = 0; i < 40 && !achou; i++) {
      await pagina.keyboard.press('Tab')
      achou = await pagina.evaluate(() => document.activeElement?.getAttribute('role') === 'radio')
    }
    assert.ok(achou, 'o teclado alcança os filtros')
    const anel = await pagina.evaluate(() => {
      const el = document.activeElement
      return { visivel: el.matches(':focus-visible'), sombra: getComputedStyle(el).boxShadow }
    })
    assert.equal(anel.visivel, true)
    assert.notEqual(anel.sombra, 'none', 'o foco do controle segmentado é visível (anel)')
    // Tudo o que é interativo é alcançável (nenhum tabindex negativo escondendo controle).
    const negativos = await pagina.evaluate(() => [...document.querySelectorAll('main [tabindex="-1"]')].filter((e) => e.matches('button,a,input,[role="radio"]')).length)
    assert.equal(negativos, 0)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('movimento: com preferência de menos movimento os números aparecem exatos; sem ela, contam até o exato', async () => {
  const reduzido = await abrir({ movimento: 'reduce', periodo: null })
  try {
    const f = reduzido.f
    const e = esperado(f, '30dias')
    assert.ok((await textoDe(reduzido.pagina, 'Quantidade de Vendas')).includes(inteiro(e.quantidade)))
    assert.equal(await reduzido.pagina.evaluate(() => getComputedStyle(document.querySelector('.painel-numero-subiu')).animationName), 'none', 'sem animação com prefers-reduced-motion')
  } finally {
    await reduzido.fechar()
  }
  const animado = await abrir({ movimento: 'no-preference', periodo: null })
  try {
    const e = esperado(animado.f, '30dias')
    await expect(regiao(animado.pagina, 'Quantidade de Vendas')).toContainText(inteiro(e.quantidade), { timeout: 5000 })
    await expect(regiao(animado.pagina, 'Total de Vendas')).toContainText(normalizar(money(e.total)), { timeout: 5000 })
    assert.notEqual(await animado.pagina.evaluate(() => getComputedStyle(document.querySelector('.painel-numero-subiu')).animationName), 'none', 'com movimento o número "sobe"')
    assert.deepEqual(animado.erros, [])
  } finally {
    await animado.fechar()
  }
})

await teste('vendas do time: abas, paginação e janela própria; últimas vendas somem do filtro de período', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const bloco = pagina.locator('[data-dashboard-section="transparent-operation"]')
    await expect(bloco.getByRole('radio', { name: 'Aprovado', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(bloco.getByText(/40 resultados/)).toBeVisible()
    assert.equal(await bloco.locator('ol > li').count(), 5, '5 por página')
    await bloco.getByRole('button', { name: 'Próxima página' }).click()
    await expect(bloco.getByText('2 / 8')).toBeVisible()
    await bloco.getByRole('radio', { name: 'Pendente', exact: true }).click()
    await expect(bloco.getByText('1 /')).toBeVisible()
    const ultimas = pagina.locator('[data-dashboard-section="recent-sales"] ol > li')
    assert.equal(await ultimas.count(), 10, 'as 10 aprovações mais recentes')
    const antes = await ultimas.allInnerTexts()
    await pagina.getByRole('radio', { name: '30 dias', exact: true }).click()
    await sleep(1200)
    assert.deepEqual(await ultimas.allInnerTexts(), antes, 'o período não recorta as últimas vendas (janela própria, dita na tela)')
    await expect(pagina.getByText(/Ranking, metas e vendas do time têm janela própria/)).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('checklist: marcar uma tarefa chama a mesma RPC e as metas avançam juntas', async () => {
  const f = buildFixtures({ role: 'super_admin', now: FIXED })
  const chamadas = []
  f.rpc.set_daily_goal_task_completed = (args) => {
    chamadas.push(args)
    const t = f.tables.daily_goal_tasks.find((x) => x.id === args.p_task_id)
    Object.assign(t, { is_completed: args.p_completed, completed_at: args.p_completed ? FIXED.toISOString() : null, version: t.version + 1 })
    return t
  }
  const { pagina, erros, fechar } = await abrir({ fixtures: f })
  try {
    const kpi = regiao(pagina, 'Meta do dia')
    await expect(kpi).toContainText('de 5')
    assert.ok((await textoDe(pagina, 'Meta do dia')).includes('40% das tarefas de hoje'))
    await pagina.getByRole('checkbox', { name: 'Concluir Tarefa do dia 3', exact: true }).click()
    await expect.poll(() => chamadas.length).toBe(1)
    assert.equal(chamadas[0].p_completed, true)
    assert.equal(chamadas[0].p_expected_version, 1, 'a versão da tarefa segue junto (controle de concorrência)')
    await expect(kpi).toContainText('60% das tarefas de hoje', { timeout: 10_000 })
    await expect(pagina.getByText('3/5 concluídas')).toBeVisible()
    await pagina.getByRole('checkbox', { name: 'Concluir Tarefa do dia 4', exact: true }).click()
    await pagina.getByRole('checkbox', { name: 'Concluir Tarefa do dia 5', exact: true }).click()
    await expect(pagina.getByText('Todas as metas do dia foram concluídas.', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(pagina.getByRole('checkbox', { name: 'Reabrir Tarefa do dia 1', exact: true })).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('papel de vendedor: o time todo, igual ao Executive, e menu sem itens de administração', async () => {
  const f = buildFixtures({ role: 'seller', now: FIXED })
  const { pagina, pedidosDeVendas, pedidosDeCalls, erros, fechar } = await abrir({ fixtures: f })
  try {
    // Sem filtro de usuário: a consulta é a mesma de quem é Executive (as tabelas só entregariam as linhas dele).
    await expect.poll(() => pedidosDeVendas.length).toBeGreaterThan(0)
    assert.ok(pedidosDeVendas.every((a) => !('user_id' in a) && !('p_user' in a)), 'o pedido do vendedor não filtra por usuário')
    await expect.poll(() => pedidosDeCalls.length).toBeGreaterThan(0)
    assert.ok(pedidosDeCalls.every((a) => !('assigned_to' in a)), 'as calls são as do time todo')
    const time = esperado(f, 'hoje')
    const proprias = time.calls.filter((c) => c.assigned_to === USER_ID)
    assert.ok(proprias.length > 0 && proprias.length < time.calls.length, 'o mock tem calls do time além das da própria pessoa')
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(time.total)))
    assert.ok((await textoDe(pagina, 'Quantidade de Vendas')).includes(inteiro(time.quantidade)), 'a quantidade é a do time')
    assert.ok((await textoDe(pagina, 'Abordagens')).includes(inteiro(time.abordagens.length)), 'as abordagens são as do time')
    const legenda = normalizar(await regiao(pagina, GRAFICO).getByRole('list', { name: 'Legenda' }).innerText())
    assert.ok(legenda.includes(`Calls feitas ${inteiro(time.calls.length)}`), `o gráfico conta as calls do time (veio "${legenda}")`)
    const itens = (await pagina.locator('[data-sidebar="content"] [data-sidebar="menu-button"]').allInnerTexts()).map((t) => t.trim())
    assert.ok(!itens.includes('Executive') && !itens.includes('Assinaturas'), `vendedor não vê Executive nem Assinaturas (veio ${itens.join(', ')})`)
    await expect(pagina.getByText('visão consolidada do time')).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('carga inicial com falha: nada de zeros que parecem dados, mensagem e "Tentar de novo"', async () => {
  const { pagina, contexto, erros, fechar } = await abrir()
  try {
    // Esta página abriu normalmente; a falha é simulada numa segunda aba do mesmo contexto, desde o primeiro pedido.
    let falhar = true
    await contexto.route(/benchmock\.supabase\.co\/rest\/v1\/rpc\/dashboard_home_(sales|approaches)/, (route) =>
      falhar ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falha simulada' }) }) : route.fallback(),
    )
    const outra = await contexto.newPage()
    await outra.clock.setFixedTime(FIXED)
    const errosDaOutra = []
    outra.on('pageerror', (e) => errosDaOutra.push(String(e.message)))
    await outra.goto(new URL(pagina.url()).origin + '/')
    const aviso = outra.getByRole('alert').filter({ hasText: 'Não foi possível carregar os indicadores' })
    await expect(aviso).toBeVisible({ timeout: 20_000 })
    assert.equal(await outra.getByRole('region', { name: 'Total de Vendas', exact: true }).isVisible(), false, 'nenhum indicador com zero inventado')
    falhar = false
    await aviso.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(outra.getByRole('region', { name: 'Total de Vendas', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(aviso).toHaveCount(0)
    assert.deepEqual(errosDaOutra, [])
    assert.deepEqual(erros.filter((e) => !/500|falha simulada|Erro ao buscar dados/.test(e)), [])
  } finally {
    await fechar()
  }
})

await teste('atalhos do painel antigo no canto dos blocos e a conta no rodapé do menu', async () => {
  const { pagina, erros, fechar } = await abrir()
  try {
    const feed = regiao(pagina, 'Ao vivo')
    await feed.getByRole('button', { name: 'Nova abordagem' }).click()
    await expect(pagina).toHaveURL(/\/abordagens\?new=true$/)
    await pagina.goBack()
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    // A tela de vendas não sobe com este backend falso (já era assim antes desta mudança: as fixtures não trazem
    // products.product_tickets, que RegistrarVenda lê), então os erros dela não contam; aqui só importa que o atalho
    // leva para ela. O erro chega assíncrono e abre o AppErrorBoundary global (a mesma janela da Home): espera por
    // ele (ou 5 s, se um dia o mock cobrir a tela) e recarrega a Home, como a pessoa faria, em vez de voltar no histórico.
    const errosAntesDeSair = erros.length
    const erroDaTelaDeVendas = pagina.waitForEvent('pageerror', { timeout: 5000 }).catch(() => null)
    await regiao(pagina, 'Últimas vendas').getByRole('button', { name: 'Registrar venda' }).click()
    await expect(pagina).toHaveURL(/\/vendas\?new=true$/)
    await erroDaTelaDeVendas
    await pagina.goto(new URL(pagina.url()).origin + '/')
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    erros.splice(errosAntesDeSair)
    for (const bloco of [...PODIOS, 'Últimas vendas']) await expect(regiao(pagina, bloco).getByRole('link', { name: 'Ranking' })).toHaveAttribute('href', '/ranking')
    // A conta saiu da barra superior (ficava duplicada) e mora no rodapé do menu: Perfil, Configurações e Sair.
    assert.equal(await pagina.locator('header').getByText('BE', { exact: true }).count(), 0, 'sem o avatar da conta repetido na barra')
    await pagina.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').click()
    for (const item of ['Perfil', 'Configurações', 'Sair']) await expect(pagina.getByRole('menuitem', { name: item })).toBeVisible()
    await pagina.keyboard.press('Escape')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

// ---------------------------------------------------------------------------------------------------------------
await navegador.close()
server.close()
fs.writeFileSync(path.join(SAIDA, '_resultado.json'), JSON.stringify(resultados, null, 2))
const falhas = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações de interface passaram.`)
if (falhas.length) {
  console.log(falhas.map((r) => `- ${r.nome}: ${r.erro}`).join('\n'))
  process.exit(1)
}
