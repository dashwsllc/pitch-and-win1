import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from './useAuth'
import { useRoles } from './useRoles'
import type { Product } from '@/lib/products'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'

export function useProducts() {
  const { user } = useAuth()
  const { isExecutive, loading: rolesLoading } = useRoles()
  return useQuery({
    queryKey: ['products', user?.id, isExecutive],
    enabled: !!user && !rolesLoading,
    queryFn: async (): Promise<Product[]> => {
      // Embedded tickets come from the same database snapshot as their products.
      const products: Product[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('products')
          .select('*, product_tickets(*)').order('name').order('id').range(offset, offset + 499)
        if (error) throw error
        products.push(...data)
        if (data.length < 500) return products
      }
    },
    staleTime: 0,
    refetchInterval: AUTO_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}
