import { Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCallNoHorario, type CallComLink } from '@/lib/crm-call-meeting'

/**
 * "Entrar na call": só existe do início ao fim da call, quando o Closer colou o link na /agenda e enquanto a call não
 * foi encerrada. Fora disso não renderiza nada.
 */
export function CRMCallMeetButton({ call, className = '' }: { call: CallComLink; className?: string }) {
  const noHorario = useCallNoHorario(call)
  if (!noHorario || !call.meeting_link) return null
  return (
    <Button asChild size="sm" className={`h-7 gap-1.5 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-600/90 ${className}`}>
      <a href={call.meeting_link} target="_blank" rel="noopener noreferrer">
        <Video className="h-3.5 w-3.5" aria-hidden="true" />
        Entrar na call (Google Meet)
      </a>
    </Button>
  )
}
