import { saleStatus, type TeamSale } from '@/lib/sales'

export type TomDoSelo = 'ok' | 'aviso' | 'erro' | 'destaque'

const TOM_DO_STATUS: Record<TeamSale['approval_status'], TomDoSelo> = {
  aprovada: 'ok',
  pendente: 'aviso',
  rejeitada: 'erro',
  cancelada: 'erro',
  estornada: 'aviso',
}

/** Selo do estado da venda, com o mesmo texto que o painel antigo usava (Aprovado, Pendente...). */
export const seloDoStatus = (status: TeamSale['approval_status']) => ({ tom: TOM_DO_STATUS[status], texto: saleStatus[status].label })
