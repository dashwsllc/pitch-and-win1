import { useCallback, useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Passo } from '../lib/visao'
import { indicesDosRotulos } from './eixo'
import { caminhoAte, caminhoSuave, indiceMaisProximo, type Ponto } from './geometria'
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

// ---------------------------------------------------------------------------------------------------------------------
// Movimento. Só apresentação: o gráfico sempre renderiza (no React) o dado que recebe, no instante em que recebe; a
// animação apenas leva o desenho que está na tela até esse estado, mexendo nos atributos do SVG por refs, num único
// requestAnimationFrame. No fim, cada atributo volta exatamente ao valor que o React escreveu.
// ---------------------------------------------------------------------------------------------------------------------

/** cubic-bezier() do CSS: devolve o progresso (y) para um tempo normalizado (x). */
function curvaBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const emX = (t: number) => ((ax * t + bx) * t + cx) * t
  const emY = (t: number) => ((ay * t + by) * t + cy) * t
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let baixo = 0
    let alto = 1
    let t = x
    for (let i = 0; i < 24; i++) {
      const v = emX(t)
      if (Math.abs(v - x) < 1e-5) break
      if (v < x) baixo = t
      else alto = t
      t = (baixo + alto) / 2
    }
    return emY(t)
  }
}
/** Devagar no começo, rápido no meio, assenta no fim. */
const vaiEVolta = curvaBezier(0.65, 0, 0.35, 1)
/** ease-out do CSS. */
const saida = curvaBezier(0, 0, 0.58, 1)
const fracao = (t: number, inicio: number, duracao: number) => Math.min(1, Math.max(0, (t - inicio) / duracao))

/** Plot inicial (ms a partir da primeira chegada de dados). */
const INICIAL = { linha: [130, 600], tracejada: [250, 250], area: [430, 350], fim: 780 } as const
/** Troca de período: morph contínuo do desenho antigo para o novo. */
const MORPH = { inicio: 40, duracao: 450 } as const
/** prefers-reduced-motion: nada é desenhado nem morfado, só um fade. */
const FADE_REDUZIDO = 150

/** O que está desenhado, em coordenadas da tela (px do SVG). */
interface Desenho {
  largura: number
  pontos: Ponto[]
  base: number
  /** y da média tracejada, ou null sem média. */
  media: number | null
  /** Topo do eixo y e as marcas do grid, como o gráfico calcula. */
  topo: number
  marcas: number[]
}

interface Animacao {
  tipo: 'inicial' | 'morph' | 'fade'
  inicio: number
  /** Morph: o desenho de onde parte (o que estava na tela, inclusive no meio de outro morph). */
  de: Desenho | null
}

/** A série antiga na quantidade de pontos da nova, por índice normalizado (13 pontos viram 12 sem pulo). */
function reamostrar(de: Ponto[], para: Ponto[]): Ponto[] {
  const n = para.length
  if (de.length === n) return de
  // Um ponto só não tem largura: vira uma linha reta na altura dele, nos x da série nova.
  if (de.length === 1) return para.map(([x]) => [x, de[0][1]])
  return para.map((_, j) => {
    const posicao = n === 1 ? 0 : (j / (n - 1)) * (de.length - 1)
    const i = Math.min(de.length - 2, Math.floor(posicao))
    const f = posicao - i
    return [de[i][0] + (de[i + 1][0] - de[i][0]) * f, de[i][1] + (de[i + 1][1] - de[i][1]) * f]
  })
}

/** O mesmo contorno de área que o React desenha: a linha, depois a base, fechando. */
function contornoDaArea(linha: string, pontos: Ponto[], base: number) {
  return pontos.length > 1 ? `${linha} L${pontos[pontos.length - 1][0]},${base} L${pontos[0][0]},${base} Z` : ''
}

/**
 * Uma medida no tempo, no modelo do gráfico de abordagens e calls: área em degradê sob uma linha suave (verde: vendas),
 * o pico e o último ponto escritos, média tracejada opcional, mira com dica e a tabela gêmea com o acumulado. A mira é
 * a mesma dos outros gráficos da linha do tempo (FocoNoTempo). Sem dados, a moldura vazia (nada inventado).
 *
 * Movimento (só visual):
 * - plot inicial: a linha é revelada da esquerda para a direita (130 ms + 600 ms), a média tracejada e a área entram
 *   com fade; tudo estável em ~800 ms;
 * - troca de período ou de dados: o desenho antigo morfa para o novo (450 ms), linha e área pelo mesmo array de pontos,
 *   os números do eixo y contam do topo antigo ao novo; outra troca no meio retoma do quadro atual, sem salto;
 * - hover: mira pontilhada e marcador no ponto mais próximo em x; a dica segue o ponteiro;
 * - prefers-reduced-motion: sem desenho nem morph, só fade de 150 ms.
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
  const { ref: medir, largura } = useLargura(320)
  const idDoDegrade = useId().replace(/:/g, '')
  const idDaCortina = `${idDoDegrade}-cortina`
  const { ativo, origem, focar, entrar } = useFocoNoTempo(id, pontos.map((p) => p.chave))
  const soma = pontos.reduce((s, p) => s + p.valor, 0)
  const semDados = pontos.length === 0 || soma === 0

  // Elementos que a animação move (o React continua dono do estado final de cada um).
  const conteiner = useRef<HTMLDivElement | null>(null)
  const serieEl = useRef<SVGGElement>(null)
  const linhaEl = useRef<SVGPathElement>(null)
  const areaEl = useRef<SVGPathElement>(null)
  const mediaEl = useRef<SVGLineElement>(null)
  const cortinaEl = useRef<SVGRectElement>(null)
  const origemEl = useRef<SVGCircleElement>(null)
  const ultimoEl = useRef<SVGCircleElement>(null)
  const rotulosEl = useRef<SVGGElement>(null)
  const marcasEl = useRef<(SVGTextElement | null)[]>([])
  const dicaEl = useRef<HTMLDivElement>(null)

  const alvo = useRef<Desenho | null>(null)
  const exibido = useRef<Desenho | null>(null)
  const animacao = useRef<Animacao | null>(null)
  const quadro = useRef(0)
  const dadosVistos = useRef<string | null>(null)
  const ponteiro = useRef<{ x: number; y: number } | null>(null)
  const dicaVisivel = useRef(false)
  const ultimoAtivo = useRef<number | null>(null)

  const refDoConteiner = useCallback(
    (el: HTMLDivElement | null) => {
      conteiner.current = el
      medir(el)
    },
    [medir],
  )

  // ---------------------------------------------------------------------------------------- geometria do estado final
  const n = pontos.length
  const W = Math.max(160, largura)
  const plotW = W - MARGEM.esquerda - MARGEM.direita
  const plotH = altura - MARGEM.topo - MARGEM.base
  const base = MARGEM.topo + plotH
  const valores = pontos.map((p) => p.valor)
  const ticks = niceTicks(semDados ? 1 : Math.max(...valores), 2)
  const topo = ticks[ticks.length - 1]
  const x = (i: number) => MARGEM.esquerda + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => base - (v / topo) * plotH
  const coordenadas: Ponto[] = semDados ? [] : pontos.map((p, i) => [x(i), y(p.valor)])
  const linha = caminhoSuave(coordenadas)
  const area = contornoDaArea(linha, coordenadas, base)
  const valorMedio = n ? soma / n : 0
  const comMedia = media && n >= 3
  const desenho: Desenho | null = semDados
    ? null
    : { largura: W, pontos: coordenadas, base, media: comMedia ? y(valorMedio) : null, topo, marcas: ticks }
  const assinaturaDoDesenho = desenho ? `${W}|${altura}|${desenho.media}|${coordenadas.flat().join(',')}` : ''
  const assinaturaDosDados = pontos.map((p) => `${p.chave}:${p.valor}`).join('|')

  // ------------------------------------------------------------------------------------------------ driver de quadros
  /** Pinta o quadro do instante `agora`; devolve true quando a animação terminou. */
  const pintar = useCallback((agora: number) => {
    const a = animacao.current
    const d = alvo.current
    if (!a || !d) return true
    const t = agora - a.inicio
    const total = d.pontos.length
    const ultimo = d.pontos[total - 1]

    if (a.tipo === 'fade') {
      serieEl.current?.style.setProperty('opacity', String(saida(fracao(t, 0, FADE_REDUZIDO))))
      return t >= FADE_REDUZIDO
    }

    if (a.tipo === 'inicial') {
      // Série atual: cortina da esquerda para a direita; a linha é cortada no x da cortina, com a ponta arredondada.
      const p = vaiEVolta(fracao(t, ...INICIAL.linha))
      const x0 = d.pontos[0][0]
      const limite = x0 + (ultimo[0] - x0) * p
      linhaEl.current?.setAttribute('d', p <= 0 ? '' : p >= 1 ? caminhoSuave(d.pontos) : caminhoAte(d.pontos, limite))
      cortinaEl.current?.setAttribute('width', String(p >= 1 ? d.largura : Math.max(0, limite)))
      origemEl.current?.setAttribute('opacity', p >= 1 ? '0' : '1')
      mediaEl.current?.setAttribute('opacity', String(saida(fracao(t, ...INICIAL.tracejada))))
      areaEl.current?.setAttribute('opacity', String(saida(fracao(t, ...INICIAL.area))))
      return t >= INICIAL.fim
    }

    // Morph: linha, área e marcador andam pelo MESMO array de pontos, interpolado em coordenadas da tela.
    const de = a.de ?? d
    const p = vaiEVolta(fracao(t, MORPH.inicio, MORPH.duracao))
    const partida = reamostrar(de.pontos, d.pontos)
    const atuais: Ponto[] = d.pontos.map(([xf, yf], i) => [partida[i][0] + (xf - partida[i][0]) * p, partida[i][1] + (yf - partida[i][1]) * p])
    const baseAtual = de.base + (d.base - de.base) * p
    const caminho = caminhoSuave(atuais)
    linhaEl.current?.setAttribute('d', caminho)
    areaEl.current?.setAttribute('d', contornoDaArea(caminho, atuais, baseAtual))
    const ponta = atuais[total - 1]
    ultimoEl.current?.setAttribute('cx', String(ponta[0]))
    ultimoEl.current?.setAttribute('cy', String(ponta[1]))
    let mediaAtual = d.media
    if (d.media !== null) {
      mediaAtual = (de.media ?? d.media) + (d.media - (de.media ?? d.media)) * p
      mediaEl.current?.setAttribute('y1', String(mediaAtual))
      mediaEl.current?.setAttribute('y2', String(mediaAtual))
    }
    // Eixo y: as linhas do grid ficam paradas; os números contam do topo antigo ao novo, nos mesmos degraus.
    const topoAtual = de.topo + (d.topo - de.topo) * p
    if (de.topo !== d.topo) {
      d.marcas.forEach((marca, k) => {
        const el = marcasEl.current[k]
        if (el) el.textContent = formatarNumero(Math.round((topoAtual * marca) / d.topo))
      })
    }
    exibido.current = { ...d, pontos: atuais, base: baseAtual, media: mediaAtual, topo: topoAtual }
    return t >= MORPH.inicio + MORPH.duracao
  }, [])

  /** Devolve cada atributo ao valor que o React escreveu (o estado final) e libera a mira e a dica. */
  const finalizar = useCallback(() => {
    cancelAnimationFrame(quadro.current)
    const d = alvo.current
    animacao.current = null
    conteiner.current?.removeAttribute('data-animando')
    serieEl.current?.style.removeProperty('opacity')
    rotulosEl.current?.style.removeProperty('opacity')
    if (!d) return
    const caminho = caminhoSuave(d.pontos)
    linhaEl.current?.setAttribute('d', caminho)
    areaEl.current?.setAttribute('d', contornoDaArea(caminho, d.pontos, d.base))
    areaEl.current?.removeAttribute('opacity')
    mediaEl.current?.removeAttribute('opacity')
    if (d.media !== null) {
      mediaEl.current?.setAttribute('y1', String(d.media))
      mediaEl.current?.setAttribute('y2', String(d.media))
    }
    const ponta = d.pontos[d.pontos.length - 1]
    ultimoEl.current?.setAttribute('cx', String(ponta[0]))
    ultimoEl.current?.setAttribute('cy', String(ponta[1]))
    cortinaEl.current?.setAttribute('width', String(d.largura))
    origemEl.current?.setAttribute('opacity', '0')
    d.marcas.forEach((marca, k) => {
      const el = marcasEl.current[k]
      if (el) el.textContent = formatarNumero(marca)
    })
    exibido.current = d
  }, [])

  const iniciar = useCallback(
    (tipo: Animacao['tipo']) => {
      cancelAnimationFrame(quadro.current)
      animacao.current = { tipo, inicio: performance.now(), de: tipo === 'morph' ? exibido.current : null }
      if (!exibido.current) exibido.current = alvo.current
      // Durante o movimento a mira, o marcador e a dica somem (não mostram o valor de um ponto andando).
      conteiner.current?.setAttribute('data-animando', '')
      // Os números do pico e do último ponto voltam no fim do morph (no plot inicial, a cortina os revela).
      if (tipo === 'morph') rotulosEl.current?.style.setProperty('opacity', '0')
      const passo = (agora: number) => {
        if (pintar(agora)) finalizar()
        else quadro.current = requestAnimationFrame(passo)
      }
      // O quadro 0 é pintado já aqui, antes de o navegador pintar o que o React escreveu: sem flash.
      if (pintar(performance.now())) finalizar()
      else quadro.current = requestAnimationFrame(passo)
    },
    [pintar, finalizar],
  )

  useLayoutEffect(() => {
    alvo.current = desenho
    if (!desenho) {
      // Sem dados: a moldura vazia substitui o SVG. A próxima chegada de dados é um plot inicial.
      cancelAnimationFrame(quadro.current)
      animacao.current = null
      exibido.current = null
      dadosVistos.current = null
      return
    }
    const mudaramOsDados = dadosVistos.current !== assinaturaDosDados
    dadosVistos.current = assinaturaDosDados
    const reduzido = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const a = animacao.current
    if (!a && !exibido.current) iniciar(reduzido ? 'fade' : 'inicial')
    // Plot inicial em curso, ou só a largura mudou no meio de um movimento: segue o mesmo relógio rumo ao novo alvo.
    // O quadro atual é repintado já, antes de o navegador mostrar o estado final que o React acabou de escrever.
    else if (a && (a.tipo === 'inicial' || !mudaramOsDados)) {
      if (pintar(performance.now())) finalizar()
    } else if (!mudaramOsDados) exibido.current = desenho
    // Dados novos (período, filtro ou venda ao vivo): morfa a partir do que está na tela, mesmo no meio de outro morph.
    else iniciar(reduzido ? 'fade' : 'morph')
    // As assinaturas resumem tudo de que o efeito depende (o desenho e os dados).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaDoDesenho, assinaturaDosDados])

  useLayoutEffect(
    () => () => {
      // Desmontagem: nada fica rodando, e uma montagem nova (StrictMode) começa do plot inicial.
      cancelAnimationFrame(quadro.current)
      animacao.current = null
      exibido.current = null
      dadosVistos.current = null
    },
    [],
  )

  // ----------------------------------------------------------------------------------------------------------- hover
  if (ativo !== null) ultimoAtivo.current = ativo
  // Ao sair, mira, marcador e dica ficam no último ponto enquanto somem (fade de 120 ms).
  const indiceDaMira = ativo ?? (ultimoAtivo.current !== null ? Math.min(ultimoAtivo.current, n - 1) : null)
  const comDica = ativo !== null && origem

  /** Dica ancorada no ponteiro (12 px à direita e acima), presa ao gráfico; perto da borda direita vai para a esquerda. */
  const posicionarDica = useCallback(
    (semDeslizar: boolean) => {
      const dica = dicaEl.current
      const caixa = conteiner.current
      if (!dica || !caixa) return
      let px: number
      let py: number
      if (ponteiro.current) ({ x: px, y: py } = ponteiro.current)
      else {
        // Teclado: ancora no ponto ativo.
        const d = alvo.current
        const i = ultimoAtivo.current
        if (!d || i === null || !d.pontos[i]) return
        const escala = caixa.clientWidth / d.largura
        px = d.pontos[i][0] * escala
        py = d.pontos[i][1] * escala
      }
      const w = dica.offsetWidth
      const h = dica.offsetHeight
      const larguraDaCaixa = caixa.clientWidth
      const alturaDaCaixa = caixa.clientHeight
      let esquerda = px + 12
      if (esquerda + w > larguraDaCaixa) esquerda = px - 12 - w
      esquerda = Math.min(Math.max(0, esquerda), Math.max(0, larguraDaCaixa - w))
      const acima = Math.min(Math.max(0, py - 12 - h), Math.max(0, alturaDaCaixa - h))
      const transformacao = `translate(${Math.round(esquerda)}px, ${Math.round(acima)}px)`
      if (semDeslizar) {
        // Entrada: aparece no lugar, sem deslizar de onde estava da última vez.
        dica.style.transition = 'opacity 120ms ease-out'
        dica.style.transform = transformacao
        void dica.offsetWidth
        dica.style.removeProperty('transition')
      } else dica.style.transform = transformacao
    },
    [],
  )

  // O conteúdo da dica troca na hora; a posição é refeita com o tamanho novo. Ao reaparecer, entra sem deslizar.
  useLayoutEffect(() => {
    if (comDica) {
      posicionarDica(!dicaVisivel.current)
      dicaVisivel.current = true
    } else dicaVisivel.current = false
  }, [comDica, ativo, posicionarDica])

  if (semDados) {
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

  const pico = valores.indexOf(Math.max(...valores))
  const ultimo = n - 1
  // O pico ganha rótulo só se não colar no do último ponto.
  const rotularPico = pico !== ultimo && Math.abs(x(ultimo) - x(pico)) >= 24
  const rotulosX = indicesDosRotulos(n, plotW)
  const [umPasso, variosPassos] = NOME_DO_PASSO[passo]
  const contagem = (v: number) => `${formatarNumero(v)} ${v === 1 ? singular : plural}`
  const acumulados = valores.reduce<number[]>((lista, v) => [...lista, (lista[lista.length - 1] ?? 0) + v], [])

  function mover(e: PointerEvent<SVGSVGElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const escala = caixa.width > 0 ? W / caixa.width : 1
    const local = conteiner.current?.getBoundingClientRect()
    if (local) ponteiro.current = { x: e.clientX - local.left, y: e.clientY - local.top }
    focar(indiceMaisProximo((e.clientX - caixa.left) * escala - MARGEM.esquerda, n, plotW))
    // A dica acompanha o ponteiro com um leve atraso (transição de transform no painel.css).
    if (dicaVisivel.current) posicionarDica(false)
  }

  function sair() {
    ponteiro.current = null
    focar(null)
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    ponteiro.current = null
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
        ref={refDoConteiner}
        role="img"
        aria-label={rotuloAcessivel}
        tabIndex={0}
        onFocus={entrar}
        onBlur={() => focar(null)}
        onKeyDown={teclar}
        className="grafico-area relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <svg
          width={W}
          height={altura}
          viewBox={`0 0 ${W} ${altura}`}
          className="block h-auto max-w-full touch-pan-y select-none"
          onPointerMove={mover}
          onPointerLeave={sair}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={idDoDegrade} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'hsl(var(--viz-3))', stopOpacity: 0.26 }} />
              <stop offset="100%" style={{ stopColor: 'hsl(var(--viz-3))', stopOpacity: 0.02 }} />
            </linearGradient>
            {/* Cortina do plot inicial para o ponto final e os números (cobre o SVG inteiro no estado final). */}
            <clipPath id={idDaCortina}>
              <rect ref={cortinaEl} x={0} y={0} width={W} height={altura} />
            </clipPath>
          </defs>

          {ticks.map((t, k) => (
            <g key={t}>
              <line x1={MARGEM.esquerda} x2={W - MARGEM.direita} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-border' : 'stroke-viz-grid'} strokeWidth={1} />
              <text
                ref={(el) => {
                  marcasEl.current[k] = el
                }}
                x={MARGEM.esquerda - 6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {formatarNumero(t)}
              </text>
            </g>
          ))}

          <g ref={serieEl}>
            {area && <path ref={areaEl} data-area d={area} fill={`url(#${idDoDegrade})`} />}
            <path ref={linhaEl} d={linha} fill="none" className="stroke-viz-3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {/* Plot inicial: um ponto de 2 px na origem da série enquanto a linha não começou (invisível no estado final). */}
            <circle ref={origemEl} cx={coordenadas[0][0]} cy={coordenadas[0][1]} r={1} className="fill-viz-3" opacity={0} />

            {comMedia && (
              <line
                ref={mediaEl}
                x1={MARGEM.esquerda}
                x2={W - MARGEM.direita}
                y1={y(valorMedio)}
                y2={y(valorMedio)}
                className="stroke-muted-foreground/70"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            <g clipPath={`url(#${idDaCortina})`}>
              {/* Rotulagem seletiva: o pico e o último ponto (somem enquanto a mira mostra outro). */}
              <g ref={rotulosEl}>
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
              </g>
              <circle ref={ultimoEl} cx={x(ultimo)} cy={y(valores[ultimo])} r={4} className="fill-viz-3 stroke-card" strokeWidth={2} />
            </g>
          </g>

          {/* Mira: linha de 1 px pontilhada e marcador no ponto ativo; trocam de ponto na hora, entram e saem em 120 ms. */}
          {indiceDaMira !== null && indiceDaMira >= 0 && (
            <g
              className="grafico-foco"
              data-mira={ativo !== null ? '' : undefined}
              data-chave={ativo !== null ? pontos[indiceDaMira].chave : undefined}
              style={{ opacity: ativo !== null ? 1 : 0 }}
            >
              <line x1={x(indiceDaMira)} x2={x(indiceDaMira)} y1={MARGEM.topo} y2={base} className="stroke-muted-foreground/25" strokeWidth={1} strokeDasharray="2 3" />
              <circle cx={x(indiceDaMira)} cy={y(valores[indiceDaMira])} r={3} className="fill-viz-3 stroke-card" strokeWidth={2} />
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

        {/* Dica: sempre montada (para poder entrar e sair com fade); só é "tooltip" enquanto mostra o ponto ativo. */}
        <div
          ref={dicaEl}
          role={comDica ? 'tooltip' : undefined}
          aria-hidden={comDica ? undefined : true}
          className="grafico-dica pointer-events-none absolute left-0 top-0 z-10 min-w-36 whitespace-nowrap rounded-[8px] border bg-popover/[0.92] px-2.5 py-2 text-[11.5px] leading-4 text-popover-foreground shadow-lg backdrop-blur-sm"
          style={{ opacity: comDica ? 1 : 0 }}
        >
          {indiceDaMira !== null && indiceDaMira >= 0 && (
            <>
              <p className="mb-1 font-semibold text-popover-foreground">{pontos[indiceDaMira].rotulo}</p>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1">
                <span className="w-3 border-t-2 border-viz-3" aria-hidden="true" />
                <span className="text-muted-foreground">{plural.charAt(0).toUpperCase() + plural.slice(1)}</span>
                <strong className="text-right font-semibold tabular-nums text-popover-foreground">{formatarNumero(valores[indiceDaMira])}</strong>
              </div>
              {acumulado && <p className="mt-1.5 border-t pt-1.5 text-muted-foreground">{contagem(acumulados[indiceDaMira])} no acumulado</p>}
            </>
          )}
        </div>
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
