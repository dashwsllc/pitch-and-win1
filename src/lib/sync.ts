import type { QueryClient } from '@tanstack/react-query'

// Registration-status fallback cadence. Dashboards themselves do not poll:
// they update on actual changes, network reconnection or an explicit refresh.
export const AUTO_REFRESH_INTERVAL_MS = 50_000

export const AUTO_REFRESH_INTERVAL_LABEL = `${AUTO_REFRESH_INTERVAL_MS / 1000} segundos`

// Visual clocks must never share the much slower database polling cadence.
export const LIVE_CLOCK_INTERVAL_MS = 1_000
export const CRM_CLOCK_INTERVAL_MS = 15_000
export const RECENT_SALES_AUTOPLAY_INTERVAL_MS = 6_000
export const DASHBOARD_SALES_CHANNEL = 'dashboard-sales-changed'
// A periodic reconciliation heals a failed aggregate or legacy local-state
// fetch even when the database revision has not changed again.
export const DASHBOARD_RECONCILE_INTERVAL_MS = 120_000

export function shouldRefreshDashboardRevision(
  lastRevision: string | undefined,
  revision: string,
  lastRefreshStartedAt: number,
  now: number,
) {
  return lastRevision === undefined || revision !== lastRevision ||
    now - lastRefreshStartedAt >= DASHBOARD_RECONCILE_INTERVAL_MS
}

function notifyLocalDataChanged() {
  window.dispatchEvent(new Event('dashboard-data-changed'))
}

export function notifyDashboardDataChanged() {
  notifyLocalDataChanged()
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(DASHBOARD_SALES_CHANNEL)
    channel.postMessage('data-updated')
    channel.close()
  }
}

// One synchronized refresh covers every active query and every legacy screen
// that still owns local async state. Inactive queries are marked stale so they
// cannot reopen with an old snapshot.
export async function refreshDashboardData(client: QueryClient) {
  notifyLocalDataChanged()
  await client.invalidateQueries()
}

export async function refreshDashboardMutation(client: QueryClient) {
  notifyDashboardDataChanged()
  await client.invalidateQueries()
}

// A successful write refreshes every dependent view, including new Arena and
// CRM queries, and alerts other tabs without rebroadcasting remote changes.
export async function refreshSalesData(client: QueryClient) {
  await refreshDashboardMutation(client)
}

export async function refreshApproachData(client: QueryClient) {
  await refreshDashboardMutation(client)
}

export async function refreshIdentityData(client: QueryClient) {
  await refreshDashboardMutation(client)
}
