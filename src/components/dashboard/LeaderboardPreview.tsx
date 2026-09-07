import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useRankingDataWithMock } from '@/hooks/useRankingDataWithMock'
import { cn } from '@/lib/utils'
import { Trophy, Crown, Medal, Award, ArrowRight, Flame } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const positionColors = [
  'from-amber-500 to-yellow-400',   // 1st - gold
  'from-slate-300 to-slate-400',     // 2nd - silver
  'from-amber-700 to-orange-600',    // 3rd - bronze
]

const avatarColors = [
  'bg-gradient-to-br from-amber-500 to-orange-600',
  'bg-gradient-to-br from-blue-500 to-indigo-600',
  'bg-gradient-to-br from-purple-500 to-violet-600',
  'bg-gradient-to-br from-emerald-500 to-teal-600',
  'bg-gradient-to-br from-rose-500 to-pink-600',
]

export function LeaderboardPreview() {
  const { ranking, loading } = useRankingDataWithMock()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  
  const top5 = ranking.slice(0, 5)
  const maxSales = top5[0]?.totalVendas || 1

  const getMedalIcon = (position: number) => {
    switch (position) {
      case 0: return <Crown className="w-4 h-4 text-amber-400" />
      case 1: return <Medal className="w-4 h-4 text-slate-300" />
      case 2: return <Award className="w-4 h-4 text-amber-700" />
      default: return <span className="text-xs font-bold text-muted-foreground">#{position + 1}</span>
    }
  }

  if (loading) {
    return (
      <Card className="border-border/30">
        <CardHeader className="pb-3">
          <div className="h-6 bg-muted rounded w-40 animate-pulse" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/30 relative overflow-hidden">
      {/* Subtle ember glow at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-ember/40 to-transparent" />
      
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            Top Vendedores
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/ranking')}
            className="text-xs text-muted-foreground hover:text-foreground group"
          >
            Ver ranking
            <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent ref={containerRef} className="space-y-2">
        {top5.map((seller, index) => {
          const barWidth = (seller.totalVendas / maxSales) * 100
          const isCurrentUser = seller.isCurrentUser
          
          return (
            <div
              key={seller.user_id}
              className={cn(
                'flex items-center gap-3 p-2.5 rounded-lg transition-all duration-200 group',
                isCurrentUser 
                  ? 'bg-ember/10 border border-ember/20' 
                  : 'hover:bg-white/[0.03]'
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Position */}
              <div className="w-6 flex justify-center">
                {getMedalIcon(index)}
              </div>
              
              {/* Avatar */}
              <Avatar className="w-8 h-8">
                <AvatarFallback className={cn(
                  'text-xs font-bold text-white',
                  avatarColors[index % avatarColors.length]
                )}>
                  {seller.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-sm font-medium truncate',
                    isCurrentUser ? 'text-ember' : 'text-foreground'
                  )}>
                    {seller.name}
                  </span>
                  {isCurrentUser && (
                    <Badge variant="outline" className="border-ember/40 text-ember text-[10px] px-1.5 py-0">
                      Você
                    </Badge>
                  )}
                </div>
                
                {/* Progress bar */}
                <div className="mt-1.5 h-1.5 rounded-full bg-border/30 overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-1000 ease-out"
                    style={{ 
                      width: `${barWidth}%`,
                      background: index === 0 
                        ? 'linear-gradient(90deg, rgb(253, 137, 37), rgb(255, 12, 0))' 
                        : index === 1 
                        ? 'linear-gradient(90deg, rgb(148, 163, 184), rgb(203, 213, 225))'
                        : index === 2
                        ? 'linear-gradient(90deg, rgb(180, 83, 9), rgb(245, 158, 11))'
                        : 'linear-gradient(90deg, rgb(7, 122, 199), rgb(107, 33, 239))'
                    }}
                  />
                </div>
              </div>
              
              {/* Value */}
              <div className="text-right">
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(seller.totalVendas)}
                </span>
                <p className="text-[10px] text-muted-foreground">
                  {seller.quantidadeVendas} vendas
                </p>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
