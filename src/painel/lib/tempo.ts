// Datas guardadas em UTC e exibidas no fuso de Brasília, com Intl e sem biblioteca de datas.
// Tudo passa pelas funções de src/lib/brasilia-time.ts (a única fonte de "que dia e que hora é em Brasília").
import { brasiliaParts, formatBrasiliaDate } from '@/lib/brasilia-time'

type Instante = string | number | Date

const dois = (n: number) => String(n).padStart(2, '0')

/** Chave da hora local de Brasília: 'yyyy-MM-dd HH'. */
export function chaveDaHora(instante: Instante): string {
  const p = brasiliaParts(instante)
  return `${p.year}-${dois(p.month)}-${dois(p.day)} ${dois(p.hour)}`
}

/** HH:mm. */
export function formatarHoraMinuto(instante: Instante): string {
  const p = brasiliaParts(instante)
  return `${dois(p.hour)}:${dois(p.minute)}`
}

/** HH:mm:ss. */
export function formatarHoraCompleta(instante: Instante): string {
  const p = brasiliaParts(instante)
  return `${dois(p.hour)}:${dois(p.minute)}:${dois(p.second)}`
}

/** dd/MM (a data curta ao lado de uma hora que não é de hoje). */
export function formatarDiaMes(instante: Instante): string {
  const p = brasiliaParts(instante)
  return `${dois(p.day)}/${dois(p.month)}`
}

/** "Quinta-feira, 01/10/2026": o dia exato no fuso de Brasília. */
export function formatarDiaDaSemana(instante: Instante): string {
  const p = brasiliaParts(instante)
  const semana = formatBrasiliaDate(instante, { weekday: 'long', day: undefined, month: undefined, year: undefined })
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)}, ${dois(p.day)}/${dois(p.month)}/${p.year}`
}

/** Duração curta para pessoas: "47 s", "1 min 07 s", "1 h 05 min". */
export function formatarDuracao(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 1) return 'menos de 1 s'
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return s % 60 ? `${min} min ${dois(s % 60)} s` : `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${dois(min % 60)} min` : `${h} h`
}

/**
 * "agora", "há 5 s", "há 3 min", "há 2 h" e, passando de dois dias, "há 3 d". `agoraMs` vem de um relógio que anda
 * sozinho (useHa), nunca de Date.now() solto durante a renderização.
 */
export function formatarHa(iso: string, agoraMs: number): string {
  const s = Math.max(0, Math.round((agoraMs - Date.parse(iso)) / 1000))
  if (s < 5) return 'agora'
  if (s < 60) return `há ${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}
