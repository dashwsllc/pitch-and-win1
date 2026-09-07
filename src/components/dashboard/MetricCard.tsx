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
        "relative overflow-hidden border-border/30 animate-pulse",
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
      "relative overflow-hidden border-border/30 transition-all duration-300 hover:scale-[1.03] group",
      gradient && 'border-ember/20',
      className
    )}>
      {/* Subtle top accent line */}
      {gradient && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-ember" />
      )}
      
      {/* Inset glow effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ boxShadow: 'rgba(255, 142, 93, 0.1) 0px 0px 0px 1px inset, rgba(255, 142, 93, 0.05) 0px 1px 0px 0px inset' }}
      />
      
      <CardContent className="p-6 relative">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-3xl font-bold text-foreground leading-none tracking-tight">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
            {trend && (
              <div className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                <span className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px]",
                  trend.isPositive ? "bg-success/10" : "bg-destructive/10"
                )}>
                  {trend.isPositive ? "↑" : "↓"}{Math.abs(trend.value)}%
                </span>
                <span className="text-muted-foreground">vs anterior</span>
              </div>
            )}
          </div>
          
          <div className={cn(
            "w-14 h-14 rounded-xl flex items-center justify-center ml-4 transition-colors",
            gradient 
              ? 'bg-ember/10 text-ember group-hover:bg-ember/20' 
              : 'bg-primary/10 text-primary group-hover:bg-primary/15'
          )}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}