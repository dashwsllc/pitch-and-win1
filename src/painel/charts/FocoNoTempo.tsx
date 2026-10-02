import { useMemo, useState, type ReactNode } from 'react'
import { ContextoDoFoco } from './contextoDoFoco'
import type { Foco } from './foco'

/** Envolve os gráficos que dividem a linha do tempo: apontar um intervalo num deles acende o mesmo intervalo nos outros. */
export function FocoNoTempo({ children }: { children: ReactNode }) {
  const [foco, setFoco] = useState<Foco | null>(null)
  const valor = useMemo(() => ({ foco, mudar: setFoco }), [foco])
  return <ContextoDoFoco.Provider value={valor}>{children}</ContextoDoFoco.Provider>
}
