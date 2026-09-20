import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'
import { exactDate } from '@/lib/sales'

export function ExecutiveRegistrationRequests() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [reviewing, setReviewing] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['executive-users', 'registration-requests', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('executive_list_registration_requests')
      if (error) throw error
      return data as unknown as Tables<'registration_requests'>[]
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
  })

  const review = async (request: Tables<'registration_requests'>, action: 'approve' | 'reject') => {
    if (reviewing) return
    setReviewing(request.user_id)
    try {
      const { error } = await supabase.rpc('executive_review_registration', { p_user_id: request.user_id, p_action: action })
      if (error) throw error
      toast({ title: action === 'approve' ? 'Cadastro aprovado' : 'Cadastro não aprovado',
        description: action === 'approve' ? `O acesso de ${request.display_name || request.email} foi liberado.` : 'A decisão foi registrada e já pode ser consultada pelo colaborador.' })
    } catch {
      toast({ title: 'Não foi possível confirmar a decisão', description: 'A lista será atualizada. Confira se outro Executive já analisou este cadastro antes de tentar novamente.', variant: 'destructive' })
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['executive-users'] })
      void queryClient.invalidateQueries({ queryKey: ['executive-audit'] })
      setReviewing(null)
    }
  }

  return <section className="surface-panel rounded-2xl p-5 sm:p-6" aria-labelledby="registration-requests-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="registration-requests-title" className="flex items-center gap-2 text-lg font-medium text-white"><Clock3 className="h-5 w-5 text-orange-300" aria-hidden="true" />Cadastros pendentes
          {query.data && <span className="rounded-full bg-orange-400/10 px-2 py-0.5 text-xs text-orange-200" aria-label={`${query.data.length} cadastros pendentes`}>{query.data.length}</span>}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">Novos colaboradores aguardam sua análise para acessar o dashboard.</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => { void query.refetch() }} aria-label="Atualizar cadastros pendentes"><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />Atualizar</Button>
    </div>
    {query.isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">Consultando solicitações…</p>}
    {query.error && <p role="alert" className="mt-4 text-sm text-orange-200">Não foi possível atualizar as solicitações. Vamos tentar novamente automaticamente. Os cadastros permanecem registrados.</p>}
    {query.data?.length === 0 && !query.error && <p className="mt-4 text-sm text-muted-foreground">Nenhum cadastro aguardando análise.</p>}
    <div className="mt-4 space-y-3" aria-live="polite">
      {query.data?.map(request => <article key={request.user_id} aria-label={`Cadastro de ${request.display_name || request.email}`}
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium text-white">{request.display_name || 'Colaborador'}</h3>
          <p className="mt-1 break-all text-xs text-muted-foreground">{request.email}</p>
          <p className="mt-2 text-xs text-orange-200">Cargo definido pelo Super Admin após a aprovação</p>
          <time dateTime={request.created_at} className="mt-1 block text-xs text-muted-foreground">Solicitado em {exactDate(request.created_at)} · Brasília</time>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!!reviewing} onClick={() => { void review(request, 'reject') }}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Rejeitar</Button>
          <Button type="button" size="sm" className="bg-orange-400 text-stone-950 hover:bg-orange-500" disabled={!!reviewing} onClick={() => { void review(request, 'approve') }}>
            {reviewing === request.user_id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}Aprovar
          </Button>
        </div>
      </article>)}
    </div>
  </section>
}
