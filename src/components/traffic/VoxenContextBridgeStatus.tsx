import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { arenaRpc } from '@/lib/arena-api'
import { leadDateTime } from '@/lib/meta-waves'
import { isVoxenBridgeAlignment, isVoxenBridgeHealth, voxenBridgeVerdict, type VoxenBridgeAlignment, type VoxenBridgeHealth, type VoxenBridgeLevel } from '@/lib/voxen-bridge'
import { Button } from '@/components/ui/button'

const LEVEL_CLASS: Record<VoxenBridgeLevel, string> = { ok: 'text-emerald-300', attention: 'text-amber-300', problem: 'text-destructive', off: 'text-amber-300' }

export function VoxenBridgeHealthView({ data, now = Date.now() }: { data: VoxenBridgeHealth; now?: number }) {
  const verdict = voxenBridgeVerdict(data, now)
  const waiting = data.pending_count + data.processing_count
  const sweep = data.last_reconcile_summary
  return <div className="space-y-2 text-xs">
    <p role={verdict.level === 'problem' ? 'alert' : 'status'} className={`font-medium ${LEVEL_CLASS[verdict.level]}`}>{verdict.title}</p>
    <p>{data.delivered_count} entregues · {waiting} na fila · {data.blocked_count} bloqueados</p>
    <p>Última entrega {leadDateTime(data.last_delivered_at)} · última varredura {leadDateTime(data.last_reconcile_at)}{sweep ? ` (${sweep.examined} atletas conferidos, ${sweep.changed} alterados)` : ''}</p>
    {verdict.reasons.map(reason => <p key={reason} className={verdict.level === 'ok' ? 'text-muted-foreground' : LEVEL_CLASS[verdict.level]}>{reason}</p>)}
    <p className="text-muted-foreground">Cada mudança no CRM entra na fila na hora e segue para a VOXEN em poucos minutos. A varredura de segurança confere tudo a cada 15 minutos.</p>
  </div>
}

export function VoxenCoverageView({ data }: { data: VoxenBridgeAlignment }) {
  const outside = data.with_answers_without_voxen_id + data.context_without_answers
  return <div className="space-y-1 text-xs" aria-label="Cobertura do CRM">
    <p className="font-medium">Cobertura do CRM</p>
    <p>{data.crm_leads_with_context} leads do CRM com contexto (ícone aceso).</p>
    <p>{data.linked_sites} atletas já cadastrados na VOXEN têm contexto: {data.in_sync} em dia{data.to_enqueue ? `, ${data.to_enqueue} a enviar` : ''}{data.skipped ? `, ${data.skipped} ignorados` : ''}.</p>
    <p>Dos {data.with_answers} leads com respostas do formulário, {data.with_answers_addressable} já têm cadastro na VOXEN e {data.with_answers_without_voxen_id} ainda não se cadastraram lá. {data.context_without_answers} leads têm só notas de atendimento.</p>
    {outside > 0 && <p className="text-muted-foreground">Esses leads ainda não existem na VOXEN (não passaram pelo cadastro do site), então não há atleta para receber o contexto. Não é erro: o envio acontece sozinho quando o cadastro aparecer e o vínculo for feito.</p>}
    {data.unmapped_questions.length > 0 && <p role="alert" className="text-amber-300">Perguntas novas do formulário ainda não mapeadas (não são enviadas): {data.unmapped_questions.join('; ')}</p>}
  </div>
}

/** Só para o Executivo (as RPCs recusam os demais). A saúde da fila é barata e atualiza sozinha; a cobertura recalcula o conteúdo de cada atleta, então só roda quando pedida. */
export function VoxenContextBridgeStatus({ active }: { active: boolean }) {
  const { user } = useAuth()
  const health = useQuery({ queryKey: ['voxen-bridge', 'health', user?.id], enabled: active && !!user, refetchInterval: active ? 30_000 : false, retry: 1,
    queryFn: async () => {
      const data = await arenaRpc<unknown>('crm_context_health', {})
      if (!isVoxenBridgeHealth(data)) throw new Error('invalid_voxen_bridge_health')
      return data
    } })
  // enabled: false de propósito: a invalidação global do dashboard (a cada mudança de revisão) não pode disparar o cálculo pesado.
  const coverage = useQuery({ queryKey: ['voxen-bridge', 'alignment', user?.id], enabled: false, staleTime: 10 * 60_000, retry: 0,
    queryFn: async () => {
      const data = await arenaRpc<unknown>('crm_context_alignment', {})
      if (!isVoxenBridgeAlignment(data)) throw new Error('invalid_voxen_bridge_alignment')
      return data
    } })
  return <section aria-label="Envio de contexto à VOXEN" className="space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">CRM → VOXEN (contexto do atleta)</h3>
    {health.isError ? <div role="alert" className="text-sm text-destructive">Estado do envio indisponível. <Button size="sm" onClick={() => void health.refetch()}>Tentar novamente</Button></div>
      : health.data ? <VoxenBridgeHealthView data={health.data} /> : <p role="status" className="text-xs">Conferindo o envio à VOXEN…</p>}
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={coverage.isFetching} onClick={() => void coverage.refetch()}>
        {coverage.isFetching ? 'Calculando…' : coverage.data ? 'Atualizar cobertura do CRM' : 'Conferir cobertura do CRM'}
      </Button>
      {coverage.isError && <p role="alert" className="text-xs text-destructive">Não foi possível calcular a cobertura. Tente de novo em instantes.</p>}
      {coverage.data && <VoxenCoverageView data={coverage.data} />}
    </div>
  </section>
}
