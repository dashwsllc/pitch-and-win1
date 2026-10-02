import { useEffect, useRef, useState } from 'react'
import { formatarNumero } from '../charts/scale'

function reduzMovimento(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Número que conta até o valor ao abrir e quando muda ao vivo (com um leve realce ao mudar). Sem animação para quem pede
 * menos movimento. O valor final é sempre o exato. A contagem é de inteiros: dinheiro entra em centavos e o
 * `formatar` devolve o texto (ver `formatarReais`).
 */
export function NumeroAnimado({ valor, formatar = formatarNumero, className }: { valor: number; formatar?: (n: number) => string; className?: string }) {
  // null: mostra o valor exato. Um número: a contagem em andamento.
  const [contando, setContando] = useState<number | null>(() => (reduzMovimento() ? null : 0))
  // O que está na tela agora: a animação parte daqui (sobrevive ao efeito rodar duas vezes no modo estrito do React).
  const mostrado = useRef(0)

  useEffect(() => {
    const de = mostrado.current
    if (reduzMovimento()) {
      mostrado.current = valor
      return
    }
    const inicio = performance.now()
    const duracao = de === 0 ? 900 : 550
    let quadro = 0
    const passo = (t: number) => {
      const k = de === valor ? 1 : Math.min(1, (t - inicio) / duracao)
      const atual = de + (valor - de) * (1 - (1 - k) ** 3)
      mostrado.current = k < 1 ? atual : valor
      setContando(k < 1 ? atual : null)
      if (k < 1) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [valor])

  return (
    <span key={valor} className={`painel-numero-subiu ${className ?? ''}`}>
      {formatar(Math.round(contando ?? valor))}
    </span>
  )
}
