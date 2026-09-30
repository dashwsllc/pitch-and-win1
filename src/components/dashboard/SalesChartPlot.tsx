import { memo } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export interface SalesChartPoint {
  label: string
  vendas: number
  abordagens: number
  [key: string]: unknown
}

// Recharts restarts its animation whenever it receives a new `data` reference, so
// this component is memoized and the caller keeps `data` referentially stable.
function SalesChartPlot({ data }: { data: SalesChartPoint[] }) {
  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
  )
}

export default memo(SalesChartPlot)
