import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface LevelRingProps {
  percent: number
  size?: number
  strokeWidth?: number
  className?: string
  children?: ReactNode
}

export function LevelRing({ percent, size = 40, strokeWidth = 4, className, children }: LevelRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = Math.min(100, Math.max(0, percent))
  const offset = circumference * (1 - filled / 100)
  const center = size / 2

  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(52,211,153,0.22)" strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#34d399"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  )
}
