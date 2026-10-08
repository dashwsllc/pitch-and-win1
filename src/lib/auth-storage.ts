// Onde o login fica guardado. A sessão ficava só na aba (sessionStorage): fechar a aba, reiniciar o navegador ou abrir o
// dashboard numa aba nova pedia a senha de novo, e abas duplicadas dividiam o mesmo refresh token, o que fazia o servidor
// revogar a sessão inteira. Agora ela fica no localStorage, compartilhada por todas as abas do mesmo navegador. Se o navegador
// não permitir o localStorage (modo restrito), volta a valer a aba.

/** O armazenamento que guarda o login: localStorage quando o navegador permite gravar nele, senão o da aba. */
export function pickAuthStorage(win: { localStorage: Storage; sessionStorage: Storage }): Storage {
  try {
    const probe = '__ws_auth_storage_probe__'
    win.localStorage.setItem(probe, '1')
    win.localStorage.removeItem(probe)
    return win.localStorage
  } catch {
    return win.sessionStorage
  }
}

/**
 * Logins criados antes da mudança estão no sessionStorage da aba. Leva o login para o armazenamento compartilhado uma vez, para
 * ninguém precisar entrar de novo, e nunca deixa uma segunda cópia do refresh token para trás. Se o armazenamento compartilhado
 * já tem um login, ele é o mais recente (está em uso) e vence.
 */
export function adoptTabSession(storageKey: string, target: Storage, tab: Storage) {
  if (target === tab) return
  try {
    const legacy = tab.getItem(storageKey)
    if (legacy && !target.getItem(storageKey)) target.setItem(storageKey, legacy)
    tab.removeItem(storageKey)
  } catch {
    // Armazenamento bloqueado: não há o que levar.
  }
}
