import {
  addDaysToDateKey,
  addMonthsToMonthKey,
  brasiliaDateKey,
  brasiliaDateRange,
  brasiliaLocalToDate,
  formatDateKey,
  isValidDateKey,
} from '@/lib/brasilia-time'

export type DashboardDateFilter =
  | 'hoje'
  | 'ontem'
  | '7dias'
  | '14dias'
  | '30dias'
  | 'custom'
  | 'all'

export interface DashboardCustomRange {
  start: string
  end: string
}

export interface ResolvedDashboardPeriod {
  start?: Date
  end?: Date
  startKey?: string
  endKey?: string
  allTime: boolean
}

interface DatedRecord {
  created_at: string
}

export interface DashboardSeriesPoint {
  month: string
  vendas: number
  abordagens: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function dateKeyValue(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function inclusiveDayCount(startKey: string, endKey: string) {
  return Math.round((dateKeyValue(endKey) - dateKeyValue(startKey)) / DAY_MS) + 1
}

function inclusiveMonthCount(startMonth: string, endMonth: string) {
  const [startYear, startValue] = startMonth.split('-').map(Number)
  const [endYear, endValue] = endMonth.split('-').map(Number)
  return (endYear - startYear) * 12 + endValue - startValue + 1
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)))
    .replace('.', '')
}

export function createDefaultDashboardCustomRange(): DashboardCustomRange {
  const end = brasiliaDateKey()
  return { start: addDaysToDateKey(end, -6), end }
}

export function validateDashboardCustomRange(range: DashboardCustomRange) {
  if (!isValidDateKey(range.start) || !isValidDateKey(range.end)) {
    return 'Informe a data inicial e a data final.'
  }
  if (range.start > range.end) {
    return 'A data inicial deve ser anterior ou igual à data final.'
  }
  if (range.end > brasiliaDateKey()) {
    return 'A data final não pode estar no futuro.'
  }
  return null
}

export function resolveDashboardPeriod(
  filter: DashboardDateFilter,
  customRange: DashboardCustomRange,
): ResolvedDashboardPeriod {
  if (filter === 'all') return { allTime: true }

  if (filter === 'custom') {
    const validRange = validateDashboardCustomRange(customRange)
      ? createDefaultDashboardCustomRange()
      : customRange
    return {
      start: brasiliaLocalToDate(validRange.start),
      end: brasiliaLocalToDate(addDaysToDateKey(validRange.end, 1)),
      startKey: validRange.start,
      endKey: validRange.end,
      allTime: false,
    }
  }

  const today = brasiliaDateKey()
  const days = filter === '7dias' ? 7 : filter === '14dias' ? 14 : filter === '30dias' ? 30 : 1
  const endKey = filter === 'ontem' ? addDaysToDateKey(today, -1) : today
  const startKey = addDaysToDateKey(endKey, -(days - 1))
  const range = brasiliaDateRange(days, endKey)
  return { ...range, startKey, endKey, allTime: false }
}

export function buildDashboardSeries(
  sales: DatedRecord[] | null | undefined,
  approaches: DatedRecord[] | null | undefined,
  period: ResolvedDashboardPeriod,
): DashboardSeriesPoint[] {
  const salesDateKeys = (sales ?? [])
    .map((item) => brasiliaDateKey(item.created_at))
    .filter(isValidDateKey)
  const approachDateKeys = (approaches ?? [])
    .map((item) => brasiliaDateKey(item.created_at))
    .filter(isValidDateKey)
  const eventDateKeys = [...salesDateKeys, ...approachDateKeys].sort()

  const startKey = period.startKey ?? eventDateKeys[0]
  const endKey = period.endKey ?? eventDateKeys[eventDateKeys.length - 1]
  if (!startKey || !endKey || startKey > endKey) return []

  const dayCount = inclusiveDayCount(startKey, endKey)
  const startMonth = startKey.slice(0, 7)
  const endMonth = endKey.slice(0, 7)
  const monthCount = inclusiveMonthCount(startMonth, endMonth)

  let keys: string[]
  let bucketForDate: (dateKey: string) => string
  let labelForKey: (key: string) => string

  if (dayCount <= 62) {
    keys = Array.from({ length: dayCount }, (_, index) => addDaysToDateKey(startKey, index))
    bucketForDate = (dateKey) => dateKey
    labelForKey = (dateKey) => formatDateKey(dateKey, { day: '2-digit', month: '2-digit', year: undefined })
  } else if (monthCount <= 48) {
    keys = Array.from({ length: monthCount }, (_, index) => addMonthsToMonthKey(startMonth, index))
    bucketForDate = (dateKey) => dateKey.slice(0, 7)
    labelForKey = formatMonthKey
  } else {
    const startYear = Number(startKey.slice(0, 4))
    const endYear = Number(endKey.slice(0, 4))
    keys = Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index))
    bucketForDate = (dateKey) => dateKey.slice(0, 4)
    labelForKey = (year) => year
  }

  const salesCount = new Map(keys.map((key) => [key, 0]))
  const approachCount = new Map(keys.map((key) => [key, 0]))

  salesDateKeys.forEach((dateKey) => {
    const key = bucketForDate(dateKey)
    if (salesCount.has(key)) salesCount.set(key, (salesCount.get(key) ?? 0) + 1)
  })
  approachDateKeys.forEach((dateKey) => {
    const key = bucketForDate(dateKey)
    if (approachCount.has(key)) approachCount.set(key, (approachCount.get(key) ?? 0) + 1)
  })

  return keys.map((key) => ({
    month: labelForKey(key),
    vendas: salesCount.get(key) ?? 0,
    abordagens: approachCount.get(key) ?? 0,
  }))
}
