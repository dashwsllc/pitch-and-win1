import { useSyncExternalStore } from 'react'
import { outageGuard } from '@/lib/outage-client'

/** Aviso discreto no topo enquanto o disjuntor está aberto (servidor lento): explica por que as telas pararam de atualizar sozinhas. */
export function OutageBanner() {
  const state = useSyncExternalStore(outageGuard.subscribe, outageGuard.getState, outageGuard.getState)
  if (!state.open) return null
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-[100] border-b border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-center text-xs text-amber-200 backdrop-blur">
      Servidor lento no momento. Pausamos as atualizações automáticas por alguns segundos para não piorar; o que você salvar continua sendo enviado.
    </div>
  )
}
