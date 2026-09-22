import type { CRMLead } from '@/hooks/useCRM'
import { addDaysToDateKey, brasiliaDateKey, isValidDateKey } from '@/lib/brasilia-time'

export type CRMPipelinePeriod = 'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'

export type CRMPipelineCustomRange = {
  start: string
  end: string
}

export type CRMPipelineResolvedRange = {
  startKey?: string
  endKey?: string
  allTime: boolean
}

export function createDefaultCRMPipelineRange(today = brasiliaDateKey()): CRMPipelineCustomRange {
  return { start: addDaysToDateKey(today, -6), end: today }
}

export function validateCRMPipelineRange(range: CRMPipelineCustomRange) {
  if (!isValidDateKey(range.start) || !isValidDateKey(range.end)) {
    return 'Informe a data inicial e a data final.'
  }
  if (range.start > range.end) {
    return 'A data inicial deve ser anterior ou igual à data final.'
  }
  return null
}

export function resolveCRMPipelinePeriod(
  period: CRMPipelinePeriod,
  customRange: CRMPipelineCustomRange,
  today = brasiliaDateKey(),
): CRMPipelineResolvedRange {
  if (period === 'all') return { allTime: true }
  if (period === 'custom') {
    const fallback = createDefaultCRMPipelineRange(today)
    const range = validateCRMPipelineRange(customRange) ? fallback : customRange
    return { startKey: range.start, endKey: range.end, allTime: false }
  }

  const days = period === '7days' ? 7 : period === '30days' ? 30 : 1
  const endKey = period === 'yesterday' ? addDaysToDateKey(today, -1) : today
  return {
    startKey: addDaysToDateKey(endKey, -(days - 1)),
    endKey,
    allTime: false,
  }
}

// A esteira usa a data que representa a etapa de abordagem atual. Um lead
// ainda não abordado pertence ao dia de entrada; depois do primeiro contato,
// usa a marca temporal gravada pela transição de abordagem no banco.
export function leadApproachReference(lead: Pick<
  CRMLead,
  'approach_stage' | 'created_at' | 'first_contact_at' | 'last_contact_at' | 'approached_at' | 'updated_at'
>) {
  if (lead.approach_stage === 'nao_abordado') return lead.created_at
  if (lead.approach_stage === 'em_abordagem') {
    return lead.approached_at || lead.last_contact_at || lead.first_contact_at || lead.updated_at || lead.created_at
  }
  return lead.approached_at || lead.last_contact_at || lead.first_contact_at || lead.updated_at || lead.created_at
}

export function leadApproachDateKey(lead: Parameters<typeof leadApproachReference>[0]) {
  const reference = leadApproachReference(lead)
  if (!reference || !Number.isFinite(Date.parse(reference))) return null
  return brasiliaDateKey(reference)
}

export function leadMatchesPipelinePeriod(
  lead: Parameters<typeof leadApproachReference>[0],
  range: CRMPipelineResolvedRange,
) {
  if (range.allTime) return true
  const dateKey = leadApproachDateKey(lead)
  return !!dateKey && !!range.startKey && !!range.endKey && dateKey >= range.startKey && dateKey <= range.endKey
}
