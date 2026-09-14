type ScheduledLead = {
  id: string
  created_at?: string | null
  pipeline_stage: string
  next_followup_at?: string | null
}

export function nextLeadSchedule(lead: ScheduledLead, callDate?: string | null) {
  if (['fechado_ganho', 'fechado_perdido', 'lead_perdido'].includes(lead.pipeline_stage)) return null
  const dates = [lead.next_followup_at, callDate]
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return dates[0] ?? null
}

// Oldest untreated appointments first, future appointments in ascending order,
// then unscheduled/closed leads. UUID breaks ties for a stable synchronized list.
export function compareLeadUrgency(a: ScheduledLead, b: ScheduledLead, aCall?: string | null, bCall?: string | null) {
  const aNext = nextLeadSchedule(a, aCall)
  const bNext = nextLeadSchedule(b, bCall)
  const aTime = aNext ? Date.parse(aNext) : Infinity
  const bTime = bNext ? Date.parse(bNext) : Infinity
  return aTime - bTime || (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id)
}

export function compareLeadRecency(a: ScheduledLead, b: ScheduledLead) {
  return (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id)
}

// For a selected call day, show the next upcoming time first. Calls from
// earlier today (or from a past selected day) follow from the nearest to the
// oldest, so the first card is always the most useful moment to act on.
export function compareCallProximity(
  aCall?: string | null,
  bCall?: string | null,
  now = Date.now(),
) {
  const parse = (value?: string | null) => {
    const time = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(time) ? time : null
  }
  const aTime = parse(aCall)
  const bTime = parse(bCall)
  if (aTime === null) return bTime === null ? 0 : 1
  if (bTime === null) return -1
  const aUpcoming = aTime >= now
  const bUpcoming = bTime >= now
  if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
  return aUpcoming ? aTime - bTime : bTime - aTime
}
