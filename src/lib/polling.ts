// Cadência das atualizações automáticas das telas.
//
// Cada aba aberta repete estas consultas o dia todo, e o banco do projeto é uma instância pequena (Nano, ~1 núcleo útil): em 23/10 as telas de Tráfego, Arena e CRM
// somadas ocuparam ~1 núcleo inteiro só com leituras repetidas (uma consulta de "operação do Tráfego" custa 0,3 a 2,5 s de CPU), e quando o banco engasgou cada aba
// tentou de novo ao mesmo tempo. Por isso: (1) nenhuma tela atualiza sozinha em menos de 45 s, (2) cada repetição ganha uma folga aleatória para as abas não baterem
// juntas, (3) quando muita gente é avisada de uma mudança, a releitura geral espera a sua vez em vez de disparar na hora.
// Mudanças feitas pela própria pessoa continuam atualizando na hora (refreshDashboardMutation); isto vale só para o que vem de fora (Realtime, cursor, relógio).

/** Cadências (ms) por tipo de tela. O teste scripts/verify-load-guards-ui.mjs reprova qualquer refetchInterval abaixo de 45 s. */
export const POLL = {
  traffic: 60_000,        // levas, fila de leads, operação do Tráfego
  trafficBadge: 60_000,   // selo de levas pendentes na barra lateral (aparece em toda página de executivo)
  audit: 120_000,         // trilha de auditoria (17 mil linhas)
  edit: 90_000,           // edição de leads/métricas do Tráfego
  bridge: 60_000,         // status das pontes (site, VOXEN)
  goals: 60_000,          // metas e histórico da Arena
  calendar: 60_000,       // status do Google Agenda
  conference: 90_000,     // conferência de leads
} as const

export const MIN_POLL_MS = 45_000

/** ms + folga aleatória de até `spread` (25% por padrão). `random` injetável para teste. */
export function jittered(ms: number, spread = 0.25, random: () => number = Math.random): number {
  return Math.round(ms + ms * spread * random())
}

/**
 * Valor para `refetchInterval` do React Query: uma função que o React Query reavalia a cada busca e que SEMPRE devolve um número (nunca para o ciclo), com folga
 * aleatória. O React Query já não busca em aba escondida (refetchIntervalInBackground=false).
 */
export function pollEvery(ms: number): () => number {
  return () => jittered(ms)
}

/** A releitura geral disparada por mudança de fora espera no mínimo isto entre uma e outra (a primeira é imediata). */
export const REMOTE_REFRESH_MIN_GAP_MS = 10_000
/** Folga aleatória (ms) somada ao atraso, para N abas avisadas ao mesmo tempo não consultarem juntas. */
export const REMOTE_REFRESH_JITTER_MS = 1_500

/**
 * Quanto esperar antes de refazer a leitura geral: o atraso base + uma folga aleatória, mas nunca antes de `minGapMs` depois da última releitura.
 * Rajada de mudanças => no máximo uma releitura por intervalo (a última mudança sempre acaba refletida, só que no fim do intervalo).
 */
export function nextRefreshDelay({ now, lastStartedAt, minGapMs, baseMs, jitterMs, random = Math.random }:
  { now: number; lastStartedAt: number; minGapMs: number; baseMs: number; jitterMs: number; random?: () => number }): number {
  const wait = baseMs + Math.floor(random() * jitterMs)
  const waitForGap = lastStartedAt > 0 ? lastStartedAt + minGapMs - now : 0
  return Math.max(wait, waitForGap, 0)
}
