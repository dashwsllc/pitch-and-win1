import { Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { linkDaCall, useCallNoHorario, type CallComLink } from '@/lib/crm-call-meeting'
import { useGoogleMeetingUrl } from './CRMCalendarStatus'

/**
 * "Entrar na call": só existe do início ao fim da call, com o link que o Closer colou na /agenda ou, quando ele não colou,
 * o do Google Meet gerado pela agenda, e enquanto a call não foi encerrada. Fora disso não renderiza nada.
 */
export function CRMCallMeetButton({ call, className = '' }: { call: CallComLink & { id: string }; className?: string }) {
  const linkDoGoogle = useGoogleMeetingUrl(call.id)
  const noHorario = useCallNoHorario(call, linkDoGoogle)
  const link = linkDaCall(call, linkDoGoogle)
  if (!noHorario || !link) return null
  return (
    <Button asChild size="sm" className={`h-7 gap-1.5 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-600/90 ${className}`}>
      <a href={link} target="_blank" rel="noopener noreferrer">
        <Video className="h-3.5 w-3.5" aria-hidden="true" />
        Entrar na call (Google Meet)
      </a>
    </Button>
  )
}
