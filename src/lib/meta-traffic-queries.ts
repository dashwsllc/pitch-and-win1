import { arenaClient, arenaRpc } from '@/lib/arena-api'
import { errorMessage } from './sales'
import type { ImportRow, MetaDailyRow } from './meta-traffic'
import type { LeadImportRow } from './meta-lead-import'

export type TrafficReviewSummary = {
  format: 'legacy' | 'capture-v1'; kind: 'metrics' | 'leads'; id: string; filename: string;
  version: number | null; updated_at: string; created_at: string; status: string; row_count: number;
  source: 'api' | 'csv'; window_start: string | null; window_end: string | null; replaced_by_review_id: string | null;
  upsert_count: number; remove_count: number; conflict_count: number;
}
export type TrafficReviewRow = { row_no: number; operation: 'upsert' | 'remove'; payload: ImportRow;
  before_snapshot: MetaDailyRow | null; edit_reason: string | null;
  conflict_details: { reason?: string; incoming?: ImportRow | null; edited?: ImportRow | null; published?: MetaDailyRow | null } | null }
export type TrafficReviewPart = { id: string; version: number; total: number; rows: TrafficReviewRow[]; next_offset: number | null }
export const trafficReviewOptions = (active: boolean) => ({ enabled: active, refetchInterval: active ? 30_000 : false as const })
export const trafficReviewPartKey = (user: string | undefined, summary: TrafficReviewSummary, offset: number) =>
  ['meta-review-detail', user, summary.format, summary.kind, summary.id, summary.version ?? summary.updated_at, offset, 500] as const
export const trafficReviewSeenKey = (summary: TrafficReviewSummary) => JSON.stringify([summary.id, summary.version ?? summary.updated_at])
export const fetchTrafficReviewList = ({ kind = null, status = null, offset = 0, limit = 50 }: {
  kind?: 'metrics' | 'leads' | null; status?: string | null; offset?: number; limit?: number }) =>
  arenaRpc<{ rows: TrafficReviewSummary[]; count: number }>('meta_traffic_review_list', { p_kind: kind, p_status: status, p_offset: offset, p_limit: limit })
export const fetchTrafficReviewPart = ({ id, version, offset = 0, limit = 500 }: { id: string; version: number; offset?: number; limit?: number }) =>
  arenaRpc<TrafficReviewPart>('meta_capture_review_part', { p_id: id, p_version: version, p_offset: offset, p_limit: limit })
export async function fetchLegacyBatchRows(kind: 'metrics' | 'leads', id: string, expectedUpdatedAt?: string) {
  const { data, error } = await arenaClient.from(kind === 'metrics' ? 'meta_import_batches' : 'meta_lead_import_batches')
    .select('rows,updated_at,status').eq('id', id).single()
  if (error) throw error
  if (expectedUpdatedAt && data.updated_at !== expectedUpdatedAt) throw { code: '40001', message: 'Importação alterada; recarregue para conferir.' }
  return data.rows as (ImportRow | LeadImportRow)[]
}
export function canApproveTrafficReview(summary: TrafficReviewSummary, detailReady: boolean, acknowledged: boolean) {
  return summary.status === 'pendente' && !summary.replaced_by_review_id && detailReady && acknowledged
    && Number.isInteger(summary.remove_count) && summary.remove_count >= 0 && summary.conflict_count === 0
}
export async function decideTrafficReviews(reviews: TrafficReviewSummary[], action: 'aprovar' | 'rejeitar', note: string, refresh: () => Promise<unknown>) {
  let recorded = 0, refreshFailed = false
  const failures: { id: string; stale: boolean; message: string }[] = []
  for (const review of reviews) {
    try {
      if (review.replaced_by_review_id) throw new Error('Importação incorporada em uma revisão API. Abra a revisão atual.')
      if (review.format === 'capture-v1') await arenaRpc('meta_capture_review_decide', { p_id: review.id, p_version: review.version!, p_action: action, p_note: note })
      else await arenaRpc(review.kind === 'metrics' ? 'meta_review_traffic_import' : 'meta_review_lead_import',
        { p_batch_id: review.id, p_expected_updated_at: review.updated_at, p_action: action, p_note: note })
      recorded++
    } catch (cause) {
      const stale = (cause as { code?: string })?.code === '40001'
      failures.push({ id: review.id, stale, message: stale ? 'A revisão mudou ou já foi decidida. Recarregue e confira a versão atual.' : errorMessage(cause) })
    }
  }
  try { await refresh() } catch { refreshFailed = true }
  return { recorded, failures, refreshFailed }
}
export function createLatestFileLoader<FileType, Data>(read: (file: FileType) => Promise<Data>, loaded: (file: FileType, data: Data) => void, failed?: (cause: unknown) => void) {
  let generation = 0
  return async (file: FileType) => {
    const current = ++generation
    try { const data = await read(file); if (current === generation) loaded(file, data) }
    catch (cause) { if (current === generation) { if (failed) failed(cause); else throw cause } }
  }
}
