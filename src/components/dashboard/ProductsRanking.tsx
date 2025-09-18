import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Trophy, Medal, Award } from "lucide-react"

interface ProductsRankingProps {
  data?: Array<{
    nome: string
    quantidade: number
    valor: number
  }>
  loading?: boolean
}

export function ProductsRanking({ data = [], loading = false }: ProductsRankingProps) {
  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-foreground">Top Produtos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 bg-muted animate-pulse rounded"></div>
        </CardContent>
      </Card>
    )
  }
  
  const topProducts = data.length > 0 ? data.slice(0, 3) : []

  const getMedalIcon = (position: number) => {
    switch (position) {
      case 0:
        return <Trophy className="w-8 h-8 text-gold animate-bounce-medal" />
      case 1:
        return <Medal className="w-8 h-8 text-silver" />
      case 2:
        return <Award className="w-8 h-8 text-bronze" />
      default:
        return null
    }
  }

  const getPositionStyle = (position: number) => {
    switch (position) {
      case 0:
        return "border-gold/30 bg-gold/5"
      case 1:
        return "border-silver/30 bg-silver/5"
      case 2:
        return "border-bronze/30 bg-bronze/5"
      default:
        return "border-border/50"
    }
  }

  const getInitials = (productName: string) => {
    return productName
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 3)
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-foreground">Top Produtos</CardTitle>
      </CardHeader>
      <CardContent>
        {topProducts.length === 0 ? (
          <div className="h-80 flex items-center justify-center">
            <p className="text-muted-foreground">Nenhum produto vendido ainda</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 h-80">
            {topProducts.map((product, index) => (
              <Card 
                key={product.nome}
                className={`${getPositionStyle(index)} transition-all hover:scale-105 flex flex-col justify-center`}
              >
                <CardContent className="text-center p-4 space-y-3">
                  <div className="flex justify-center mb-3">
                    {getMedalIcon(index)}
                  </div>
                  
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <span className="text-lg font-bold text-primary">
                      {getInitials(product.nome)}
                    </span>
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="font-semibold text-sm text-foreground truncate" title={product.nome}>
                      {product.nome}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {product.quantidade} vendas
                    </p>
                    <p className="text-sm font-bold text-foreground">
                      {new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: 'BRL' 
                      }).format(product.valor)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}