import { useId, type KeyboardEvent, type PointerEvent } from 'react'
import type { Passo } from '../lib/visao'
import { indicesDosRotulos } from './eixo'
import { caminhoSuave, indiceMaisProximo } from './geometria'
import { formatarNumero, niceTicks } from './scale'
import { useFocoNoTempo } from './useFocoNoTempo'
import { useLargura } from './useLargura'

export interface PontoKpi {
  chave: string
  rotulo: string
  valor: number
}

const MARGEM = { topo: 18, direita: 10, base: 18, esquerda: 24 }
const NOME_DO_PASSO: Record<Passo, [string, string]> = { hora: ['hora', 'horas'], dia: ['dia', 'dias'], mês: ['mês', 'meses'], ano: ['ano', 'anos'] }
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/**
 * Uma medida no tempo, no modelo do gráfico de abordagens e calls: área em degradê sob uma linha suave (verde: vendas),
 * o pico e o último ponto escritos, média tracejada opcional, mira com dica e a tabela gêmea com o acumulado. A mira é
 * a mesma dos outros gráficos da linha do tempo (FocoNoTempo). Sem dados, a moldura vazia (nada inventado).
 */
export function AreaKpi({
  id,
  pontos,
  unidade: [singular, plural],
  passo,
  resumo,
  vazio,
  altura = 132,
  media = false,
  acumulado = false,
}: {
  /** Quem aponta na mira sincronizada: "vendas". */
  id: string
  pontos: PontoKpi[]
  /** "venda"/"vendas": o valor na dica, na tabela e no rótulo de acessibilidade. */
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
  const idDoDegrade = useId().replace(/:/g, '')
  const { ativo, origem, focar, entrar } = useFocoNoTempo(id, pontos.map((p) => p.chave))
  const soma = pontos.reduce((s, p) => s + p.valor, 0)

  if (pontos.length === 0 || soma === 0) {
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

  const n = pontos.length
  const W = Math.max(160, largura)
  const plotW = W - MARGEM.esquerda - MARGEM.direita
  const plotH = altura - MARGEM.topo - MARGEM.base
  const base = MARGEM.topo + plotH
  const valores = pontos.map((p) => p.valor)
  const ticks = niceTicks(Math.max(...valores), 2)
  const topo = ticks[ticks.length - 1]
  const x = (i: number) => MARGEM.esquerda + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => base - (v / topo) * plotH
  const linha = caminhoSuave(pontos.map((p, i) => [x(i), y(p.valor)]))
  const area = n > 1 ? `${linha} L${x(n - 1)},${base} L${x(0)},${base} Z` : ''
  const pico = valores.indexOf(Math.max(...valores))
  const ultimo = n - 1
  // O pico ganha rótulo só se não colar no do último ponto.
  const rotularPico = pico !== ultimo && Math.abs(x(ultimo) - x(pico)) >= 24
  const valorMedio = soma / n
  const comMedia = media && n >= 3
  const rotulosX = indicesDosRotulos(n, plotW)
  const [umPasso, variosPassos] = NOME_DO_PASSO[passo]
  const contagem = (v: number) => `${formatarNumero(v)} ${v === 1 ? singular : plural}`
  const acumulados = valores.reduce<number[]>((lista, v) => [...lista, (lista[lista.length - 1] ?? 0) + v], [])

  function mover(e: PointerEvent<SVGSVGElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const escala = caixa.width > 0 ? W / caixa.width : 1
    focar(indiceMaisProximo((e.clientX - caixa.left) * escala - MARGEM.esquerda, n, plotW))
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') focar(Math.max(0, (ativo ?? n - 1) - 1))
    else if (e.key === 'ArrowRight') focar(Math.min(n - 1, (ativo ?? n - 1) + 1))
    else if (e.key === 'Home') focar(0)
    else if (e.key === 'End') focar(n - 1)
    else return
    e.preventDefault()
  }

  const rotuloAcessivel =
    `${resumo}: ${contagem(soma)} em ${n} ${n === 1 ? umPasso : variosPassos}. ` +
    `Pico de ${contagem(valores[pico])} em ${pontos[pico].rotulo}; último intervalo (${pontos[ultimo].rotulo}): ${contagem(valores[ultimo])}. ` +
    'Use as setas para percorrer os intervalos.'
  // A dica fica acima do gráfico, centrada no ponto e presa às bordas para não sair do cartão.
  const fracaoAtiva = ativo === null ? 0 : x(ativo) / W
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
        onFocus={entrar}
        onBlur={() => focar(null)}
        onKeyDown={teclar}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <svg
          width={W}
          height={altura}
          viewBox={`0 0 ${W} ${altura}`}
          className="block h-auto max-w-full touch-pan-y select-none"
          onPointerMove={mover}
          onPointerLeave={() => focar(null)}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={idDoDegrade} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'hsl(var(--viz-3))', stopOpacity: 0.26 }} />
              <stop offset="100%" style={{ stopColor: 'hsl(var(--viz-3))', stopOpacity: 0.02 }} />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGEM.esquerda} x2={W - MARGEM.direita} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-border' : 'stroke-viz-grid'} strokeWidth={1} />
              <text x={MARGEM.esquerda - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {formatarNumero(t)}
              </text>
            </g>
          ))}

          {area && <path data-area d={area} fill={`url(#${idDoDegrade})`} />}
          <path d={linha} fill="none" className="stroke-viz-3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

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

          {/* Rotulagem seletiva: o pico e o último ponto (somem enquanto a mira mostra outro). */}
          {ativo === null && rotularPico && (
            <text data-rotulo-ponto="pico" x={x(pico)} y={y(valores[pico]) - 7} textAnchor="middle" className="fill-foreground text-[10px] font-semibold tabular-nums">
              {formatarNumero(valores[pico])}
            </text>
          )}
          {ativo === null && (
            <text
              data-rotulo-ponto="ultimo"
              x={x(ultimo)}
              y={y(valores[ultimo]) - 9}
              textAnchor={n === 1 ? 'middle' : 'end'}
              className="fill-foreground text-[10px] font-semibold tabular-nums"
            >
              {formatarNumero(valores[ultimo])}
            </text>
          )}
          <circle cx={x(ultimo)} cy={y(valores[ultimo])} r={4} className="fill-viz-3 stroke-card" strokeWidth={2} />

          {ativo !== null && (
            <g data-mira data-chave={pontos[ativo].chave}>
              <line x1={x(ativo)} x2={x(ativo)} y1={MARGEM.topo} y2={base} className="stroke-muted-foreground/50" strokeWidth={1} />
              <circle cx={x(ativo)} cy={y(valores[ativo])} r={4.5} className="fill-viz-3 stroke-card" strokeWidth={2} />
            </g>
          )}

          {rotulosX.map((i) => (
            <text
              key={pontos[i].chave}
              x={Math.min(W - MARGEM.direita, Math.max(MARGEM.esquerda, x(i)))}
              y={altura - 4}
              textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px]"
            >
              {pontos[i].rotulo}
            </text>
          ))}
        </svg>

        {ativo !== null && origem && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-1 min-w-32 whitespace-nowrap rounded-lg border bg-popover/95 px-2.5 py-1.5 text-xs leading-4 text-popover-foreground shadow-lg backdrop-blur"
            style={{ left: `${fracaoAtiva * 100}%`, transform: `translateX(${ancoraDaDica})` }}
          >
            <p className="mb-0.5 font-medium text-muted-foreground">{pontos[ativo].rotulo}</p>
            <p className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-viz-3" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{formatarNumero(valores[ativo])}</strong>
              <span className="text-muted-foreground">{valores[ativo] === 1 ? singular : plural}</span>
            </p>
            {acumulado && <p className="mt-1 border-t pt-1 text-[11px] text-muted-foreground">{contagem(acumulados[ativo])} no acumulado</p>}
          </div>
        )}
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{passo === 'hora' ? 'Hora' : 'Período'}</th>
              <th className="py-1 text-right font-medium">{plural.charAt(0).toUpperCase() + plural.slice(1)}</th>
              <th className="py-1 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pontos.map((p, i) => (
              <tr key={p.chave} className="border-t">
                <td className="py-1">{p.rotulo}</td>
                <td className="py-1 text-right">{p.valor}</td>
                <td className="py-1 text-right">{acumulados[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
