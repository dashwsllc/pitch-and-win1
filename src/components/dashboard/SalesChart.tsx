import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

interface ChartDataItem {
  month?: string
  period?: string
  vendas: number
  abordagens: number
  [key: string]: any
}

interface SalesChartProps {
  data?: ChartDataItem[]
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
  
  // Normalize data: accept both `month` and `period` as X-axis key
  const chartData = data.length > 0 
    ? data.map(item => ({
        ...item,
        label: item.month || item.period || ''
      }))
    : [
        { label: "Jan", vendas: 0, abordagens: 0 },
        { label: "Fev", vendas: 0, abordagens: 0 },
        { label: "Mar", vendas: 0, abordagens: 0 },
        { label: "Abr", vendas: 0, abordagens: 0 },
        { label: "Mai", vendas: 0, abordagens: 0 },
        { label: "Jun", vendas: 0, abordagens: 0 }
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
                dataKey="label" 
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
