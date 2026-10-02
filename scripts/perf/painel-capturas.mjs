// Capturas da Home (Visão geral) nos mesmos tamanhos e temas das imagens de referencias/, com backend
// falso e relógio congelado. Nada toca em produção: o build deve ser o de benchmark (VITE_SUPABASE_URL falsa).
//   node scripts/perf/painel-capturas.mjs --dist .verification.local/perf/dist-depois --out .verification.local/painel-capturas
// Opções: --so 01,02 (só estes números), --animado (não reduz o movimento)
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from './pw.mjs'
import { startServer } from './server.mjs'
import { buildFixtures, installMock, fakeSession, STORAGE_KEY } from './mock.mjs'

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)
const OUT = path.resolve(argv.out ?? '.verification.local/painel-capturas')
fs.mkdirSync(OUT, { recursive: true })
const SO = argv.so ? new Set(String(argv.so).split(',')) : null
const FIXED = new Date('2026-09-29T18:00:00Z') // 15:00 em Brasília, uma terça
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Mesmos nomes das imagens de referência (menos a 07, ficha lateral, que a Home não tem).
const CENARIOS = [
  { id: '01', nome: 'desktop-escuro-1440', largura: 1440, altura: 900, tema: 'dark' },
  { id: '02', nome: 'desktop-claro-1440', largura: 1440, altura: 900, tema: 'light' },
  { id: '03', nome: 'tablet-escuro-820', largura: 820, altura: 1180, tema: 'dark' },
  { id: '04', nome: 'celular-escuro-390', largura: 390, altura: 844, tema: 'dark' },
  { id: '05', nome: 'celular-claro-390', largura: 390, altura: 844, tema: 'light' },
  { id: '06', nome: 'grafico-por-hora-com-dica-escuro', largura: 1440, altura: 900, tema: 'dark', dica: true },
  { id: '08', nome: 'desktop-escuro-1920', largura: 1920, altura: 1080, tema: 'dark' },
  { id: '09', nome: 'desktop-claro-1920', largura: 1920, altura: 1080, tema: 'light' },
  { id: '10', nome: 'estado-vazio-escuro-1440', largura: 1440, altura: 900, tema: 'dark', vazio: true },
  { id: '11', nome: 'estado-vazio-claro-1440', largura: 1440, altura: 900, tema: 'light', vazio: true },
]

const { server, url } = await startServer(path.resolve(argv.dist))
const browser = await chromium.launch({ headless: true })
const resumo = []

for (const c of CENARIOS) {
  if (SO && !SO.has(c.id)) continue
  const contexto = await browser.newContext({
    viewport: { width: c.largura, height: c.altura },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: argv.animado ? 'no-preference' : 'reduce',
    colorScheme: c.tema,
  })
  const fixtures = buildFixtures({ role: 'super_admin', now: FIXED })
  if (c.vazio) {
    fixtures.tables.vendas = []
    fixtures.tables.abordagens = []
    fixtures.tables.crm_activities = []
    fixtures.tables.daily_goal_tasks = []
    fixtures.rpc.get_team_ranking = () => []
    fixtures.rpc.get_sdr_ranking = () => []
    fixtures.rpc.arena_shift_approach_progress = () => []
    fixtures.rpc.get_sales_board = () => ({ items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0, pending_value: 0, approved_value: 0, overdue: 0 }, fetched_at: FIXED.toISOString() })
  }
  installMock(contexto, fixtures, { latencyMs: 20 })
  await contexto.addInitScript(
    ({ chave, sessao, tema }) => {
      try {
        sessionStorage.setItem(chave, JSON.stringify(sessao))
        localStorage.setItem('theme', tema)
      } catch {
        /* sem armazenamento */
      }
    },
    { chave: STORAGE_KEY, sessao: fakeSession(FIXED.getTime()), tema: c.tema },
  )
  const pagina = await contexto.newPage()
  await pagina.clock.setFixedTime(FIXED)
  const erros = []
  pagina.on('pageerror', (e) => erros.push(`pageerror: ${String(e.message).slice(0, 200)}`))
  pagina.on('console', (m) => {
    if (m.type() === 'error') erros.push(`console: ${m.text().slice(0, 200)}`)
  })

  try {
    await pagina.goto(url + '/', { waitUntil: 'load' })
    await pagina.getByRole('heading', { level: 1, name: 'Visão geral' }).waitFor({ timeout: 20000 })
    await sleep(2800)
    const estouro = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const arquivo = path.join(OUT, `${c.id}-${c.nome}.png`)
    if (c.dica) {
      const grafico = pagina.getByRole('img', { name: /Calls feitas e abordagens/ })
      await grafico.scrollIntoViewIfNeeded()
      const caixa = await grafico.boundingBox()
      if (caixa) await pagina.mouse.move(caixa.x + caixa.width * 0.62, caixa.y + caixa.height * 0.45)
      await sleep(300)
      const bloco = pagina.locator('[data-dashboard-section="commercial-evolution"]')
      await bloco.screenshot({ path: arquivo })
    } else {
      // Como as imagens de referência: a janela ganha a altura da página, então o menu fixo acompanha a página toda.
      const altura = await pagina.evaluate(() => document.documentElement.scrollHeight)
      await pagina.setViewportSize({ width: c.largura, height: Math.max(c.altura, altura) })
      await sleep(900)
      await pagina.screenshot({ path: arquivo })
    }
    resumo.push({ id: c.id, nome: c.nome, estouroHorizontal: estouro, erros: [...new Set(erros)].slice(0, 6) })
  } catch (e) {
    resumo.push({ id: c.id, nome: c.nome, falha: String(e.message).split('\n')[0], erros: [...new Set(erros)].slice(0, 6) })
    await pagina.screenshot({ path: path.join(OUT, `${c.id}-${c.nome}-FALHA.png`), fullPage: true }).catch(() => {})
  }
  await contexto.close()
}

fs.writeFileSync(path.join(OUT, '_resumo.json'), JSON.stringify(resumo, null, 2))
console.log(JSON.stringify(resumo, null, 2))
await browser.close()
server.close()
