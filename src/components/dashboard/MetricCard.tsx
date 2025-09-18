import { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  trend, 
  className,
  gradient = false,
  loading = false
}: MetricCardProps) {
  if (loading) {
    return (
      <Card className={cn(
        "relative overflow-hidden border-border/50 animate-pulse",
        gradient && "bg-gradient-card",
        className
      )}>
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <div className="space-y-3 flex-1">
              <div className="h-4 bg-muted rounded w-24"></div>
              <div className="h-10 bg-muted rounded w-20"></div>
              <div className="h-3 bg-muted rounded w-28"></div>
            </div>
            <div className="w-16 h-16 bg-muted rounded-xl ml-4"></div>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className={cn(
      "relative overflow-hidden border-border/50 transition-all hover:scale-105 hover:shadow-lg",
      gradient && "bg-gradient-card",
      className
    )}>
      <CardContent className="p-8">
        <div className="flex items-center justify-between">
          <div className="space-y-3 flex-1">
            <p className="text-sm font-medium text-muted-foreground">
              {title}
            </p>
            <p className="text-4xl font-bold text-foreground leading-none">
              {value}
            </p>
            {subtitle && (
              <p className="text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
            {trend && (
              <div className={cn(
                "flex items-center gap-1 text-sm font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                <span className={trend.isPositive ? "↗" : "↘"}>
                  {trend.isPositive ? "+" : ""}{trend.value}%
                </span>
                <span className="text-muted-foreground">vs período anterior</span>
              </div>
            )}
          </div>
          
          <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary ml-4">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}