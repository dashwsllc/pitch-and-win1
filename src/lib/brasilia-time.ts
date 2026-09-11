export const BRASILIA_TIME_ZONE = 'America/Sao_Paulo'

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const brasiliaPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BRASILIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function brasiliaParts(value: Date | string | number = new Date()): DateParts {
  const date = value instanceof Date ? value : new Date(value)
  const parts = Object.fromEntries(
    brasiliaPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<keyof DateParts, number>
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

export function brasiliaDateKey(value: Date | string | number = new Date()) {
  const { year, month, day } = brasiliaParts(value)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function brasiliaMonthKey(value: Date | string | number = new Date()) {
  const { year, month } = brasiliaParts(value)
  return `${year}-${pad(month)}`
}

export function addDaysToDateKey(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function isValidDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addMonthsToMonthKey(monthKey: string, amount: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + amount, 1, 12))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

function localPartsAt(date: Date) {
  const parts = brasiliaParts(date)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

// Converts a wall-clock time in America/Sao_Paulo into its UTC instant. The
// second pass also handles historical daylight-saving transitions correctly.
export function brasiliaLocalToDate(
  dateKey: string,
  time = '00:00:00',
) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number)
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let candidate = new Date(wallClockUtc)
  candidate = new Date(wallClockUtc - (localPartsAt(candidate) - candidate.getTime()))
  candidate = new Date(wallClockUtc - (localPartsAt(candidate) - candidate.getTime()))
  return candidate
}

export function brasiliaDayBounds(dateKey = brasiliaDateKey()) {
  return {
    start: brasiliaLocalToDate(dateKey),
    end: brasiliaLocalToDate(addDaysToDateKey(dateKey, 1)),
  }
}

export function brasiliaDateRange(days: number, endDateKey = brasiliaDateKey()) {
  return {
    start: brasiliaLocalToDate(addDaysToDateKey(endDateKey, -(days - 1))),
    end: brasiliaLocalToDate(addDaysToDateKey(endDateKey, 1)),
  }
}

export function brasiliaLocalInputToIso(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  if (!isValidDateKey(match[1])) return null
  const [hours, minutes] = match[2].split(':').map(Number)
  if (hours > 23 || minutes > 59 || Number(match[3] ?? 0) > 59) return null
  const date = brasiliaLocalToDate(match[1], `${match[2]}:${match[3] ?? '00'}`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function isoToBrasiliaLocalInput(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const { year, month, day, hour, minute } = brasiliaParts(value)
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

export function formatBrasiliaDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Sem registro'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRASILIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  }).format(date)
}

export function formatDateKey(dateKey: string, options?: Intl.DateTimeFormatOptions) {
  if (!isValidDateKey(dateKey)) return 'Data não selecionada'
  return formatBrasiliaDate(brasiliaLocalToDate(dateKey, '12:00:00'), options)
}

export function millisecondsUntilBrasiliaMidnight(now = new Date()) {
  return Math.max(0, brasiliaDayBounds(brasiliaDateKey(now)).end.getTime() - now.getTime())
}
