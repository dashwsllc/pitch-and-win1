import { createContext } from 'react'
import type { Foco } from './foco'

export interface ValorDoFoco {
  foco: Foco | null
  mudar: (proximo: (atual: Foco | null) => Foco | null) => void
}

/** A mira dividida pelos gráficos da mesma linha do tempo (ver FocoNoTempo e useFocoNoTempo). */
export const ContextoDoFoco = createContext<ValorDoFoco | null>(null)
