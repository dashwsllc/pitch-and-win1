// Credentials exist only at the outbound boundary. Stored cursors never contain them.
export const GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') || 'v23.0'
export const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export class MetaGraphError extends Error {
  code: number
  subcode?: number
  constructor(code: number, subcode: number | undefined, message: string) {
    super(message)
    this.code = code
    this.subcode = subcode
  }
}

export function isAuthError(error: MetaGraphError) { return error.code === 190 }
export function isRateLimitError(error: MetaGraphError) { return [4, 17, 32, 613, 80004].includes(error.code) }
export function isPermissionError(error: MetaGraphError) { return [10, 200, 272, 299].includes(error.code) }

export function describeMetaGraphError(error: MetaGraphError): string {
  if (isAuthError(error)) return `Token da Meta inválido ou expirado (${error.message}). Gere um novo System User Token.`
  if (isRateLimitError(error)) return `Limite de requisições da Meta atingido (${error.message}). Tentará novamente no próximo ciclo.`
  if (isPermissionError(error)) return `Permissão insuficiente na Meta (${error.message}). Confira ads_read/leads_retrieval no Usuário de Sistema.`
  return `Erro da Graph API (código ${error.code}): ${error.message}`
}

export interface MetaGraphRequest { path: string; params: Record<string, string> }
export interface GraphBudget { deadlineMs: number; signal?: AbortSignal }
const secretKeys = new Set(['access_token', 'appsecret_proof'])
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function requestUrl(request: MetaGraphRequest, token: string) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(request.path) || request.path.includes('..')) throw new Error('Caminho Graph inválido')
  const url = new URL(`${GRAPH_BASE_URL}${request.path}`)
  for (const [key, value] of Object.entries(request.params)) if (!secretKeys.has(key.toLowerCase())) url.searchParams.set(key, value)
  url.searchParams.set('access_token', token)
  return url
}
async function requestGraph<T>(request: MetaGraphRequest, token: string, budget: GraphBudget): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = budget.deadlineMs - Date.now()
    if (remaining <= 0 || budget.signal?.aborted) throw new Error('Orçamento de captura esgotado')
    const controller = new AbortController()
    const abort = () => controller.abort()
    budget.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, Math.min(8000, remaining))
    let retryMs = [500, 1000][attempt] ?? 1000
    let failure: Error
    let retry = false
    try {
      const response = await fetch(requestUrl(request, token), { signal: controller.signal })
      const body = await response.json()
      if (response.ok && !body.error) return body as T
      const err = body.error || {}
      const message = String(err.message || 'Falha na Graph API').replaceAll(token, '[credencial]').replaceAll(encodeURIComponent(token), '[credencial]')
      failure = new MetaGraphError(err.code ?? response.status, err.error_subcode, message)
      retry = response.status === 429 || response.status >= 500 || isRateLimitError(failure as MetaGraphError)
      const header = response.headers.get('retry-after')
      if (header) retryMs = Math.max(retryMs, /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now())
    } catch (error) {
      failure = new Error(controller.signal.aborted ? 'Timeout da Graph API' : 'Falha de rede da Graph API')
      retry = error instanceof TypeError || controller.signal.aborted
    } finally {
      clearTimeout(timer)
      budget.signal?.removeEventListener('abort', abort)
    }
    if (!retry || attempt === 2 || !Number.isFinite(retryMs) || Date.now() + retryMs >= budget.deadlineMs) throw failure!
    await pause(retryMs)
  }
  throw new Error('Falha da Graph API')
}
export async function metaGraphGet<T>(path: string, params: Record<string, string>, token: string, budget: GraphBudget = { deadlineMs: Date.now() + 25000 }): Promise<T> {
  return requestGraph<T>({ path, params }, token, budget)
}
export async function fetchGraphPage<T>(request: MetaGraphRequest, token: string, budget: GraphBudget): Promise<{ data: T[]; next: MetaGraphRequest | null }> {
  const page = await requestGraph<{ data: T[]; paging?: { next?: string } }>(request, token, budget)
  if (!Array.isArray(page.data)) throw new Error('Graph retornou dados inválidos')
  let next: MetaGraphRequest | null = null
  if (page.paging?.next) {
    let url: URL
    try { url = new URL(page.paging.next) } catch { throw new Error('URL de paginação inválida') }
    if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com' || url.port || url.username || url.password
      || url.pathname !== `/${GRAPH_API_VERSION}${request.path}`) throw new Error('URL de paginação fora do escopo')
    const params = { ...request.params }
    for (const [key, value] of url.searchParams) if (!secretKeys.has(key.toLowerCase())) params[key] = value
    for (const key of Object.keys(params)) if (secretKeys.has(key.toLowerCase())) delete params[key]
    if (!params.after && !params.before) throw new Error('Cursor de paginação ausente')
    for (const [key, value] of Object.entries(request.params)) if (!['after', 'before'].includes(key) && params[key] !== value) throw new Error('Escopo de paginação alterado')
    next = { path: request.path, params }
  }
  return { data: page.data, next }
}

interface GraphPaging { paging?: { next?: string } }

export async function fetchAllPages<T extends GraphPaging & { data: unknown[] }>(
  path: string, params: Record<string, string>, token: string, maxPages = 20,
): Promise<T['data']> {
  const rows: unknown[] = []
  let request: MetaGraphRequest | null = { path, params }
  const seen = new Set<string>()
  const budget = { deadlineMs: Date.now() + 45000 }
  for (let pageNo = 0; request && pageNo < maxPages; pageNo++) {
    const key = JSON.stringify(request)
    if (seen.has(key)) throw new Error('Cursor de paginação repetido; captura incompleta')
    seen.add(key)
    const page: { data: unknown[]; next: MetaGraphRequest | null } = await fetchGraphPage(request, token, budget)
    rows.push(...page.data)
    request = page.next
  }
  if (request) throw new Error('Limite de páginas atingido; captura incompleta')
  return rows as T['data']
}

export interface MetaAction { action_type: string; value: string }

export function selectCanonicalAction(actions: MetaAction[] | undefined, types: readonly string[]): { actionType: string | null; value: number | null } {
  if (!Array.isArray(actions)) return { actionType: null, value: null }
  for (const type of types) {
    const matching = actions.filter(action => action.action_type === type)
    if (!matching.length) continue
    if (matching.length !== 1 || !/^\d+(\.\d+)?$/.test(matching[0].value)) throw new Error(`Ação Meta inválida: ${type}`)
    const value = Number(matching[0].value)
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`Valor Meta inválido: ${type}`)
    return { actionType: type, value }
  }
  return { actionType: null, value: null }
}
// Existing callers retain their interface; aliases are alternatives, never a sum.
export function sumActions(actions: MetaAction[] | undefined, types: string[]): number { return selectCanonicalAction(actions, types).value ?? 0 }

// Mapeamento documentado publicamente pela Meta para os tipos de acao mais comuns.
// NAO validado contra a conta real do usuario - confirmar contra o Ads Manager
// (mesmo periodo/janela de atribuicao) antes de confiar no numero para decisao
// de investimento. Ajustar aqui se a conta usar outro action_type.
export const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']
export const PURCHASE_ACTION_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']
export const MESSAGING_ACTION_TYPES = ['onsite_conversion.messaging_conversation_started_7d']
