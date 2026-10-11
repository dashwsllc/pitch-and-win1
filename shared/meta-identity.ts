/** Canonical IDs are text to preserve Meta's large integer identifiers. */
export function normalizeMetaAccountId(value: string): string {
  const id = String(value ?? '').trim().replace(/^act_/, '')
  if (!/^[0-9]{1,80}$/.test(id)) throw new Error('ID da conta Meta inválido; informe o ID numérico, com ou sem act_.')
  return id
}

export function metaTrafficKey(row: { date: string; account_id: string; campaign_id: string; adset_id?: string; ad_id?: string }): string {
  return JSON.stringify([row.date, normalizeMetaAccountId(row.account_id), row.campaign_id.trim(), row.adset_id?.trim() || '', row.ad_id?.trim() || ''])
}
