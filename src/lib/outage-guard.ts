// Disjuntor do cliente: quando o servidor está claramente sofrendo (rajada de erros de tempo-limite, 5xx, pool esgotado, rede), pausa as atualizações automáticas por
// alguns segundos em vez de martelar um banco que já não aguenta. Foi o que faltou em 22-23/10: com o banco lento, cada aba repetia todas as consultas ao mesmo tempo
// (3 tentativas cada), o que mantinha o banco saturado até alguém reiniciar o projeto.
//
// Não mexe em gravações (as ações da pessoa seguem sendo enviadas) nem em erros de regra (permissão, conflito de versão): só em sinais de sobrecarga.
// A lógica é pura (relógio, sorteio e temporizador injetáveis) para ser testada sem navegador.

const OVERLOAD_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524])
// PGRST000-003: sem conexão / pool esgotado / cache de schema; 57014: tempo-limite da consulta; 53300: conexões demais; 57P01/57P03: banco reiniciando; 08xxx: conexão; 55P03: trava.
const OVERLOAD_CODES = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014', '53300', '57P01', '57P03', '08000', '08003', '08006', '55P03'])
const OVERLOAD_TEXT = /timed? ?out|timeout|upstream request|gateway|temporarily unavailable|failed to fetch|networkerror|load failed|connection pool|too many connections|remaining connection slots/i

/** Sinal de que o SERVIDOR está sobrecarregado ou indisponível (e não de que a pessoa errou alguma coisa). */
export function isBackendOverload(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown; context?: { status?: unknown } }
  const status = Number(e.status ?? e.context?.status)
  if (OVERLOAD_STATUS.has(status)) return true
  if (typeof e.code === 'string' && OVERLOAD_CODES.has(e.code)) return true
  return OVERLOAD_TEXT.test(`${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : ''}`)
}

export interface OutageState { open: boolean; resumeAt: number | null; level: number }

export interface OutageGuardOptions {
  /** Liga/desliga as atualizações automáticas (React Query: onlineManager.setOnline). */
  setOnline: (online: boolean) => void
  windowMs?: number      // janela em que as falhas contam
  tripAfter?: number     // falhas dentro da janela para abrir o disjuntor
  minPauseMs?: number    // pausa da 1ª vez; dobra a cada reabertura seguida, até maxPauseMs
  maxPauseMs?: number
  now?: () => number
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export interface OutageGuard {
  recordFailure(error: unknown): void
  recordSuccess(): void
  getState(): OutageState
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createOutageGuard(options: OutageGuardOptions): OutageGuard {
  const windowMs = options.windowMs ?? 30_000
  const tripAfter = options.tripAfter ?? 5
  const minPauseMs = options.minPauseMs ?? 20_000
  const maxPauseMs = options.maxPauseMs ?? 120_000
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? Math.random
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  let failures: number[] = []
  let timer: unknown = null
  let state: OutageState = { open: false, resumeAt: null, level: 0 }

  const publish = (next: OutageState) => { state = next; for (const listener of [...listeners]) listener() }

  function resume() {
    timer = null
    failures = []
    // o nível só cai quando uma consulta volta a dar certo (recordSuccess); se falhar de novo logo em seguida, a próxima pausa é maior
    publish({ open: false, resumeAt: null, level: state.level })
    options.setOnline(true)
  }

  function trip() {
    const level = Math.min(state.level + 1, 6)
    const base = Math.min(minPauseMs * 2 ** (level - 1), maxPauseMs)
    const pause = Math.round(base + base * 0.5 * random())   // folga aleatória: as abas não voltam todas juntas
    failures = []
    publish({ open: true, resumeAt: now() + pause, level })
    options.setOnline(false)
    if (timer !== null) clearTimer(timer)
    timer = setTimer(resume, pause)
  }

  return {
    recordFailure(error) {
      if (state.open || !isBackendOverload(error)) return
      const t = now()
      failures = failures.filter(at => t - at <= windowMs)
      failures.push(t)
      if (failures.length >= tripAfter) trip()
    },
    recordSuccess() {
      failures = []
      if (!state.open && state.level !== 0) publish({ open: false, resumeAt: null, level: 0 })
    },
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { if (timer !== null) clearTimer(timer); timer = null; listeners.clear() },
  }
}

/**
 * `retry` do React Query: UMA nova tentativa (o padrão eram 3: com o banco lento, 12 consultas x 3 tentativas x N abas mantinham tudo saturado). Vale para qualquer erro,
 * para não mudar o que se resolve sozinho (ex.: renovação de sessão); a próxima releitura automática cobre o resto.
 */
export function retryPolicy(failureCount: number): boolean {
  return failureCount < 1
}

/** Espera antes da nova tentativa: 1,5 a 4 s (sorteio injetável para teste). */
export function retryDelayWith(random: () => number): number {
  return Math.round(1_500 + random() * 2_500)
}
/** `retryDelay` do React Query (recebe a tentativa e o erro; não usa nenhum dos dois). */
export function retryDelay(_attempt: number, _error?: unknown): number {
  return retryDelayWith(Math.random)
}
