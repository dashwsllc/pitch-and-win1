import { useState } from "react"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useRankingDataWithMock } from "@/hooks/useRankingDataWithMock"
import { Trophy, Medal, Award, TrendingUp, Target, Crown, ChevronDown, ChevronUp, Gift, Percent, DollarSign } from "lucide-react"

const badges = {
  "closer-mes": { label: "Closer do Mês", icon: Crown, color: "bg-gold" },
  "maior-ticket": { label: "Maior Ticket", icon: TrendingUp, color: "bg-primary" },
  "mais-abordagens": { label: "Mais Abordagens", icon: Target, color: "bg-chart-3" },
  "destaque-mes": { label: "Destaque", icon: Award, color: "bg-chart-4" }
}

export default function Ranking() {
  const { ranking, loading } = useRankingDataWithMock()
  const [showFullRanking, setShowFullRanking] = useState(false)
  
  const rankingData = ranking.map((user, index) => ({
    position: index + 1,
    name: user.name,
    sales: new Intl.NumberFormat('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    }).format(user.totalVendas),
    deals: user.quantidadeVendas,
    conversion: `${user.conversao.toFixed(1)}%`,
    avatar: "",
    badges: [] as string[],
    isCurrentUser: user.isCurrentUser
  }))

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    )
  }
  const getMedalIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="w-6 h-6 text-gold animate-bounce-medal" />
      case 2:
        return <Medal className="w-6 h-6 text-silver" />
      case 3:
        return <Award className="w-6 h-6 text-bronze" />
      default:
        return <div className="w-6 h-6 flex items-center justify-center text-muted-foreground font-bold">#{position}</div>
    }
  }

  const getPositionStyle = (position: number, isCurrentUser?: boolean) => {
    if (isCurrentUser) {
      return "border-primary bg-primary/5 animate-pulse-glow"
    }
    
    switch (position) {
      case 1:
        return "border-gold/30 bg-gold/5"
      case 2:
        return "border-silver/30 bg-silver/5"
      case 3:
        return "border-bronze/30 bg-bronze/5"
      default:
        return "border-border/50"
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Trophy className="w-8 h-8 text-gold" />
            Ranking de Vendedores
          </h1>
          <p className="text-muted-foreground mt-1">
            Competição saudável para motivar toda a equipe
          </p>
        </div>

        {/* Top 3 em destaque */}
        <div className="grid gap-6 md:grid-cols-3">
          {rankingData.slice(0, 3).map((seller, index) => (
            <Card 
              key={seller.position}
              className={`${getPositionStyle(seller.position, seller.isCurrentUser)} transition-all hover:scale-105`}
            >
              <CardHeader className="text-center pb-4">
                <div className="flex justify-center mb-3">
                  {getMedalIcon(seller.position)}
                </div>
                <div className="space-y-2">
                  <Avatar className="w-16 h-16 mx-auto">
                    <AvatarImage src={seller.avatar} alt={seller.name} />
                    <AvatarFallback className="text-lg font-bold">
                      {seller.name.split(" ").map(n => n[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-lg">{seller.name}</CardTitle>
                  {seller.isCurrentUser && (
                    <Badge variant="outline" className="border-primary text-primary">
                      Você
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="text-center space-y-3">
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-foreground">{seller.sales}</p>
                  <p className="text-sm text-muted-foreground">Total em vendas</p>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="font-semibold">{seller.deals}</p>
                    <p className="text-muted-foreground">Vendas</p>
                  </div>
                  <div>
                    <p className="font-semibold">{seller.conversion}</p>
                    <p className="text-muted-foreground">Conversão</p>
                  </div>
                </div>

                {seller.badges.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {seller.badges.map((badgeKey) => {
                      const badge = badges[badgeKey as keyof typeof badges]
                      const Icon = badge.icon
                      return (
                        <Badge 
                          key={badgeKey}
                          className={`${badge.color} text-white text-xs`}
                        >
                          <Icon className="w-3 h-3 mr-1" />
                          {badge.label}
                        </Badge>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Ranking completo - Colapsável */}
        <Collapsible open={showFullRanking} onOpenChange={setShowFullRanking}>
          <Card className="border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-foreground">Ranking Completo</CardTitle>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-9 p-0">
                    {showFullRanking ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <div className="space-y-3">
                  {rankingData.map((seller) => (
                    <div 
                      key={seller.position}
                      className={`flex items-center gap-4 p-4 rounded-lg transition-all hover:scale-[1.02] ${
                        getPositionStyle(seller.position, seller.isCurrentUser)
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {getMedalIcon(seller.position)}
                      </div>
                      
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={seller.avatar} alt={seller.name} />
                        <AvatarFallback>
                          {seller.name.split(" ").map(n => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-4">
                        <div>
                          <p className="font-semibold text-foreground flex items-center gap-2">
                            {seller.name}
                            {seller.isCurrentUser && (
                              <Badge variant="outline" className="border-primary text-primary text-xs">
                                Você
                              </Badge>
                            )}
                          </p>
                        </div>
                        
                        <div className="text-right md:text-center">
                          <p className="text-lg font-bold text-foreground">{seller.sales}</p>
                          <p className="text-xs text-muted-foreground">Total vendas</p>
                        </div>
                        
                        <div className="text-right md:text-center">
                          <p className="font-semibold">{seller.deals}</p>
                          <p className="text-xs text-muted-foreground">Quantidade</p>
                        </div>
                        
                        <div className="text-right md:text-center">
                          <p className="font-semibold">{seller.conversion}</p>
                          <p className="text-xs text-muted-foreground">Conversão</p>
                        </div>
                      </div>

                      {seller.badges.length > 0 && (
                        <div className="hidden md:flex flex-wrap gap-1">
                          {seller.badges.map((badgeKey) => {
                            const badge = badges[badgeKey as keyof typeof badges]
                            const Icon = badge.icon
                            return (
                              <Badge 
                                key={badgeKey}
                                className={`${badge.color} text-white text-xs`}
                              >
                                <Icon className="w-3 h-3 mr-1" />
                                {badge.label}
                              </Badge>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Seção de Prêmios e Bônus */}
        <Card className="border-border/50 bg-gradient-card">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-3">
              <Gift className="w-6 h-6 text-gold" />
              Prêmios e Bônus de Comissão
            </CardTitle>
            <p className="text-muted-foreground">
              Sistema de recompensas para alta performance
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Bônus Principal */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Percent className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Bônus Adicional</h3>
                  <p className="text-3xl font-bold text-primary mb-2">+10%</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Comissionamento adicional para vendedores de alta performance
                  </p>
                  <Badge className="bg-success text-success-foreground">
                    Total: 22% de Comissão
                  </Badge>
                </CardContent>
              </Card>

              {/* Prêmio TOP 1 */}
              <Card className="border-gold/20 bg-gold/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
                    <Crown className="w-6 h-6 text-gold" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">1º Lugar</h3>
                  <p className="text-3xl font-bold text-gold mb-2">R$ 5.000</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Prêmio em dinheiro para o vendedor #1 do mês
                  </p>
                  <Badge className="bg-gold text-white">
                    Closer do Mês
                  </Badge>
                </CardContent>
              </Card>

              {/* Prêmio 2º Lugar */}
              <Card className="border-silver/20 bg-silver/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-silver/10 flex items-center justify-center mx-auto mb-4">
                    <Medal className="w-6 h-6 text-silver" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">2º Lugar</h3>
                  <p className="text-3xl font-bold text-silver mb-2">R$ 2.500</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Premiação para o segundo colocado
                  </p>
                  <Badge className="bg-silver text-white">
                    Vice-Campeão
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Segunda linha de prêmios */}
            <div className="grid gap-6 md:grid-cols-2 mt-6">
              {/* Prêmio 3º Lugar */}
              <Card className="border-bronze/20 bg-bronze/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-bronze/10 flex items-center justify-center mx-auto mb-4">
                    <Award className="w-6 h-6 text-bronze" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">3º Lugar</h3>
                  <p className="text-3xl font-bold text-bronze mb-2">R$ 1.500</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Premiação para o terceiro colocado
                  </p>
                  <Badge className="bg-bronze text-white">
                    Terceiro Lugar
                  </Badge>
                </CardContent>
              </Card>

              {/* TOP 3 Geral */}
              <Card className="border-chart-3/20 bg-chart-3/5">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-chart-3/10 flex items-center justify-center mx-auto mb-4">
                    <DollarSign className="w-6 h-6 text-chart-3" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">TOP 3</h3>
                  <p className="text-3xl font-bold text-chart-3 mb-2">Bônus Extra</p>
                  <p className="text-sm text-muted-foreground mb-3">
                    Benefícios exclusivos para os 3 primeiros
                  </p>
                  <Badge className="bg-chart-3 text-white">
                    Reconhecimento
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Informações adicionais */}
            <div className="mt-6 p-4 bg-muted/30 rounded-lg">
              <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                <Target className="w-4 h-4" />
                Como Conquistar os Bônus
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Mantenha a taxa de conversão acima de 25%</li>
                <li>• Realize pelo menos 200 abordagens no mês</li>
                <li>• Alcance a meta mínima de R$30.000 em vendas mensais</li>
                <li>• Participe ativamente do grupo</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}