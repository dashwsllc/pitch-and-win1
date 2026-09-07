import { useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useGoals } from '@/hooks/useGoals'
import { AnimatedCounter } from './AnimatedCounter'
import { cn } from '@/lib/utils'
import { Target, Trophy, CalendarDays, CalendarRange, Calendar } from 'lucide-react'

function CircularProgress({ percent, size = 80, strokeWidth = 6, children, color }: {
  percent: number
  size?: number
  strokeWidth?: number
  children?: React.ReactNode
  color: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          className="stroke-white/[0.055]"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all ease-out"
          style={{ transitionDuration: '1000ms', filter: `drop-shadow(0 0 4px ${color}28)` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  )
}

const periodConfig = {
  daily: { label: 'Meta Diária', icon: CalendarDays, color: 'rgb(253, 137, 37)', gradient: 'from-amber-500/20 to-orange-500/20' },
  weekly: { label: 'Meta Semanal', icon: CalendarRange, color: 'rgb(7, 122, 199)', gradient: 'from-blue-500/20 to-indigo-500/20' },
  monthly: { label: 'Meta Mensal', icon: Calendar, color: 'rgb(107, 33, 239)', gradient: 'from-purple-500/20 to-violet-500/20' },
}

export function GoalsProgress() {
  const { goals, loading } = useGoals()
  const containerRef = useRef<HTMLDivElement>(null)

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="surface-inset-glow animate-pulse rounded-2xl border-0">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-white/[0.035]" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-white/[0.035] rounded w-24" />
                  <div className="h-6 bg-white/[0.035] rounded w-32" />
                  <div className="h-3 bg-white/[0.035] rounded w-20" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (goals.length === 0) {
    return (
      <Card className="surface-inset-glow rounded-2xl border-0">
        <CardContent className="p-8 text-center sm:p-10">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.035] shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
            <Target className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
          </div>
          <p className="text-sm font-medium text-ash">Nenhuma meta definida ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">O administrador pode definir metas no painel executivo</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div ref={containerRef} className="grid gap-4 md:grid-cols-3">
      {goals.slice(0, 3).map((goal) => {
        const config = periodConfig[goal.period] || periodConfig.daily
        const Icon = config.icon
        const isCompleted = goal.isCompleted
        
        return (
          <Card 
            key={goal.id}
            className={cn(
              'surface-inset-glow relative overflow-hidden rounded-2xl border-0 transition-colors duration-300 hover:bg-white/[0.04]',
              isCompleted && 'shadow-[rgba(255,95,31,0.16)_0_0_0_1px_inset]'
            )}
          >
            {/* Subtle gradient background */}
            <div className={cn('absolute inset-0 bg-gradient-to-br opacity-25', config.gradient)} />
            
            <CardContent className="p-6 relative">
              <div className="flex items-center gap-4">
                <CircularProgress 
                  percent={goal.progress} 
                  color={config.color}
                  size={80}
                  strokeWidth={6}
                >
                  <div className="text-center">
                    <span className="text-lg font-medium tabular-nums text-white">
                      {Math.round(Math.min(goal.progress, 100))}%
                    </span>
                  </div>
                </CircularProgress>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {config.label}
                    </span>
                  </div>
                  
                  <p className="mb-1 truncate text-sm font-medium text-ash">
                    {goal.title}
                  </p>
                  
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-medium tracking-[-0.025em] text-white">
                      <AnimatedCounter 
                        end={goal.current} 
                        isCurrency={goal.unit === 'currency' || goal.unit === 'BRL' || !goal.unit}
                        duration={2}
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      / {goal.unit === 'count' ? goal.target : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goal.target)}
                    </span>
                  </div>

                  {isCompleted ? (
                    <Badge className="mt-2 border-0 bg-gradient-ember text-xs text-white">
                      <Trophy className="w-3 h-3 mr-1" />
                      Meta atingida
                    </Badge>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Faltam {goal.unit === 'count' ? goal.remaining : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(goal.remaining)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
