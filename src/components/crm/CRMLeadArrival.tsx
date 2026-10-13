import { Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useLiveClockSelector } from '@/hooks/useLiveClock'
import type { CRMLead } from '@/hooks/useCRM'
import { elapsedLabel, leadArrivedAt, leadDateTime, leadUrgency, urgencyClass } from '@/lib/meta-waves'
import { importChannel, importReceivedAt } from '@/lib/crm-imports'

/**
 * "Caiu em 11/10 às 10:43 · há 8 min". Enquanto o lead não foi abordado, a cor mostra a urgência
 * (verde até 15 min, amarelo até 1 h, vermelho depois); depois da abordagem fica neutra.
 */
export function CRMLeadArrival({ lead, compact = false }: { lead: Pick<CRMLead, 'lead_source' | 'lead_generated_at' | 'approach_stage' | 'lead_received_at' | 'import_channel' | 'import_snapshot'>; compact?: boolean }) {
  const receipt = importReceivedAt(lead)
  const at = importChannel(lead) ? receipt || leadArrivedAt(lead) : null
  const waiting = lead.approach_stage === 'nao_abordado'
  const view = useLiveClockSelector(now => at ? `${leadUrgency(at, now.getTime())}|${elapsedLabel(at, now.getTime())}` : '', at && waiting ? 30_000 : 0)
  if (!at) return null
  const [urgency, elapsed] = view.split('|') as [keyof typeof urgencyClass, string]
  const label = `${receipt ? 'Recebido em' : 'Formulário enviado em'} ${leadDateTime(at)}`
  return <Badge variant="outline" title={`${label} · Brasília`} className={`h-auto flex-wrap gap-1 px-2 py-0.5 text-[10px] tabular-nums ${waiting ? urgencyClass[urgency] : 'text-muted-foreground'}`}>
    <Clock3 className="h-3 w-3" />{label}{!compact && waiting && elapsed ? ` · ${elapsed}` : ''}
  </Badge>
}
