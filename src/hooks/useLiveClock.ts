import { useEffect, useRef, useState } from 'react'
import { LIVE_CLOCK_INTERVAL_MS } from '@/lib/sync'

const identity = (now: Date) => now

// Align updates to wall-clock boundaries instead of drifting from mount time.
// Returning to a sleeping/background tab also updates the value immediately.
//
// `select` derives what the component actually renders from the current time.
// React skips the re-render whenever the derived value is unchanged, so a
// once-per-second tick only re-renders the parts of the screen whose output
// really changed (a countdown label), not the whole page around it.
// An `intervalMs` <= 0 keeps the value frozen (no timer at all).
export function useLiveClockSelector<T>(select: (now: Date) => T, intervalMs = LIVE_CLOCK_INTERVAL_MS): T {
  const [value, setValue] = useState(() => select(new Date()))
  const selector = useRef(select)
  useEffect(() => { selector.current = select })

  useEffect(() => {
    if (intervalMs <= 0) return
    let timer: number | undefined
    const update = () => setValue(selector.current(new Date()))

    const schedule = () => {
      const remainder = Date.now() % intervalMs
      timer = window.setTimeout(() => {
        // Nothing is visible in a hidden tab; the visibility handler catches up.
        if (!document.hidden) update()
        schedule()
      }, Math.max(1, intervalMs - remainder))
    }
    const refreshWhenVisible = () => {
      if (!document.hidden) update()
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

  return value
}

export function useLiveClock(intervalMs = LIVE_CLOCK_INTERVAL_MS) {
  return useLiveClockSelector(identity, intervalMs)
}
