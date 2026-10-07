// Aprovar uma venda tem de aparecer na Home na hora, mesmo quando a compra é de outro dia. Navegador real, backend FALSO
// (nada toca em produção). O build tem de ser o de benchmark, como em verify-painel-ui.mjs:
//   VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
//     npx vite build --outDir .verification.local/perf/dist-aprovacao --emptyOutDir
//   node scripts/verify-approval-sync-ui.mjs --dist .verification.local/perf/dist-aprovacao
//
// Regra que o teste protege: o PERÍODO (totais, gráficos) segue a data da compra, como o dono definiu em 23/09; o que
// acontece AGORA (feed ao vivo, "na última hora", "última às") segue a hora da aprovação, e uma aprovação de compra
// anterior ao período é anunciada na tela em vez de sumir.
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
const FIXED = new Date('2026-09-29T18:00:00Z') // 15:00 em Brasília, uma terça
const normalizar = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

const { server, url } = await startServer(path.resolve(argv.dist))
const navegador = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })

/**
 * Home aberta só com as vendas pendentes dadas e mais nada (sem abordagens nem calls: o feed só tem o que o teste cria).
 * `venda` é uma venda ou uma lista delas; `papel` é o de quem olha a tela.
 */
async function abrir(venda, { papel = 'super_admin', caminho = '/' } = {}) {
  const f = buildFixtures({ role: papel, now: FIXED })
  const modelo = f.tables.vendas[0]
  f.tables.vendas = [venda].flat().map((v) => ({ ...modelo, ...v, approval_status: 'pendente', reviewed_at: null }))
  f.tables.abordagens = []
  f.tables.crm_activities = []
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce', colorScheme: 'dark' })
  const mock = installMock(contexto, f, { latencyMs: 15, ws: 'normal' })
  await contexto.addInitScript(
    ({ chave, sessao }) => {
      try {
        sessionStorage.setItem(chave, JSON.stringify(sessao))
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
  await expect(pagina.getByRole('heading', { level: 1, name: caminho === '/' ? 'Visão geral' : 'Central Executive' })).toBeVisible()
  const regiao = (nome) => pagina.getByRole('region', { name: nome, exact: true })
  const texto = async (nome) => normalizar(await regiao(nome).innerText())
  // O momento exato em que o executivo aprova: o banco grava reviewed_at e avisa o painel (Realtime).
  const aprovar = async (aprovadaEm) => {
    for (const v of f.tables.vendas) Object.assign(v, { approval_status: 'aprovada', reviewed_at: aprovadaEm, updated_at: aprovadaEm })
    mock.bumpRevision('sales')
  }
  return { f, pagina, regiao, texto, aprovar, erros, fechar: () => contexto.close() }
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

const AVISO = '[data-dashboard-section="late-approvals"]'

await teste('compra de sexta aprovada agora: o aviso e o feed aparecem, os totais de hoje seguem a data da compra', async () => {
  const { pagina, regiao, texto, aprovar, erros, fechar } = await abrir({
    nome_produto: 'Mentoria Jogador De Elite',
    valor_venda: 500,
    created_at: '2026-09-25T21:57:00.000Z', // sexta 18:57 em Brasília
    updated_at: '2026-09-25T21:57:00.000Z',
  })
  try {
    await expect(pagina.locator(AVISO)).toHaveCount(0)
    assert.ok((await texto('Total de Vendas')).includes('R$ 0,00'))
    await expect(pagina.getByText('As vendas aprovadas e as abordagens aparecem aqui assim que acontecem.')).toBeVisible()

    await aprovar('2026-09-29T17:58:00.000Z') // terça 14:58, dois minutos antes de "agora"

    const aviso = pagina.locator(AVISO)
    await expect(aviso).toBeVisible()
    const textoDoAviso = normalizar(await aviso.innerText())
    for (const trecho of ['Mentoria Jogador De Elite', 'R$ 500,00', 'compra de 25/09']) assert.ok(textoDoAviso.includes(trecho), `o aviso diz "${trecho}": ${textoDoAviso}`)

    const feed = pagina.getByRole('list', { name: 'Atividade ao vivo' })
    await expect(feed).toBeVisible()
    const itemDoFeed = normalizar(await feed.innerText())
    for (const trecho of ['Venda aprovada · R$ 500,00', 'compra de 25/09', 'há 2 min']) assert.ok(itemDoFeed.includes(trecho), `o feed diz "${trecho}": ${itemDoFeed}`)

    // O período é o da compra (regra de 23/09): o total de HOJE não muda, e o aviso explica por quê.
    assert.ok((await texto('Total de Vendas')).includes('R$ 0,00'), 'o total de hoje continua pela data da compra')
    assert.equal((await regiao('Quantidade de Vendas').locator('p').first().innerText()).trim(), '0')
    await aviso.getByRole('link', { name: 'Ver dia da compra' }).click()
    await expect(pagina).toHaveURL(/periodo=intervalo&de=2026-09-25&ate=2026-09-25/)
    await expect(regiao('Total de Vendas')).toContainText('R$ 500,00')
    await expect(regiao('Quantidade de Vendas').locator('p').first()).toHaveText('1')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('compra de hoje aprovada agora: entra nos totais e na última hora pela hora da aprovação, sem aviso', async () => {
  const { pagina, texto, aprovar, erros, fechar } = await abrir({
    nome_produto: 'Assessoria de Elite',
    valor_venda: 1497,
    created_at: '2026-09-29T12:00:00.000Z', // hoje 09:00, seis horas antes de "agora"
    updated_at: '2026-09-29T12:00:00.000Z',
  })
  try {
    assert.ok((await texto('Quantidade de Vendas')).includes('+0 na última hora'))

    await aprovar('2026-09-29T17:30:00.000Z') // hoje 14:30: aprovada há 30 min

    await expect(pagina.getByRole('region', { name: 'Total de Vendas', exact: true })).toContainText('R$ 1.497,00')
    const quantidade = await texto('Quantidade de Vendas')
    assert.ok(quantidade.includes('+1 na última hora'), `aprovada há 30 min conta na última hora, mesmo comprada às 09:00: ${quantidade}`)
    assert.ok(quantidade.includes('última às 14:30'), `a "última às" é a da aprovação: ${quantidade}`)
    const total = await texto('Total de Vendas')
    assert.ok(total.includes('+R$ 1.497,00 na última hora'), total)
    await expect(pagina.locator(AVISO)).toHaveCount(0)
    const itemDoFeed = normalizar(await pagina.getByRole('list', { name: 'Atividade ao vivo' }).innerText())
    assert.ok(itemDoFeed.includes('Venda aprovada · R$ 1.497,00') && itemDoFeed.includes('há 30 min'), itemDoFeed)
    assert.ok(!itemDoFeed.includes('compra de'), 'comprada e aprovada no mesmo dia: sem dica de compra')
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('vendedor: o aviso e o feed mostram só as aprovações das vendas dele, de compras anteriores', async () => {
  const outro = '00000000-0000-4000-8000-0000000000aa'
  const compra = '2026-09-25T21:57:00.000Z' // sexta
  const { pagina, aprovar, erros, fechar } = await abrir(
    [
      { id: '00000000-0000-4000-8000-0000000b0001', user_id: USER_ID, nome_produto: 'Minha Mentoria', valor_venda: 500, created_at: compra, updated_at: compra },
      { id: '00000000-0000-4000-8000-0000000b0002', user_id: outro, nome_produto: 'Venda de outra pessoa', valor_venda: 2997, created_at: compra, updated_at: compra },
    ],
    { papel: 'seller' },
  )
  try {
    await expect(pagina.locator(AVISO)).toHaveCount(0)
    await aprovar('2026-09-29T17:58:00.000Z')
    const aviso = pagina.locator(AVISO)
    await expect(aviso).toBeVisible()
    const textoDoAviso = normalizar(await aviso.innerText())
    assert.ok(textoDoAviso.includes('Uma venda aprovada neste período foi comprada antes'), textoDoAviso)
    assert.ok(textoDoAviso.includes('Minha Mentoria') && textoDoAviso.includes('R$ 500,00'), textoDoAviso)
    assert.ok(!textoDoAviso.includes('Venda de outra pessoa') && !textoDoAviso.includes('2.997'), `o vendedor não vê a venda de outra pessoa: ${textoDoAviso}`)
    const itemDoFeed = normalizar(await pagina.getByRole('list', { name: 'Atividade ao vivo' }).innerText())
    assert.ok(itemDoFeed.includes('Venda aprovada · R$ 500,00') && !itemDoFeed.includes('2.997'), itemDoFeed)
    assert.deepEqual(erros, [])
  } finally {
    await fechar()
  }
})

await teste('Central Executive: a atividade recente mostra a aprovação de uma compra de antes da janela, pela hora da aprovação', async () => {
  const { pagina, aprovar, fechar } = await abrir(
    { nome_produto: 'Mentoria Antiga', valor_venda: 500, created_at: '2026-08-01T15:00:00.000Z', updated_at: '2026-08-01T15:00:00.000Z' }, // 59 dias antes: fora dos 30 dias
    { caminho: '/executive' },
  )
  try {
    const atividade = pagina.getByRole('heading', { name: 'Atividade Recente' }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
    await expect(atividade).toBeVisible()
    assert.ok(!normalizar(await atividade.innerText()).includes('Mentoria Antiga'))

    await aprovar('2026-09-29T17:58:00.000Z')

    await expect(atividade).toContainText('Venda aprovada de Mentoria Antiga')
    const texto = normalizar(await atividade.innerText())
    assert.ok(texto.includes('compra de 01/08'), `a atividade diz quando foi a compra: ${texto}`)
    assert.ok(texto.includes('14:58'), `na hora da aprovação (14:58 em Brasília): ${texto}`)
  } finally {
    await fechar()
  }
})

await navegador.close()
server.close()
const falhas = resultados.filter((r) => !r.ok)
console.log(falhas.length ? `\n${falhas.length} de ${resultados.length} testes FALHARAM.` : `\nPASS: ${resultados.length} testes de aprovação de venda (Home e Central Executive).`)
process.exit(falhas.length ? 1 : 0)
