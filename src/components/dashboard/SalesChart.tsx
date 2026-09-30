import { lazy, memo, Suspense, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartNoAxesCombined } from "lucide-react"
import type { SalesChartPoint } from "./SalesChartPlot"

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

// Recharts is ~100 KB gzip. The card renders immediately and the plot is fetched
// in parallel with the first data request instead of sitting on the critical
// path of the dashboard's initial JavaScript.
const loadPlot = () => import("./SalesChartPlot")
const SalesChartPlot = lazy(loadPlot)
void loadPlot().catch(() => undefined)

const placeholder: SalesChartPoint[] = [
  { label: "Jan", vendas: 0, abordagens: 0 },
  { label: "Fev", vendas: 0, abordagens: 0 },
  { label: "Mar", vendas: 0, abordagens: 0 },
  { label: "Abr", vendas: 0, abordagens: 0 },
  { label: "Mai", vendas: 0, abordagens: 0 },
  { label: "Jun", vendas: 0, abordagens: 0 },
]

const plotSkeleton = <div className="h-[320px] animate-pulse rounded-xl bg-white/[0.025]" />

function SalesChartCard({ data, loading = false }: SalesChartProps) {
  const chartData = useMemo(
    () => (data && data.length > 0
      ? data.map((item) => ({ ...item, label: item.month || item.period || "" }))
      : placeholder),
    [data],
  )

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
          plotSkeleton
        ) : (
          <Suspense fallback={plotSkeleton}>
            <SalesChartPlot data={chartData} />
          </Suspense>
        )}
        <div className="mt-1 flex items-center justify-end gap-4 px-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ember" /> Vendas</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-electric-violet" /> Abordagens</span>
        </div>
      </CardContent>
    </Card>
  )
}

export const SalesChart = memo(SalesChartCard)
