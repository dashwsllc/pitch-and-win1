const MINIMUM_AUTO_REFRESH_INTERVAL_MS = 50_000

const configuredInterval = Number(import.meta.env?.VITE_AUTO_REFRESH_INTERVAL_MS)

// Realtime delivers the fast path. Polling is a configurable safety net and
// defaults to 50 seconds, as requested for the dashboard.
export const AUTO_REFRESH_INTERVAL_MS =
  Number.isFinite(configuredInterval) && configuredInterval >= MINIMUM_AUTO_REFRESH_INTERVAL_MS
    ? configuredInterval
    : MINIMUM_AUTO_REFRESH_INTERVAL_MS

export const AUTO_REFRESH_INTERVAL_LABEL = `${AUTO_REFRESH_INTERVAL_MS / 1000} segundos`
