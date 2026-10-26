import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CRMLead } from '@/hooks/useCRM'
import { addDaysToDateKey, formatDateKey } from '@/lib/brasilia-time'
import {
  importDateKey, matchesCRMImport, matchesImportPeriod,
  type ImportSection, type ImportMethodFilter, type ImportPeriod, type ImportPeriodRange, type ImportPeriodSelection,
} from '@/lib/crm-imports'

const periodOptions: Array<{ value: ImportPeriod; label: string }> = [
  { value: 'all', label: 'Todas as datas' },
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'date', label: 'Data específica' },
  { value: 'range', label: 'Período' },
]

export function CRMImportsSection({ leads, section, method, period, range, today, onSection, onMethod, onPeriod }: {
  leads: CRMLead[]; section: ImportSection; method: ImportMethodFilter
  period: ImportPeriodSelection; range: ImportPeriodRange; today: string
  onSection: (value: ImportSection) => void; onMethod: (value: ImportMethodFilter) => void
  onPeriod: (patch: Partial<ImportPeriodSelection>) => void
}) {
  const imported = leads.filter(lead => matchesCRMImport(lead, 'all', 'all'))
  const countOn = (dateKey: string) => imported.filter(lead => importDateKey(lead) === dateKey).length
  const count = (value: ImportPeriod) => value === 'today' ? countOn(today) : value === 'yesterday' ? countOn(addDaysToDateKey(today, -1)) : null
  const choose = (value: ImportPeriod) => onPeriod({
    period: value,
    ...(value === 'date' && !period.date ? { date: today } : {}),
    ...(value === 'range' && (!period.start || !period.end) ? { start: addDaysToDateKey(today, -6), end: today } : {}),
  })
  const invalid = range && 'invalid' in range ? range.invalid : null
  const applied = range && !('invalid' in range)
    ? range.startKey === range.endKey ? formatDateKey(range.startKey) : `${formatDateKey(range.startKey)} a ${formatDateKey(range.endKey)}`
    : null
  return <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="Importações do SDR">
    <div><h2 className="font-semibold">Importações · SDR</h2><p className="mt-1 text-xs text-muted-foreground">Contatos aprovados, com dados e contexto da origem. Recebimentos mais recentes primeiro · data e horário de Brasília.</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Origem dos leads importados">
      {([{value:'all',label:'Todas'}] as const).map(item =>
        <Button key={item.value} size="sm" variant={section === item.value ? 'default' : 'outline'} aria-pressed={section === item.value} onClick={() => onSection(item.value)}>
          {item.label} · {leads.filter(lead => matchesCRMImport(lead, item.value, 'all') && matchesImportPeriod(lead, range)).length}
        </Button>)}
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Forma de entrada dos leads importados">
      {([{value:'all',label:'Automáticas e manuais'}, {value:'automatic',label:'Automáticas'}, {value:'manual',label:'Manuais'}] as const).map(item =>
        <Button key={item.value} size="sm" variant={method === item.value ? 'secondary' : 'ghost'} aria-pressed={method === item.value} onClick={() => onMethod(item.value)}>{item.label}</Button>)}
    </div>
    <div className="space-y-2 border-t border-border/40 pt-3" role="group" aria-label="Filtrar importações por data de recebimento">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Recebidas em:</span>
        {periodOptions.map(option => {
          const total = count(option.value)
          return <Button key={option.value} type="button" size="sm" variant={period.period === option.value ? 'default' : 'outline'}
            aria-pressed={period.period === option.value} data-import-period-option={option.value} onClick={() => choose(option.value)}>
            {option.label}{total !== null && <span className="ml-1 opacity-70">({total})</span>}
          </Button>
        })}
      </div>
      {period.period === 'date' && <Input type="date" aria-label="Escolher a data de recebimento" className="h-9 w-full sm:w-44"
        value={period.date} onChange={event => onPeriod({ date: event.target.value })} />}
      {period.period === 'range' && <div className="grid gap-2 sm:grid-cols-[repeat(2,minmax(0,11rem))]">
        <label className="space-y-1 text-xs text-muted-foreground">Data inicial
          <Input type="date" className="h-9" value={period.start} max={period.end || undefined} onChange={event => onPeriod({ start: event.target.value })} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">Data final
          <Input type="date" className="h-9" value={period.end} min={period.start || undefined} onChange={event => onPeriod({ end: event.target.value })} />
        </label>
      </div>}
      {invalid && <p role="alert" className="text-xs text-amber-400">{invalid}</p>}
      {applied && <p role="status" className="text-xs text-muted-foreground">Mostrando recebidas em {applied} (inclusive) · dia de Brasília</p>}
    </div>
  </section>
}
