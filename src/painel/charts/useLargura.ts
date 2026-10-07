import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Largura real do contêiner (o SVG é desenhado em pixels, sem distorcer texto nem pontos). A referência é um ref
 * de callback porque o gráfico pode aparecer depois do primeiro desenho (os dados chegam da rede e, sem pontos, só
 * existe a moldura vazia): o observador liga quando o elemento entra e desliga quando sai.
 */
export function useLargura(padrao = 640) {
  const [largura, setLargura] = useState(padrao)
  const [altura, setAltura] = useState(0)
  const observador = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observador.current?.disconnect()
    observador.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = (w: number, h: number) => {
      if (w > 0) setLargura(Math.round(w))
      setAltura(Math.round(h))
    }
    const caixa = el.getBoundingClientRect()
    medir(caixa.width, caixa.height)
    const ro = new ResizeObserver(([e]) => medir(e.contentRect.width, e.contentRect.height))
    ro.observe(el)
    observador.current = ro
  }, [])
  useEffect(() => () => observador.current?.disconnect(), [])
  return { ref, largura, altura }
}
