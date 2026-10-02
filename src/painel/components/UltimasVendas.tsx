import { BadgeDollarSignIcon } from 'lucide-react'
import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useSalesBoard } from '@/hooks/useSalesBoard'
import { ACAO_DO_BLOCO } from '../lib/estilos'
import { Bloco } from './KpiCard'
import { LinhaDeVenda } from './LinhaDeVenda'
import { LinkSecao } from './LinkSecao'

/**
 * As 10 aprovações mais recentes do time (a mesma consulta get_sales_board que o carrossel antigo usava), na grade
 * de "Últimos registros" da referência. Registrar venda é o atalho que ficava em Ações rápidas.
 */
function UltimasVendasBase({ className = '' }: { className?: string }) {
  const { data, isLoading, isError } = useSalesBoard('aprovada', '', 0, 10)
  const { user } = useAuth()
  const navegar = useNavigate()
  const vendas = data?.items ?? []
  return (
    <Bloco
      titulo="Últimas vendas"
      descricao="As 10 aprovações mais recentes. Quem será o próximo?"
      acao={
        <div className="flex shrink-0 items-center gap-3">
          {/* No celular só o ícone: o texto apertaria o título e a descrição do bloco. */}
          <Button variant="outline" size="sm" className={ACAO_DO_BLOCO} onClick={() => navegar('/vendas?new=true')} aria-label="Registrar venda">
            <BadgeDollarSignIcon aria-hidden="true" />
            <span className="hidden sm:inline">Registrar venda</span>
          </Button>
          <LinkSecao para="/ranking">Ranking</LinkSecao>
        </div>
      }
      dataSecao="recent-sales"
      className={className}
    >
      {isError && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          Atualização indisponível. Use Atualizar no topo do painel para tentar novamente.
        </p>
      )}
      {isLoading ? (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : vendas.length === 0 && !isError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">A primeira venda aprovada abre a competição.</p>
      ) : (
        <ol aria-label="Últimas dez vendas aprovadas" className="-mx-2 divide-y divide-border">
          {vendas.map((venda) => {
            const minha = venda.user_id === user?.id
            return (
              <LinhaDeVenda
                key={venda.id}
                larga
                venda={venda}
                voce={false}
                quando={venda.reviewed_at || venda.created_at}
                rotuloQuando={venda.reviewed_at ? 'Aprovada em' : 'Registrada em'}
                selo={minha ? { tom: 'destaque', texto: 'Sua conquista' } : { tom: 'ok', texto: 'Venda confirmada' }}
              />
            )
          })}
        </ol>
      )}
    </Bloco>
  )
}

export const UltimasVendas = memo(UltimasVendasBase)
