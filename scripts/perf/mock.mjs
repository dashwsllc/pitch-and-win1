// Fake Supabase backend for benchmarking. Nothing here talks to a real server:
// the bench bundle is built against https://benchmock.supabase.co and every request
// to that host is fulfilled from these fixtures inside Playwright.

export const MOCK_HOST = 'benchmock.supabase.co'
export const STORAGE_KEY = 'sb-benchmock-auth-token'
export const USER_ID = '00000000-0000-4000-8000-000000000001'

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
export function fakeJwt(exp) {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 })}.fake-signature`
}

export function fakeSession(nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + 24 * 3600
  return {
    access_token: fakeJwt(exp),
    token_type: 'bearer',
    expires_in: 24 * 3600,
    expires_at: exp,
    refresh_token: 'bench-refresh-token',
    user: fakeUser(),
  }
}

function fakeUser() {
  return {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'bench@example.test',
    email_confirmed_at: '2026-01-01T00:00:00Z', phone: '', app_metadata: { provider: 'email' },
    user_metadata: { display_name: 'Bench Admin' }, identities: [{ id: USER_ID }],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

const brasiliaKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export function buildFixtures({ sales = 900, approaches = 3000, days = 60, role = 'super_admin', seed = 7, now = new Date() } = {}) {
  const r = rng(seed)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const iso = (d) => new Date(d).toISOString()
  const nowMs = now.getTime()
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  const names = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Rocha', 'Elisa Prado', 'Felipe Nunes', 'Gabi Torres', 'Hugo Matos', 'Iara Melo', 'João Pires', 'Karen Alves', 'Lucas Reis']
  const users = names.map((name, i) => ({ id: uuid(i + 2), name }))
  const me = { id: USER_ID, name: 'Bench Admin' }
  const allUsers = [me, ...users]
  const closers = users.slice(0, 7)
  const sdrs = users.slice(7)

  const products = [
    { id: uuid(9001), nome: 'Mentoria Elite', valor: 4997 }, { id: uuid(9002), nome: 'Curso Pro', valor: 1497 },
    { id: uuid(9003), nome: 'Consultoria VIP', valor: 2997 }, { id: uuid(9004), nome: 'Plano Start', valor: 497 },
    { id: uuid(9005), nome: 'Imersão Presencial', valor: 3497 }, { id: uuid(9006), nome: 'Comunidade Anual', valor: 997 },
  ]

  const profiles = allUsers.map((u, i) => ({
    id: uuid(3000 + i), user_id: u.id, display_name: u.name, avatar_url: null, suspended: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', last_seen_at: iso(nowMs - 60_000), status: 'approved',
  }))

  const roleRows = [
    { id: uuid(4000), user_id: USER_ID, role, crm_access: true, crm_closer_access: true, commission_rate: 10, can_view_sales: true, updated_at: '2026-01-01T00:00:00Z' },
    ...closers.map((u, i) => ({ id: uuid(4001 + i), user_id: u.id, role: 'closer', crm_access: true, crm_closer_access: true, commission_rate: 10, can_view_sales: false, updated_at: '2026-01-01T00:00:00Z' })),
    ...sdrs.map((u, i) => ({ id: uuid(4100 + i), user_id: u.id, role: 'sdr', crm_access: true, crm_closer_access: false, commission_rate: 10, can_view_sales: false, updated_at: '2026-01-01T00:00:00Z' })),
  ]

  const vendas = []
  for (let i = 0; i < sales; i++) {
    const seller = pick(closers)
    const product = pick(products)
    const at = nowMs - Math.floor(r() * days * 86400_000) - (i < 25 ? 0 : 0)
    const status = r() < 0.86 ? 'aprovada' : r() < 0.7 ? 'pendente' : 'rejeitada'
    vendas.push({
      id: uuid(10_000 + i), user_id: seller.id, nome_produto: product.nome, valor_venda: product.valor,
      approval_status: status, created_at: iso(at), updated_at: iso(at), reviewed_at: status === 'pendente' ? null : iso(at + 3600_000),
      nome_comprador: `Cliente ${i}`, email_comprador: `cliente${i}@example.test`, whatsapp_comprador: '11999990000',
      commission_amount: product.valor * 0.1, withdrawn: false, withdrawal_id: null, consideracoes_gerais: null,
    })
  }
  // A few sales today so the default "hoje" filter shows data.
  for (let i = 0; i < 14; i++) {
    const seller = pick(closers); const product = pick(products); const at = nowMs - Math.floor(r() * 10 * 3600_000)
    vendas.push({
      id: uuid(20_000 + i), user_id: seller.id, nome_produto: product.nome, valor_venda: product.valor, approval_status: 'aprovada',
      created_at: iso(at), updated_at: iso(at), reviewed_at: iso(at + 600_000), nome_comprador: `Hoje ${i}`, email_comprador: `hoje${i}@example.test`,
      whatsapp_comprador: '11988880000', commission_amount: product.valor * 0.1, withdrawn: false, withdrawal_id: null, consideracoes_gerais: null,
    })
  }
  vendas.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))

  const abordagens = []
  for (let i = 0; i < approaches; i++) {
    const u = pick([...closers, ...sdrs]); const at = nowMs - Math.floor(r() * days * 86400_000)
    abordagens.push({ id: uuid(30_000 + i), user_id: u.id, created_at: iso(at), mostrou_ia: i % 5 < 3 })
  }
  for (let i = 0; i < 60; i++) {
    const u = pick([...closers, ...sdrs]); const at = nowMs - Math.floor(r() * 10 * 3600_000)
    abordagens.push({ id: uuid(50_000 + i), user_id: u.id, created_at: iso(at), mostrou_ia: i % 5 < 3 })
  }
  abordagens.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))

  const today = brasiliaKey(now)
  const dailyTasks = Array.from({ length: 5 }, (_, i) => ({
    id: uuid(60_000 + i), assignee_id: USER_ID, task_date: today, title: `Tarefa do dia ${i + 1}`, is_completed: i < 2, completed_at: i < 2 ? iso(nowMs - 3600_000) : null,
    deadline_at: null, position: i, version: 1, created_at: iso(nowMs - 7200_000), updated_at: iso(nowMs - 3600_000),
  }))

  const activity = Array.from({ length: 260 }, (_, i) => ({
    score_delta: 5 + Math.floor(r() * 30), action_type: pick(['sale.approved', 'lead.approached', 'closing.performed', 'q.performed']),
    occurred_at: iso(nowMs - Math.floor(r() * 40 * 86400_000)), responsible_id: USER_ID, id: uuid(70_000 + i),
  }))

  const money = (n) => Math.round(n * 100) / 100
  const closerRanking = closers.map((u, i) => ({
    user_id: u.id, name: u.name, avatarUrl: null, totalVendas: money(90000 - i * 9000 + r() * 3000),
    quantidadeVendas: 40 - i * 4, abordagens: 300 - i * 20, conversao: money(12 - i * 0.7),
  }))
  const sdrRanking = sdrs.map((u, i) => ({
    user_id: u.id, name: u.name, avatarUrl: null, totalLeads: 200 - i * 20, leadsAbordados: 180 - i * 20, abordagens: 240 - i * 25,
    repasses: 30 - i * 4, vendasOriginadas: 12 - i * 2, receitaOriginada: money(40000 - i * 6000), conversao: money(9 - i),
  }))
  const dailyCalls = {
    day: today, sdrCalls: 22, closerCalls: 31,
    ranking: [...sdrs, ...closers].map((u, i) => ({ user_id: u.id, name: u.name, avatarUrl: null, sdrCalls: i < 5 ? 6 - i : 0, closerCalls: i >= 5 ? 9 - (i - 5) : 0, total: 9 - (i % 9) })),
  }

  const cycles = ['daily', 'weekly', 'monthly'].map((period, i) => ({
    id: uuid(80_000 + i), goal_id: uuid(81_000 + i), title: `Meta ${period}`, period, scope: 'role', role: 'closer', metric: 'revenue',
    starts_at: iso(nowMs - 86400_000 * (i + 1)), ends_at: iso(nowMs + 86400_000 * (i + 1)), show_countdown: true,
    result: { actual: 40000 + i * 9000, target: 80000, state: 'on_track', members: closers.map((u) => ({ user_id: u.id, display_name: u.name, avatar_url: null, suspended: false, actual: 5000, target: 10000, state: 'on_track' })) },
  }))

  const history = { items: Array.from({ length: 30 }, (_, i) => ({
    id: uuid(82_000 + i), user_id: USER_ID, outcome: i % 3 ? 'achieved' : 'failed', scope: 'user', target_role: 'closer', title: `Ciclo ${i}`,
    period: 'daily', metric: 'revenue', actual: 1000 + i, target: 900, starts_at: iso(nowMs - 86400_000 * (i + 2)), ends_at: iso(nowMs - 86400_000 * (i + 1)),
  })), total: 30 }

  const salesBoardItems = vendas.filter((v) => v.approval_status === 'aprovada').slice(-40).reverse().map((v) => ({
    ...v, seller_name: allUsers.find((u) => u.id === v.user_id)?.name ?? 'Vendedor', seller_avatar: null, ticket_name: null, reviewer_name: 'Bench Admin',
  }))

  const assignees = allUsers.map((u) => ({ user_id: u.id, display_name: u.name, avatar_url: null, suspended: false, arena_hidden: false, roles: u.id === USER_ID ? [role] : closers.includes(u) ? ['closer'] : ['sdr'] }))

  const arenaMetrics = { revenue: 480000, sales: 120, ticket: 4000, conversion: 11.5, cpl: 12.4, appointments: 210, approaches: 1500, spend: 15000, leads: 1200 }
  const arenaDashboard = {
    server_time: iso(nowMs), revision: 1, metrics: arenaMetrics, previous: { ...arenaMetrics, revenue: 430000 },
    series: Array.from({ length: 30 }, (_, i) => ({ at: iso(nowMs - (29 - i) * 86400_000), revenue: 10000 + i * 300, sales: 3 + (i % 5), appointments: 5 + (i % 7) })),
    cycles, feed: activity.slice(0, 20).map((a, i) => ({ id: a.id, action_type: a.action_type, responsible_id: USER_ID, responsible_name: 'Bench Admin', responsible_role: role, score_delta: a.score_delta, revenue_delta: 0, occurred_at: a.occurred_at, provenance: 'live', lead_id: i % 2 ? null : uuid(1) })),
    sdrs: sdrs.map((u, i) => ({ user_id: u.id, name: u.name, avatarUrl: null, suspended: false, score: 300 - i * 20, repasses: 5, scheduled: 9, performed: 7, cancelled: 1, no_handoff: 1 })),
    closers: closers.map((u, i) => ({ user_id: u.id, name: u.name, avatarUrl: null, suspended: false, score: 500 - i * 30, totalVendas: 90000 - i * 9000, quantidadeVendas: 40 - i * 4 })),
    ticket_reference: 4000,
  }

  const crmLeads = Array.from({ length: 180 }, (_, i) => ({
    id: uuid(90_000 + i), owner_id: pick(closers).id, created_by: USER_ID, name: `Lead ${i} Silva`, email: `lead${i}@example.test`, phone: '11977770000',
    stage: pick(['novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'fechado']), source: 'meta', created_at: iso(nowMs - Math.floor(r() * 20 * 86400_000)),
    updated_at: iso(nowMs - Math.floor(r() * 5 * 86400_000)), status: 'open', product_interest: pick(products).nome, value: pick(products).valor,
  }))

  // Calls do CRM (crm_activities): qualificação, do SDR, e fechamento, do Closer. "Feita" é a que tem presença registrada
  // (performed_at) e não foi cancelada, a mesma regra da Arena; aqui também há calls só marcadas e canceladas, que o
  // painel não pode contar. Gerador próprio, depois de tudo: as outras fixtures continuam idênticas.
  const rc = rng(seed + 1000)
  const escolher = (arr) => arr[Math.floor(rc() * arr.length)]
  const call = (n, { pessoa, qualificacao, marcadaMs, estado }) => {
    const feita = estado === 'feita'
    const cancelada = estado === 'cancelada'
    const feitaMs = Math.min(nowMs - 60_000, marcadaMs + Math.floor(rc() * 3 * 3600_000))
    const fimMs = feita ? feitaMs : marcadaMs + 1800_000
    return {
      id: uuid(95_000 + n), lead_id: escolher(crmLeads).id, user_id: qualificacao ? pessoa.id : escolher(sdrs).id, assigned_to: pessoa.id,
      activity_type: 'call', call_type: qualificacao ? 'qualificacao' : 'fechamento_closer', title: qualificacao ? 'Call de qualificação' : 'Call de fechamento',
      description: null, author_name: null, scheduled_at: iso(marcadaMs + 3600_000), created_at: iso(marcadaMs), updated_at: iso(feita || cancelada ? fimMs : marcadaMs),
      is_completed: feita || cancelada, completed_at: feita || cancelada ? iso(fimMs) : null,
      outcome: feita ? (qualificacao ? 'avancou' : 'venda_perdida') : cancelada ? 'followup' : null,
      performed_at: feita ? iso(feitaMs) : null, performed_by: feita ? pessoa.id : null,
      cancelled_at: cancelada ? iso(fimMs) : null, cancelled_by: cancelada ? pessoa.id : null, cancellation_reason: cancelada ? 'Cliente pediu para remarcar' : null,
      is_pinned: false, previous_state: null, new_state: null,
    }
  }
  const estadoDaCall = () => (rc() < 0.72 ? 'feita' : rc() < 0.5 ? 'cancelada' : 'marcada')
  const crmActivities = []
  for (let i = 0; i < Math.round(approaches / 5); i++) {
    const qualificacao = rc() < 0.55
    const pessoa = rc() < 0.05 ? me : escolher(qualificacao ? sdrs : closers)
    crmActivities.push(call(i, { pessoa, qualificacao, marcadaMs: nowMs - Math.floor(rc() * days * 86400_000), estado: estadoDaCall() }))
  }
  // Algumas hoje (o filtro padrão é "Hoje"), seis delas da própria pessoa logada (o vendedor só vê as suas).
  for (let i = 0; i < 24; i++) {
    const qualificacao = rc() < 0.5
    const pessoa = i < 6 ? me : escolher(qualificacao ? sdrs : closers)
    crmActivities.push(call(10_000 + i, { pessoa, qualificacao, marcadaMs: nowMs - Math.floor(rc() * 9 * 3600_000), estado: i % 4 === 3 ? 'marcada' : 'feita' }))
  }
  crmActivities.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))

  return {
    today, users: allUsers, closers, sdrs,
    tables: {
      profiles, user_roles: roleRows, vendas, abordagens, products: products.map((p) => ({ id: p.id, nome: p.nome, valor: p.valor, ativo: true, active: true, name: p.nome, price: p.valor })),
      daily_goal_tasks: dailyTasks, activity_feed: activity, arena_notifications: [], crm_leads: crmLeads, crm_activities: crmActivities, crm_lead_contexts: [],
      saques: [], assinaturas: [], meta_ad_accounts: [], meta_sync_runs: [], meta_traffic_daily: [], meta_import_batches: [], meta_lead_import_batches: [],
      meta_form_leads: [], meta_webhook_events: [], traffic_suggestions: [], traffic_suggestion_replies: [], executive_audit_events: [], password_reset_requests: [],
    },
    dashboardEvents: [{ topic: 'sales', revision: 100 }, { topic: 'approaches', revision: 200 }, { topic: 'crm', revision: 300 }],
    rpc: {
      get_my_registration_status: () => ({ status: 'approved' }),
      crm_can_schedule_qualification_call: () => true,
      get_team_ranking: () => closerRanking,
      get_sdr_ranking: () => sdrRanking,
      get_daily_call_ranking: () => dailyCalls,
      get_sales_board: (args) => {
        const status = args?.p_status ?? 'aprovada'
        const size = Math.min(Number(args?.p_page_size ?? 12), salesBoardItems.length)
        const items = salesBoardItems.filter((s) => status === 'todas' || s.approval_status === status).slice(Number(args?.p_page ?? 0) * size, (Number(args?.p_page ?? 0) + 1) * size)
        return { items, total: salesBoardItems.length, summary: { pending: 6, approved: salesBoardItems.length, rejected: 3, pending_value: 15000, approved_value: 300000, overdue: 1 }, fetched_at: iso(nowMs) }
      },
      arena_visible_goals: () => cycles,
      arena_goal_history: () => history,
      arena_shift_approach_progress: () => [{ id: uuid(83_000), assignee_id: USER_ID, display_name: 'Bench Admin', title: 'Turno manhã', target_approaches: 60, approach_source: 'crm', actual: 34, starts_at: iso(nowMs - 3 * 3600_000), ends_at: iso(nowMs + 5 * 3600_000), created_at: iso(nowMs - 4 * 3600_000), cancelled_at: null }],
      arena_live_cursor: () => iso(nowMs),
      arena_revision: () => 1,
      arena_dashboard: () => arenaDashboard,
      arena_assignees: () => assignees,
      arena_score_weights: () => [],
      arena_management: () => ({ items: [], total: 0 }),
      executive_list_users: () => ({ users: [], fetched_at: iso(nowMs) }),
      executive_list_registration_requests: () => [],
      get_available_balance: () => 12500,
      get_pending_commission: () => 3400,
      crm_call_assignees: () => [],
      crm_result_sale_links: () => [],
      meta_traffic_lead_reconciliation: () => [],
      meta_crm_attribution_daily: () => [],
    },
  }
}

// ---- Minimal PostgREST query engine ----
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
function matchFilter(row, col, spec) {
  const v = row[col]
  const [op, ...rest] = spec.split('.')
  const val = rest.join('.')
  const num = (x) => (typeof v === 'number' ? Number(x) : x)
  switch (op) {
    case 'eq': return String(v) === val
    case 'neq': return String(v) !== val
    case 'gt': return cmp(v, num(val)) > 0
    case 'gte': return cmp(v, num(val)) >= 0
    case 'lt': return cmp(v, num(val)) < 0
    case 'lte': return cmp(v, num(val)) <= 0
    case 'is': return val === 'null' ? v == null : String(v) === val
    case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v))
    case 'like': case 'ilike': return new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', op === 'ilike' ? 'i' : '').test(String(v ?? ''))
    case 'not': return !matchFilter(row, col, val)
    default: return true
  }
}

export function queryTable(rows, params) {
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'])
  let out = rows
  for (const [key, value] of params.entries()) {
    if (reserved.has(key)) continue
    out = out.filter((row) => matchFilter(row, key, value))
  }
  const order = params.getAll('order').flatMap((s) => s.split(','))
  if (order.length) {
    out = [...out].sort((a, b) => {
      for (const o of order) {
        const [col, dir = 'asc'] = o.split('.')
        const c = cmp(a[col], b[col])
        if (c) return dir === 'desc' ? -c : c
      }
      return 0
    })
  }
  const total = out.length
  const offset = Number(params.get('offset') ?? 0)
  const limit = params.has('limit') ? Number(params.get('limit')) : undefined
  out = out.slice(offset, limit === undefined ? undefined : offset + limit)
  return { rows: out, total, offset }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': 'content-range, content-type',
}

export function installMock(context, fixtures, { onRequest, latencyMs = 70, ws = 'normal', wsJoinDelayMs = 0 } = {}) {
  const stats = { requests: [], ws: { opened: 0, messages: [] } }
  const f = fixtures
  const wsClients = new Set()
  const jitter = rng(99)
  const delay = () => new Promise((r) => setTimeout(r, latencyMs * (0.6 + jitter() * 0.8)))

  const json = (route, body, status = 200, extra = {}) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) })

  context.route(`https://${MOCK_HOST}/**`, async (route, request) => {
    const url = new URL(request.url())
    const method = request.method()
    const record = { t: Date.now(), method, path: url.pathname, query: url.search.slice(0, 160) }
    stats.requests.push(record)
    onRequest?.(record)
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (latencyMs > 0) await delay()

    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user')) return json(route, fakeUser())
      if (url.pathname.endsWith('/token')) return json(route, fakeSession())
      if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: CORS })
      return json(route, {})
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()
      record.kind = 'rpc'; record.name = name
      let args = {}
      try { args = method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse(request.postData() || '{}') } catch { /* ignore */ }
      const fn = f.rpc[name]
      if (!fn) { record.unmocked = true; return json(route, null) }
      return json(route, fn(args))
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()
      record.kind = 'rest'; record.name = table
      if (method !== 'GET' && method !== 'HEAD') return json(route, [], method === 'POST' ? 201 : 200)
      const source = table === 'dashboard_events' ? f.dashboardEvents : f.tables[table]
      if (!source) { record.unmocked = true }
      const { rows, total, offset } = queryTable(source ?? [], url.searchParams)
      const prefer = request.headers()['prefer'] ?? ''
      const range = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`
      const headers = prefer.includes('count=') ? { 'content-range': range } : {}
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, ...headers } })
      if ((request.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1) return json(route, { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406)
        return json(route, rows[0], 200, headers)
      }
      return json(route, rows, 200, headers)
    }

    record.kind = 'other'
    return json(route, {}, 404)
  })

  // Realtime: speak just enough Phoenix so channels reach SUBSCRIBED.
  context.routeWebSocket(new RegExp(`${MOCK_HOST.replace(/\./g, '\\.')}/realtime/`), (ws_) => {
    stats.ws.opened += 1
    if (ws === 'closed') { ws_.close(); return }
    const client = { ws: ws_, bindings: new Map(), v2: false }
    wsClients.add(client)
    ws_.onClose(() => wsClients.delete(client))
    ws_.onMessage(async (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (latencyMs > 0) await delay()
      let joinRef, ref, topic, event, payload
      if (Array.isArray(msg)) { client.v2 = true; [joinRef, ref, topic, event, payload] = msg } else ({ ref, topic, event, payload } = msg)
      stats.ws.messages.push({ t: Date.now(), topic, event })
      const send = (t, e, p, r = ref) => ws_.send(JSON.stringify(client.v2 ? [joinRef ?? null, r, t, e, p] : { topic: t, event: e, payload: p, ref: r, join_ref: joinRef }))
      if (event === 'heartbeat') return send('phoenix', 'phx_reply', { status: 'ok', response: {} })
      if (event === 'phx_join') {
        if (wsJoinDelayMs) await new Promise((r) => setTimeout(r, wsJoinDelayMs))
        const changes = (payload?.config?.postgres_changes ?? []).map((c, i) => ({ ...c, id: Number(`${Math.abs(hash(topic))}${i}`.slice(0, 9)) }))
        client.bindings.set(topic, changes)
        return send(topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } })
      }
      if (event === 'phx_leave') return send(topic, 'phx_reply', { status: 'ok', response: {} })
      if (event === 'access_token') return send(topic, 'phx_reply', { status: 'ok', response: {} })
      return undefined
    })
  })

  // Push a postgres_changes event to every subscribed channel that listens to it.
  function emitChange({ table, type = 'UPDATE', record = {} }) {
    let delivered = 0
    for (const client of wsClients) {
      for (const [topic, changes] of client.bindings) {
        const ids = changes.filter((c) => c.table === table && (c.event === '*' || c.event === type)).map((c) => c.id)
        if (!ids.length) continue
        const data = { schema: 'public', table, commit_timestamp: new Date().toISOString(), type, columns: [], record, old_record: {}, errors: null }
        const payload = { ids, data }
        client.ws.send(JSON.stringify(client.v2 ? [null, null, topic, 'postgres_changes', payload] : { topic, event: 'postgres_changes', payload, ref: null }))
        delivered += 1
      }
    }
    return delivered
  }
  function bumpRevision(topic = 'sales') {
    const row = f.dashboardEvents.find((e) => e.topic === topic) ?? f.dashboardEvents[0]
    row.revision += 1
    return emitChange({ table: 'dashboard_events', type: 'UPDATE', record: { ...row } })
  }

  function touchRevision(topic = 'sales') {
    const row = f.dashboardEvents.find((e) => e.topic === topic) ?? f.dashboardEvents[0]
    row.revision += 1
  }
  return { stats, emitChange, bumpRevision, touchRevision }
}

function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h }
