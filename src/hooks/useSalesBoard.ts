import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import type { SalesBoardData } from '@/lib/sales'

export function useSalesBoard(status = 'pendente', search = '', page = 0, pageSize = 12) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['sales-board', user?.id, status, search, page, pageSize],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sales_board', {
        p_status: status, p_search: search, p_page: page, p_page_size: pageSize,
      })
      if (error) throw error
      return data as unknown as SalesBoardData
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}
