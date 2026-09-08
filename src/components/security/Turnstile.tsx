import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string
    theme: 'dark' | 'light' | 'auto'
    callback: (token: string) => void
    'expired-callback': () => void
    'error-callback': () => void
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim()
const scriptId = 'cloudflare-turnstile-api'

export const captchaRequired = Boolean(siteKey)

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onToken)

  useEffect(() => {
    callbackRef.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    let widgetId: string | undefined
    let cancelled = false

    const render = () => {
      if (cancelled || widgetId || !window.turnstile || !containerRef.current) return
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: token => callbackRef.current(token),
        'expired-callback': () => callbackRef.current(null),
        'error-callback': () => callbackRef.current(null),
      })
    }

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (window.turnstile) {
      render()
    } else if (existing) {
      existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.addEventListener('load', render, { once: true })
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      existing?.removeEventListener('load', render)
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [])

  if (!siteKey) return null
  return <div ref={containerRef} className="min-h-[65px]" aria-label="Verificação anti-bot" />
}
