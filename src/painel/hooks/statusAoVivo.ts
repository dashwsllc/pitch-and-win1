import { useAuth } from '@/hooks/useAuth'
import { useLiveClockSelector } from '@/hooks/useLiveClock'
import { supabase } from '@/integrations/supabase/client'

export type StatusAoVivo = 'conectando' | 'ao_vivo' | 'offline'

/**
 * Estado real do canal Realtime que o DataSync mantém para esta pessoa (dashboard-events-<id>). O selo "Ao vivo"
 * só aparece com o canal inscrito: sem Realtime a tela continua se atualizando pela verificação de revisão, mas
 * não é "ao vivo" e o selo diz a verdade (Conectando…, Offline).
 */
export function lerStatusAoVivo(userId: string | undefined): StatusAoVivo {
  if (!userId) return 'conectando'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  const canal = supabase.getChannels().find((c) => c.topic.endsWith(`dashboard-events-${userId}`))
  if (!canal) return 'conectando'
  if (canal.state === 'joined') return 'ao_vivo'
  if (canal.state === 'joining') return 'conectando'
  return 'offline'
}

/** Relê o estado do canal a cada 2 s; só re-renderiza quando o estado muda. */
export function useStatusAoVivo(): StatusAoVivo {
  const { user } = useAuth()
  const userId = user?.id
  return useLiveClockSelector(() => lerStatusAoVivo(userId), 2_000)
}
