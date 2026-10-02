import { useId } from 'react'
import { caminhoSuave } from './geometria'

/** Minigráfico decorativo (o número principal fica ao lado): área suave com degradê. */
export function Sparkline({ valores, largura = 160, altura = 48 }: { valores: number[]; largura?: number; altura?: number }) {
  const id = useId().replace(/:/g, '')
  if (valores.length < 2) return null
  const max = Math.max(1, ...valores)
  const pad = 3
  const x = (i: number) => (i / (valores.length - 1)) * largura
  const y = (v: number) => pad + (altura - pad * 2) * (1 - v / max)
  const linha = caminhoSuave(valores.map((v, i) => [x(i), y(v)]))
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} className="block h-auto max-w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--viz-1))', stopOpacity: 0.4 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--viz-1))', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={`${linha} L${largura},${altura} L0,${altura} Z`} fill={`url(#${id})`} />
      <path d={linha} fill="none" className="stroke-viz-1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={largura} cy={y(valores[valores.length - 1])} r={3.5} className="fill-viz-1 stroke-card" strokeWidth={2} />
    </svg>
  )
}
