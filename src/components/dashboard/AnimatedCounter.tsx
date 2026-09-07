import CountUp from 'react-countup'
import { cn } from '@/lib/utils'

interface AnimatedCounterProps {
  end: number
  prefix?: string
  suffix?: string
  duration?: number
  decimals?: number
  className?: string
  isCurrency?: boolean
}

export function AnimatedCounter({
  end,
  prefix = '',
  suffix = '',
  duration = 1.5,
  decimals = 0,
  className,
  isCurrency = false,
}: AnimatedCounterProps) {
  return (
    <CountUp
      end={end}
      duration={duration}
      decimals={isCurrency ? 2 : decimals}
      decimal=","
      separator="."
      prefix={isCurrency ? 'R$ ' : prefix}
      suffix={suffix}
      className={cn('tabular-nums', className)}
    />
  )
}
