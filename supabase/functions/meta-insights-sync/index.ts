import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { isTrustedOrigin, jsonResponse, preflightResponse, readJsonBody, RequestError } from '../_shared/http.ts'
import { requireCronSecret, requireTrafficUser } from '../_shared/meta-auth.ts'
import { captureAccountLevel, readMetaAccount, accountWindow } from '../_shared/meta-insights-capture.ts'
import type { MetaLevel } from '../../../shared/meta-contract.ts'
import { normalizeMetaAccountId } from '../../../shared/meta-identity.ts'
const LEVELS: MetaLevel[] = ['campaign', 'adset', 'ad']

Deno.serve(async (req) => {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (!isTrustedOrigin(req)) return jsonResponse(req, { error: 'Origem não autorizada' }, 403)
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  try {
    const deadlineMs = Date.now() + 45000
    const isCron = requireCronSecret(req)
    let actor: string | null = null
    const triggeredBy: 'cron' | 'manual' = isCron ? 'cron' : 'manual'
    if (!isCron) {
      const { userId } = await requireTrafficUser(req)
      actor = userId
    }
    const token = Deno.env.get('META_SYSTEM_USER_TOKEN')
    if (!token) return jsonResponse(req, { error: 'META_SYSTEM_USER_TOKEN não configurado' }, 500)

    const body = await readJsonBody<{ days?: number; resumeOnly?: boolean }>(req)
    if (body.resumeOnly && !isCron) return jsonResponse(req, { error: 'Retomada exclusiva do cron' }, 403)
    const days = body.days ?? Number(Deno.env.get('META_SYNC_LOOKBACK_DAYS') || 3)
    if (!Number.isInteger(days) || days < 1 || days > 30) return jsonResponse(req, { error: 'Período deve ter 1 a 30 dias' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const remaining = deadlineMs - Date.now()
        if (remaining <= 0) throw new Error('Orçamento de captura esgotado')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.min(5000, remaining))
        try { return await fetch(input, { ...init, signal: controller.signal }) }
        finally { clearTimeout(timer) }
      } },
    })
    const { data: pending, error: pendingError } = await admin.from('meta_sync_runs')
      .select('id,account_id,level,window_start,window_end,started_at').eq('kind', 'insights').in('status', ['running', 'partial'])
      .not('level', 'is', null).order('started_at').limit(100)
    if (pendingError) throw pendingError
    const { data: accounts, error: accountsError } = await admin.from('meta_ad_accounts').select('account_id').eq('status', 'active')
    if (accountsError) throw accountsError
    const active = new Set((accounts ?? []).map(account => normalizeMetaAccountId(account.account_id)))
    const jobs: { accountId: string; level: MetaLevel; since?: string; until?: string }[] = (pending ?? [])
      .filter(run => active.has(normalizeMetaAccountId(run.account_id)))
      .map(run => ({ accountId: run.account_id, level: run.level as MetaLevel, since: run.window_start, until: run.window_end }))
    const turn = jobs.length ? Math.floor(Date.now() / 60000) % jobs.length : 0
    jobs.push(...jobs.splice(0, turn))
    if (!body.resumeOnly) for (const account of accounts ?? []) for (const level of LEVELS) {
      if (!jobs.some(job => normalizeMetaAccountId(job.accountId) === normalizeMetaAccountId(account.account_id) && job.level === level)) jobs.push({ accountId: account.account_id, level })
    }
    const results = []
    let partial = false
    for (const job of jobs) {
      if (Date.now() >= deadlineMs - 5000) { partial = true; break }
      try {
        const account = await readMetaAccount(admin, job.accountId, token, deadlineMs - 5000)
        const window = job.since && job.until ? { since: job.since, until: job.until } : accountWindow(account.timezone, days)
        const result = await captureAccountLevel(admin, { ...job, ...window, actor, triggeredBy, deadlineMs, pageLimit: 2 }, token)
        results.push({ accountId: account.id, level: job.level, ...result })
        partial ||= result.state === 'partial' || result.state === 'skipped'
      } catch (error) {
        let message = error && typeof error === 'object' && 'message' in error ? String(error.message).replaceAll(token, '[credencial]').replaceAll(encodeURIComponent(token), '[credencial]') : 'Falha da conta Meta'
        // Metadata failures precede staging. Keep an operational error run with
        // unknown coverage, rather than inventing account metadata or a window.
        const { data: errorRun, error: startError } = await admin.rpc('meta_sync_run_start', {
          p_kind: 'insights', p_account_id: normalizeMetaAccountId(job.accountId), p_triggered_by: triggeredBy, p_triggered_by_user: actor,
        })
        if (!startError && errorRun) {
          const { error: finishError } = await admin.rpc('meta_sync_run_finish', { p_id: errorRun, p_status: 'error', p_rows_synced: 0, p_error_message: `${job.level}: ${message}` })
          if (finishError) message += '; falha ao registrar o erro da conta'
        } else if (startError?.code !== '55006') message += '; falha ao registrar o erro da conta'
        results.push({ accountId: job.accountId, level: job.level, state: 'error', runId: errorRun, error: message })
      }
    }
    const ok = !results.some(result => result.state === 'error')
    return jsonResponse(req, { ok, partial, results }, !ok ? 502 : partial ? 202 : 200)
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
    console.error('meta-insights-sync failed', error)
    return jsonResponse(req, { error: 'Não foi possível sincronizar as métricas da Meta.' }, 500)
  }
})
