export const PROACTIVE_NOTIFICATIONS_STORAGE_KEY =
  'dashboard-proactive-notifications-enabled'

export function readProactiveNotificationsPreference() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(PROACTIVE_NOTIFICATIONS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeProactiveNotificationsPreference(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      PROACTIVE_NOTIFICATIONS_STORAGE_KEY,
      String(enabled),
    )
  } catch {
    // A preferência continua aplicada na tela atual mesmo sem armazenamento.
  }
}
