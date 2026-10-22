import { leadDateTime } from '@/lib/meta-waves'
import { errorMessage } from '@/lib/sales'

// Envio de leads que ainda não se cadastraram na VOXEN: o time escolhe ("Enviar para a VOXEN", no lead ou na seção VOXEN do CRM) e o sistema mantém
// o lead em sincronia (RPCs crm_voxen_send, crm_voxen_stop e crm_voxen_sync_states, migration 20261021233000). Sem janela de confirmação.
// Só ids, estados e contagens: nenhuma dessas RPCs devolve dado pessoal.
export type VoxenLeadState = 'registered' | 'waiting' | 'pending' | 'sent' | 'quarantined' | 'blocked' | 'stopped'
/** O que o app mostra de um lead: o estado devolvido pelo banco ou "available" (ainda não escolhido). */
export type VoxenLeadView = VoxenLeadState | 'available'
export interface VoxenSyncRow { lead_id: string; state: VoxenLeadState; at: string | null }
export interface VoxenSyncStates { ready: boolean; rows: VoxenSyncRow[] }
export interface VoxenRpcRow { lead_id: string; result: string }

/** O banco aceita até 25 leads por chamada; o app manda em blocos menores para cada chamada caber no limite de tempo da sessão. */
export const VOXEN_SEND_CHUNK = 15
/** Uma chamada de bloco que passa disso foi para um servidor engasgado (o banco corta a sessão em 8 s): o app desiste dela em vez de esperar para sempre. */
export const VOXEN_CALL_TIMEOUT_MS = 20_000
/** Esperas entre as novas tentativas do mesmo bloco (duas). Repetir é seguro: o envio é idempotente, bloco já aplicado volta como "sent" sem criar nada. */
export const VOXEN_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000]
const STATES: readonly string[] = ['registered', 'waiting', 'pending', 'sent', 'quarantined', 'blocked', 'stopped']

export function isVoxenSyncStates(value: unknown): value is VoxenSyncStates {
  const s = value as Partial<VoxenSyncStates> | null
  if (!s || typeof s !== 'object' || typeof s.ready !== 'boolean' || !Array.isArray(s.rows)) return false
  return s.rows.every(row => !!row && typeof row === 'object' && typeof row.lead_id === 'string' && STATES.includes(row.state)
    && (row.at === null || row.at === undefined || (typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)))))
}

/** Função ausente no banco (migration ainda não aplicada): o recurso some em vez de quebrar o CRM. */
export function isMissingRpc(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'PGRST202' || code === '42883'
}

/** Falha de infraestrutura (gateway, rede, sessão cortada por tempo, trava passageira): repetir o mesmo bloco pode dar certo. Erro de regra (permissão, parâmetro, função ausente) não melhora repetindo. */
export function isTransientVoxenError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; name?: unknown } | null
  if (!e || typeof e !== 'object') return false
  const code = typeof e.code === 'string' ? e.code : ''
  if (code === 'voxen_timeout' || /^PGRST00[0-3]$/.test(code) || ['57014', '40001', '40P01', '55P03', '53300', '57P01', '57P03', '08000', '08003', '08006'].includes(code)) return true
  const words = `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : ''}`
  return /abort|timeout|timed out|network|failed to fetch|fetch failed|load failed|bad gateway|service unavailable|gateway|too many connections/i.test(words)
}

/** Cancela a chamada quando passa do tempo: o clique nunca fica preso esperando um servidor que não responde. */
export async function withVoxenTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms = VOXEN_CALL_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('O servidor demorou para responder.'), { code: 'voxen_timeout' })) }, ms)
  })
  try { return await Promise.race([run(controller.signal), expired]) } finally { clearTimeout(timer) }
}

/** A fila da VOXEN anda sozinha enquanto há lead na fila ("pending"); sem fila não há nada a acompanhar e o app não precisa consultar o banco de tempos em tempos. */
export const hasVoxenInFlight = (states: VoxenSyncStates | null | undefined) => !!states?.rows.some(row => row.state === 'pending')

export function voxenViewOf(states: ReadonlyMap<string, VoxenSyncRow>, leadId: string): VoxenLeadView {
  return states.get(leadId)?.state ?? 'available'
}

export interface VoxenStatusText { label: string; detail: string | null; tone: 'neutral' | 'ok' | 'attention' | 'problem' }
export function voxenStatusText(view: VoxenLeadView, at?: string | null): VoxenStatusText {
  switch (view) {
    case 'registered': return { label: 'Cadastrado na VOXEN', detail: 'Sincroniza automaticamente, sem precisar enviar.', tone: 'ok' }
    case 'waiting': return { label: 'Marcado para enviar', detail: 'Segue sozinho assim que houver respostas, notas ou dados do atleta.', tone: 'attention' }
    case 'pending': return { label: 'Enviando para a VOXEN', detail: 'Chega em poucos minutos.', tone: 'attention' }
    case 'sent': return { label: 'Enviado e em sincronia', detail: at ? `Último envio em ${leadDateTime(at)}. Cada mudança neste lead segue sozinha.` : 'Cada mudança neste lead segue sozinha.', tone: 'ok' }
    case 'quarantined': return { label: 'A VOXEN não guardou o envio', detail: 'Avise a Zyron: ela recebeu e deixou em quarentena.', tone: 'problem' }
    case 'blocked': return { label: 'A VOXEN recusou o envio', detail: 'Avise a Zyron: o envio fica parado até ser reenfileirado.', tone: 'problem' }
    case 'stopped': return { label: 'Sincronização parada', detail: 'Nada novo sai deste lead até você enviar de novo.', tone: 'neutral' }
    default: return { label: 'Não enviado', detail: null, tone: 'neutral' }
  }
}

/** Pode enviar: lead ainda não escolhido (ou parado), com algo para enviar, e a VOXEN já liberou o recebimento. */
export const canSendToVoxen = (view: VoxenLeadView, hasContext: boolean, ready: boolean) => ready && hasContext && (view === 'available' || view === 'stopped')
/** Pode parar: o lead está escolhido (aguardando, na fila, enviado ou com problema). */
export const canStopVoxen = (view: VoxenLeadView) => view === 'waiting' || view === 'pending' || view === 'sent' || view === 'quarantined' || view === 'blocked'

export const VOXEN_TONE_CLASS = { ok: 'text-emerald-300', attention: 'text-amber-300', problem: 'text-destructive', neutral: 'text-muted-foreground' } as const

export type VoxenFilter = 'available' | 'sent' | 'problem' | 'stopped' | 'registered' | 'nocontext'
export const VOXEN_FILTERS: { value: VoxenFilter; label: string }[] = [
  { value: 'available', label: 'Disponíveis' }, { value: 'sent', label: 'Enviados' }, { value: 'problem', label: 'Com problema' },
  { value: 'stopped', label: 'Parados' }, { value: 'registered', label: 'Cadastrados na VOXEN' }, { value: 'nocontext', label: 'Sem contexto' },
]
export function voxenFilterOf(view: VoxenLeadView, hasContext: boolean): VoxenFilter {
  if (view === 'registered') return 'registered'
  if (view === 'stopped') return 'stopped'
  if (view === 'quarantined' || view === 'blocked') return 'problem'
  if (view === 'waiting' || view === 'pending' || view === 'sent') return 'sent'
  return hasContext ? 'available' : 'nocontext'
}

/** Uma linha da seção VOXEN do CRM. */
export interface VoxenRowData<L = unknown> { lead: L; view: VoxenLeadView; at: string | null; hasContext: boolean; filter: VoxenFilter }
/** Selecionar só faz sentido onde a ação existe: enviar (disponíveis e parados) ou parar (enviados e com problema). */
export const selectableIn = (filter: VoxenFilter, row: Pick<VoxenRowData, 'view' | 'hasContext'>, ready: boolean) =>
  (filter === 'available' || filter === 'stopped') ? canSendToVoxen(row.view, row.hasContext, ready) : (filter === 'sent' || filter === 'problem') ? canStopVoxen(row.view) : false

export function chunkLeadIds(ids: readonly string[], size = VOXEN_SEND_CHUNK): string[][] {
  const unique = [...new Set(ids)], out: string[][] = []
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size))
  return out
}

export interface VoxenBatchOutcome { requested: number; done: number; counts: Record<string, number>; error: unknown | null }

export interface VoxenBatchOptions {
  /** Esperas entre as novas tentativas do mesmo bloco; o tamanho da lista é o número de novas tentativas. */
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  /** Chamado antes de esperar para tentar de novo: `attempt` é a nova tentativa que vem (1, 2…). */
  onRetry?: (attempt: number, of: number, error: unknown) => void
}

/**
 * Manda os ids em blocos, um de cada vez. Falha passageira (gateway, rede, tempo esgotado) repete o mesmo bloco depois de uma espera; erro de regra ou falha que
 * persiste para e devolve o que já foi feito (cada bloco é atômico no banco, então nada fica pela metade).
 */
export async function runVoxenBatch(ids: readonly string[], call: (chunk: string[]) => Promise<VoxenRpcRow[]>, onProgress?: (done: number, total: number) => void, options: VoxenBatchOptions = {}): Promise<VoxenBatchOutcome> {
  const { delaysMs = VOXEN_RETRY_DELAYS_MS, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), onRetry } = options
  const total = new Set(ids).size, counts: Record<string, number> = {}
  let done = 0
  const attempt = async (part: string[]): Promise<VoxenRpcRow[]> => {
    for (let tries = 0; ; tries++) {
      try { return await call(part) } catch (error) {
        if (tries >= delaysMs.length || !isTransientVoxenError(error)) throw error
        onRetry?.(tries + 1, delaysMs.length, error)
        await sleep(delaysMs[tries])
      }
    }
  }
  try {
    for (const part of chunkLeadIds(ids)) {
      const rows = await attempt(part)
      for (const row of rows) counts[row.result] = (counts[row.result] ?? 0) + 1
      done += part.length
      onProgress?.(done, total)
    }
    return { requested: total, done, counts, error: null }
  } catch (error) {
    return { requested: total, done, counts, error }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Texto do aviso depois de enviar. */
export function describeSend(outcome: VoxenBatchOutcome): { title: string; description?: string; variant?: 'destructive' } {
  const sent = outcome.counts.sent ?? 0, waiting = outcome.counts.nothing_to_send ?? 0, registered = outcome.counts.registered ?? 0, missing = outcome.counts.not_found ?? 0
  const notes = [
    waiting ? `${plural(waiting, 'lead ficou marcado', 'leads ficaram marcados')} sem nada para enviar ainda; seguem sozinhos quando houver.` : '',
    registered ? `${plural(registered, 'lead já está cadastrado', 'leads já estão cadastrados')} na VOXEN e sincroniza${registered === 1 ? '' : 'm'} sozinho${registered === 1 ? '' : 's'}.` : '',
    missing ? `${plural(missing, 'lead não foi encontrado', 'leads não foram encontrados')}.` : '',
  ].filter(Boolean)
  if (outcome.error) return { title: 'Envio interrompido', description: `${errorMessage(outcome.error)}${sent ? ` Já enviados: ${sent}.` : ''} Tente de novo em instantes: o que já foi enviado não se repete.`, variant: 'destructive' }
  return { title: sent ? `${plural(sent, 'lead enviado', 'leads enviados')} para a VOXEN` : 'Nada novo foi enviado', description: notes.join(' ') || undefined }
}

/** Texto do aviso depois de parar a sincronização. */
export function describeStop(outcome: VoxenBatchOutcome): { title: string; description?: string; variant?: 'destructive' } {
  const stopped = outcome.counts.stopped ?? 0
  if (outcome.error) return { title: 'Não foi possível parar', description: errorMessage(outcome.error), variant: 'destructive' }
  return { title: stopped ? `Sincronização parada em ${plural(stopped, 'lead', 'leads')}` : 'Nada para parar', description: stopped ? 'O que já foi enviado continua na VOXEN.' : undefined }
}
