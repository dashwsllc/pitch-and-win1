import type { ReactNode } from 'react'
import { formatarNumero, formatarPct } from './scale'

export interface ItemBarra {
  chave: string
  rotulo: ReactNode
  /** Texto do rótulo para leitores de tela e tabela. */
  rotuloTexto: string
  total: number
  /** Fração exibida ao lado do número (ex.: da receita do período). */
  fracao?: number | null
  /** Texto curto depois do rótulo ("3 vendas"); também vai para a tabela. */
  complemento?: string
  /** Elemento antes do rótulo (foto, ícone). */
  inicio?: ReactNode
  /** Classe da cor da barra; padrão: série 1. */
  cor?: string
}

/**
 * Barras horizontais finas (uma série): valor na ponta, escala do maior item, trilha na mesma família de cor.
 * Cada linha é o alvo do mouse (realça ao passar) e o total sempre sai escrito, a cor nunca carrega o dado sozinha.
 * `formatarTotal` escreve o valor (padrão: inteiro em pt-BR).
 */
export function Barras({
  itens,
  rotulo,
  vazio = 'Sem dados ainda.',
  formatarTotal = formatarNumero,
}: {
  itens: ItemBarra[]
  rotulo: string
  vazio?: string
  formatarTotal?: (n: number) => string
}) {
  const max = Math.max(0, ...itens.map((i) => i.total))
  if (itens.length === 0 || max === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>
  }
  const temComplemento = itens.some((x) => x.complemento)
  return (
    <figure>
      <ul aria-label={rotulo} className="space-y-3">
        {itens.map((i) => (
          <li key={i.chave} className="group rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-2.5">
              {i.inicio}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-foreground" title={i.rotuloTexto}>
                    {i.rotulo}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold text-heading">{formatarTotal(i.total)}</strong>
                    {i.fracao != null && <span className="text-xs text-muted-foreground"> · {formatarPct(i.fracao)}</span>}
                  </span>
                </div>
                {i.complemento && <p className="text-[11px] leading-tight text-muted-foreground">{i.complemento}</p>}
                <div className="mt-1.5 h-2 rounded-full bg-viz-track/60" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ease-out group-hover:brightness-110 ${i.cor ?? 'bg-viz-1'}`}
                    style={{ width: `${(i.total / max) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <tbody className="tabular-nums">
            {itens.map((i) => (
              <tr key={i.chave} className="border-t">
                <td className="py-1">{i.rotuloTexto}</td>
                {temComplemento && <td className="py-1 text-right">{i.complemento ?? '—'}</td>}
                <td className="py-1 text-right">{formatarTotal(i.total)}</td>
                {itens.some((x) => x.fracao != null) && <td className="py-1 text-right">{i.fracao == null ? '—' : formatarPct(i.fracao)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
