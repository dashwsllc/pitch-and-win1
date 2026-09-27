const reloadKey = 'dashboard:chunk-reload-at'
const retryWindowMs = 60_000

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .* failed|failed to load module script|unable to preload css/i.test(message)
}

// A stale tab can request a chunk removed by a new deployment. One reload gets
// the current HTML and asset names; the time guard prevents a reload loop when
// the network is unavailable or the new deployment is also broken.
export function reloadAfterChunkError(): boolean {
  try {
    const now = Date.now()
    const lastReload = Number(sessionStorage.getItem(reloadKey) ?? 0)
    if (now - lastReload < retryWindowMs) return false
    sessionStorage.setItem(reloadKey, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
