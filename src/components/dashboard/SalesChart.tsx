import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

const data = [
  { name: "Jan", vendas: 4000, abordagens: 2400 },
  { name: "Fev", vendas: 3000, abordagens: 1398 },
  { name: "Mar", vendas: 2000, abordagens: 9800 },
  { name: "Abr", vendas: 2780, abordagens: 3908 },
  { name: "Mai", vendas: 1890, abordagens: 4800 },
  { name: "Jun", vendas: 2390, abordagens: 3800 },
]

interface SalesChartProps {
  data?: Array<{
    month: string
    vendas: number
    abordagens: number
  }>
  loading?: boolean
}

export function SalesChart({ data = [], loading = false }: SalesChartProps) {
  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-foreground">Evolução de Vendas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80 bg-muted animate-pulse rounded"></div>
        </CardContent>
      </Card>
    )
  }
  
  const chartData = data.length > 0 ? data : [
    { month: "Jan", vendas: 0, abordagens: 0 },
    { month: "Fev", vendas: 0, abordagens: 0 },
    { month: "Mar", vendas: 0, abordagens: 0 },
    { month: "Abr", vendas: 0, abordagens: 0 },
    { month: "Mai", vendas: 0, abordagens: 0 },
    { month: "Jun", vendas: 0, abordagens: 0 }
  ]
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-foreground">Evolução de Vendas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="month" 
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
              />
              <Line 
                type="monotone" 
                dataKey="vendas" 
                stroke="hsl(var(--primary))" 
                strokeWidth={3}
                dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 6 }}
                activeDot={{ r: 8, stroke: "hsl(var(--primary))", strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="abordagens" 
                stroke="hsl(var(--chart-3))" 
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ fill: "hsl(var(--chart-3))", strokeWidth: 2, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}