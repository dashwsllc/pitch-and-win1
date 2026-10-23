// Liga o disjuntor (outage-guard) ao React Query do app: toda consulta que falha por sobrecarga do servidor alimenta o disjuntor, e quando ele abre as atualizações
// automáticas ficam em pausa (onlineManager) por alguns segundos. Gravações da pessoa nunca são pausadas (networkMode 'always' nas mutations, ver App.tsx).
import { onlineManager, QueryCache, QueryClient } from '@tanstack/react-query'
import { createOutageGuard, retryDelay, retryPolicy } from '@/lib/outage-guard'

export const outageGuard = createOutageGuard({ setOnline: online => onlineManager.setOnline(online) })

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: error => outageGuard.recordFailure(error),
      onSuccess: () => outageGuard.recordSuccess(),
    }),
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: retryPolicy, retryDelay },
      // a pessoa clicou em salvar: o pedido sai mesmo com o disjuntor aberto
      mutations: { networkMode: 'always' },
    },
  })
}
