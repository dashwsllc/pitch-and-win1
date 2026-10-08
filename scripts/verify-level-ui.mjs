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

// Atividade real (activity_feed, lido direto por RLS): 3 acoes em 3 dias
// seguidos (hoje, ontem, anteontem) somando 2.0 de score -> 50 XP, sequencia
// de 3 dias, e 1 venda aprovada. E essa fonte que garante o nivel evoluir
// mesmo quando a meta do ciclo ativo esta parada em 0% (o bug relatado em
// producao: Closer com meta configurada mas actual=0 no ciclo da semana).
const activityRows = [
  { score_delta: 1.0, action_type: 'sale.approved', occurred_at: daysAgo(2) },
  { score_delta: 0.5, action_type: 'q.scheduled', occurred_at: daysAgo(1) },
  { score_delta: 0.5, action_type: 'q.scheduled', occurred_at: now.toISOString() },
]

// XP esperado (mesma formula de src/lib/level.ts): 32 (h1) + 180 (h2) + 80 (live) + 50 (atividade) = 342
// Curva: xpForLevel(2)=260, xpForLevel(3)=559 -> nivel 2, faltam 217 XP pro nivel 3.
const EXPECTED_LEVEL = 2
const EXPECTED_XP_INTO_LEVEL = '82'
const EXPECTED_XP_FOR_NEXT = '299'
const EXPECTED_XP_TO_NEXT = '217'
const EXPECTED_XP_TOTAL = '342'

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
  else if (resource === 'activity_feed') data = activityRows
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
  localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
}, { actor, project })

const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

try {
  await page.goto(`${origin}/metas?tab=atribuicoes`)

  // Badge no header, ao lado do sino de notificacao. O texto "Nível N" tem
  // que estar visivel de verdade (nao só no aria-label) -- era o bug relatado.
  const badge = page.getByLabel(new RegExp(`Nível ${EXPECTED_LEVEL}, Closer\\.`))
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('href', '/metas?tab=atribuicoes')
  await expect(badge.getByText(`Nível ${EXPECTED_LEVEL}`)).toBeVisible()

  // O trilho do anel tem que estar sempre visivel (verde), nao quase
  // transparente -- antes ficava invisivel quando o progresso era 0%.
  const trackStroke = await badge.locator('svg circle').first().getAttribute('stroke')
  assert.equal(trackStroke, 'rgba(52,211,153,0.22)', `trilho do anel deveria ser verde visivel, veio "${trackStroke}"`)

  // Card "Sua Progressao" dentro da aba Minhas tarefas, antes de "Metas em andamento".
  await expect(page.getByRole('heading', { name: 'Sua Progressão' })).toBeVisible()
  await expect(page.getByText(`${EXPECTED_XP_INTO_LEVEL} / ${EXPECTED_XP_FOR_NEXT} XP`)).toBeVisible()
  await expect(page.getByText(`Faltam ${EXPECTED_XP_TO_NEXT} XP para o nível ${EXPECTED_LEVEL + 1}`)).toBeVisible()
  await expect(page.getByText(`${EXPECTED_XP_TOTAL} XP total`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Metas em andamento' })).toBeVisible()

  // Sequencia (3 dias seguidos de atividade) e conquistas (3 das 8: primeira
  // venda, meta batida, sequencia de 3 dias -- as outras 5 continuam
  // bloqueadas com esses dados).
  await expect(page.getByText('Sequência ativa · 3 dias')).toBeVisible()
  await expect(page.getByText('Conquistas · 3 de 8')).toBeVisible()
  const unlockedNames = ['Primeira venda', 'Meta batida', 'Em ritmo']
  const lockedNames = ['Sequência forte', 'Veterano', 'Nível 5', 'Multimetas', '5 vendas']
  for (const name of unlockedNames) {
    const card = page.getByText(name, { exact: true }).locator('..')
    await expect(card.locator('svg.lucide-trophy')).toHaveCount(1)
  }
  for (const name of lockedNames) {
    const card = page.getByText(name, { exact: true }).locator('..')
    await expect(card.locator('svg.lucide-lock')).toHaveCount(1)
  }

  // Grafico de XP acumulado: 2 pontos de historico (27/09, 28/09) + 1 ponto
  // "hoje" sempre adicionado com o XP total atual (342, ja incluindo o ciclo
  // ao vivo) -- 3 pontos no eixo X.
  await expect(page.locator('.recharts-responsive-container')).toBeVisible()
  const xTicks = await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents()
  assert.equal(xTicks.length, 3, `esperava 3 pontos no eixo X (historico + hoje), veio ${JSON.stringify(xTicks)}`)
  // 32 XP -> 342 XP: a curva tem que terminar perto do topo (y pequeno), nao
  // no meio -- confere a geometria real do SVG a partir do primeiro e do
  // ultimo par de coordenadas do path (robusto a quantos pontos/curvas
  // existirem no meio), nao uma leitura visual do screenshot.
  const areaPath = await page.locator('.recharts-area-curve').getAttribute('d')
  const pairs = [...areaPath.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
  const startY = Number(pairs[0][2])
  const endY = Number(pairs[pairs.length - 1][2])
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

  // --- Segundo cenario: usuario sem nenhum historico e sem nenhuma
  // atividade -- o grafico tem que continuar aparecendo, zerado, em vez de
  // sumir da tela (pedido explicito: "mesmo zerado, deixe o grafico la").
  const zeroActor = 'ce220000-0000-4000-8000-000000000097'
  const zeroContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const zeroErrors = []
  await zeroContext.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await zeroContext.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const resource = url.pathname.split('/').at(-1)
    let data = []
    if (resource === 'get_my_registration_status') data = { status: 'approved' }
    else if (resource === 'profiles') data = url.searchParams.has('user_id') ? { ...profile, id: zeroActor, user_id: zeroActor } : [{ ...profile, id: zeroActor, user_id: zeroActor }]
    else if (resource === 'user_roles') data = [{ ...role, id: zeroActor, user_id: zeroActor }]
    else if (resource === 'arena_goal_history') data = { summary: { total: 0, achieved: 0, failed: 0, unassigned: 0 }, items: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await zeroContext.addInitScript(({ actor, project }) => {
    const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const session = {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
      refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
      user: { id: actor, email: 'zero-level@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Closer zerado' }, created_at: new Date().toISOString() },
    }
    localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
  }, { actor: zeroActor, project })
  const zeroPage = await zeroContext.newPage()
  zeroPage.on('pageerror', (error) => zeroErrors.push(error.message))
  zeroPage.on('console', (message) => { if (message.type() === 'error') zeroErrors.push(message.text()) })
  try {
    await zeroPage.goto(`${origin}/metas?tab=atribuicoes`)
    await expect(zeroPage.getByLabel(/Nível 1, Closer\./)).toBeVisible()
    await expect(zeroPage.getByRole('heading', { name: 'Sua Progressão' })).toBeVisible()
    await expect(zeroPage.getByText('0 XP total')).toBeVisible()
    await expect(zeroPage.getByText('Ainda não há atividade sua computada', { exact: false })).toBeVisible()
    // O grafico continua la, so que achatado em zero -- nao pode sumir.
    await expect(zeroPage.locator('.recharts-responsive-container')).toBeVisible()
    const zeroXTicks = await zeroPage.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents()
    assert.equal(zeroXTicks.length, 2, `esperava 2 pontos (inicio sintetico + hoje) mesmo sem historico, veio ${JSON.stringify(zeroXTicks)}`)
    if (process.env.LEVEL_UI_SCREENSHOT_DIR) {
      await zeroPage.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/metas-zerado.png`, fullPage: true })
    }
    assert.deepEqual(zeroErrors, [])
  } finally {
    await zeroContext.close()
  }

  // --- Terceiro cenario: arena_goal_history falha (reproduz o bug real de
  // producao -- "Filtro de histórico inválido" quando p_limit>50). O card
  // nao pode sumir inteiro so porque UMA das tres fontes deu erro; anel, XP
  // ao vivo e grafico continuam usando o que as outras duas ja tem.
  const brokenActor = 'ce220000-0000-4000-8000-000000000096'
  const brokenContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const brokenErrors = []
  await brokenContext.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await brokenContext.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const resource = url.pathname.split('/').at(-1)
    if (resource === 'arena_goal_history') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Filtro de histórico inválido', code: '22023' }) })
      return
    }
    let data = []
    if (resource === 'get_my_registration_status') data = { status: 'approved' }
    else if (resource === 'profiles') data = url.searchParams.has('user_id') ? { ...profile, id: brokenActor, user_id: brokenActor } : [{ ...profile, id: brokenActor, user_id: brokenActor }]
    else if (resource === 'user_roles') data = [{ ...role, id: brokenActor, user_id: brokenActor }]
    else if (resource === 'arena_visible_goals') data = visibleGoals.map((cycle) => ({ ...cycle, result: { ...cycle.result, members: cycle.result.members.map((member) => ({ ...member, user_id: brokenActor })) } }))
    else if (resource === 'activity_feed') data = activityRows
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await brokenContext.addInitScript(({ actor, project }) => {
    const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const session = {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', exp: 4102444800 })}.test`,
      refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer',
      user: { id: actor, email: 'broken-level@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Closer quebrado' }, created_at: new Date().toISOString() },
    }
    localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
  }, { actor: brokenActor, project })
  const brokenPage = await brokenContext.newPage()
  brokenPage.on('pageerror', (error) => brokenErrors.push(error.message))
  try {
    await brokenPage.goto(`${origin}/metas?tab=atribuicoes`)
    // O aviso de erro aparece, mas o card continua util: anel, XP ao vivo (80
    // do ciclo ativo) + XP de atividade (50) ainda contam, ja que so o
    // historico falhou -- 130 XP total, nao zero.
    await expect(brokenPage.getByRole('alert').filter({ hasText: 'Filtro de histórico inválido' })).toBeVisible()
    await expect(brokenPage.getByRole('heading', { name: 'Sua Progressão' })).toBeVisible()
    await expect(brokenPage.getByText('130 XP total')).toBeVisible()
    await expect(brokenPage.locator('.recharts-responsive-container')).toBeVisible()
    if (process.env.LEVEL_UI_SCREENSHOT_DIR) {
      await brokenPage.screenshot({ path: `${process.env.LEVEL_UI_SCREENSHOT_DIR}/metas-erro-parcial.png`, fullPage: true })
    }
  } finally {
    await brokenContext.close()
  }

  assert.deepEqual(errors, [])
  console.log('PASS: level badge shows beside notifications (not on Arena), Sua Progressão renders correct XP/level inside Metas, the chart always renders (even zeroed with no history), and a single failing source (e.g. history) shows a banner without blanking the whole card.')
} finally {
  await context.close()
  await browser.close()
}
