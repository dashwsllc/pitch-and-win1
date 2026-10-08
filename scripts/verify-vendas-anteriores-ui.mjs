// A Visão geral tem de abrir mostrando as vendas anteriores, com as datas rotuladas, e uma venda antiga aprovada agora tem
// de entrar ao vivo. Navegador real, backend FALSO (nada toca em produção). O build tem de ser o de benchmark:
//   VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
//     npx vite build --outDir .verification.local/perf/dist-novo --emptyOutDir
//   node scripts/verify-vendas-anteriores-ui.mjs --dist .verification.local/perf/dist-novo
//
// Regressão de 2026-10-07 ("não está aparecendo as vendas anteriores"): o painel abria em "Hoje" e, com as quatro vendas
// reais de produção (14/09, 20/09, 01/10 e 02/10, esta aprovada em 06/10), mostrava 0 vendas, R$ 0,00, "Nenhum produto
// vendido" e o "Ao vivo" vazio. Além disso a mesma venda aparecia com o dia da compra num bloco e o da aprovação em outro,
// sem rótulo visível, o que parecia dado dessincronizado.
import assert from 'node:assert/strict'
import path from 'node:path'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, installMock, STORAGE_KEY, USER_ID } from './perf/mock.mjs'
import { startServer } from './perf/server.mjs'

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)
if (!argv.dist) throw new Error('Informe --dist <pasta do build de benchmark>')
const expect = baseExpect.configure({ timeout: 15_000 })
const FIXED = new Date('2026-10-07T15:00:00Z') // quarta, 12:00 em Brasília
const normalizar = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

const { server, url } = await startServer(path.resolve(argv.dist))
const navegador = await chromium.launch({ headless: true })

// As quatro vendas aprovadas que existem em produção (valores, compra e aprovação reais).
const VENDAS_REAIS = [
  { id: '6fa48847-24a7-4ac3-8b65-0af3e9b5540b', valor_venda: 500, created_at: '2026-10-02T21:57:49Z', reviewed_at: '2026-10-06T21:52:50Z' },
  { id: 'fe29a77a-ff3c-47f6-b212-01b22d8a4bfc', valor_venda: 1497, created_at: '2026-10-01T14:31:09Z', reviewed_at: '2026-10-01T14:56:09Z' },
  { id: '8820534c-ae72-452d-8d57-3a95a04842f2', valor_venda: 2997, created_at: '2026-09-20T17:38:16Z', reviewed_at: '2026-09-20T17:38:42Z' },
  { id: '00f25bc9-2769-473c-9add-fec2ec964ed1', valor_venda: 1770, created_at: '2026-09-14T05:37:17Z', reviewed_at: '2026-09-14T05:37:44Z' },
]

/** Home aberta com as vendas dadas (aprovadas, a menos que `approval_status` diga outra coisa) e mais nada. */
async function abrir(vendas, { papel = 'super_admin', caminho = '/', donoDasVendas } = {}) {
  const f = buildFixtures({ role: papel, now: FIXED })
  const modelo = f.tables.vendas[0]
  const dono = donoDasVendas ?? f.users[2]
  f.tables.vendas = vendas.map((v) => ({
    ...modelo,
    user_id: dono.id,
    nome_produto: 'Mentoria Jogador De Elite',
    approval_status: 'aprovada',
    updated_at: v.reviewed_at ?? v.created_at,
    ...v,
  }))
  f.tables.abordagens = []
  f.tables.crm_activities = []
  const nomeDe = (id) => (id === USER_ID ? 'Bench Admin' : f.users.find((u) => u.id === id)?.name ?? 'Vendedor')
  // O quadro de vendas do time lê o banco a cada pedido: aprovar uma venda no teste muda a resposta, como em produção.
  f.rpc.get_sales_board = (args) => {
    const status = args?.p_status ?? 'aprovada'
    const tamanho = Number(args?.p_page_size ?? 12)
    const pagina = Number(args?.p_page ?? 0)
    const linhas = f.tables.vendas
      .filter((v) => v.approval_status === status)
      .sort((a, b) => Date.parse(b.reviewed_at ?? b.created_at) - Date.parse(a.reviewed_at ?? a.created_at))
      .map((v) => ({ ...v, seller_name: nomeDe(v.user_id), seller_avatar: null, ticket_name: null, reviewer_name: 'Bench Admin' }))
    return {
      items: linhas.slice(pagina * tamanho, (pagina + 1) * tamanho),
      total: linhas.length,
      summary: { pending: 0, approved: linhas.length, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 },
      fetched_at: FIXED.toISOString(),
    }
  }
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce', colorScheme: 'dark' })
  const mock = installMock(contexto, f, { latencyMs: 15, ws: 'normal' })
  await contexto.addInitScript(
    ({ chave, sessao }) => {
      try {
        localStorage.setItem(chave, JSON.stringify(sessao))
        localStorage.setItem('theme', 'dark')
      } catch {
        /* sem armazenamento */
      }
    },
    { chave: STORAGE_KEY, sessao: fakeSession(FIXED.getTime()) },
  )
  const pagina = await contexto.newPage()
  await pagina.clock.setFixedTime(FIXED)
  const erros = []
  pagina.on('pageerror', (e) => erros.push(`pageerror: ${String(e.message).slice(0, 220)}`))
  await pagina.goto(url + caminho, { waitUntil: 'load' })
  await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
  const regiao = (nome) => pagina.getByRole('region', { name: nome, exact: true })
  const texto = async (nome) => normalizar(await regiao(nome).innerText())
  const quantidade = async () => (await regiao('Quantidade de Vendas').locator('p').first().innerText()).trim()
  // O momento em que o executivo aprova: o banco grava reviewed_at e avisa o painel (Realtime).
  const aprovar = async (id, aprovadaEm) => {
    const v = f.tables.vendas.find((x) => x.id === id)
    Object.assign(v, { approval_status: 'aprovada', reviewed_at: aprovadaEm, updated_at: aprovadaEm })
    mock.bumpRevision('sales')
  }
  return { f, pagina, regiao, texto, quantidade, aprovar, erros, fechar: () => contexto.close() }
}

const resultados = []
async function teste(nome, fn) {
  try {
    await fn()
    resultados.push({ nome, ok: true })
    console.log(`PASS  ${nome}`)
  } catch (erro) {
    resultados.push({ nome, ok: false })
    console.log(`FAIL  ${nome}\n      ${String(erro.message ?? erro).split('\n').slice(0, 6).join('\n      ')}`)
  }
}

await teste('abrir a Visão geral sem filtro mostra as vendas anteriores: 30 dias, 4 vendas, R$ 6.764,00', async () => {
  const { pagina, regiao, texto, quantidade, erros, fechar } = await abrir(VENDAS_REAIS)
  try {
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    assert.equal(new URL(pagina.url()).search, '', 'o padrão não é gravado no endereço')
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.equal(await quantidade(), '4')
    assert.ok((await texto('Ticket Médio')).includes('R$ 1.691,00'), await texto('Ticket Médio'))
    // A última venda é de ontem: a hora sozinha parecia de hoje.
    const kpi = await texto('Quantidade de Vendas')
    assert.ok(kpi.includes('última em 06/10 às 18:52'), `a última venda diz o dia: ${kpi}`)
    assert.ok(!(await texto('Produtos em destaque')).includes('Nenhum produto vendido'), 'os produtos vendidos aparecem')
    assert.ok((await texto('Produtos em destaque')).includes('Mentoria Jogador De Elite'))
    // O "Ao vivo" lista as vendas anteriores, com o dia da compra quando difere do da aprovação.
    const feed = normalizar(await pagina.getByRole('list', { name: 'Atividade ao vivo' }).innerText())
    for (const trecho of ['R$ 500,00', 'R$ 1.497,00', 'R$ 2.997,00', 'R$ 1.770,00', 'compra de 02/10']) assert.ok(feed.includes(trecho), `o feed diz "${trecho}": ${feed}`)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('a mesma venda aparece com a data rotulada nos dois blocos: Compra (Vendas do time) e Aprovada (Últimas vendas)', async () => {
  const { regiao, texto, fechar } = await abrir(VENDAS_REAIS)
  try {
    await expect(regiao('Últimas vendas')).toContainText('R$ 500,00')
    await expect(regiao('Vendas do time')).toContainText('R$ 500,00')
    const ultimas = await texto('Últimas vendas')
    const time = await texto('Vendas do time')
    // A venda de R$ 500: comprada em 02/10 18:57, aprovada em 06/10 18:52. Cada bloco diz qual das duas datas mostra.
    assert.ok(ultimas.includes('Aprovada 18:52 06/10'), `Últimas vendas mostra a aprovação, rotulada: ${ultimas}`)
    assert.ok(ultimas.includes('compra de 02/10'), `e diz que a compra foi em outro dia: ${ultimas}`)
    assert.ok(time.includes('Compra 18:57 02/10'), `Vendas do time mostra a compra, rotulada: ${time}`)
    // Venda aprovada no mesmo dia da compra: sem dica de compra.
    assert.ok(ultimas.includes('Aprovada 11:56 01/10'), ultimas)
    assert.equal((ultimas.match(/compra de/g) ?? []).length, 1, `só a venda de 02/10 foi aprovada em outro dia: ${ultimas}`)
  } finally {
    await fechar()
  }
})

await teste('compra antiga aprovada agora entra nos totais e no feed da Visão geral na hora', async () => {
  const pendente = { id: '00000000-0000-4000-8000-0000000c0001', valor_venda: 997, created_at: '2026-09-25T21:57:00Z', reviewed_at: null, approval_status: 'pendente' }
  const { pagina, regiao, texto, quantidade, aprovar, erros, fechar } = await abrir([...VENDAS_REAIS, pendente])
  try {
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.equal(await quantidade(), '4')

    await aprovar(pendente.id, '2026-10-07T14:58:00Z') // hoje 11:58, dois minutos antes de "agora"

    await expect(regiao('Total de Vendas')).toContainText('R$ 7.761,00')
    assert.equal(await quantidade(), '5')
    const kpi = await texto('Quantidade de Vendas')
    assert.ok(kpi.includes('+1 na última hora') && kpi.includes('última às 11:58'), `aprovada há 2 min, de hoje: só a hora: ${kpi}`)
    const feed = normalizar(await pagina.getByRole('list', { name: 'Atividade ao vivo' }).innerText())
    assert.ok(feed.includes('Venda aprovada · R$ 997,00') && feed.includes('compra de 25/09'), feed)
    await expect(pagina.locator('[data-dashboard-section="late-approvals"]')).toHaveCount(0)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('escolher "Hoje" é uma escolha: indicadores do dia, as vendas anteriores seguem nos blocos de vendas, e Limpar volta aos 30 dias', async () => {
  const { pagina, regiao, erros, fechar } = await abrir(VENDAS_REAIS)
  try {
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    await pagina.getByRole('radio', { name: 'Hoje', exact: true }).click()
    assert.equal(new URL(pagina.url()).searchParams.get('periodo'), 'hoje')
    await expect(regiao('Quantidade de Vendas').locator('p').first()).toHaveText('0')
    await expect(regiao('Total de Vendas').locator('p').first()).toHaveText('R$ 0,00')
    // O período não esconde o histórico das vendas: os blocos "do time" têm janela própria.
    await expect(regiao('Últimas vendas')).toContainText('R$ 500,00')
    await expect(regiao('Vendas do time')).toContainText('4 resultados')
    await pagina.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('quem não é Executive vê o time todo: vendas anteriores, totais e feed iguais aos do Executive', async () => {
  const { f, pagina, regiao, quantidade, erros, fechar } = await abrir(VENDAS_REAIS, { papel: 'seller', donoDasVendas: { id: '00000000-0000-4000-8000-0000000000aa', name: 'Outra Pessoa' } })
  try {
    // Só duas das quatro vendas são de quem olha a tela; as outras duas são de outra pessoa. As tabelas só entregariam as
    // dele (RLS); a Home lê o time todo pelas funções dashboard_home_*.
    for (const v of f.tables.vendas.slice(0, 2)) v.user_id = USER_ID
    await pagina.reload()
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.equal(await quantidade(), '4')
    await expect(pagina.getByText('visão consolidada do time')).toBeVisible()
    const feed = normalizar(await pagina.getByRole('list', { name: 'Atividade ao vivo' }).innerText())
    for (const trecho of ['R$ 500,00', 'R$ 1.497,00', 'R$ 2.997,00', 'R$ 1.770,00']) assert.ok(feed.includes(trecho), `o feed do vendedor diz "${trecho}": ${feed}`)
    await expect(regiao('Vendas do time')).toContainText('4 resultados')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('a Visão geral SEMPRE abre nos últimos 30 dias: recarregar (F5) ou abrir um endereço salvo com outro filtro volta aos 30 dias', async () => {
  const { pagina, regiao, quantidade, erros, fechar } = await abrir(VENDAS_REAIS)
  try {
    await pagina.getByRole('radio', { name: 'Hoje', exact: true }).click()
    assert.equal(new URL(pagina.url()).searchParams.get('periodo'), 'hoje')
    await expect(regiao('Quantidade de Vendas').locator('p').first()).toHaveText('0')
    // Recarregar: a pessoa tinha escolhido "Hoje" e antes continuava vendo zeros depois do F5.
    await pagina.reload()
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.equal(await quantidade(), '4')
    assert.equal(new URL(pagina.url()).search, '', 'o filtro velho saiu do endereço')
    // Endereço salvo (favorito, histórico, link colado) com qualquer filtro: mesma coisa, e os outros parâmetros ficam.
    const origem = new URL(pagina.url()).origin
    for (const salvo of ['?periodo=hoje', '?periodo=ontem&outro=1', '?periodo=intervalo&de=2026-09-01&ate=2026-09-15', '?periodo=tudo']) {
      await pagina.goto(`${origem}/${salvo}`)
      await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
      const busca = new URL(pagina.url()).searchParams
      assert.equal(busca.has('periodo') || busca.has('de') || busca.has('ate'), false, `o filtro de ${salvo} foi limpo`)
    }
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('a escolha feita na tela vale durante a visita: sair da Home e voltar pelo histórico mantém o período; entrar pelo menu abre em 30 dias', async () => {
  const { pagina, regiao, erros, fechar } = await abrir(VENDAS_REAIS)
  try {
    await pagina.getByRole('radio', { name: '7 dias', exact: true }).click()
    await expect(pagina.getByRole('radio', { name: '7 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    await pagina.getByRole('link', { name: 'Ranking', exact: true }).first().click()
    await expect(pagina).toHaveURL(/\/ranking/)
    await pagina.goBack()
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    await expect(pagina.getByRole('radio', { name: '7 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    // Entrar na Home pelo menu (logo ou "Dashboard") abre no padrão, sem filtro carregado do endereço.
    await pagina.getByRole('link', { name: 'Ranking', exact: true }).first().click()
    await expect(pagina).toHaveURL(/\/ranking/)
    await pagina.getByRole('link', { name: 'Dashboard', exact: true }).first().click()
    await expect(pagina.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible()
    await expect(pagina.getByRole('radio', { name: '30 dias', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(regiao('Total de Vendas')).toContainText('R$ 6.764,00')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await navegador.close()
server.close()
const falhas = resultados.filter((r) => !r.ok)
console.log(falhas.length ? `\n${falhas.length} de ${resultados.length} testes FALHARAM.` : `\nPASS: ${resultados.length} testes das vendas anteriores na Visão geral.`)
process.exit(falhas.length ? 1 : 0)
