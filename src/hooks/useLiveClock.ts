import { useEffect, useState } from 'react'
import { LIVE_CLOCK_INTERVAL_MS } from '@/lib/sync'

// Align updates to wall-clock boundaries instead of drifting from mount time.
// Returning to a sleeping/background tab also updates the value immediately.
export function useLiveClock(intervalMs = LIVE_CLOCK_INTERVAL_MS) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      const remainder = Date.now() % intervalMs
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, Math.max(1, intervalMs - remainder))
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) setNow(new Date())
    }

    schedule()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)

    return () => {
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [intervalMs])

  return now
}
