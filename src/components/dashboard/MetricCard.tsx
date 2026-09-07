import { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: ReactNode
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
  gradient?: boolean
  loading?: boolean
  accent?: "ember" | "electric" | "success" | "neutral"
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  trend, 
  className,
  gradient = false,
  loading = false,
  accent = "neutral"
}: MetricCardProps) {
  if (loading) {
    return (
      <Card className={cn(
        "relative overflow-hidden border-0 surface-panel animate-pulse",
        className
      )}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-3 flex-1">
              <div className="h-3 bg-muted rounded w-24"></div>
              <div className="h-8 bg-muted rounded w-20"></div>
              <div className="h-3 bg-muted rounded w-28"></div>
            </div>
            <div className="w-14 h-14 bg-muted rounded-xl ml-4"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn(
      "relative isolate overflow-hidden border-0 surface-inset-glow group transition-[transform,box-shadow,background-color] duration-300 hover:-translate-y-0.5",
      gradient && 'shadow-[rgba(255,255,255,0.09)_0_0_0_1px_inset,rgba(255,142,93,0.34)_0_1px_0_inset]',
      className
    )}>
      <div className={cn(
        "pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100",
        accent === "ember" && "bg-ember/20",
        accent === "electric" && "bg-electric-violet/20",
        accent === "success" && "bg-success/15",
        accent === "neutral" && "bg-white/5",
      )} />
      
      <CardContent className="relative p-5 sm:p-6">
        <div className="flex min-h-[112px] items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-fog">
              {title}
            </p>
            <p className="mt-3 truncate text-[clamp(1.65rem,2.4vw,2.15rem)] font-normal leading-none tracking-[-0.035em] text-white" title={String(value)}>
              {value}
            </p>
            {subtitle && (
              <p className="mt-2 text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
            {trend && (
              <div className={cn(
                "mt-auto flex items-center gap-1.5 pt-3 text-xs font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                <span className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px]",
                  trend.isPositive ? "bg-success/10" : "bg-destructive/10"
                )}>
                  {trend.isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(trend.value)}%
                </span>
                <span className="text-muted-foreground">vs anterior</span>
              </div>
            )}
          </div>
          
          <div className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-[rgba(255,255,255,0.08)_0_0_0_1px_inset] transition-colors",
            accent === "ember" && "bg-ember/10 text-ember group-hover:bg-ember/15",
            accent === "electric" && "bg-electric-violet/10 text-blue-400 group-hover:bg-electric-violet/15",
            accent === "success" && "bg-success/10 text-success group-hover:bg-success/15",
            accent === "neutral" && "bg-white/[0.045] text-ash group-hover:bg-white/[0.07]"
          )}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
