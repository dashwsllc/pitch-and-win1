import { useId, type KeyboardEvent, type PointerEvent } from 'react'
import { indicesDosRotulos } from './eixo'
import { caminhoSuave, indiceMaisProximo } from './geometria'
import { formatarNumero, niceTicks } from './scale'
import { useFocoNoTempo } from './useFocoNoTempo'
import { useLargura } from './useLargura'

const MARGEM = { topo: 16, direita: 16, base: 30, esquerda: 40 }

export interface PontoDaSerie {
  /** Chave estável do ponto: 'yyyy-MM-dd HH' (série por hora) ou o rótulo do dia, mês ou ano. */
  chave: string
  /** '14h', '30/09 14h', '30/09', 'set 26'... */
  rotulo: string
  /** Série da ÁREA (azul): as calls feitas. */
  principal: number
  /** Série da LINHA (laranja): a medida de topo de funil. */
  secundaria: number
}

export interface TextosDaSerie {
  /** Legenda e cabeçalho da tabela, no plural e com inicial maiúscula: "Calls feitas". */
  principal: string
  secundaria: string
  /** As mesmas medidas na dica e no rótulo de acessibilidade, no singular e no plural: ['call feita', 'calls feitas']. */
  unidades: { principal: [string, string]; secundaria: [string, string] }
  /** Primeira coluna da tabela alternativa: "Hora" ou "Período". */
  coluna: string
  /** Frase que abre o rótulo de acessibilidade: "Calls feitas e abordagens por hora, no horário de Brasília". */
  resumo: string
  /** Estado vazio. */
  vazio: string
  /** Dica do clique, só quando há para onde ir. */
  clique?: string
}

const contar = (n: number, [um, varios]: [string, string]) => `${formatarNumero(n)} ${n === 1 ? um : varios}`

/** Legenda com o total de cada medida no período (os mesmos números da tabela). */
function Legenda({ textos, totais }: { textos: TextosDaSerie; totais: [number, number] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      <li className="flex items-center gap-2">
        <span className="h-2.5 w-4 rounded-[3px] bg-gradient-to-b from-viz-4/70 to-viz-4/10 ring-1 ring-viz-4" aria-hidden="true" />
        <span>{textos.principal}</span>
        <strong className="font-semibold tabular-nums text-heading">{formatarNumero(totais[0])}</strong>
      </li>
      <li className="flex items-center gap-2">
        <span className="w-4 border-t-2 border-viz-1" aria-hidden="true" />
        <span>{textos.secundaria}</span>
        <strong className="font-semibold tabular-nums text-heading">{formatarNumero(totais[1])}</strong>
      </li>
    </ul>
  )
}

/**
 * Duas medidas no tempo, num só eixo: calls em área azul com degradê e abordagens em linha laranja, com mira e dica.
 * A mira é a mesma dos outros gráficos da linha do tempo (FocoNoTempo): a
 * dica só aparece no gráfico apontado. Com `onSelecionar`, clicar num ponto (ou Enter) abre aquele intervalo.
 */
export function SeriesChart({
  pontos,
  textos,
  altura: alturaMinima = 280,
  preencher = false,
  foco,
  onSelecionar,
}: {
  pontos: PontoDaSerie[]
  textos: TextosDaSerie
  /** Altura do desenho em px (a largura acompanha o cartão). */
  altura?: number
  /** Expande o desenho para acompanhar a altura dos pódios ao lado. */
  preencher?: boolean
  /** Quem aponta na mira sincronizada ("calls"); sem ele, um id próprio. */
  foco?: string
  onSelecionar?(chave: string): void
}) {
  const { ref, largura, altura: alturaDisponivel } = useLargura()
  const altura = preencher ? Math.max(alturaMinima, alturaDisponivel) : alturaMinima
  const idGradiente = useId().replace(/:/g, '')
  const { ativo, origem, focar, entrar } = useFocoNoTempo(foco ?? idGradiente, pontos.map((p) => p.chave))
  const totais: [number, number] = [pontos.reduce((t, p) => t + p.principal, 0), pontos.reduce((t, p) => t + p.secundaria, 0)]

  if (pontos.length === 0) {
    // Sem nenhum registro: a moldura do gráfico aparece vazia (nenhum valor inventado).
    return (
      <figure className={preencher ? 'flex flex-1 flex-col' : undefined}>
        <Legenda textos={textos} totais={totais} />
        <div className={`relative mt-4 rounded-lg border border-dashed ${preencher ? 'flex-1' : ''}`} style={{ minHeight: alturaMinima, height: preencher ? undefined : altura }}>
          <div aria-hidden="true" className="absolute inset-x-0 bottom-8 border-t border-border" />
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">{textos.vazio}</p>
        </div>
      </figure>
    )
  }

  const W = Math.max(280, largura)
  const plotW = W - MARGEM.esquerda - MARGEM.direita
  const plotH = altura - MARGEM.topo - MARGEM.base
  const ticks = niceTicks(Math.max(...pontos.flatMap((p) => [p.principal, p.secundaria])))
  const topo = ticks[ticks.length - 1]
  const n = pontos.length
  const x = (i: number) => MARGEM.esquerda + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => MARGEM.topo + plotH - (v / topo) * plotH
  const base = MARGEM.topo + plotH

  const linhaPrincipal = caminhoSuave(pontos.map((p, i) => [x(i), y(p.principal)]))
  const linhaSecundaria = caminhoSuave(pontos.map((p, i) => [x(i), y(p.secundaria)]))
  const areaPrincipal = n > 1 ? `${linhaPrincipal} L${x(n - 1)},${base} L${x(0)},${base} Z` : ''
  // Rótulos sem colisão; o primeiro encosta à esquerda e o último à direita, para nenhum sair do cartão.
  const rotulosX = indicesDosRotulos(n, plotW, 64)
  const ultimo = pontos[n - 1]

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
    else if (e.key === 'Enter' && onSelecionar) onSelecionar(pontos[ativo ?? n - 1].chave)
    else return
    e.preventDefault()
  }

  const p = ativo === null ? null : pontos[ativo]
  const xAtivo = ativo === null ? 0 : x(ativo)

  return (
    <figure className={preencher ? 'flex flex-1 flex-col' : undefined}>
      <Legenda textos={textos} totais={totais} />
      <div
        ref={ref}
        role="img"
        aria-label={`${textos.resumo}. Use as setas para percorrer os pontos${onSelecionar ? ' e Enter para abrir o ponto escolhido' : ''}. Último ponto (${ultimo.rotulo}): ${contar(ultimo.principal, textos.unidades.principal)} e ${contar(ultimo.secundaria, textos.unidades.secundaria)}.`}
        tabIndex={0}
        onFocus={entrar}
        onBlur={() => focar(null)}
        onKeyDown={teclar}
        className={`relative mt-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${preencher ? 'flex-1' : ''}`}
        style={preencher ? { minHeight: alturaMinima } : undefined}
      >
        <svg
          width={W}
          height={altura}
          viewBox={`0 0 ${W} ${altura}`}
          className={`${preencher ? 'absolute inset-0' : 'block h-auto'} max-w-full touch-pan-y select-none ${onSelecionar ? 'cursor-pointer' : ''}`}
          onPointerMove={mover}
          onClick={() => {
            if (onSelecionar && ativo !== null) onSelecionar(pontos[ativo].chave)
          }}
          onPointerLeave={() => focar(null)}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'hsl(var(--viz-4))', stopOpacity: 0.3 }} />
              <stop offset="100%" style={{ stopColor: 'hsl(var(--viz-4))', stopOpacity: 0 }} />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={MARGEM.esquerda}
                x2={W - MARGEM.direita}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? 'stroke-border' : 'stroke-viz-grid'}
                strokeWidth={1}
              />
              <text x={MARGEM.esquerda - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatarNumero(t)}
              </text>
            </g>
          ))}

          {rotulosX.map((i) => (
            <text
              key={pontos[i].chave}
              x={x(i)}
              y={altura - 8}
              textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[11px]"
            >
              {pontos[i].rotulo}
            </text>
          ))}

          {areaPrincipal && <path data-area d={areaPrincipal} fill={`url(#${idGradiente})`} />}
          <path d={linhaSecundaria} fill="none" className="stroke-viz-1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={linhaPrincipal} fill="none" className="stroke-viz-4" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Ponto e rótulo só no fim da série principal (rotulagem seletiva). */}
          <circle cx={x(n - 1)} cy={y(ultimo.principal)} r={4.5} className="fill-viz-4 stroke-card" strokeWidth={2} />
          {ativo === null && (
            <text data-rotulo-ponto="ultimo" x={x(n - 1)} y={y(ultimo.principal) - 12} textAnchor={n === 1 ? 'middle' : 'end'} className="fill-foreground text-xs font-semibold tabular-nums">
              {formatarNumero(ultimo.principal)}
            </text>
          )}

          {p && (
            <g data-mira data-chave={p.chave}>
              <line x1={xAtivo} x2={xAtivo} y1={MARGEM.topo} y2={base} className="stroke-muted-foreground/50" strokeWidth={1} />
              <circle cx={xAtivo} cy={y(p.secundaria)} r={5} className="fill-viz-1 stroke-card" strokeWidth={2} />
              <circle cx={xAtivo} cy={y(p.principal)} r={5.5} className="fill-viz-4 stroke-card" strokeWidth={2} />
            </g>
          )}
        </svg>

        {p && origem && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur"
            style={{
              left: `${(xAtivo / W) * 100}%`,
              transform: `translateX(${xAtivo > W * 0.6 ? 'calc(-100% - 12px)' : '12px'})`,
            }}
          >
            <p className="mb-1.5 font-medium text-muted-foreground">{p.rotulo}</p>
            <p className="flex items-center gap-2">
              <span className="w-3 border-t-2 border-viz-4" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{formatarNumero(p.principal)}</strong>
              <span className="text-muted-foreground">{p.principal === 1 ? textos.unidades.principal[0] : textos.unidades.principal[1]}</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="w-3 border-t-2 border-viz-1" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{formatarNumero(p.secundaria)}</strong>
              <span className="text-muted-foreground">{p.secundaria === 1 ? textos.unidades.secundaria[0] : textos.unidades.secundaria[1]}</span>
            </p>
            {onSelecionar && textos.clique && <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">{textos.clique}</p>}
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{textos.coluna}</th>
              <th className="py-1 text-right font-medium">{textos.principal}</th>
              <th className="py-1 text-right font-medium">{textos.secundaria}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pontos.map((pt) => (
              <tr key={pt.chave} className="border-t">
                <td className="py-1">{pt.rotulo}</td>
                <td className="py-1 text-right">{pt.principal}</td>
                <td className="py-1 text-right">{pt.secundaria}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
