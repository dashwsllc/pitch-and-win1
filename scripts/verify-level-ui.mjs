import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15_000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
const project = 'mbzwchnxtskysqplqiyy'
const actor = 'ce220000-0000-4000-8000-000000000098'
const otherUser = 'ce220000-0000-4000-8000-000000000099'
const now = new Date()
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString()
const laterIso = new Date(now.getTime() + 3_600_000).toISOString()

const profile = { id: actor, user_id: actor, display_name: 'Closer de teste', avatar_url: null, suspended: false, created_at: daysAgo(30), updated_at: daysAgo(30) }
const role = { id: actor, user_id: actor, role: 'closer', crm_access: true, commission_rate: 0, can_view_sales: true, updated_at: daysAgo(30) }

// Ciclo ativo individual (scope "user"): 50/200 = 25% -> 80 XP (period monthly, cap 200% nao entra em jogo aqui)
const liveMember = { user_id: actor, display_name: 'Closer de teste', avatar_url: null, suspended: false, actual: 50, target: 200, state: 'on_track' }
const visibleGoals = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    goal_id: '20000000-0000-4000-8000-000000000011',
    title: 'Meta mensal individual',
    period: 'monthly',
    scope: 'user',
    role: 'closer',
    metric: 'revenue',
    starts_at: daysAgo(10),
    ends_at: laterIso,
    show_countdown: true,
    result: { actual: 50, target: 200, state: 'on_track', members: [liveMember] },
  },
]

// Historico: 2 ciclos pessoais do actor devem contar; 2 ciclos-ruido devem ser filtrados.
const historyItems = [
  // conta: scope "user", daily, 80/100=80% -> 32 XP, outcome failed
  {
    cycle_id: 'h1', goal_id: 'h1g', goal_version: 1, title: 'Meta diaria de ontem',
    scope: 'user', period: 'daily', target_role: null,
    starts_at: daysAgo(3), ends_at: daysAgo(2), closed_at: daysAgo(2),
    user_id: actor, display_name: 'Closer de teste',
    actual: 80, target: 100, state: 'below', outcome: 'failed', metric: 'revenue',
  },
  // conta: scope "role" == cargo do actor (closer), weekly, 150/100=150% -> 180 XP, outcome achieved
  {
    cycle_id: 'h2', goal_id: 'h2g', goal_version: 1, title: 'Meta semanal do cargo',
    scope: 'role', period: 'weekly', target_role: 'closer',
    starts_at: daysAgo(9), ends_at: daysAgo(2), closed_at: daysAgo(1),
    user_id: actor, display_name: 'Closer de teste',
    actual: 150, target: 100, state: 'exceeded', outcome: 'achieved', metric: 'revenue',
  },
  // ruido: scope "role" de outro cargo (sdr) -- tem que ser ignorado mesmo pertencendo ao actor
  {
    cycle_id: 'h3', goal_id: 'h3g', goal_version: 1, title: 'Meta de outro cargo',
    scope: 'role', period: 'daily', target_role: 'sdr',
    starts_at: daysAgo(4), ends_at: daysAgo(3), closed_at: daysAgo(3),
    user_id: actor, display_name: 'Closer de teste',
    actual: 999, target: 10, state: 'exceeded', outcome: 'achieved', metric: 'score',
  },
  // ruido: scope "user" de outra pessoa -- tem que ser ignorado
  {
    cycle_id: 'h4', goal_id: 'h4g', goal_version: 1, title: 'Meta individual de outra pessoa',
    scope: 'user', period: 'monthly', target_role: null,
    starts_at: daysAgo(20), ends_at: daysAgo(1), closed_at: daysAgo(1),
    user_id: otherUser, display_name: 'Outro usuario',
    actual: 999, target: 10, state: 'exceeded', outcome: 'achieved', metric: 'revenue',
  },
]
const historyResponse = { summary: { total: 4, achieved: 3, failed: 1, unassigned: 0 }, items: historyItems }

// XP esperado (mesma formula de src/lib/level.ts): 32 (h1) + 180 (h2) + 80 (live) = 292
// Curva: xpForLevel(2)=260, xpForLevel(3)=559 -> nivel 2, faltam 267 XP pro nivel 3.
const EXPECTED_LEVEL = 2
const EXPECTED_XP_INTO_LEVEL = '32'
const EXPECTED_XP_FOR_NEXT = '299'
const EXPECTED_XP_TO_NEXT = '267'
const EXPECTED_XP_TOTAL = '292'

const metrics = { revenue: 0, sales: 0, ticket: null, conversion: null, cpl: null, appointments: 0, approaches: 0, spend: null, leads: null }
const dashboard = { server_time: now.toISOString(), revision: 1, metrics, previous: metrics, series: [], cycles: visibleGoals, feed: [], sdrs: [], closers: [], ticket_reference: 2997 }

const errors = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('https://**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [role]
  else if (resource === 'arena_visible_goals') data = visibleGoals
  else if (resource === 'arena_goal_history') data = historyResponse
  else if (resource === 'arena_dashboard') data = dashboard
  else if (resource === 'arena_revision') data = 1
  else if (resource === 'arena_live_cursor') data = now.toISOString()
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
    refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
    user: { id: actor, email: 'level@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Closer de teste' }, created_at: new Date().toISOString() },
  }
  sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

try {
  await page.goto(`${origin}/metas?tab=atribuicoes`)

  // Badge no header, ao lado do sino de notificacao.
  const badge = page.getByLabel(new RegExp(`Nível ${EXPECTED_LEVEL}, Closer\\.`))
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('href', '/metas?tab=atribuicoes')

  // Card "Sua Progressao" dentro da aba Minhas tarefas, antes de "Metas em andamento".
  await expect(page.getByRole('heading', { name: 'Sua Progressão' })).toBeVisible()
  await expect(page.getByText(`${EXPECTED_XP_INTO_LEVEL} / ${EXPECTED_XP_FOR_NEXT} XP`)).toBeVisible()
  await expect(page.getByText(`Faltam ${EXPECTED_XP_TO_NEXT} XP para o nível ${EXPECTED_LEVEL + 1}`)).toBeVisible()
  await expect(page.getByText(`${EXPECTED_XP_TOTAL} XP total`)).toBeVisible()
  await expect(page.getByText('1 meta batida')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Metas em andamento' })).toBeVisible()

  // Grafico de XP acumulado (2 pontos de historico validos -> chartData.length >= 2).
  await expect(page.locator('.recharts-responsive-container')).toBeVisible()
  // 32 XP (27/09) -> 212 XP (28/09) num eixo 0-220: a curva tem que terminar
  // perto do topo (y pequeno), nao no meio -- confere a geometria real do SVG,
  // nao uma leitura visual do screenshot.
  const areaPath = await page.locator('.recharts-area-curve').getAttribute('d')
  const [, startY, endY] = areaPath.match(/M[\d.]+,([\d.]+)L[\d.]+,([\d.]+)/).map(Number)
  assert.ok(endY < startY * 0.2, `esperava a curva subir perto do topo (start y=${startY}, end y=${endY})`)

  if (process.env.LEVEL_UI_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/metas-atribuicoes.png`, fullPage: true })
  }

  // Arena tem layout/toolbar proprios: espera carregar de verdade antes de
  // confirmar ausencia (senao a checagem passaria so por a pagina estar em branco).
  await page.goto(`${origin}/arena`)
  await expect(page.getByRole('heading', { name: 'Arena Comercial' })).toBeVisible()
  await expect(page.getByLabel(/Nível \d/)).toHaveCount(0)
  await expect(page.getByText('Sua Progressão')).toHaveCount(0)
  if (process.env.LEVEL_UI_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/arena.png` })
  }

  assert.deepEqual(errors, [])
  console.log('PASS: level badge shows beside notifications (not on Arena) and Sua Progressão renders correct XP/level inside Metas.')
} finally {
  await context.close()
  await browser.close()
}
