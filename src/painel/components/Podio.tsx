import { CrownIcon, MedalIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { iniciais } from '../lib/iniciais'
import { NumeroAnimado } from './NumeroAnimado'

/** Uma posição do ranking, pronta para exibir. */
export interface LinhaDoPodio {
  posicao: number
  chave: string
  nome: string
  /** O número que ordena o ranking: a receita aprovada (Closers), os repasses (SDRs). */
  valor: number
  /** A linha de apoio sob o valor: "40 vendas", "240 abordagens". */
  apoio: string
}

const LUGARES = [
  { lugar: 1, ordem: 2, altura: 'h-11' },
  { lugar: 2, ordem: 1, altura: 'h-8' },
  { lugar: 3, ordem: 3, altura: 'h-6' },
] as const

/**
 * Pódio compacto: o 1º no centro, o 2º à esquerda e o 3º à direita. Na leitura (teclado e leitor de tela) a ordem
 * continua 1º, 2º, 3º. Só posições reais: sem gente suficiente, o degrau fica "em aberto".
 * `destaque` é a chave de quem está olhando a tela (ganha a marca "você").
 */
export function Podio({
  rotulo,
  linhas,
  formatar,
  destaque,
}: {
  /** Nome da lista para o leitor de tela: "Pódio dos Closers". */
  rotulo: string
  linhas: LinhaDoPodio[]
  /** Texto do valor: R$ inteiros, "12 repasses". */
  formatar: (n: number) => string
  destaque?: string
}) {
  return (
    <ol className="podio" aria-label={rotulo}>
      {LUGARES.map(({ lugar, ordem, altura }) => {
        const l = linhas[lugar - 1]
        const estilo: CSSProperties = { order: ordem }
        if (!l) {
          return (
            <li key={lugar} className="podio-lugar opacity-50" data-lugar={lugar} style={estilo}>
              <span className="podio-avatar size-8 text-xs text-muted-foreground" aria-hidden="true">
                ?
              </span>
              <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{lugar}º lugar em aberto</p>
              <div className={`podio-degrau mt-1.5 ${altura}`} aria-hidden="true" />
            </li>
          )
        }
        return (
          <li key={l.chave} className="podio-lugar" data-lugar={lugar} style={estilo}>
            <div className="flex w-full min-w-0 flex-col items-center">
              <span className="relative">
                {lugar === 1 && (
                  <CrownIcon aria-hidden="true" className="podio-coroa absolute left-1/2 -top-3.5 size-4 -translate-x-1/2" strokeWidth={2.2} />
                )}
                <span className="podio-avatar size-8 text-xs">{iniciais(l.nome)}</span>
              </span>
              <span className="mt-1.5 flex min-w-0 max-w-full items-center justify-center gap-1 text-xs font-semibold text-heading">
                <span className="truncate">{l.nome}</span>
                {l.chave === destaque && (
                  <span className="shrink-0 rounded-full border border-viz-2/45 bg-viz-2/10 px-1 text-[9px] font-medium uppercase tracking-wide text-foreground">você</span>
                )}
              </span>
              <span className="mt-0.5 text-[0.95rem] font-semibold leading-tight tracking-tight text-heading">
                <NumeroAnimado valor={Math.round(l.valor)} formatar={formatar} />
              </span>
              <span data-apoio className="text-[11px] leading-tight text-muted-foreground">{l.apoio}</span>
              <span className={`podio-degrau mt-1.5 flex items-start justify-center pt-1 ${altura}`}>
                <span className="podio-numero flex items-center gap-0.5 text-sm">
                  {lugar}
                  <MedalIcon aria-hidden="true" className="size-3" />
                </span>
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
