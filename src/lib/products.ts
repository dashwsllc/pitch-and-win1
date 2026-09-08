import type { Tables } from '@/integrations/supabase/types'
import { errorMessage } from './sales'

export type Product = Tables<'products'> & { product_tickets: Tables<'product_tickets'>[] }
export type ProductTicket = Tables<'product_tickets'>

// Accept Brazilian currency input without guessing ambiguous grouping/decimals.
export function parseTicketPrice(input: string): number | null {
  const value = input.trim().replace(/^R\$\s*/i, '')
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)
    && !/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const normalized = value.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(value)
    ? value.replace(/\./g, '').replace(',', '.') : value
  const price = Number(normalized)
  return Number.isFinite(price) && price >= 0.01 && price <= 100_000_000 ? price : null
}

export function catalogError(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
    return 'Já existe um produto com esse nome ou um ticket com esse nome neste produto. Use outro nome.'
  }
  return errorMessage(error)
}
