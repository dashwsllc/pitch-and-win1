import { brasiliaParts, isValidDateKey } from '@/lib/brasilia-time'

// Nem todo lead entra pelo fluxo de IA, entao nem sempre existe data de
// nascimento. A idade pode ser informada manualmente, sem que isso signifique
// que conhecemos o dia exato de nascimento: nunca derivamos uma data a partir
// da idade.
export const MIN_ATHLETE_AGE = 1
export const MAX_ATHLETE_AGE = 80

export type AthleteAgeSource = 'birth_date' | 'manual'

export type AthleteAgeInput = {
  athlete_birth_date?: string | null
  athlete_age?: number | null
}

// Idade completa em anos, considerando se o aniversario ja ocorreu no ano
// corrente. O "hoje" vem do fuso de Brasilia, o mesmo usado no resto do CRM.
export function ageFromBirthDate(
  birthDate: string | null | undefined,
  now: Date | string | number = new Date(),
): number | null {
  if (!birthDate) return null
  const dateKey = birthDate.slice(0, 10)
  if (!isValidDateKey(dateKey)) return null
  const [birthYear, birthMonth, birthDay] = dateKey.split('-').map(Number)
  const today = brasiliaParts(now)
  let age = today.year - birthYear
  const hadBirthdayThisYear =
    today.month > birthMonth || (today.month === birthMonth && today.day >= birthDay)
  if (!hadBirthdayThisYear) age -= 1
  if (age < 0 || age > 150) return null
  return age
}

export function isValidManualAge(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_ATHLETE_AGE &&
    value <= MAX_ATHLETE_AGE
  )
}

// Regra unica de prioridade, aplicada em todo o sistema: a data de nascimento,
// quando existe e e valida, e a fonte mais precisa e vence a idade manual.
export function resolveAthleteAge(
  lead: AthleteAgeInput,
  now: Date | string | number = new Date(),
): { age: number | null; source: AthleteAgeSource | null } {
  const fromBirth = ageFromBirthDate(lead.athlete_birth_date, now)
  if (fromBirth !== null) return { age: fromBirth, source: 'birth_date' }
  if (isValidManualAge(lead.athlete_age)) return { age: lead.athlete_age, source: 'manual' }
  return { age: null, source: null }
}

export function formatAthleteAge(
  lead: AthleteAgeInput,
  now: Date | string | number = new Date(),
): string | null {
  const { age } = resolveAthleteAge(lead, now)
  if (age === null) return null
  return `${age} ${age === 1 ? 'ano' : 'anos'}`
}

// Usado pelo formulario para avisar quando a idade digitada contradiz a data de
// nascimento informada, em vez de sobrescrever qualquer um dos dois.
export function athleteAgeConflict(
  lead: AthleteAgeInput,
  now: Date | string | number = new Date(),
): { calculated: number; informed: number } | null {
  const calculated = ageFromBirthDate(lead.athlete_birth_date, now)
  if (calculated === null || !isValidManualAge(lead.athlete_age)) return null
  return calculated === lead.athlete_age
    ? null
    : { calculated, informed: lead.athlete_age }
}
