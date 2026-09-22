import { FormEvent, useEffect, useId, useState } from 'react'
import { CalendarDays, CalendarRange, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateKey } from '@/lib/brasilia-time'
import {
  CRMPipelineCustomRange,
  CRMPipelinePeriod,
  validateCRMPipelineRange,
} from '@/lib/crm-pipeline-period'

export function CRMLeadPeriodFilter({
  value,
  onValueChange,
  customRange,
  onCustomRangeChange,
}: {
  value: CRMPipelinePeriod
  onValueChange: (value: CRMPipelinePeriod) => void
  customRange: CRMPipelineCustomRange
  onCustomRangeChange: (range: CRMPipelineCustomRange) => void
}) {
  const startId = useId()
  const endId = useId()
  const [draft, setDraft] = useState(customRange)
  const [error, setError] = useState<string | null>(null)
  const options: Array<{ value: CRMPipelinePeriod; label: string }> = [
    { value: 'today', label: 'Hoje' },
    { value: 'yesterday', label: 'Ontem' },
    { value: '7days', label: '7 dias' },
    { value: '30days', label: '30 dias' },
    { value: 'all', label: 'Todo o período' },
    { value: 'custom', label: 'Período personalizado' },
  ]

  useEffect(() => setDraft(customRange), [customRange])

  const apply = (event: FormEvent) => {
    event.preventDefault()
    const nextError = validateCRMPipelineRange(draft)
    setError(nextError)
    if (nextError) return
    onCustomRangeChange(draft)
    onValueChange('custom')
  }

  return (
    <div className="space-y-2">
      <Tabs value={value} onValueChange={next => onValueChange(next as CRMPipelinePeriod)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-background/45 p-1">
          {options.map(option => (
            <TabsTrigger key={option.value} value={option.value} className="h-8 px-3 text-xs">
              {option.value === 'today' && <CalendarDays className="mr-1.5 h-3.5 w-3.5" />}
              {option.value === 'all' && <History className="mr-1.5 h-3.5 w-3.5" />}
              {option.value === 'custom' && <CalendarRange className="mr-1.5 h-3.5 w-3.5" />}
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {value === 'custom' && (
        <form onSubmit={apply} className="rounded-lg border border-border/50 bg-background/30 p-3" aria-label="Filtrar Esteira do LEAD por período personalizado">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label htmlFor={startId} className="space-y-1 text-xs text-muted-foreground">
              Data inicial
              <Input id={startId} type="date" className="h-9" value={draft.start} max={draft.end || undefined} onChange={event => { setDraft(current => ({ ...current, start: event.target.value })); setError(null) }} />
            </label>
            <label htmlFor={endId} className="space-y-1 text-xs text-muted-foreground">
              Data final
              <Input id={endId} type="date" className="h-9" value={draft.end} min={draft.start || undefined} onChange={event => { setDraft(current => ({ ...current, end: event.target.value })); setError(null) }} />
            </label>
            <Button type="submit" size="sm" className="h-9">Aplicar período</Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Aplicado: {formatDateKey(customRange.start)} a {formatDateKey(customRange.end)} (inclusive)</p>
          )}
        </form>
      )}
    </div>
  )
}
