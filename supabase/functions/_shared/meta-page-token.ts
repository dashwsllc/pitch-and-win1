import { metaGraphGet, MetaGraphError, isAuthError, type GraphBudget } from './meta-graph.ts'

export type LeadPageTokenResolver = (pageId: string, budget: GraphBudget) => Promise<string>

// Request-scoped and lazy: an empty queue never calls Graph. No credential is
// persisted in discovery state, receipts, operation logs or HTTP responses.
export function createLeadPageTokenResolver(pageIds: string[], pageToken: string | null, systemToken: string | null): LeadPageTokenResolver {
  const resolved = new Map<string, Promise<string>>()
  const resolve = async (pageId: string, budget: GraphBudget): Promise<string> => {
    if (!pageIds.includes(pageId)) throw new Error('Página fora da lista META_PAGE_IDS autorizada')
    if (pageToken) {
      try {
        const identity = await metaGraphGet<{ id: string }>('/me', { fields: 'id' }, pageToken, budget)
        if (identity.id === pageId) return pageToken
        if (!systemToken) throw new Error('META_PAGE_ACCESS_TOKEN não corresponde à Página autorizada')
      } catch (error) {
        if (!(error instanceof MetaGraphError) || !isAuthError(error)) throw error
        if (!systemToken) throw new MetaGraphError(error.code, error.subcode, 'Token da Página inválido ou expirado; atualize META_PAGE_ACCESS_TOKEN ou configure META_SYSTEM_USER_TOKEN para recuperação automática')
      }
    }
    if (!systemToken) throw new Error('Token de acesso da Meta não configurado')
    const page = await metaGraphGet<{ id: string; access_token?: string }>(`/${pageId}`, { fields: 'id,access_token' }, systemToken, budget)
    if (page.id !== pageId || typeof page.access_token !== 'string' || !page.access_token.trim()) {
      throw new Error('A Meta não devolveu um token para a Página autorizada; confira os ativos e permissões do usuário de sistema')
    }
    return page.access_token
  }
  return (pageId, budget) => {
    if (!resolved.has(pageId)) resolved.set(pageId, resolve(pageId, budget))
    return resolved.get(pageId)!
  }
}
