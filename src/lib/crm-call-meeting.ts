import { useEffect, useState } from 'react'
import { callEndIso } from '@/lib/crm-call-duration'

/** O que uma call precisa para saber se o botão "Entrar na call" vale agora. */
export interface CallComLink {
  scheduled_at: string | null
  duration_minutes?: number
  is_completed: boolean
  cancelled_at: string | null
  outcome: string | null
  meeting_link?: string | null
}

const LINK_VALIDO = /^https:\/\/[^/\s]+\S*$/

/**
 * O link como o banco guarda: sem espaços nas pontas, "meet.google.com/..." ganha https://, em branco apaga.
 * Devolve `erro` quando o endereço não é https (o banco recusaria do mesmo jeito).
 */
export function normalizarLinkDaCall(texto: string): { link: string | null; erro: string | null } {
  let link = texto.trim()
  if (!link) return { link: null, erro: null }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) link = `https://${link}`
  if (link.length > 2048 || !LINK_VALIDO.test(link)) return { link: null, erro: 'Cole o endereço https da reunião (ex.: https://meet.google.com/abc-defg-hij).' }
  return { link, erro: null }
}

/**
 * O link que vale para entrar na call: o que o Closer colou na /agenda; sem ele, o link do Google Meet que a agenda
 * gerou para o evento (acesso aberto, sem sala de espera). Vazio ou em branco conta como "sem link".
 */
export function linkDaCall(call: Pick<CallComLink, 'meeting_link'>, linkDoGoogle?: string | null): string | null {
  return call.meeting_link?.trim() || linkDoGoogle?.trim() || null
}

/** Call encerrada (resultado registrado, concluída ou cancelada): o link não aparece mais. */
export function callEncerrada(call: CallComLink) {
  return call.is_completed || !!call.cancelled_at || !!call.outcome
}

/** Início e fim (ms) da call, ou null se o horário não for válido. */
export function janelaDaCall(call: CallComLink): { inicio: number; fim: number } | null {
  const inicio = Date.parse(call.scheduled_at ?? '')
  const fim = Date.parse(callEndIso(call) ?? '')
  return Number.isFinite(inicio) && Number.isFinite(fim) ? { inicio, fim } : null
}

/** O botão aparece só do início ao fim da call, com link (do Closer ou do Google) e enquanto ela não foi encerrada. */
export function podeEntrarNaCall(call: CallComLink, agora: number, linkDoGoogle?: string | null) {
  const janela = janelaDaCall(call)
  return !!linkDaCall(call, linkDoGoogle) && !callEncerrada(call) && !!janela && agora >= janela.inicio && agora < janela.fim
}

/**
 * Se a call está no horário agora. Acorda exatamente no início e no fim (não fica consultando o relógio): o botão
 * aparece e some na hora certa mesmo com a tela parada.
 */
export function useCallNoHorario(call: CallComLink, linkDoGoogle?: string | null) {
  const janela = janelaDaCall(call)
  const inicio = janela?.inicio ?? null
  const fim = janela?.fim ?? null
  // O estado só acorda o componente nas viradas; a resposta usa sempre o relógio de agora.
  const [virada, setVirada] = useState(0)
  useEffect(() => {
    if (inicio === null || fim === null) return
    const atual = Date.now()
    const proxima = atual < inicio ? inicio : atual < fim ? fim : null
    if (proxima === null) return
    // setTimeout aceita no máximo ~24,8 dias; acima disso, reavalia nesse limite.
    const timer = window.setTimeout(() => setVirada((n) => n + 1), Math.min(proxima - atual + 50, 2_147_483_000))
    return () => window.clearTimeout(timer)
  }, [inicio, fim, virada])
  return podeEntrarNaCall(call, Date.now(), linkDoGoogle)
}
