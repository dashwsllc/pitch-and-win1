// Verificação de interface da Home (Visão geral) num navegador real, com backend FALSO (nada toca em produção).
// O build tem de ser o de benchmark (VITE_SUPABASE_URL=https://benchmock.supabase.co), como em scripts/perf/README.md:
//   VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
//     npx vite build --outDir .verification.local/perf/dist-depois --emptyOutDir
//   node scripts/verify-painel-ui.mjs --dist .verification.local/perf/dist-depois
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY } from './perf/mock.mjs'
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
  return { periodo, vendas, abordagens, total, quantidade, ticket: quantidade > 0 ? total / quantidade : 0, conversao, mostrou, naoMostrou: abordagens.length - mostrou }
}
const normalizar = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const inteiro = (n) => n.toLocaleString('pt-BR')
const percentual = (c) => `${Number(c.toFixed(1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

const { server, url } = await startServer(path.resolve(argv.dist))
const navegador = await chromium.launch({ headless: true })

async function abrir({ tema = 'dark', largura = 1440, altura = 900, movimento = 'reduce', fixtures, ws = 'normal', caminho = '/', comSessao = true, latencia = 15, esperarTitulo = true } = {}) {
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
  contexto.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname.endsWith('/rest/v1/vendas') && (u.searchParams.get('select') ?? '').includes('valor_venda')) pedidosDeVendas.push(u)
  })
  await contexto.addInitScript(
    ({ chave, sessao, tema, comSessao }) => {
      try {
        if (comSessao) sessionStorage.setItem(chave, JSON.stringify(sessao))
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
  return { contexto, pagina, mock, f, erros, pedidosDeVendas, fechar: () => contexto.close() }
}

const regiao = (pagina, nome) => pagina.getByRole('region', { name: nome, exact: true })
const textoDe = async (pagina, nome) => normalizar(await regiao(pagina, nome).innerText())
const KPIS = ['Quantidade de Vendas', 'Abordagens', 'Conversão', 'Meta do dia', 'Total de Vendas', 'Ticket Médio', 'Posição no ranking']
/** Legenda da barra dividida das abordagens: os dois totais escritos ao lado dos pontos coloridos. */
async function divisaoNaTela(pagina) {
  const texto = await textoDe(pagina, 'Abordagens')
  const m = texto.match(/Mostrou a IA ([\d.]+) Não mostrou ([\d.]+)/)
  assert.ok(m, `legenda da barra dividida (veio "${texto}")`)
  return { mostrou: Number(m[1].replaceAll('.', '')), naoMostrou: Number(m[2].replaceAll('.', '')) }
}
const linhasDaTabela = (pagina) =>
  pagina.locator('[data-dashboard-section="commercial-evolution"] details tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())))

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
    for (const nome of KPIS) await expect(regiao(pagina, nome)).toBeVisible()
    // A grade da referência a 1440 px: KPIs 5 · 3 · 2 · 2, a linha extra 6 · 3 · 3, metas 6 · 6, série 8 + pódio 4,
    // trio 4 · 4 · 4 e a lista larga 12.
    const span = (loc) => loc.evaluate((el) => getComputedStyle(el).gridColumnStart)
    assert.deepEqual(await Promise.all(KPIS.map((n) => span(regiao(pagina, n)))), ['span 5', 'span 3', 'span 2', 'span 2', 'span 6', 'span 3', 'span 3'])
    const blocos = ['Checklist de hoje', 'Metas de abordagens por turno', 'Evolução comercial', 'Pódio dos Closers', 'Produtos em destaque', 'Vendas do time', 'Ao vivo', 'Últimas vendas']
    assert.deepEqual(await Promise.all(blocos.map((n) => span(regiao(pagina, n)))), ['span 6', 'span 6', 'span 8', 'span 4', 'span 4', 'span 4', 'span 4', 'span 12'])
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
  const { pagina, f, erros, pedidosDeVendas, fechar } = await abrir()
  try {
    const nomes = { hoje: 'Hoje', ontem: 'Ontem', '7dias': '7 dias', '14dias': '14 dias', '30dias': '30 dias', all: 'Todo o período' }
    const enderecos = { hoje: null, ontem: 'ontem', '7dias': '7dias', '14dias': '14dias', '30dias': '30dias', all: 'tudo' }
    for (const [filtro, rotulo] of Object.entries(nomes)) {
      const e = esperado(f, filtro)
      pedidosDeVendas.length = 0
      if (filtro !== 'hoje') await pagina.getByRole('radio', { name: rotulo, exact: true }).click()
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
      // Mesma fonte, mesma consulta: a janela pedida ao banco é a do período.
      const janela = pedidosDeVendas.at(-1)
      if (e.periodo.allTime) assert.equal(janela?.searchParams.has('created_at'), false, 'todo o período não filtra por data')
      else {
        assert.ok(janela, `pedido de vendas para ${filtro}`)
        assert.deepEqual(janela.searchParams.getAll('created_at'), [`gte.${e.periodo.start.toISOString()}`, `lt.${e.periodo.end.toISOString()}`], `janela do filtro ${filtro}`)
      }
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

    // Um link com intervalo invertido não filtra em silêncio: a mensagem vermelha diz o que vale enquanto isso.
    const origem = new URL(pagina.url()).origin
    await pagina.goto(`${origem}/?periodo=intervalo&de=2026-09-10&ate=2026-09-01`)
    await expect(pagina.getByRole('alert').filter({ hasText: 'A data inicial deve ser anterior ou igual à data final. Enquanto isso, valem os últimos 7 dias.' })).toBeVisible()
    const invertido = esperado(f, 'custom', { start: '2026-09-10', end: '2026-09-01' })
    await expect(regiao(pagina, 'Total de Vendas')).toContainText(normalizar(money(invertido.total)))
    assert.equal(invertido.total, esperado(f, '7dias').total, 'o que vale é o mesmo recorte dos últimos 7 dias')
    await pagina.goto(`${origem}/?periodo=intervalo&de=2026-09-01&ate=2026-09-15`)
    await expect(pagina.getByText(/Período aplicado: 01\/09\/2026 a 15\/09\/2026/)).toBeVisible()

    // Limpar filtros volta ao padrão e apaga o endereço; link compartilhado abre com o filtro.
    await pagina.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(pagina.getByRole('radio', { name: 'Hoje', exact: true })).toHaveAttribute('aria-checked', 'true')
    assert.equal(new URL(pagina.url()).search, '')
    await pagina.goto(`${new URL(pagina.url()).origin}/?periodo=ontem&outro=1`)
    await expect(pagina.getByRole('radio', { name: 'Ontem', exact: true })).toHaveAttribute('aria-checked', 'true')
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    assert.equal(new URL(pagina.url()).searchParams.get('outro'), '1', 'preserva os outros parâmetros do endereço')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('gráfico: teclado, mira, tabela alternativa e série por hora fechando com os totais', async () => {
  const { pagina, f, erros, fechar } = await abrir()
  try {
    const e = esperado(f, 'hoje')
    const grafico = pagina.getByRole('img', { name: /Vendas e abordagens por hora, no horário de Brasília/ })
    await expect(grafico).toBeVisible()
    assert.match((await grafico.getAttribute('aria-label')) ?? '', /Use as setas para percorrer os pontos\. Último ponto \(\d{2}h\): \d+ vendas e \d+ abordagens\./)
    const linhas = await linhasDaTabela(pagina)
    assert.ok(linhas.length >= 2)
    assert.equal(linhas.reduce((t, l) => t + Number(l[1]), 0), e.quantidade, 'a soma das vendas por hora fecha com o indicador')
    assert.equal(linhas.reduce((t, l) => t + Number(l[2]), 0), e.abordagens.length, 'e a das abordagens com o total')

    await grafico.focus()
    // A dica fica dentro do contêiner role="img", como na referência: para o ARIA os filhos de uma imagem são
    // apresentacionais (o leitor de tela lê o rótulo do gráfico), então ela é achada pelo atributo, não pelo papel.
    const dica = pagina.locator('[data-dashboard-section="commercial-evolution"] [role="tooltip"]')
    await expect(dica).toBeVisible()
    const ultima = linhas.at(-1)
    await expect(dica).toContainText(ultima[0])
    await expect(dica).toContainText(new RegExp(`${ultima[1]}\\s*vendas`))
    await expect(dica).toContainText(new RegExp(`${ultima[2]}\\s*abordagens`))
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

    // Um dia só = série por hora; vários dias = a série diária da hook, também com tabela.
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    await expect(pagina.getByRole('img', { name: /Vendas e abordagens ao longo do período/ })).toBeVisible()
    const e7 = esperado(f, '7dias')
    const linhas7 = await linhasDaTabela(pagina)
    assert.equal(linhas7.length, 7, 'um ponto por dia')
    assert.equal(linhas7.reduce((t, l) => t + Number(l[1]), 0), e7.quantidade)
    assert.equal(linhas7.reduce((t, l) => t + Number(l[2]), 0), e7.abordagens.length)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('estado vazio: moldura sem valor inventado, em todos os blocos', async () => {
  const vazio = buildFixtures({ role: 'super_admin', now: FIXED })
  vazio.tables.vendas = []
  vazio.tables.abordagens = []
  vazio.tables.daily_goal_tasks = []
  vazio.rpc.get_team_ranking = () => []
  vazio.rpc.get_sdr_ranking = () => []
  vazio.rpc.arena_shift_approach_progress = () => []
  vazio.rpc.get_sales_board = () => ({ items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: FIXED.toISOString() })
  const { pagina, erros, fechar } = await abrir({ fixtures: vazio })
  try {
    await expect(pagina.getByText('Aguardando as primeiras vendas.')).toBeVisible()
    assert.equal(await pagina.getByRole('img', { name: /Vendas e abordagens/ }).count(), 0, 'sem pontos não há gráfico')
    await expect(pagina.getByRole('list', { name: 'Legenda' })).toBeVisible()
    assert.ok((await textoDe(pagina, 'Quantidade de Vendas')).includes('+0 na última hora'))
    assert.ok(!(await textoDe(pagina, 'Quantidade de Vendas')).includes('última às'), 'sem venda não há "última às"')
    assert.equal(await regiao(pagina, 'Quantidade de Vendas').locator('svg').count(), 1, 'só o ícone: sem minigráfico com menos de 2 pontos')
    assert.ok((await textoDe(pagina, 'Conversão')).includes('—'))
    assert.ok((await textoDe(pagina, 'Conversão')).includes('0 vendas para 0 abordagens'))
    assert.equal(await pagina.getByRole('meter', { name: 'Vendas por abordagem' }).count(), 0, 'sem taxa não há anel')
    assert.ok((await textoDe(pagina, 'Total de Vendas')).includes('R$ 0,00'))
    assert.ok(!(await textoDe(pagina, 'Total de Vendas')).includes('na última hora'), 'sem venda não há receita da última hora')
    // Barra dividida vazia: trilho sem segmentos e a legenda com 0 e 0.
    assert.deepEqual(await divisaoNaTela(pagina), { mostrou: 0, naoMostrou: 0 })
    assert.equal(await regiao(pagina, 'Abordagens').locator('.bg-viz-1.h-full, .bg-viz-2.h-full').count(), 0, 'nenhum segmento inventado')
    for (const texto of [
      'Nenhum produto vendido no período',
      'As vendas aprovadas e as abordagens aparecem aqui assim que acontecem.',
      'A primeira venda aprovada abre a competição.',
      'Nenhuma tarefa definida para hoje',
      'Nenhuma meta de turno para esta seleção.',
      'Nenhum Closer elegível no ranking.',
      'Nenhuma venda neste filtro',
    ]) await expect(pagina.getByText(texto, { exact: true }).first()).toBeVisible()
    for (const lugar of ['1º', '2º', '3º']) await expect(pagina.getByText(`${lugar} lugar em aberto`)).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('pódio: 0, 1, 2, 3 e 6 posições, na ordem de leitura 1º, 2º, 3º', async () => {
  const pessoas = (n) =>
    Array.from({ length: n }, (_, i) => ({ user_id: `00000000-0000-4000-8000-0000000000${20 + i}`, name: `Pessoa ${i + 1}`, avatarUrl: null, totalVendas: 1000 - i * 100, quantidadeVendas: 10 - i, abordagens: 50, conversao: 10 }))
  for (const n of [0, 1, 2, 3, 6]) {
    const f = buildFixtures({ role: 'super_admin', now: FIXED })
    f.rpc.get_team_ranking = () => pessoas(n)
    const { pagina, erros, fechar } = await abrir({ fixtures: f })
    try {
      const podio = pagina.getByRole('list', { name: 'Pódio' })
      await expect(podio).toBeVisible()
      const lugares = await podio.locator('li').evaluateAll((lis) => lis.map((li) => ({ lugar: li.dataset.lugar, ordemVisual: li.style.order })))
      assert.deepEqual(lugares.map((l) => l.lugar), ['1', '2', '3'], 'a ordem do DOM é 1º, 2º, 3º')
      assert.deepEqual(lugares.map((l) => l.ordemVisual), ['2', '1', '3'], 'a ordem visual é 2º, 1º, 3º')
      for (let lugar = 1; lugar <= 3; lugar++) {
        const aberto = await pagina.getByText(`${lugar}º lugar em aberto`).count()
        assert.equal(aberto, lugar > n ? 1 : 0, `n=${n}: ${lugar}º ${lugar > n ? 'em aberto' : 'preenchido'}`)
      }
      const lista = pagina.locator('ol[start="4"] li')
      assert.equal(await lista.count(), n > 3 ? Math.min(3, n - 3) : 0, `n=${n}: lista do 4º ao 6º`)
      if (n > 0) await expect(pagina.getByText('Pessoa 1').first()).toBeVisible()
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
    assert.ok(mock.bumpRevision('sales') > 0, 'o canal Realtime estava inscrito')
    const depois = esperado(f, 'hoje')
    assert.equal(depois.quantidade, antes.quantidade + 1)
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
    assert.equal(linhas.reduce((t, l) => t + Number(l[1]), 0), depois.quantidade)
    assert.equal(linhas.reduce((t, l) => t + Number(l[2]), 0), depois.abordagens.length)
    assert.equal(await pagina.evaluate(() => window.__marcador), 'mesma-pagina', 'sem recarregar a página')
    await expect(pagina.getByText(/^atualizado (agora|há)/)).toBeVisible()
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('primeira pintura do feed não pisca e a carga inicial mostra o carregando do painel', async () => {
  const { pagina, erros, fechar } = await abrir({ latencia: 600 })
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
    await contexto.route(/benchmock\.supabase\.co\/rest\/v1\/vendas/, (route) => (falhar ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falha simulada' }) }) : route.fallback()))
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
  const reduzido = await abrir({ movimento: 'reduce' })
  try {
    const f = reduzido.f
    const e = esperado(f, 'hoje')
    assert.ok((await textoDe(reduzido.pagina, 'Quantidade de Vendas')).includes(inteiro(e.quantidade)))
    assert.equal(await reduzido.pagina.evaluate(() => getComputedStyle(document.querySelector('.painel-numero-subiu')).animationName), 'none', 'sem animação com prefers-reduced-motion')
  } finally {
    await reduzido.fechar()
  }
  const animado = await abrir({ movimento: 'no-preference' })
  try {
    const e = esperado(animado.f, 'hoje')
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

await teste('papel de vendedor: números só dele e menu sem itens de administração', async () => {
  const f = buildFixtures({ role: 'seller', now: FIXED })
  const { pagina, pedidosDeVendas, erros, fechar } = await abrir({ fixtures: f })
  try {
    await expect.poll(() => pedidosDeVendas.length).toBeGreaterThan(0)
    assert.ok(pedidosDeVendas.every((u) => u.searchParams.get('user_id')?.startsWith('eq.')), 'a consulta do vendedor filtra pelo próprio usuário (a regra do painel antigo)')
    const itens = (await pagina.locator('[data-sidebar="content"] [data-sidebar="menu-button"]').allInnerTexts()).map((t) => t.trim())
    assert.ok(!itens.includes('Executive') && !itens.includes('Assinaturas'), `vendedor não vê Executive nem Assinaturas (veio ${itens.join(', ')})`)
    await expect(pagina.getByText('somente os seus números')).toBeVisible()
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
    await contexto.route(/benchmock\.supabase\.co\/rest\/v1\/(vendas|abordagens)/, (route) =>
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
    for (const bloco of ['Pódio dos Closers', 'Últimas vendas']) await expect(regiao(pagina, bloco).getByRole('link', { name: 'Ranking' })).toHaveAttribute('href', '/ranking')
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
