import { useState, useEffect, useRef } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useRankingDataWithMock } from "@/hooks/useRankingDataWithMock"
import { cn } from "@/lib/utils"
import { AnimatedCounter } from "@/components/dashboard/AnimatedCounter"
import { Trophy, Medal, Award, TrendingUp, Target, Crown, ChevronDown, ChevronUp, Gift, Percent, DollarSign, Flame, Star, Zap } from "lucide-react"
import gsap from 'gsap'

const avatarColors = [
  'bg-gradient-to-br from-amber-500 to-orange-600',
  'bg-gradient-to-br from-slate-300 to-slate-400',
  'bg-gradient-to-br from-amber-700 to-orange-600',
  'bg-gradient-to-br from-blue-500 to-indigo-600',
  'bg-gradient-to-br from-purple-500 to-violet-600',
  'bg-gradient-to-br from-emerald-500 to-teal-600',
  'bg-gradient-to-br from-rose-500 to-pink-600',
  'bg-gradient-to-br from-cyan-500 to-sky-600',
]

export default function Ranking() {
  const { ranking, loading, error } = useRankingDataWithMock()
  const [showFullRanking, setShowFullRanking] = useState(true)
  const podiumRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const rankingData = ranking.map((user, index) => ({
    position: index + 1,
    name: user.name,
    salesValue: user.totalVendas,
    sales: new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(user.totalVendas),
    deals: user.quantidadeVendas,
    conversion: `${user.conversao.toFixed(1)}%`,
    isCurrentUser: user.isCurrentUser
  }))

  // GSAP podium animation
  useEffect(() => {
    if (!loading && podiumRef.current) {
      const children = podiumRef.current.children
      if (children.length >= 3) {
        const tl = gsap.timeline()
        // Animate 3rd, then 2nd, then 1st (dramatic reveal)
        tl.fromTo(children[2], { opacity: 0, y: 60, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)' })
          .fromTo(children[0], { opacity: 0, y: 60, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)' }, '-=0.35')
          .fromTo(children[1], { opacity: 0, y: 80, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'back.out(2)' }, '-=0.35')
      }
    }
  }, [loading])

  // GSAP list stagger animation
  useEffect(() => {
    if (!loading && listRef.current && showFullRanking) {
      const items = listRef.current.children
      gsap.fromTo(items,
        { opacity: 0, x: -20 },
        { opacity: 1, x: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out' }
      )
    }
  }, [loading, showFullRanking])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-ember animate-pulse" />
            <p className="text-sm text-muted-foreground">Carregando ranking...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const getMedalIcon = (position: number) => {
    switch (position) {
      case 1: return <Crown className="w-7 h-7 text-amber-400 animate-float" />
      case 2: return <Medal className="w-6 h-6 text-slate-300" />
      case 3: return <Award className="w-6 h-6 text-amber-700" />
      default: return <div className="w-6 h-6 flex items-center justify-center text-muted-foreground font-bold text-sm">#{position}</div>
    }
  }

  const maxSales = rankingData[0]?.salesValue || 1

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Não foi possível atualizar o ranking. Tente novamente.</p>}
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl p-6 lg:p-8" style={{ background: 'linear-gradient(135deg, rgba(253, 137, 37, 0.06) 0%, rgba(107, 33, 239, 0.06) 100%)' }}>
          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl" />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-ember flex items-center justify-center">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-light text-foreground tracking-tight">
                Ranking de <span className="font-semibold">Vendedores</span>
              </h1>
              <p className="text-muted-foreground mt-0.5">
                Ranking acumulado do time · somente vendas aprovadas.
              </p>
            </div>
          </div>
        </div>

        {/* Pódio Visual - Top 3 */}
        <div ref={podiumRef} className="grid gap-4 md:gap-6 md:grid-cols-3 items-end">
          {/* 2nd Place */}
          {rankingData[1] && (
            <Card className={cn(
              'relative overflow-hidden border-border/30 transition-all hover:scale-[1.02] md:order-1',
              rankingData[1].isCurrentUser && 'border-ember/30 animate-glow-ember'
            )}>
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-slate-300 to-slate-400" />
              <CardContent className="p-6 text-center">
                <div className="mb-3">{getMedalIcon(2)}</div>
                <Avatar className="w-16 h-16 mx-auto mb-3 ring-2 ring-slate-300/30">
                  <AvatarFallback className={cn('text-lg font-bold text-white', avatarColors[1])}>
                    {rankingData[1].name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold text-foreground">{rankingData[1].name}</h3>
                {rankingData[1].isCurrentUser && <Badge variant="outline" className="border-ember/40 text-ember text-xs mt-1">Você</Badge>}
                <p className="text-2xl font-bold text-foreground mt-3">{rankingData[1].sales}</p>
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  <div><p className="font-semibold">{rankingData[1].deals}</p><p className="text-xs text-muted-foreground">Vendas</p></div>
                  <div><p className="font-semibold">{rankingData[1].conversion}</p><p className="text-xs text-muted-foreground">Conversão</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 1st Place - Center, taller */}
          {rankingData[0] && (
            <Card className={cn(
              'relative overflow-hidden border-border/30 transition-all hover:scale-[1.02] md:order-2 md:-mt-4',
              rankingData[0].isCurrentUser && 'animate-glow-ember'
            )} style={{ boxShadow: 'rgba(255, 142, 93, 0.15) 0px 0px 0px 1px inset, rgba(255, 142, 93, 0.1) 0px 4px 24px 0px' }}>
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-ember" />
              {/* Decorative glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2" />
              <CardContent className="p-8 text-center relative">
                <div className="mb-4">{getMedalIcon(1)}</div>
                <Avatar className="w-20 h-20 mx-auto mb-4 ring-4 ring-amber-400/30">
                  <AvatarFallback className={cn('text-xl font-bold text-white', avatarColors[0])}>
                    {rankingData[0].name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <Badge className="bg-gradient-ember text-white border-0 mb-2">
                  <Star className="w-3 h-3 mr-1" /> Líder
                </Badge>
                <h3 className="text-xl font-bold text-foreground">{rankingData[0].name}</h3>
                {rankingData[0].isCurrentUser && <Badge variant="outline" className="border-ember/40 text-ember text-xs mt-1">Você</Badge>}
                <p className="text-3xl font-bold text-foreground mt-4">{rankingData[0].sales}</p>
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div><p className="text-lg font-bold">{rankingData[0].deals}</p><p className="text-xs text-muted-foreground">Vendas</p></div>
                  <div><p className="text-lg font-bold">{rankingData[0].conversion}</p><p className="text-xs text-muted-foreground">Conversão</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 3rd Place */}
          {rankingData[2] && (
            <Card className={cn(
              'relative overflow-hidden border-border/30 transition-all hover:scale-[1.02] md:order-3',
              rankingData[2].isCurrentUser && 'border-ember/30 animate-glow-ember'
            )}>
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-700 to-orange-500" />
              <CardContent className="p-6 text-center">
                <div className="mb-3">{getMedalIcon(3)}</div>
                <Avatar className="w-16 h-16 mx-auto mb-3 ring-2 ring-amber-700/30">
                  <AvatarFallback className={cn('text-lg font-bold text-white', avatarColors[2])}>
                    {rankingData[2].name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold text-foreground">{rankingData[2].name}</h3>
                {rankingData[2].isCurrentUser && <Badge variant="outline" className="border-ember/40 text-ember text-xs mt-1">Você</Badge>}
                <p className="text-2xl font-bold text-foreground mt-3">{rankingData[2].sales}</p>
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  <div><p className="font-semibold">{rankingData[2].deals}</p><p className="text-xs text-muted-foreground">Vendas</p></div>
                  <div><p className="font-semibold">{rankingData[2].conversion}</p><p className="text-xs text-muted-foreground">Conversão</p></div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Ranking Completo */}
        <Collapsible open={showFullRanking} onOpenChange={setShowFullRanking}>
          <Card className="border-border/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="w-5 h-5 text-ember" />
                  Classificação Geral
                </CardTitle>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-9 p-0">
                    {showFullRanking ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div ref={listRef} className="space-y-2">
                  {rankingData.map((seller) => {
                    const barWidth = (seller.salesValue / maxSales) * 100
                    
                    return (
                      <div 
                        key={seller.position}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group',
                          seller.isCurrentUser 
                            ? 'bg-ember/10 border border-ember/20' 
                            : 'hover:bg-white/[0.03]',
                          seller.position <= 3 && 'border-border/20'
                        )}
                      >
                        {/* Position */}
                        <div className="w-8 flex justify-center">
                          {getMedalIcon(seller.position)}
                        </div>
                        
                        {/* Avatar */}
                        <Avatar className="w-9 h-9">
                          <AvatarFallback className={cn(
                            'text-xs font-bold text-white',
                            avatarColors[(seller.position - 1) % avatarColors.length]
                          )}>
                            {seller.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'text-sm font-semibold truncate',
                              seller.isCurrentUser ? 'text-ember' : 'text-foreground'
                            )}>
                              {seller.name}
                            </span>
                            {seller.isCurrentUser && (
                              <Badge variant="outline" className="border-ember/40 text-ember text-[10px] px-1.5 py-0">
                                Você
                              </Badge>
                            )}
                          </div>
                          
                          {/* Progress bar */}
                          <div className="mt-1.5 h-1.5 rounded-full bg-border/20 overflow-hidden">
                            <div 
                              className="h-full rounded-full animate-progress-fill"
                              style={{ 
                                '--progress-width': `${barWidth}%`,
                                background: seller.position === 1 
                                  ? 'linear-gradient(90deg, rgb(253, 137, 37), rgb(255, 12, 0))' 
                                  : seller.position === 2 
                                  ? 'linear-gradient(90deg, rgb(148, 163, 184), rgb(203, 213, 225))'
                                  : seller.position === 3
                                  ? 'linear-gradient(90deg, rgb(180, 83, 9), rgb(245, 158, 11))'
                                  : 'linear-gradient(90deg, rgb(7, 122, 199), rgb(107, 33, 239))'
                              } as React.CSSProperties}
                            />
                          </div>
                        </div>
                        
                        {/* Stats */}
                        <div className="hidden md:flex items-center gap-6">
                          <div className="text-center">
                            <p className="text-sm font-bold text-foreground tabular-nums">{seller.sales}</p>
                            <p className="text-[10px] text-muted-foreground">Faturamento</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold">{seller.deals}</p>
                            <p className="text-[10px] text-muted-foreground">Vendas</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold">{seller.conversion}</p>
                            <p className="text-[10px] text-muted-foreground">Conversão</p>
                          </div>
                        </div>
                        
                        {/* Mobile value */}
                        <div className="md:hidden text-right">
                          <p className="text-sm font-bold tabular-nums">{seller.sales}</p>
                          <p className="text-[10px] text-muted-foreground">{seller.deals} vendas</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Prêmios e Bônus */}
        <Card className="border-border/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-ember/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.03] to-purple-500/[0.03]" />
          
          <CardHeader className="relative">
            <CardTitle className="text-xl font-light text-foreground flex items-center gap-3">
              <Gift className="w-6 h-6 text-amber-400" />
              Prêmios e <span className="font-semibold">Bônus de Comissão</span>
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Sistema de recompensas para alta performance
            </p>
          </CardHeader>
          <CardContent className="relative">
            <div className="grid gap-4 md:grid-cols-3">
              {/* Bônus Principal */}
              <Card className="border-ember/20 bg-ember/[0.03]">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-xl bg-ember/10 flex items-center justify-center mx-auto mb-4">
                    <Percent className="w-6 h-6 text-ember" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Bônus Adicional</h3>
                  <p className="text-3xl font-bold text-ember mb-2">+10%</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Comissionamento extra para alta performance
                  </p>
                  <Badge className="bg-success/10 text-success border-success/20">
                    Total: 22% de Comissão
                  </Badge>
                </CardContent>
              </Card>

              {/* Prêmio TOP 1 */}
              <Card className="border-amber-400/20 bg-amber-400/[0.03]" style={{ boxShadow: 'rgba(255, 142, 93, 0.1) 0px 0px 0px 1px inset, rgba(255, 142, 93, 0.06) 0px 1px 0px 0px inset' }}>
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-xl bg-amber-400/10 flex items-center justify-center mx-auto mb-4">
                    <Crown className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">1º Lugar</h3>
                  <p className="text-3xl font-bold text-amber-400 mb-2">R$ 5.000</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Prêmio em dinheiro para o vendedor #1
                  </p>
                  <Badge className="bg-amber-400/10 text-amber-400 border-amber-400/20">
                    Closer do Mês
                  </Badge>
                </CardContent>
              </Card>

              {/* Prêmio 2º Lugar */}
              <Card className="border-slate-300/20 bg-slate-300/[0.03]">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-xl bg-slate-300/10 flex items-center justify-center mx-auto mb-4">
                    <Medal className="w-6 h-6 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">2º Lugar</h3>
                  <p className="text-3xl font-bold text-slate-300 mb-2">R$ 2.500</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Premiação para o segundo colocado
                  </p>
                  <Badge className="bg-slate-300/10 text-slate-300 border-slate-300/20">
                    Vice-Campeão
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Segunda linha */}
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card className="border-amber-700/20 bg-amber-700/[0.03]">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-xl bg-amber-700/10 flex items-center justify-center mx-auto mb-4">
                    <Award className="w-6 h-6 text-amber-700" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">3º Lugar</h3>
                  <p className="text-3xl font-bold text-amber-700 mb-2">R$ 1.500</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Premiação para o terceiro colocado
                  </p>
                  <Badge className="bg-amber-700/10 text-amber-700 border-amber-700/20">
                    Terceiro Lugar
                  </Badge>
                </CardContent>
              </Card>

              <Card className="border-electric/20 bg-electric/[0.03]">
                <CardContent className="p-6">
                  <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-ember" />
                    Como Conquistar os Bônus
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-ember/60" />
                      Mantenha a taxa de conversão acima de 25%
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-ember/60" />
                      Realize pelo menos 200 abordagens no mês
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-ember/60" />
                      Alcance a meta mínima de R$30.000 em vendas mensais
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-ember/60" />
                      Participe ativamente do grupo
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
