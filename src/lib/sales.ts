export const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

export function exactDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem registro'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message) : 'Não foi possível concluir. Tente novamente.'

export const saleStatus = {
  pendente: { label: 'Pendente', color: 'bg-amber-400/10 text-amber-300 border-amber-400/15' },
  aprovada: { label: 'Aprovado', color: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/15' },
  rejeitada: { label: 'Rejeitado', color: 'bg-rose-400/10 text-rose-300 border-rose-400/15' },
} as const

export interface TeamSale {
  id: string
  user_id: string
  seller_name: string
  seller_avatar: string | null
  nome_produto: string
  valor_venda: number
  approval_status: keyof typeof saleStatus
  created_at: string
  reviewed_at: string | null
  nome_comprador?: string
  email_comprador?: string
  whatsapp_comprador?: string
  commission_amount?: number
  rejection_reason?: string | null
  reviewer_name?: string
  withdrawn?: boolean
  withdrawal_id?: string | null
  consideracoes_gerais?: string | null
}

export interface SalesBoardData {
  items: TeamSale[]
  total: number
  summary: { pending: number; approved: number; rejected: number; pending_value: number; approved_value: number; overdue: number }
  fetched_at: string
}
