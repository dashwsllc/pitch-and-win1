import type { CRMLead } from '@/hooks/useCRM'
import { FormAnswers } from '@/components/traffic/FormAnswers'
import { importChannel, importChannelLabels, importGenerationLabel, importMethodLabels, importReceivedAt, importSnapshot } from '@/lib/crm-imports'
import { leadDateTime } from '@/lib/meta-waves'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'

/** Complete source snapshot, separate from the SDR's editable current contact. */
export function CRMImportDetails({ lead }: { lead: CRMLead }) {
  if (!importChannel(lead)) return null
  return lead.import_snapshot === undefined ? <RemoteImportDetails lead={lead} /> : <ImportDetailsContent lead={lead} />
}

function RemoteImportDetails({ lead }: { lead: CRMLead }) {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['crm', 'import-source', user?.id, lead.id], enabled: !!user,
    staleTime: 5_000, retry: 1, queryFn: async () => {
      const { data, error } = await supabase.from('crm_leads').select('id,import_snapshot').eq('id', lead.id).single()
      if (error) throw error
      return (data as unknown as { import_snapshot: unknown }).import_snapshot
    } })
  if (query.isPending) return <p role="status" className="text-xs text-muted-foreground">Sincronizando o contexto completo da importação…</p>
  if (query.isError) return <div role="alert" className="space-y-2 text-xs text-destructive">O contexto integral não foi carregado. <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>
  return <ImportDetailsContent lead={{ ...lead, import_snapshot: query.data }} />
}

function ImportDetailsContent({ lead }: { lead: CRMLead }) {
  const channel = importChannel(lead)
  if (!channel) return null
  const source = importSnapshot(lead)
  const contact = source.import_contact && typeof source.import_contact === 'object' ? source.import_contact as Record<string, unknown> : {}
  const generated = typeof source.created_time === 'string' ? source.created_time : lead.lead_generated_at
  const knownTime = contact.time_known !== false
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const fields = [
    ['Geração na origem', importGenerationLabel(generated, knownTime, typeof contact.source_has_date === 'boolean' ? contact.source_has_date : undefined)],
    ['Recebido no sistema em', leadDateTime(importReceivedAt(lead))],
    ['Disponível no CRM em', leadDateTime(lead.created_at)],
    ['Campanha', text(source.campaign_name) || text(source.campaign_id)],
    ['Formulário', text(source.form_name) || text(source.form_id)],
    ['Anúncio', text(source.ad_id)], ['Identificador na origem', text(source.meta_lead_id)],
    ['Arquivo importado', text(source.batch_filename)],
  ]
  return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-label="Dados completos da importação">
    <div><h2 className="text-sm font-semibold">Dados e contexto da importação</h2>
      <p className="mt-1 text-xs text-muted-foreground">{importChannelLabels[channel]} · {lead.import_method ? importMethodLabels[lead.import_method] : 'Forma de entrada não informada'} · horários de Brasília</p></div>
    <dl className="grid gap-2 sm:grid-cols-2">{fields.filter(([, value]) => value).map(([label, value]) =>
      <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="break-words text-xs tabular-nums">{value}</dd></div>)}</dl>
    {Object.keys(source).length ? <>
      <h3 className="text-xs font-semibold">Respostas e informações da origem</h3>
      <FormAnswers fields={source.field_data} />
      {source.custom_disclaimer_responses != null && <details><summary className="cursor-pointer text-xs">Consentimentos completos</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/50 p-2 text-xs">{JSON.stringify(source.custom_disclaimer_responses, null, 2)}</pre></details>}
      <details><summary className="cursor-pointer text-xs">Consultar registro integral, atribuição e dados adicionais</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2 text-xs">{JSON.stringify(source, null, 2)}</pre></details>
      <p className="text-[11px] text-muted-foreground">A captura aprovada permanece preservada. O cadastro e o histórico abaixo mostram as alterações feitas no atendimento.</p>
    </> : <p role="status" className="text-xs text-amber-300">O registro integral desta importação ainda não foi sincronizado. Atualize para conferir; não há confirmação de contexto completo.</p>}
  </section>
}
