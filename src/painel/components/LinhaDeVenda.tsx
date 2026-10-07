import { exactDate, money, type TeamSale } from '@/lib/sales'
import type { TomDoSelo } from '../lib/selos'
import { brasiliaDateKey } from '@/lib/brasilia-time'
import { formatarDiaMes, formatarHoraMinuto } from '../lib/tempo'

// A cor fica no ponto e no fundo; o texto continua na cor de texto (a identidade nunca depende só da cor).
const ESTILO: Record<TomDoSelo, { caixa: string; ponto: string }> = {
  ok: { caixa: 'border-ok/40 bg-ok/10 text-foreground', ponto: 'bg-ok' },
  aviso: { caixa: 'border-aviso/45 bg-aviso/10 text-foreground', ponto: 'bg-aviso' },
  erro: { caixa: 'border-erro/40 bg-erro/10 text-foreground', ponto: 'bg-erro' },
  destaque: { caixa: 'border-viz-1/40 bg-viz-1/10 text-foreground', ponto: 'bg-viz-1' },
}

export function SeloDaVenda({ tom, texto }: { tom: TomDoSelo; texto: string }) {
  const estilo = ESTILO[tom]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${estilo.caixa}`}>
      <span className={`size-1.5 rounded-full ${estilo.ponto}`} aria-hidden="true" />
      {texto}
    </span>
  )
}

function Voce() {
  return <span className="shrink-0 rounded-full border border-viz-2/45 bg-viz-2/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground">você</span>
}

/**
 * Uma venda na lista: hora e dia, quem vendeu e o quê, e o valor com o selo. `quando` é o instante que a linha
 * destaca (aprovação ou compra) e `rotuloQuando` diz qual dos dois é, escrito sobre a hora: a mesma venda aparece com a
 * data da compra em um bloco e a da aprovação em outro, e sem o rótulo isso parecia dado dessincronizado. Quando a
 * aprovação foi em outro dia que a compra, a linha diz também o dia da compra. O horário exato fica na dica.
 *
 * `larga` segue a grade de "Últimos registros" da referência: 3 colunas no celular (o produto desce para a 2ª linha)
 * e 4 a partir de 768 px (hora · vendedor · produto · valor e selo). Sem ela, a linha cabe num bloco estreito: o
 * valor fica sobre o selo em qualquer largura de janela.
 */
export function LinhaDeVenda({
  venda,
  voce,
  quando,
  rotuloQuando,
  selo,
  larga = false,
}: {
  venda: TeamSale
  /** Marca "você" ao lado do nome (quando o selo ainda não diz que a venda é de quem está olhando). */
  voce: boolean
  quando: string
  rotuloQuando: string
  selo: { tom: TomDoSelo; texto: string }
  larga?: boolean
}) {
  const exato = `${rotuloQuando} ${exactDate(quando)} · Brasília`
  const rotuloCurto = rotuloQuando.replace(/ em$/, '')
  const compraEmOutroDia = venda.created_at !== quando && brasiliaDateKey(venda.created_at) !== brasiliaDateKey(quando)
  const produto = (
    <>
      {venda.nome_produto}
      {venda.ticket_name ? ` · ${venda.ticket_name}` : ''}
      {compraEmOutroDia ? ` · compra de ${formatarDiaMes(venda.created_at)}` : ''}
    </>
  )
  return (
    <li>
      <div
        title={exato}
        className={`grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 ${
          larga ? 'gap-y-0.5 md:grid-cols-[3.75rem_minmax(0,1.1fr)_minmax(0,1fr)_auto]' : ''
        }`}
      >
        <time dateTime={quando} className={`text-sm tabular-nums text-muted-foreground ${larga ? 'row-span-2 md:row-span-1' : ''}`}>
          <span className="block text-[10px] leading-tight">{rotuloCurto}</span>
          {formatarHoraMinuto(quando)}
          <span className="block text-[11px] leading-tight">{formatarDiaMes(quando)}</span>
        </time>

        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-heading">
            <span className="truncate">{venda.seller_name}</span>
            {voce && <Voce />}
          </p>
          {!larga && <p className="truncate text-xs text-muted-foreground">{produto}</p>}
        </div>

        {larga && <p className="col-start-2 row-start-2 min-w-0 truncate text-xs text-muted-foreground md:col-start-3 md:row-start-1 md:text-sm md:text-foreground">{produto}</p>}

        <div
          className={`flex flex-col items-end gap-1 justify-self-end ${larga ? 'col-start-3 row-span-2 row-start-1 md:col-start-4 md:row-span-1 md:flex-row md:items-center md:gap-3' : ''}`}
        >
          <span className="text-sm font-semibold tabular-nums text-heading">{money(venda.valor_venda)}</span>
          <SeloDaVenda tom={selo.tom} texto={selo.texto} />
        </div>
      </div>
    </li>
  )
}
