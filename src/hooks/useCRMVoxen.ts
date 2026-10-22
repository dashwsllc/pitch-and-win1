import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useRoles } from './useRoles'
import { arenaRpc } from '@/lib/arena-api'
import { isMissingRpc, isVoxenSyncStates, runVoxenBatch, type VoxenBatchOutcome, type VoxenRpcRow, type VoxenSyncRow } from '@/lib/voxen-send'

/**
 * Estado de cada lead no envio para a VOXEN. Quem não aparece na lista está "disponível". Se o banco ainda não tem as funções (migration não aplicada),
 * `supported` fica falso e o CRM simplesmente não mostra o recurso. `poll`: atualiza sozinho enquanto a tela do VOXEN está aberta (a fila anda sem ninguém mexer).
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
    refetchInterval: poll ? 15_000 : false,
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

/** Enviar e parar de sincronizar. Sem confirmação: o clique age. Blocos de 15 leads, um de cada vez; devolve o que foi feito até um eventual erro. */
export function useCRMVoxenActions() {
  const client = useQueryClient()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (name: 'crm_voxen_send' | 'crm_voxen_stop', ids: readonly string[]): Promise<VoxenBatchOutcome> => {
    setBusy(true)
    setProgress({ done: 0, total: new Set(ids).size })
    try {
      return await runVoxenBatch(ids, chunk => arenaRpc<VoxenRpcRow[]>(name, { p_leads: chunk }), (done, total) => setProgress({ done, total }))
    } finally {
      setBusy(false)
      setProgress(null)
      await client.invalidateQueries({ queryKey: ['crm', 'voxen'] })
    }
  }
  return { send: (ids: readonly string[]) => run('crm_voxen_send', ids), stop: (ids: readonly string[]) => run('crm_voxen_stop', ids), busy, progress }
}
