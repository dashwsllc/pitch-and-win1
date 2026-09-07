import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChartNoAxesCombined } from "lucide-react"

interface ChartDataItem {
  month?: string
  period?: string
  vendas: number
  abordagens: number
  [key: string]: unknown
}

interface SalesChartProps {
  data?: ChartDataItem[]
  loading?: boolean
}

export function SalesChart({ data = [], loading = false }: SalesChartProps) {
  const chartData = data.length > 0
    ? data.map((item) => ({ ...item, label: item.month || item.period || "" }))
    : [
        { label: "Jan", vendas: 0, abordagens: 0 },
        { label: "Fev", vendas: 0, abordagens: 0 },
        { label: "Mar", vendas: 0, abordagens: 0 },
        { label: "Abr", vendas: 0, abordagens: 0 },
        { label: "Mai", vendas: 0, abordagens: 0 },
        { label: "Jun", vendas: 0, abordagens: 0 },
      ]

  return (
    <Card className="surface-panel overflow-hidden rounded-2xl border-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-white/[0.05] px-5 py-4 sm:px-6">
        <div>
          <CardTitle className="text-base font-medium tracking-[-0.015em] text-white">Evolução comercial</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Volume de vendas e abordagens no período</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric-violet/10 text-electric shadow-[rgba(255,255,255,0.06)_0_0_0_1px_inset]">
          <ChartNoAxesCombined className="h-4 w-4" strokeWidth={1.8} />
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4 pt-5 sm:px-5">
        {loading ? (
          <div className="h-[320px] animate-pulse rounded-xl bg-white/[0.025]" />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff5f1f" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#ff5f1f" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="approachFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6b21ef" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#6b21ef" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.055)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#878091", fontSize: 11 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#878091", fontSize: 11 }} />
                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.12)", strokeDasharray: "4 4" }}
                  contentStyle={{ backgroundColor: "#171221", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", boxShadow: "0 14px 36px rgba(0,0,0,0.28)", color: "#f7f5fb", fontSize: "12px" }}
                />
                <Area type="monotone" dataKey="abordagens" name="Abordagens" stroke="#6b21ef" strokeWidth={1.7} fill="url(#approachFill)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="vendas" name="Vendas" stroke="#ff5f1f" strokeWidth={2.2} fill="url(#salesFill)" dot={false} activeDot={{ r: 4, fill: "#ff7b32", stroke: "#171221", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-4 px-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ember" /> Vendas</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-electric-violet" /> Abordagens</span>
        </div>
      </CardContent>
    </Card>
  )
}
