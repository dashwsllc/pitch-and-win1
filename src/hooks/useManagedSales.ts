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
  return useQuery({
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
}
