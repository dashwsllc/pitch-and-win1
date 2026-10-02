import { formatarNumero } from '../charts/scale'

interface Parte {
  rotulo: string
  valor: number
}

/**
 * Barra de 8 px com 2 segmentos e respiro de 2 px, e a legenda com os totais escritos (a cor nunca carrega o dado
 * sozinha). O primeiro segmento é sempre a série 1 e o segundo a série 2: a cor segue o grupo, não o tamanho.
 */
export function BarraDividida({ partes: [a, b] }: { partes: [Parte, Parte] }) {
  return (
    <div className="mt-4">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {a.valor > 0 && <span className="h-full rounded-full bg-viz-1" style={{ flexGrow: a.valor }} />}
        {b.valor > 0 && <span className="h-full rounded-full bg-viz-2" style={{ flexGrow: b.valor }} />}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-viz-1" aria-hidden="true" />
          {a.rotulo} <strong className="font-semibold tabular-nums text-heading">{formatarNumero(a.valor)}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-viz-2" aria-hidden="true" />
          {b.rotulo} <strong className="font-semibold tabular-nums text-heading">{formatarNumero(b.valor)}</strong>
        </span>
      </div>
    </div>
  )
}
