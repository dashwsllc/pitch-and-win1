import type { QueryClient } from '@tanstack/react-query'

// Registration-status fallback cadence. Dashboards themselves do not poll:
// they update on actual changes, network reconnection or an explicit refresh.
export const AUTO_REFRESH_INTERVAL_MS = 50_000

export const AUTO_REFRESH_INTERVAL_LABEL = `${AUTO_REFRESH_INTERVAL_MS / 1000} segundos`

// Visual clocks must never share the much slower database polling cadence.
export const LIVE_CLOCK_INTERVAL_MS = 1_000
export const CRM_CLOCK_INTERVAL_MS = 15_000
export const RECENT_SALES_AUTOPLAY_INTERVAL_MS = 6_000

export function notifyDashboardDataChanged() {
  window.dispatchEvent(new Event('dashboard-data-changed'))
}

async function invalidateKeys(client: QueryClient, keys: readonly string[]) {
  await Promise.all(keys.map(key => client.invalidateQueries({ queryKey: [key] })))
}

// One synchronized refresh covers every active query and every legacy screen
// that still owns local async state. Inactive queries are marked stale so they
// cannot reopen with an old snapshot.
export async function refreshDashboardData(client: QueryClient) {
  notifyDashboardDataChanged()
  await client.invalidateQueries()
}

// A successful write refreshes both mounted consumers and cached routes.
export async function refreshSalesData(client: QueryClient) {
  notifyDashboardDataChanged()
  await invalidateKeys(client, ['managed-sales', 'sales-balance', 'sales-board', 'team-ranking', 'sdr-ranking', 'crm', 'executive-audit', 'company-goals', 'arena'])
}

export async function refreshApproachData(client: QueryClient) {
  notifyDashboardDataChanged()
  await invalidateKeys(client, ['team-ranking'])
}

export async function refreshIdentityData(client: QueryClient) {
  notifyDashboardDataChanged()
  await invalidateKeys(client, ['executive-users', 'team-ranking', 'sdr-ranking', 'sales-board'])
}
