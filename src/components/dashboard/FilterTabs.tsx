import { FormEvent, useEffect, useId, useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CalendarDays, CalendarRange, History } from "lucide-react"
import {
  DashboardCustomRange,
  DashboardDateFilter,
  validateDashboardCustomRange,
} from "@/lib/dashboard-period"
import { brasiliaDateKey, formatDateKey } from "@/lib/brasilia-time"

interface FilterTabsProps {
  value: DashboardDateFilter
  onValueChange: (value: DashboardDateFilter) => void
  customRange: DashboardCustomRange
  onCustomRangeChange: (range: DashboardCustomRange) => void
}

export function FilterTabs({ value, onValueChange, customRange, onCustomRangeChange }: FilterTabsProps) {
  const startInputId = useId()
  const endInputId = useId()
  const [draftRange, setDraftRange] = useState(customRange)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const filters: Array<{ value: DashboardDateFilter; label: string }> = [
    { value: "hoje", label: "Hoje" },
    { value: "ontem", label: "Ontem" },
    { value: "7dias", label: "7 dias" },
    { value: "14dias", label: "14 dias" },
    { value: "30dias", label: "30 dias" },
    { value: "all", label: "Todo o período" },
    { value: "custom", label: "Tempo personalizado" },
  ]

  useEffect(() => {
    setDraftRange(customRange)
  }, [customRange])

  const applyCustomRange = (event: FormEvent) => {
    event.preventDefault()
    const validationError = validateDashboardCustomRange(draftRange)
    setRangeError(validationError)
    if (validationError) return
    onCustomRangeChange(draftRange)
    onValueChange('custom')
  }

  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as DashboardDateFilter)}
      className="w-full"
    >
      <div>
        <TabsList className="grid h-auto w-full grid-cols-10 gap-1 rounded-xl bg-white/[0.035] p-1 shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset] md:grid-cols-7">
          {filters.map((filter) => (
            <TabsTrigger
              key={filter.value}
              value={filter.value}
              className={`${filter.value === 'all' || filter.value === 'custom' ? 'col-span-5' : 'col-span-2'} min-h-9 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-all sm:text-xs md:col-span-1 md:text-sm data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-[rgba(255,142,93,0.25)_0_1px_0_inset]`}
            >
              {filter.value === "hoje" && <CalendarDays className="mr-1.5 hidden h-3.5 w-3.5 sm:block" />}
              {filter.value === "all" && <History className="mr-1.5 hidden h-3.5 w-3.5 sm:block" />}
              {filter.value === "custom" && <CalendarRange className="mr-1.5 hidden h-3.5 w-3.5 sm:block" />}
              {filter.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {value === 'custom' && (
        <form
          onSubmit={applyCustomRange}
          className="mt-2 rounded-xl border border-white/[0.07] bg-black/10 p-3"
          aria-label="Selecionar tempo personalizado"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <label htmlFor={startInputId} className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Data inicial
                <Input
                  id={startInputId}
                  type="date"
                  value={draftRange.start}
                  max={draftRange.end || brasiliaDateKey()}
                  onChange={(event) => {
                    setDraftRange((current) => ({ ...current, start: event.target.value }))
                    setRangeError(null)
                  }}
                  className="h-10 border-white/[0.08] bg-white/[0.04] text-foreground [color-scheme:dark]"
                />
              </label>
              <label htmlFor={endInputId} className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Data final
                <Input
                  id={endInputId}
                  type="date"
                  value={draftRange.end}
                  min={draftRange.start}
                  max={brasiliaDateKey()}
                  onChange={(event) => {
                    setDraftRange((current) => ({ ...current, end: event.target.value }))
                    setRangeError(null)
                  }}
                  className="h-10 border-white/[0.08] bg-white/[0.04] text-foreground [color-scheme:dark]"
                />
              </label>
            </div>
            <Button type="submit" size="sm" className="h-10 rounded-lg bg-gradient-ember px-5 text-white">
              Aplicar período
            </Button>
          </div>
          {rangeError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">{rangeError}</p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              Período aplicado: {formatDateKey(customRange.start)} a {formatDateKey(customRange.end)} (inclusive)
            </p>
          )}
        </form>
      )}
    </Tabs>
  )
}
