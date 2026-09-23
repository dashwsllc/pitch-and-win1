import { useState } from 'react'
import { ArenaView } from '@/components/arena/ArenaView'
import { NotificationInbox } from '@/components/arena/ArenaNotifications'
import { useArena } from '@/hooks/useArena'
import { useBrasiliaToday } from '@/hooks/useGoals'
import { createDefaultDashboardCustomRange, resolveDashboardPeriod, validateDashboardCustomRange, type DashboardDateFilter } from '@/lib/dashboard-period'

export default function Arena() {
  const today = useBrasiliaToday()
  const [filter, setFilter] = useState<DashboardDateFilter>('hoje')
  const [custom, setCustom] = useState(createDefaultDashboardCustomRange)
  const period = resolveDashboardPeriod(filter, custom)
  const invalid = filter === 'custom' ? validateDashboardCustomRange(custom) : null
  const query = useArena(period.start!.toISOString(), period.end!.toISOString(), !invalid)
  return <ArenaView query={query} today={today} filter={filter} setFilter={setFilter} custom={custom} setCustom={setCustom} invalid={invalid} toolbar={<NotificationInbox />} />
}
