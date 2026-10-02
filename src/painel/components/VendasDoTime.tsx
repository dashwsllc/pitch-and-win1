import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useSalesBoard } from '@/hooks/useSalesBoard'
import { errorMessage, exactDate, saleStatus } from '@/lib/sales'
import { Bloco } from './KpiCard'
import { seloDoStatus } from '../lib/selos'
import { LinhaDeVenda } from './LinhaDeVenda'
import { LinkSecao } from './LinkSecao'
import { Segmentos } from './Segmentos'

const POR_PAGINA = 5
type Aba = 'aprovada' | 'pendente'
const ABAS: Array<{ valor: Aba; rotulo: string }> = [
  { valor: 'aprovada', rotulo: saleStatus.aprovada.label },
  { valor: 'pendente', rotulo: saleStatus.pendente.label },
]

/**
 * Vendas do time, da solicitação à aprovação: abas Aprovado/Pendente e 5 por página. A mesma consulta
 * get_sales_board da Central de vendas, sem as ações de gestão (que ficam em Metas, para quem pode).
 */
function VendasDoTimeBase({ className = '' }: { className?: string }) {
  const [status, setStatus] = useState<Aba>('aprovada')
  const [pagina, setPagina] = useState(0)
  const { user } = useAuth()
  const consulta = useSalesBoard(status, '', pagina, POR_PAGINA)

  useEffect(() => {
    if (consulta.data && pagina > 0 && consulta.data.items.length === 0) setPagina((p) => Math.max(0, p - 1))
  }, [consulta.data, pagina])

  const itens = consulta.data?.items ?? []
  const total = consulta.data?.total ?? 0

  return (
    <Bloco
      titulo="Vendas do time"
      descricao="Da solicitação à aprovação. Acompanhe a evolução de todos."
      acao={
        <div className="flex items-center gap-1">
          <LinkSecao para="/vendas-time">Ver todas</LinkSecao>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void consulta.refetch()}
            disabled={consulta.isFetching}
            aria-label="Atualizar vendas"
          >
            <RefreshCwIcon className={`size-3.5 ${consulta.isFetching ? 'motion-safe:animate-spin' : ''}`} />
          </Button>
        </div>
      }
      dataSecao="transparent-operation"
      className={className}
    >
      <div className="mb-3">
        <Segmentos
          rotulo="Status da venda"
          opcoes={ABAS}
          valor={status}
          tamanho="pequeno"
          onChange={(valor) => {
            setStatus(valor)
            setPagina(0)
          }}
        />
      </div>
      {consulta.isError && (
        <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          Falha ao atualizar vendas. {errorMessage(consulta.error)}
          {consulta.data ? ' Os dados abaixo são da última consulta bem-sucedida.' : ''}
        </p>
      )}
      {consulta.isLoading ? (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : itens.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-foreground">{status === 'pendente' ? 'Nenhuma venda aguardando aprovação' : 'Nenhuma venda neste filtro'}</p>
          <p className="mt-1 text-xs text-muted-foreground">As solicitações e decisões aparecem automaticamente aqui.</p>
        </div>
      ) : (
        <ol aria-label={`Vendas do time: ${saleStatus[status].label}`} className="-mx-2 divide-y divide-border">
          {itens.map((venda) => (
            <LinhaDeVenda
              key={venda.id}
              venda={venda}
              voce={venda.user_id === user?.id}
              quando={venda.created_at}
              rotuloQuando="Compra em"
              selo={seloDoStatus(venda.approval_status)}
            />
          ))}
        </ol>
      )}
      {consulta.data && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <p>
            {total} resultados · consulta {exactDate(consulta.data.fetched_at)} · Brasília
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={pagina === 0 || consulta.isFetching} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="tabular-nums">
              {pagina + 1} / {Math.max(1, Math.ceil(total / POR_PAGINA))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={(pagina + 1) * POR_PAGINA >= total || consulta.isFetching}
              onClick={() => setPagina((p) => p + 1)}
              aria-label="Próxima página"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Bloco>
  )
}

export const VendasDoTime = memo(VendasDoTimeBase)
