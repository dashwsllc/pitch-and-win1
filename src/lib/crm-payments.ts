import { brasiliaLocalInputToIso, formatBrasiliaDate, formatDateKey, isValidDateKey } from '@/lib/brasilia-time'
import { normalizeContextMediaUrl } from '@/lib/crm-context-media'
import { money } from '@/lib/sales'

// Mirrors the crm_lead_payments table and crm_payment_* functions (migration 20261007110000_crm_lead_payments).
// The status is always marked by hand by a Closer; the lead badge is derived from its entries and never changes by itself.
export type PaymentStatus = 'pendente' | 'pago' | 'nao_pago'

export const PAYMENT_STATUSES: PaymentStatus[] = ['pago', 'nao_pago', 'pendente']
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pago: 'Pago',
  nao_pago: 'Não pago',
  pendente: 'Pendente',
}
export const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' && (PAYMENT_STATUSES as string[]).includes(value)

export const PAYMENT_METHODS = [
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'outro', label: 'Outro' },
]
export const paymentMethodLabel = (value: string | null | undefined) =>
  value ? PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value : 'Não informada'

export const MAX_PAYMENT_AMOUNT = 10_000_000
const MAX_DESCRIPTION = 120
const MAX_NOTES = 1000
const MAX_REASON = 500
const MIN_REASON = 3
const FUTURE_TOLERANCE_MS = 5 * 60_000

// What a person types: pt-BR first ("1.234,56"), en-US tolerated ("1,234.56"). Always > 0, at most two decimals.
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!/^\d[\d.,]*$/.test(cleaned)) return null
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let integer = cleaned
  let decimals = ''
  let hasDecimals = false
  const thousands = (part: string, separator: string) =>
    new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(part) ? part.split(separator).join('') : null
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the last one is the decimal separator, the other one groups thousands.
    const decimalAt = Math.max(lastComma, lastDot)
    const grouped = thousands(cleaned.slice(0, decimalAt), lastComma > lastDot ? '.' : ',')
    if (grouped === null) return null
    integer = grouped
    decimals = cleaned.slice(decimalAt + 1)
    hasDecimals = true
  } else if (lastComma >= 0) {
    if (cleaned.indexOf(',') !== lastComma) return null
    integer = cleaned.slice(0, lastComma)
    decimals = cleaned.slice(lastComma + 1)
    hasDecimals = true
  } else if (lastDot >= 0) {
    // "1.500" and "10.000.000" group thousands; "12.50" is a decimal.
    const single = cleaned.indexOf('.') === lastDot
    const groupsThousands = !single || (cleaned.length - lastDot - 1 === 3 && lastDot <= 3 && cleaned.slice(0, lastDot) !== '0')
    if (groupsThousands) {
      const grouped = thousands(cleaned, '.')
      if (grouped === null) return null
      integer = grouped
    } else {
      integer = cleaned.slice(0, lastDot)
      decimals = cleaned.slice(lastDot + 1)
      hasDecimals = true
    }
  }
  if (!/^\d+$/.test(integer) || (hasDecimals && !/^\d{1,2}$/.test(decimals))) return null
  const value = Number(`${integer}.${decimals || '0'}`)
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PAYMENT_AMOUNT) return null
  return Math.round(value * 100) / 100
}

export const formatMoneyInput = (value: number) => value.toFixed(2).replace('.', ',')

export interface PaymentRowLike {
  status: string
  amount: number
  due_date: string | null
}

export interface PaymentSummary {
  status: PaymentStatus | null
  count: number
  paidCount: number
  unpaidCount: number
  pendingCount: number
  total: number
  paid: number
  nextDue: string | null
  percent: number
}

const toCents = (value: number) => Math.round(Number(value) * 100)
const percentPaid = (paidCents: number, totalCents: number) =>
  totalCents <= 0 ? 0 : paidCents >= totalCents ? 100 : Math.min(99, Math.round((paidCents * 100) / totalCents))

// Every entry Pago -> Pago; any entry Não pago -> Não pago; anything else -> Pendente; no entries -> no badge.
export function summarizePayments(rows: PaymentRowLike[]): PaymentSummary {
  let totalCents = 0
  let paidCents = 0
  let paidCount = 0
  let unpaidCount = 0
  let pendingCount = 0
  let nextDue: string | null = null
  for (const row of rows) {
    totalCents += toCents(row.amount)
    if (row.status === 'pago') {
      paidCount += 1
      paidCents += toCents(row.amount)
    } else if (row.status === 'nao_pago') unpaidCount += 1
    else {
      pendingCount += 1
      if (row.due_date && (!nextDue || row.due_date < nextDue)) nextDue = row.due_date
    }
  }
  const count = rows.length
  return {
    status: !count ? null : unpaidCount > 0 ? 'nao_pago' : paidCount === count ? 'pago' : 'pendente',
    count,
    paidCount,
    unpaidCount,
    pendingCount,
    total: totalCents / 100,
    paid: paidCents / 100,
    nextDue,
    percent: percentPaid(paidCents, totalCents),
  }
}

export interface PaymentSummaryRow {
  lead_id: string
  total_count: number
  paid_count: number
  unpaid_count: number
  pending_count: number
  total_amount: number
  paid_amount: number
  status: string
  next_due_date: string | null
}

// One row per lead from crm_lead_payment_summaries(); an unknown status shows no badge instead of a wrong one.
export function paymentSummaryFromRow(row: PaymentSummaryRow): PaymentSummary {
  return {
    status: isPaymentStatus(row.status) ? row.status : null,
    count: row.total_count,
    paidCount: row.paid_count,
    unpaidCount: row.unpaid_count,
    pendingCount: row.pending_count,
    total: Number(row.total_amount),
    paid: Number(row.paid_amount),
    nextDue: row.next_due_date,
    percent: percentPaid(toCents(row.paid_amount), toCents(row.total_amount)),
  }
}

export const paymentSummaryText = (summary: Pick<PaymentSummary, 'status' | 'total' | 'paid'>) =>
  summary.status === 'pago' ? money(summary.total) : `${money(summary.paid)} de ${money(summary.total)}`

export interface PaymentForm {
  description: string
  amount: string
  method: string
  dueDate: string
  notes: string
  proofUrl: string
}

export const emptyPaymentForm: PaymentForm = { description: '', amount: '', method: 'pix', dueDate: '', notes: '', proofUrl: '' }

export interface PaymentRecord {
  description: string
  amount: number
  method: string
  due_date: string | null
  notes?: string | null
  proof_url?: string | null
}

export const paymentFormFrom = (payment: PaymentRecord): PaymentForm => ({
  description: payment.description,
  amount: formatMoneyInput(Number(payment.amount)),
  method: payment.method,
  dueDate: payment.due_date ?? '',
  notes: payment.notes ?? '',
  proofUrl: payment.proof_url ?? '',
})

export function validatePaymentForm(form: PaymentForm): string | null {
  const description = form.description.trim()
  if (!description || description.length > MAX_DESCRIPTION)
    return `Informe a descrição do lançamento (até ${MAX_DESCRIPTION} caracteres).`
  if (parseMoneyInput(form.amount) === null) return 'Informe um valor maior que zero, por exemplo 1.500,00.'
  if (!PAYMENT_METHODS.some((method) => method.value === form.method)) return 'Escolha uma forma de pagamento.'
  if (form.dueDate && !isValidDateKey(form.dueDate)) return 'Escolha uma data de vencimento válida.'
  if (form.notes.trim().length > MAX_NOTES) return `A observação aceita até ${MAX_NOTES} caracteres.`
  try {
    normalizeContextMediaUrl(form.proofUrl)
  } catch (error) {
    return error instanceof Error ? error.message : 'Link do comprovante inválido.'
  }
  return null
}

// Only valid after validatePaymentForm returned null.
export function paymentPayload(form: PaymentForm) {
  return {
    description: form.description.trim(),
    amount: parseMoneyInput(form.amount) as number,
    method: form.method,
    dueDate: form.dueDate || null,
    notes: form.notes.trim() || null,
    proofUrl: normalizeContextMediaUrl(form.proofUrl),
  }
}

export function validateReason(reason: string): string | null {
  const size = reason.trim().length
  if (size < MIN_REASON) return `Informe o motivo (mínimo ${MIN_REASON} caracteres).`
  if (size > MAX_REASON) return `O motivo aceita até ${MAX_REASON} caracteres.`
  return null
}

// `paidAt` is the datetime-local value in Brasília time; empty means "now" (the server uses its own clock).
export function validateStatusChange(
  change: { status: PaymentStatus; reason: string; paidAt: string },
  now = Date.now(),
): string | null {
  if (change.status === 'nao_pago') return validateReason(change.reason)
  if (change.status === 'pago' && change.paidAt) {
    const iso = brasiliaLocalInputToIso(change.paidAt)
    if (!iso) return 'Informe uma data de pagamento válida.'
    if (Date.parse(iso) > now + FUTURE_TOLERANCE_MS) return 'A data do pagamento não pode estar no futuro.'
  }
  return null
}

// What each payment key shows on the lead timeline ("Pagamento: Pendente → Pago").
export function paymentStateValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Sem definição'
  if (key === 'payment_status') return isPaymentStatus(value) ? PAYMENT_STATUS_LABELS[value] : String(value)
  if (key === 'payment_amount') return Number.isFinite(Number(value)) ? money(Number(value)) : String(value)
  if (key === 'payment_method') return paymentMethodLabel(String(value))
  if (key === 'payment_due_date') return formatDateKey(String(value))
  if (key === 'payment_paid_at') return formatBrasiliaDate(String(value), { hour: '2-digit', minute: '2-digit' })
  return String(value)
}
