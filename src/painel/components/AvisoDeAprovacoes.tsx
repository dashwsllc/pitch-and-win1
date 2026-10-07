import { InfoIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { saleDashboardPath } from '@/lib/sales'
import { formatarReais, pluralizar } from '../lib/formatar'
import { formatarDiaMes, formatarHoraMinuto } from '../lib/tempo'
import { instanteDoRegistro, type VendaLinha } from '../lib/visao'

const MOSTRAR = 3

/**
 * Vendas aprovadas NO período cuja compra veio ANTES dele. Os totais e os gráficos seguem a data da compra (regra de
 * 23/09: aprovar ou editar não faz uma compra antiga parecer venda nova), então elas já estão somadas ao dia em que
 * foram compradas. Sem este aviso, aprovar uma venda de outro dia parecia não fazer nada na tela.
 */
export function AvisoDeAprovacoes({ vendas, className = '' }: { vendas: VendaLinha[]; className?: string }) {
  if (vendas.length === 0) return null
  const maisRecentesPrimeiro = [...vendas].sort((a, b) => Date.parse(instanteDoRegistro(b)) - Date.parse(instanteDoRegistro(a)))
  const visiveis = maisRecentesPrimeiro.slice(0, MOSTRAR)
  const resto = vendas.length - visiveis.length
  const varias = vendas.length > 1
  return (
    <section
      role="status"
      aria-label="Aprovações de compras anteriores"
      data-dashboard-section="late-approvals"
      className={`min-w-0 rounded-2xl border bg-card p-4 text-card-foreground md:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-viz-1/12 text-viz-1 ring-1 ring-viz-1/20" aria-hidden="true">
          <InfoIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">
            {varias ? `${vendas.length.toLocaleString('pt-BR')} vendas aprovadas neste período foram compradas antes` : 'Uma venda aprovada neste período foi comprada antes'}
          </h2>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {visiveis.map((v) => {
              const aprovadaEm = instanteDoRegistro(v)
              return (
                <li key={v.id} className="break-words" title={v.nome_produto}>
                  <span className="font-medium text-heading">{v.nome_produto}</span> · {formatarReais(v.valor_venda)} · compra de {formatarDiaMes(v.created_at)} · aprovada em{' '}
                  {formatarDiaMes(aprovadaEm)} às {formatarHoraMinuto(aprovadaEm)}
                  {' · '}<Link className="font-medium text-heading underline underline-offset-2" to={saleDashboardPath(v.created_at)}>Ver dia da compra</Link>
                </li>
              )
            })}
            {resto > 0 && <li>e mais {pluralizar(resto, 'venda', 'vendas')}</li>}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Cada venda conta no dia da compra, por isso {varias ? 'estas não entram' : 'esta não entra'} nos totais deste período.
          </p>
        </div>
      </div>
    </section>
  )
}
