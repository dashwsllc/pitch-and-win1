import { useLiveClockSelector } from '@/hooks/useLiveClock'
import { formatarHa } from '../lib/tempo'

/**
 * "Agora" que anda sozinho (a cada 30 s), para "última hora" e "hoje" continuarem certos com a tela aberta.
 * Usa o relógio do projeto (timeouts alinhados ao relógio de parede), não um setInterval próprio.
 */
export function useAgora(intervaloMs = 30_000): string {
  return useLiveClockSelector((agora) => agora.toISOString(), intervaloMs)
}

/** "há 5 s", "há 3 min": anda sozinho a cada segundo, e só re-renderiza quando o texto muda. */
export function useHa(iso: string | null | undefined): string | null {
  return useLiveClockSelector((agora) => (iso ? formatarHa(iso, agora.getTime()) : null), 1_000)
}
