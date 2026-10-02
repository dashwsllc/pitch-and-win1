import { Bloco } from './KpiCard'
import { LinkSecao } from './LinkSecao'
import { Podio, type LinhaDoPodio } from './Podio'

/**
 * Um pódio do mês num cartão compacto: título, a régua do ranking, o atalho para Ranking e os estados de carga, erro e
 * vazio. Os degraus ficam no pé do cartão, alinhados com o cartão ao lado quando a coluna estica.
 */
export function CartaoDoPodio({
  titulo,
  descricao,
  linhas,
  formatar,
  carregando,
  erro,
  vazio,
  destaque,
}: {
  titulo: string
  /** A régua e a janela do ranking: "Receita aprovada no mês". */
  descricao: string
  linhas: LinhaDoPodio[]
  formatar: (n: number) => string
  carregando: boolean
  erro: boolean
  /** Sem ninguém no ranking: "Nenhum Closer elegível no ranking." */
  vazio: string
  destaque?: string
}) {
  return (
    <Bloco compacto titulo={titulo} descricao={descricao} acao={<LinkSecao para="/ranking">Ranking</LinkSecao>} className="flex flex-col">
      {erro && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          Não foi possível atualizar o ranking.
        </p>
      )}
      {carregando ? (
        <p role="status" className="my-auto py-4 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : (
        <div className="mt-auto pt-4">
          <Podio rotulo={titulo} linhas={linhas.slice(0, 3)} formatar={formatar} destaque={destaque} />
          {linhas.length === 0 && !erro && <p className="mt-2 text-center text-xs text-muted-foreground">{vazio}</p>}
        </div>
      )}
    </Bloco>
  )
}
