import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useRoles } from './useRoles'
import { arenaRpc } from '@/lib/arena-api'
import { hasVoxenInFlight, isMissingRpc, isVoxenSyncStates, runVoxenBatch, withVoxenTimeout, type VoxenBatchOutcome, type VoxenRpcRow, type VoxenSyncRow } from '@/lib/voxen-send'

/**
 * Estado de cada lead no envio para a VOXEN. Quem não aparece na lista está "disponível". Se o banco ainda não tem as funções (migration não aplicada),
 * `supported` fica falso e o CRM simplesmente não mostra o recurso. `poll`: com a tela do VOXEN aberta, atualiza sozinho enquanto há lead na fila (ela anda sem ninguém
 * mexer); sem fila não consulta o banco de tempos em tempos.
 */
export function useCRMVoxenStates({ poll = false }: { poll?: boolean } = {}) {
  const { user } = useAuth()
  const { hasCRMAccess } = useRoles()
  const query = useQuery({
    // Fica sob ["crm"]: toda mudança em lead, nota ou contexto que o CRM já escuta renova o estado também.
    queryKey: ['crm', 'voxen', 'states', user?.id],
    enabled: !!user && hasCRMAccess,
    staleTime: 5_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: poll ? query => (hasVoxenInFlight(query.state.data) ? 15_000 : false) : false,
    queryFn: async () => {
      try {
        const data = await arenaRpc<unknown>('crm_voxen_sync_states', {})
        if (!isVoxenSyncStates(data)) throw new Error('invalid_voxen_sync_states')
        return data
      } catch (error) {
        if (isMissingRpc(error)) return null
        throw error
      }
    },
  })
  const data = query.data ?? null
  const states = useMemo(() => new Map<string, VoxenSyncRow>((data?.rows ?? []).map(row => [row.lead_id, row])), [data])
  return {
    states,
    ready: data?.ready === true,
    supported: query.data !== null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Enviar e parar de sincronizar. Sem confirmação: o clique age. Blocos de 15 leads, um de cada vez, cada um com tempo-limite; falha passageira repete o bloco
 * (`notice` avisa na tela) e o que falhar de vez devolve o que foi feito até ali.
 */
export function useCRMVoxenActions() {
  const client = useQueryClient()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (name: 'crm_voxen_send' | 'crm_voxen_stop', ids: readonly string[]): Promise<VoxenBatchOutcome> => {
    setBusy(true)
    setNotice(null)
    setProgress({ done: 0, total: new Set(ids).size })
    try {
      return await runVoxenBatch(ids, chunk => withVoxenTimeout(signal => arenaRpc<VoxenRpcRow[]>(name, { p_leads: chunk }, { signal })),
        (done, total) => { setNotice(null); setProgress({ done, total }) },
        { onRetry: (attempt, of) => setNotice(`O servidor demorou para responder. Tentando de novo (${attempt} de ${of})…`) })
    } finally {
      setBusy(false)
      setProgress(null)
      setNotice(null)
      // Sem esperar a releitura: com o servidor lento o aviso do resultado não pode ficar preso atrás dela.
      void client.invalidateQueries({ queryKey: ['crm', 'voxen'] })
    }
  }
  return { send: (ids: readonly string[]) => run('crm_voxen_send', ids), stop: (ids: readonly string[]) => run('crm_voxen_stop', ids), busy, progress, notice }
}
