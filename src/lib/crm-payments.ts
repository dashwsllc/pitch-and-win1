import { formatBrasiliaDate, formatDateKey } from '@/lib/brasilia-time'
import { money } from '@/lib/sales'

// One manual, informational status per lead. It never changes with a date or sale approval.
export type PaymentStatus = 'pago' | 'pendente' | 'nao_pago'
export const PAYMENT_STATUSES: PaymentStatus[] = ['pago', 'pendente', 'nao_pago']
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pago: 'Pago',
  pendente: 'Pendente',
  nao_pago: 'Não pago',
}
export const isPaymentStatus = (value: unknown): value is PaymentStatus =>
  typeof value === 'string' && (PAYMENT_STATUSES as string[]).includes(value)

// Keep older timeline entries readable even though the entry form was retired.
const methodLabels: Record<string, string> = {
  pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito',
  boleto: 'Boleto', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outro',
}
export function paymentStateValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Sem definição'
  if (key === 'payment_status') return isPaymentStatus(value) ? PAYMENT_STATUS_LABELS[value] : String(value)
  if (key === 'payment_amount') return Number.isFinite(Number(value)) ? money(Number(value)) : String(value)
  if (key === 'payment_method') return methodLabels[String(value)] ?? String(value)
  if (key === 'payment_due_date') return formatDateKey(String(value))
  if (key === 'payment_paid_at') return formatBrasiliaDate(String(value), { hour: '2-digit', minute: '2-digit' })
  return String(value)
}
