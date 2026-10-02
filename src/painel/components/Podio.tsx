import { CrownIcon, MedalIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { formatarReaisInteiros, pluralizar } from '../lib/formatar'
import { iniciais } from '../lib/iniciais'
import { NumeroAnimado } from './NumeroAnimado'

/** Uma posição do ranking, pronta para exibir (o total é a receita aprovada do mês). */
export interface LinhaDoPodio {
  posicao: number
  chave: string
  nome: string
  total: number
  vendas: number
}

const LUGARES = [
  { lugar: 1, ordem: 2, altura: 'h-20' },
  { lugar: 2, ordem: 1, altura: 'h-14' },
  { lugar: 3, ordem: 3, altura: 'h-11' },
] as const

/**
 * Pódio compacto: o 1º no centro, o 2º à esquerda e o 3º à direita. Na leitura (teclado e leitor de tela) a ordem
 * continua 1º, 2º, 3º. Só posições reais: sem gente suficiente, o degrau fica "em aberto".
 * `destaque` é a chave de quem está olhando a tela (ganha a marca "você").
 */
export function Podio({ linhas, destaque }: { linhas: LinhaDoPodio[]; destaque?: string }) {
  return (
    <ol className="podio gap-2" aria-label="Pódio">
      {LUGARES.map(({ lugar, ordem, altura }) => {
        const l = linhas[lugar - 1]
        const estilo: CSSProperties = { order: ordem }
        if (!l) {
          return (
            <li key={lugar} className="podio-lugar opacity-50" data-lugar={lugar} style={estilo}>
              <span className="podio-avatar size-10 text-muted-foreground" aria-hidden="true">
                ?
              </span>
              <p className="mt-2 text-xs text-muted-foreground">{lugar}º lugar em aberto</p>
              <div className={`podio-degrau mt-2 ${altura}`} aria-hidden="true" />
            </li>
          )
        }
        return (
          <li key={l.chave} className="podio-lugar" data-lugar={lugar} style={estilo}>
            <div className="flex w-full min-w-0 flex-col items-center">
              <span className="relative">
                {lugar === 1 && (
                  <CrownIcon aria-hidden="true" className="podio-coroa absolute left-1/2 -top-4 size-5 -translate-x-1/2" strokeWidth={2.2} />
                )}
                <span className="podio-avatar size-11 text-sm">{iniciais(l.nome)}</span>
              </span>
              <span className="mt-2 flex min-w-0 max-w-full items-center justify-center gap-1.5 text-xs font-semibold text-heading">
                <span className="truncate">{l.nome}</span>
                {l.chave === destaque && (
                  <span className="shrink-0 rounded-full border border-viz-2/45 bg-viz-2/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground">você</span>
                )}
              </span>
              <span className="mt-1 text-lg font-semibold leading-none tracking-tight text-heading">
                <NumeroAnimado valor={Math.round(l.total)} formatar={formatarReaisInteiros} />
              </span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{pluralizar(l.vendas, 'venda', 'vendas')}</span>
              <span className={`podio-degrau mt-2 flex items-start justify-center pt-2 ${altura}`}>
                <span className="podio-numero flex items-center gap-1 text-lg">
                  {lugar}
                  <MedalIcon aria-hidden="true" className="size-3.5" />
                </span>
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
