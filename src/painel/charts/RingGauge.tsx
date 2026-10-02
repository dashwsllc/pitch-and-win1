import type { ReactNode } from 'react'

/** Anel de progresso (0 a 1) com o valor no centro. O trilho é um tom mais claro da cor da série. */
export function RingGauge({
  fracao,
  tamanho = 76,
  espessura = 8,
  rotulo,
  children,
}: {
  fracao: number
  tamanho?: number
  espessura?: number
  rotulo: string
  children: ReactNode
}) {
  const f = Math.min(1, Math.max(0, fracao))
  const raio = (tamanho - espessura) / 2
  const circunferencia = 2 * Math.PI * raio
  return (
    <div
      className="relative shrink-0"
      style={{ width: tamanho, height: tamanho }}
      role="meter"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
    >
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="-rotate-90" aria-hidden="true">
        <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" className="stroke-viz-track" strokeWidth={espessura} />
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          className="stroke-viz-1 transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={f === 0 ? circunferencia : circunferencia * (1 - f)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  )
}
