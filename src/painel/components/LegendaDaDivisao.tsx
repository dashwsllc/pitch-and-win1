import { formatarNumero, formatarPct } from '../charts/scale'

interface Parte {
  rotulo: string
  valor: number
}

/**
 * Legenda das abordagens repartidas pela demonstração da IA: o ponto com a cor de cada parte (a mesma das colunas
 * empilhadas) e o total escrito, com a porcentagem. As duas partes somam o total do indicador.
 */
export function LegendaDaDivisao({ partes: [a, b] }: { partes: [Parte, Parte] }) {
  const total = a.valor + b.valor
  const item = (parte: Parte, ponto: string) => (
    <li className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${ponto}`} aria-hidden="true" />
      {parte.rotulo} <strong className="font-semibold tabular-nums text-heading">{formatarNumero(parte.valor)}</strong>
      {total > 0 && <span className="tabular-nums">({formatarPct(parte.valor / total)})</span>}
    </li>
  )
  return (
    <ul aria-label="Abordagens por demonstração da IA" className="mt-3 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {item(a, 'bg-viz-1')}
      {item(b, 'bg-viz-2')}
    </ul>
  )
}
