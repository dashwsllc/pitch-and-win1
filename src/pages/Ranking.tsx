import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useRankingData } from "@/hooks/useRankingData"
import { Trophy, Medal, Award, TrendingUp, Target, Crown } from "lucide-react"

const badges = {
  "closer-mes": { label: "Closer do Mês", icon: Crown, color: "bg-gold" },
  "maior-ticket": { label: "Maior Ticket", icon: TrendingUp, color: "bg-primary" },
  "mais-abordagens": { label: "Mais Abordagens", icon: Target, color: "bg-chart-3" },
  "destaque-mes": { label: "Destaque", icon: Award, color: "bg-chart-4" }
}

export default function Ranking() {
  const { ranking, loading } = useRankingData()
  
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

        {/* Ranking completo */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Ranking Completo</CardTitle>
          </CardHeader>
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
        </Card>
      </div>
    </DashboardLayout>
  )
}