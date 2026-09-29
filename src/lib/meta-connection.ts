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
  status: 'success' | 'error' | 'running'
  triggered_by: 'cron' | 'manual'
  triggered_by_user: string | null
  window_start: string | null
  window_end: string | null
  rows_synced: number
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export function lastRunFor(runs: MetaSyncRun[], kind: MetaSyncRun['kind'], accountId?: string | null): MetaSyncRun | null {
  return runs.find(run => run.kind === kind && (accountId === undefined || run.account_id === accountId)) || null
}
