// Acesso aberto do Meet das calls (quem tem o link entra sem pedir para entrar). Textos da tela de Configurações; o estado vem de `meetAccess` no status da integração.
export type MeetAccessState = 'unknown' | 'open' | 'scope_missing' | 'api_disabled' | 'not_permitted' | 'error'
export interface MeetAccessView { label: string; detail: string; tone: 'ok' | 'neutral' | 'attention' | 'problem'; reconnect: boolean }

export const MEET_API_URL = 'https://console.cloud.google.com/apis/library/meet.googleapis.com'

export function meetAccessView(state: MeetAccessState): MeetAccessView {
  switch (state) {
    case 'open': return { label: 'ativo', detail: 'Closer e lead entram pelo link sem precisar pedir para entrar, mesmo sem a conta que criou a call.', tone: 'ok', reconnect: false }
    case 'scope_missing': return { label: 'falta uma permissão', detail: 'Reconecte o Google e aceite a permissão de configurações do Meet. Enquanto isso, quem não está na lista de convidados precisa ser admitido na sala.', tone: 'attention', reconnect: true }
    case 'api_disabled': return { label: 'API do Meet desligada', detail: `Ative a Google Meet API no mesmo projeto do Google Cloud do app (${MEET_API_URL}). A tentativa se repete sozinha.`, tone: 'attention', reconnect: false }
    case 'not_permitted': return { label: 'o Google recusou', detail: 'O Google não deixou abrir o acesso das reuniões desta conta. As calls seguem sincronizadas, mas quem não está na lista de convidados precisa ser admitido na sala.', tone: 'problem', reconnect: false }
    case 'error': return { label: 'falha ao consultar o Meet', detail: 'A tentativa se repete sozinha na próxima sincronização. As calls seguem sincronizadas.', tone: 'attention', reconnect: false }
    default: return { label: 'ainda não verificado', detail: 'Aparece depois da próxima call sincronizada.', tone: 'neutral', reconnect: false }
  }
}
