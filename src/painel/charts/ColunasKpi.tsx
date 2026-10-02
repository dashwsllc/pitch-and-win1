import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Passo } from '../lib/visao'
import { formatarNumero, niceTicks } from './scale'
import { useLargura } from './useLargura'

export interface ColunaKpi {
  chave: string
  rotulo: string
  /** Valores empilhados de baixo para cima, na ordem de `series`. */
  partes: number[]
}

export interface SerieKpi {
  /** Nome no plural e em minúsculas, para a dica ("mostraram a IA"). */
  nome: string
  /** Cor da série (só as de dados): a coluna ganha um degradê vertical dela, cheio no topo. */
  cor: keyof typeof CORES
  /** Classe do ponto da dica (bg-viz-1...). */
  ponto: string
}

const CORES = { 'viz-1': 'hsl(var(--viz-1))', 'viz-2': 'hsl(var(--viz-2))' } as const
const MARGEM = { topo: 18, direita: 2, base: 18, esquerda: 24 }
const NOME_DO_PASSO: Record<Passo, [string, string]> = { hora: ['hora', 'horas'], dia: ['dia', 'dias'], mês: ['mês', 'meses'], ano: ['ano', 'anos'] }
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** Rótulos do eixo X sem colisão: espaçados pela largura útil, sempre com o último. */
function indicesDosRotulos(n: number, larguraUtil: number): number[] {
  const cada = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(larguraUtil / 44))))
  const indices: number[] = []
  for (let i = 0; i < n; i += cada) indices.push(i)
  const ultimo = indices[indices.length - 1]
  if (ultimo !== n - 1) {
    if (n - 1 - ultimo < cada * 0.6) indices[indices.length - 1] = n - 1
    else indices.push(n - 1)
  }
  return indices
}

/**
 * Colunas dos indicadores: uma série (vendas) ou duas empilhadas (abordagens com e sem a IA), nos mesmos intervalos
 * do gráfico grande. Um eixo só, valores do pico e do último intervalo escritos, média tracejada opcional e, ao
 * passar o mouse ou percorrer com as setas, a dica do intervalo. Sem dados, a moldura vazia (nada inventado).
 */
export function ColunasKpi({
  colunas,
  series,
  unidade: [singular, plural],
  passo,
  resumo,
  vazio,
  altura = 132,
  media = false,
  acumulado = false,
}: {
  colunas: ColunaKpi[]
  series: SerieKpi[]
  /** "venda"/"vendas": o total do intervalo na dica e no rótulo de acessibilidade. */
  unidade: [string, string]
  passo: Passo
  /** Legenda do gráfico e começo do rótulo de acessibilidade: "Vendas por hora". */
  resumo: string
  vazio: string
  altura?: number
  /** Linha tracejada com a média por intervalo. */
  media?: boolean
  /** Dica com o acumulado até o intervalo. */
  acumulado?: boolean
}) {
  const { ref, largura } = useLargura(320)
  const [ativo, setAtivo] = useState<number | null>(null)
  const idDoDegrade = useId().replace(/:/g, '')
  const totais = colunas.map((c) => c.partes.reduce((s, v) => s + v, 0))
  const soma = totais.reduce((s, v) => s + v, 0)

  if (colunas.length === 0 || soma === 0) {
    return (
      <figure>
        <figcaption className="mb-2 text-[11px] text-muted-foreground">{resumo}</figcaption>
        <div className="relative rounded-lg border border-dashed" style={{ height: altura }}>
          <div aria-hidden="true" className="absolute inset-x-0 border-t border-border" style={{ bottom: MARGEM.base }} />
          <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">{vazio}</p>
        </div>
      </figure>
    )
  }

  const n = colunas.length
  const W = Math.max(160, largura)
  const plotW = W - MARGEM.esquerda - MARGEM.direita
  const plotH = altura - MARGEM.topo - MARGEM.base
  const base = MARGEM.topo + plotH
  const ticks = niceTicks(Math.max(...totais), 2)
  const topo = ticks[ticks.length - 1]
  const y = (v: number) => base - (v / topo) * plotH
  const faixa = plotW / n
  const largCol = Math.max(2, Math.min(26, faixa * (n > 40 ? 0.78 : 0.64)))
  const xCol = (i: number) => MARGEM.esquerda + i * faixa + (faixa - largCol) / 2
  const raio = Math.min(3, largCol / 2)
  const respiro = largCol >= 6 ? 1.5 : 1
  const pico = totais.indexOf(Math.max(...totais))
  const ultimo = n - 1
  const valorMedio = soma / n
  const comMedia = media && n >= 3
  const rotulosX = indicesDosRotulos(n, plotW)
  const [umPasso, variosPassos] = NOME_DO_PASSO[passo]
  const contagem = (v: number) => `${formatarNumero(v)} ${v === 1 ? singular : plural}`
  const somaAte = (i: number) => totais.slice(0, i + 1).reduce((s, v) => s + v, 0)

  function mover(e: PointerEvent<SVGSVGElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const escala = caixa.width > 0 ? W / caixa.width : 1
    const x = (e.clientX - caixa.left) * escala - MARGEM.esquerda
    setAtivo(Math.min(n - 1, Math.max(0, Math.floor(x / faixa))))
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setAtivo((a) => Math.max(0, (a ?? n - 1) - 1))
    else if (e.key === 'ArrowRight') setAtivo((a) => Math.min(n - 1, (a ?? n - 1) + 1))
    else if (e.key === 'Home') setAtivo(0)
    else if (e.key === 'End') setAtivo(n - 1)
    else return
    e.preventDefault()
  }

  const rotuloAcessivel =
    `${resumo}: ${contagem(soma)} em ${n} ${n === 1 ? umPasso : variosPassos}. ` +
    `Pico de ${contagem(totais[pico])} em ${colunas[pico].rotulo}; último intervalo (${colunas[ultimo].rotulo}): ${contagem(totais[ultimo])}. ` +
    'Use as setas para percorrer os intervalos.'
  // A dica fica acima do gráfico, centrada na coluna e presa às bordas para não sair do cartão.
  const fracaoAtiva = ativo === null ? 0 : (xCol(ativo) + largCol / 2) / W
  const ancoraDaDica = fracaoAtiva < 0.25 ? '0%' : fracaoAtiva > 0.75 ? '-100%' : '-50%'

  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{resumo}</span>
        {comMedia && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t border-dashed border-muted-foreground" aria-hidden="true" />
            média {decimal.format(valorMedio)} por {umPasso}
          </span>
        )}
      </figcaption>
      <div
        ref={ref}
        role="img"
        aria-label={rotuloAcessivel}
        tabIndex={0}
        onFocus={() => setAtivo((a) => a ?? n - 1)}
        onBlur={() => setAtivo(null)}
        onKeyDown={teclar}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <svg
          width={W}
          height={altura}
          viewBox={`0 0 ${W} ${altura}`}
          className="block h-auto max-w-full touch-pan-y select-none"
          onPointerMove={mover}
          onPointerLeave={() => setAtivo(null)}
          aria-hidden="true"
        >
          <defs>
            {series.map((s, k) => (
              <linearGradient key={s.cor} id={`${idDoDegrade}-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: CORES[s.cor], stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: CORES[s.cor], stopOpacity: 0.6 }} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGEM.esquerda} x2={W - MARGEM.direita} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-border' : 'stroke-viz-grid'} strokeWidth={1} />
              <text x={MARGEM.esquerda - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {formatarNumero(t)}
              </text>
            </g>
          ))}

          {colunas.map((c, i) => {
            let topoDaPilha = base
            return (
              <g key={c.chave} data-coluna={c.chave} data-total={totais[i]} className="transition-opacity duration-150" opacity={ativo === null || ativo === i ? 1 : 0.5}>
                {c.partes.map((v, k) => {
                  if (v <= 0) return null
                  // O respiro entre as partes sai da parte de cima: o topo da pilha continua no total certo.
                  const alturaDaParte = (v / topo) * plotH
                  const respiroAqui = topoDaPilha < base ? respiro : 0
                  const yParte = topoDaPilha - alturaDaParte
                  topoDaPilha = yParte
                  return (
                    <rect
                      key={k}
                      x={xCol(i)}
                      y={yParte}
                      width={largCol}
                      height={Math.max(1, alturaDaParte - respiroAqui)}
                      rx={raio}
                      fill={`url(#${idDoDegrade}-${k})`}
                      className="painel-coluna"
                      style={{ animationDelay: `${Math.min(i * 18, 320)}ms` }}
                    />
                  )
                })}
              </g>
            )
          })}

          {comMedia && (
            <line
              x1={MARGEM.esquerda}
              x2={W - MARGEM.direita}
              y1={y(valorMedio)}
              y2={y(valorMedio)}
              className="stroke-muted-foreground/70"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {ativo === null &&
            [...new Set([pico, ultimo])].map((i) => (
              <text key={i} x={xCol(i) + largCol / 2} y={y(totais[i]) - 5} textAnchor="middle" className="fill-foreground text-[10px] font-semibold tabular-nums">
                {formatarNumero(totais[i])}
              </text>
            ))}

          {rotulosX.map((i) => (
            <text
              key={colunas[i].chave}
              x={Math.min(W - MARGEM.direita, Math.max(MARGEM.esquerda, xCol(i) + largCol / 2))}
              y={altura - 4}
              textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px]"
            >
              {colunas[i].rotulo}
            </text>
          ))}
        </svg>

        {ativo !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-1 min-w-32 whitespace-nowrap rounded-lg border bg-popover/95 px-2.5 py-1.5 text-xs leading-4 text-popover-foreground shadow-lg backdrop-blur"
            style={{ left: `${fracaoAtiva * 100}%`, transform: `translateX(${ancoraDaDica})` }}
          >
            <p className="mb-0.5 font-medium text-muted-foreground">{colunas[ativo].rotulo}</p>
            <p>
              <strong className="tabular-nums text-foreground">{formatarNumero(totais[ativo])}</strong>{' '}
              <span className="text-muted-foreground">{totais[ativo] === 1 ? singular : plural}</span>
            </p>
            {series.length > 1 &&
              series.map((s, k) => (
                <p key={s.nome} className="flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${s.ponto}`} aria-hidden="true" />
                  <strong className="tabular-nums text-foreground">{formatarNumero(colunas[ativo].partes[k] ?? 0)}</strong>
                  <span className="text-muted-foreground">{s.nome}</span>
                </p>
              ))}
            {acumulado && <p className="mt-1 border-t pt-1 text-[11px] text-muted-foreground">{contagem(somaAte(ativo))} no acumulado</p>}
          </div>
        )}
      </div>
    </figure>
  )
}
