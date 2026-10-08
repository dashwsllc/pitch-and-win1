// Uma renovação de login que falha por erro do servidor (HTTP 500, queda de conexão) não é motivo para deslogar ninguém, mas o
// supabase-js trata toda falha de renovação, exceto 502/503/504 e falha de rede, como "a sessão morreu" e apaga o login guardado.
// Aqui a renovação é tentada de novo algumas vezes antes de a biblioteca ver a falha. A janela de reuso do refresh token no
// servidor (10 s) torna a nova tentativa segura mesmo quando a primeira já tinha sido processada. Se o servidor insistir no erro,
// a biblioteca recebe "indisponível" (503), que ela trata como temporário: o login é mantido e a renovação segue tentando.
// Só uma resposta definitiva de recusa (400, 401, 403) encerra o login.

/** Esperas antes de cada nova tentativa: no máximo ~4,6 s no total, menos que a janela de reuso do refresh token. */
export const TOKEN_REFRESH_RETRY_DELAYS_MS = [400, 1200, 3000]

/** Falhas que a própria biblioteca já trata como temporárias (ela mantém o login e tenta de novo). */
const LIBRARY_RETRYABLE_STATUSES = [502, 503, 504]

export function isTokenRefreshRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return /\/auth\/v1\/token\?(?:[^#]*&)?grant_type=refresh_token(?:&|$|#)/.test(url)
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Embrulha o fetch do cliente: só a renovação de login ganha novas tentativas; qualquer outra chamada passa direto. */
export function withTokenRefreshRetry(
  baseFetch: typeof fetch,
  sleep: (ms: number) => Promise<void> = wait,
): typeof fetch {
  return async (input, init) => {
    if (!isTokenRefreshRequest(input)) return baseFetch(input, init)
    for (let attempt = 0; ; attempt++) {
      const lastAttempt = attempt >= TOKEN_REFRESH_RETRY_DELAYS_MS.length
      try {
        const response = await baseFetch(input, init)
        if (response.status < 500) return response
        if (lastAttempt) {
          return LIBRARY_RETRYABLE_STATUSES.includes(response.status)
            ? response
            : new Response(response.body, { status: 503, statusText: 'Service Unavailable', headers: response.headers })
        }
        void response.body?.cancel().catch(() => undefined)
      } catch (error) {
        if (lastAttempt || init?.signal?.aborted) throw error
      }
      await sleep(TOKEN_REFRESH_RETRY_DELAYS_MS[attempt])
    }
  }
}
