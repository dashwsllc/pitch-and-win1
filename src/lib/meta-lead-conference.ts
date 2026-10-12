// Conferência de leads por dia (Brasília) e campanha: Meta informa × recebidos × CRM.
export type ConferenceRow = {
  stat_day: string; campaign_id: string; campaign_name: string; meta_leads: number; received: number
  pending: number; approved: number; rejected: number; in_crm: number; failed: number
}

/** Diferença entre o que a Meta informa e o que chegou: positiva é lead que ainda não está no painel. */
export function conferenceGap(row: Pick<ConferenceRow, 'meta_leads' | 'received'>) {
  return Number(row.meta_leads) - Number(row.received)
}

export function summarizeConference(rows: ConferenceRow[]) {
  const total = (key: keyof ConferenceRow) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)
  const missing = rows.reduce((sum, row) => sum + Math.max(0, conferenceGap(row)), 0)
  return { meta: total('meta_leads'), received: total('received'), pending: total('pending'), inCrm: total('in_crm'), failed: total('failed'), missing,
    daysMissing: rows.filter(row => conferenceGap(row) > 0).length }
}
