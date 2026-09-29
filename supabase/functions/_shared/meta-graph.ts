// Cliente minimo para a Graph API da Meta (Marketing API + Lead Ads).
// GRAPH_API_VERSION nao pode ser validada sem um Meta App real - confirmar
// contra a documentacao atual antes de ativar a sincronizacao em producao.
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

async function metaGraphFetch<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json()
  if (!response.ok || body.error) {
    const err = body.error || {}
    throw new MetaGraphError(err.code ?? response.status, err.error_subcode, err.message || 'Falha na Graph API')
  }
  return body as T
}

export async function metaGraphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('access_token', token)
  return metaGraphFetch<T>(url.toString())
}

interface GraphPaging { paging?: { next?: string } }

export async function fetchAllPages<T extends GraphPaging & { data: unknown[] }>(
  path: string, params: Record<string, string>, token: string, maxPages = 20,
): Promise<T['data']> {
  let page = await metaGraphGet<T>(path, params, token)
  const rows: T['data'] = [...page.data]
  let pages = 1
  while (page.paging?.next && pages < maxPages) {
    page = await metaGraphFetch<T>(page.paging.next)
    rows.push(...page.data)
    pages += 1
  }
  return rows
}

export interface MetaAction { action_type: string; value: string }

export function sumActions(actions: MetaAction[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0
  return actions.filter(action => types.includes(action.action_type))
    .reduce((total, action) => total + (Number(action.value) || 0), 0)
}

// Mapeamento documentado publicamente pela Meta para os tipos de acao mais comuns.
// NAO validado contra a conta real do usuario - confirmar contra o Ads Manager
// (mesmo periodo/janela de atribuicao) antes de confiar no numero para decisao
// de investimento. Ajustar aqui se a conta usar outro action_type.
export const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']
export const PURCHASE_ACTION_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']
export const MESSAGING_ACTION_TYPES = ['onsite_conversion.messaging_conversation_started_7d']
