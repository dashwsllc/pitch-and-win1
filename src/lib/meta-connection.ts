export interface MetaAdAccount {
  id: string
  account_id: string
  account_name: string
  currency: string
  timezone: string
  status: 'active' | 'paused'
  connected_by: string
  connected_at: string
  paused_by: string | null
  paused_at: string | null
  paused_reason: string | null
  updated_at: string
}

export interface MetaSyncRun {
  id: string
  kind: 'insights' | 'leads_reconciliation'
  account_id: string | null
  status: 'success' | 'error' | 'running' | 'partial'
  triggered_by: 'cron' | 'manual'
  triggered_by_user: string | null
  window_start: string | null
  window_end: string | null
  rows_synced: number
  error_message: string | null
  started_at: string
  finished_at: string | null
  level?: 'campaign' | 'adset' | 'ad' | null
  coverage_state?: 'legacy' | 'partial' | 'complete'
  discover?: boolean | null
  page_count?: number
}

export function lastRunFor(runs: MetaSyncRun[], kind: MetaSyncRun['kind'], accountId?: string | null): MetaSyncRun | null {
  return runs.find(run => run.kind === kind && (accountId === undefined || run.account_id === accountId)) || null
}

export function trafficOperationError(error: string | null | undefined) {
  if (!error) return null
  return /pages_manage_ads|permission|permiss|oauth|authoriz|autoriz|token/i.test(error)
    ? 'Regularize a autorização da Meta e o acesso aos leads da página. A importação manual continua disponível.'
    : 'A sincronização não concluiu. Confira a configuração e tente novamente; a importação manual continua disponível.'
}
export function trafficRunSummary(runs: MetaSyncRun[], accountId: string | null) {
  const scoped = runs.filter(run => run.account_id === accountId && run.kind === 'insights').sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id))
  const lastAttempt = scoped[0] || null
  return { lastAttempt, lastComplete: scoped.find(run => run.status === 'success' && run.coverage_state === 'complete') || null,
    partial: scoped.find(run => run.status === 'partial' || run.coverage_state === 'partial') || null,
    error: trafficOperationError(lastAttempt?.error_message) }
}
export type TrafficOperation = { runs: MetaSyncRun[]; published: { account_id: string; level: string; window_start: string; window_end: string; reviewed_at: string }[]; pending: Record<string, Record<string, number>> }
