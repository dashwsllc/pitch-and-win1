import type { QueryClient } from '@tanstack/react-query'

// Single fixed cadence for every automatic dashboard update. This is
// intentionally not configurable: the product requirement is exactly 50s.
export const AUTO_REFRESH_INTERVAL_MS = 50_000

export const AUTO_REFRESH_INTERVAL_LABEL = `${AUTO_REFRESH_INTERVAL_MS / 1000} segundos`

// A successful write refreshes both mounted consumers and cached routes.
export async function refreshSalesData(client: QueryClient) {
  window.dispatchEvent(new Event('dashboard-data-changed'))
  await Promise.all(['managed-sales', 'sales-balance', 'sales-board', 'team-ranking', 'crm', 'executive-audit', 'company-goals']
    .map(key => client.invalidateQueries({ queryKey: [key] })))
}
