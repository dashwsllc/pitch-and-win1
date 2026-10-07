import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'
import { useAuth } from './useAuth'
import { useRoles } from './useRoles'
import { fetchAllPages } from '@/lib/supabase-pages'

export type ManagedSale = Tables<'vendas'>

export function useManagedSales(mineOnly = false) {
  const { user } = useAuth()
  const { isExecutive, loading } = useRoles()
  const sales = useQuery({
    queryKey: ['managed-sales', user?.id, isExecutive, mineOnly],
    enabled: !!user && !loading,
    queryFn: () => fetchAllPages((from, to) => {
      let query = supabase.from('vendas').select('*')
        .in('approval_status', ['aprovada', 'pendente'])
        .order('created_at', { ascending: false }).order('id')
      if (mineOnly || !isExecutive) query = query.eq('user_id', user!.id)
      return query.range(from, to)
    }),
    staleTime: 0,
    retry: 1,
  })
  const ownerIds = [...new Set((sales.data ?? []).map(sale => sale.user_id))].sort()
  const owners = useQuery({
    queryKey: ['managed-sale-owners', user?.id, ownerIds],
    enabled: !!user && ownerIds.length > 0,
    queryFn: async () => {
      const names: Record<string, string> = {}
      // Keep long sales histories inside URL limits; a missing profile must never hide a sale.
      for (let from = 0; from < ownerIds.length; from += 100) {
        const { data, error } = await supabase.from('profiles').select('user_id, display_name')
          .in('user_id', ownerIds.slice(from, from + 100))
        if (error) throw error
        for (const owner of data ?? []) names[owner.user_id] = owner.display_name || 'Vendedor sem nome'
      }
      return names
    },
    staleTime: 30_000,
    retry: 1,
  })
  return { ...sales, sellerNames: owners.data ?? {}, sellerNamesError: owners.isError }
}
