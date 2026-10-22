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

/** Manda os ids em blocos, um de cada vez. Se um bloco falhar, para e devolve o que já foi feito (cada bloco é atômico no banco). */
export async function runVoxenBatch(ids: readonly string[], call: (chunk: string[]) => Promise<VoxenRpcRow[]>, onProgress?: (done: number, total: number) => void): Promise<VoxenBatchOutcome> {
  const total = new Set(ids).size, counts: Record<string, number> = {}
  let done = 0
  try {
    for (const part of chunkLeadIds(ids)) {
      const rows = await call(part)
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
  if (outcome.error) return { title: 'Envio interrompido', description: `${errorMessage(outcome.error)}${sent ? ` Já enviados: ${sent}.` : ''}`, variant: 'destructive' }
  return { title: sent ? `${plural(sent, 'lead enviado', 'leads enviados')} para a VOXEN` : 'Nada novo foi enviado', description: notes.join(' ') || undefined }
}

/** Texto do aviso depois de parar a sincronização. */
export function describeStop(outcome: VoxenBatchOutcome): { title: string; description?: string; variant?: 'destructive' } {
  const stopped = outcome.counts.stopped ?? 0
  if (outcome.error) return { title: 'Não foi possível parar', description: errorMessage(outcome.error), variant: 'destructive' }
  return { title: stopped ? `Sincronização parada em ${plural(stopped, 'lead', 'leads')}` : 'Nada para parar', description: stopped ? 'O que já foi enviado continua na VOXEN.' : undefined }
}
