import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

const data = [
  { produto: "Premium", valor: 2997, vendas: 12 },
  { produto: "Plus", valor: 500, vendas: 25 },
  { produto: "Basic", valor: 275, vendas: 18 },
  { produto: "Starter", valor: 250, vendas: 8 },
]

interface ProductsChartProps {
  data?: Array<{
    nome: string
    quantidade: number
    valor: number
  }>
  loading?: boolean
}

export function ProductsChart({ data = [], loading = false }: ProductsChartProps) {
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
  
  const chartData = data.length > 0 ? data.map(item => ({
    produto: item.nome,
    vendas: item.quantidade,
    valor: item.valor
  })) : [
    { produto: "Sem dados", vendas: 0, valor: 0 }
  ]
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-foreground">Top Produtos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="produto" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px"
                }}
                formatter={(value, name) => [
                  name === 'vendas' ? `${value} vendas` : `R$ ${value}`,
                  name === 'vendas' ? 'Vendas' : 'Valor'
                ]}
              />
              <Bar 
                dataKey="vendas" 
                fill="url(#gradientBar)"
                radius={[4, 4, 0, 0]}
              />
              <defs>
                <linearGradient id="gradientBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}