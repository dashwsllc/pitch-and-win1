import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { arenaRpc } from '@/lib/arena-api'
import type { Json } from '@/integrations/supabase/types'
import { buildMetaEditPatch, metaEditDraft, metaEditFields, type MetaEditKind, type MetaEditValues } from '@/lib/meta-edit'
import { errorMessage } from '@/lib/sales'

export type MetaEditTarget = { kind: MetaEditKind; id: string; title: string; updatedAt?: string; values?: MetaEditValues; batchId?: string; rowIndex?: number; historical?: boolean }
type Snapshot = { values: MetaEditValues; updated_at: string; crm_version: number | null; crm_id?: string }
type Answer = { name: string; values: string[] }

export function MetaEditButton({ target, onSaved, disabled }: { target: MetaEditTarget; onSaved: () => Promise<unknown>; disabled?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<MetaEditTarget>(target)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    setCurrent(target); setOpen(true); setBusy(true); setError(''); setReason(''); setSnapshot(null)
    try {
      const latest = target.kind === 'leads' && !target.batchId
        ? await arenaRpc<Snapshot>('meta_get_traffic_lead', { p_id: target.id })
        : { values: target.values || {}, updated_at: target.updatedAt || '', crm_version: null }
      setSnapshot(latest); setDraft(metaEditDraft(target.kind, latest.values))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!snapshot || busy) return
    setError('')
    try {
      const patch = buildMetaEditPatch(current.kind, snapshot.values, draft)
      if (!Object.keys(patch).length) throw new Error('Altere pelo menos uma informação antes de salvar.')
      if (reason.trim().length < 3) throw new Error('Informe o motivo da alteração (3 a 500 caracteres).')
      setBusy(true)
      if (current.batchId) await arenaRpc('meta_edit_import_row', { p_kind: current.kind, p_batch_id: current.batchId,
        p_row_index: current.rowIndex!, p_expected_updated_at: snapshot.updated_at, p_patch: patch as Json, p_reason: reason.trim() })
      else if (current.kind === 'leads') await arenaRpc('meta_edit_form_lead', { p_id: current.id,
        p_expected_updated_at: snapshot.updated_at, p_expected_crm_version: snapshot.crm_version, p_patch: patch as Json, p_reason: reason.trim() })
      else await arenaRpc('meta_edit_traffic_row', { p_id: current.id, p_expected_updated_at: snapshot.updated_at,
        p_patch: patch as Json, p_reason: reason.trim() })
      setOpen(false); toast.success('Alteração salva com auditoria')
      try { await onSaved() } catch { toast.warning('Alteração registrada. Atualize a página para conferir.') }
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const answers: Answer[] = JSON.parse(draft.field_data || '[]')
  const updateAnswers = (next: Answer[]) => setDraft(previous => ({ ...previous, field_data: JSON.stringify(next) }))
  return <>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void load()}><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar</Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next) }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>Editar · {current.title}</DialogTitle><DialogDescription>Informe o motivo. A auditoria registra autor, horário e valores antes e depois de cada alteração.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!snapshot ? <p role="status" className="text-sm text-muted-foreground">{busy ? 'Carregando informações atuais…' : 'Feche e abra novamente para tentar carregar.'}</p> :
        <form onSubmit={event => void save(event)} className="space-y-5">
          <p className="text-sm text-muted-foreground">{current.historical ? 'Esta correção modifica o histórico da importação. Para atualizar o CRM ou o desempenho, edite o registro publicado na aba Dados e edições.' : current.batchId ? 'A edição mantém a decisão da importação. Dados pendentes precisam de aprovação para serem publicados.' : current.kind === 'leads' ? 'Os campos de cadastro são sincronizados com o CRM quando houver vínculo. A decisão de aprovação é mantida.' : 'A correção será refletida nos indicadores de Desempenho.'}</p>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {metaEditFields[current.kind].filter(field => !(current.batchId && current.kind === 'leads' && field.key === 'page_id')).map(field => <div key={field.key} className={field.type === 'textarea' || field.type === 'answers' ? 'sm:col-span-2' : ''}>
              <Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
              {field.type === 'answers' ? <div id={`${id}-${field.key}`} className="mt-2 space-y-3">
                <p className="text-xs text-muted-foreground">Para corrigir o cadastro do CRM, atualize também os campos de contato acima. Nas respostas, use uma resposta por linha.</p>
                {answers.map((answer, index) => <div key={index} className="space-y-2 rounded-lg border p-3"><Input aria-label={`Pergunta ${index + 1}`} value={answer.name} onChange={event => updateAnswers(answers.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} /><Textarea aria-label={`Respostas da pergunta ${index + 1}`} value={answer.values.join('\n')} onChange={event => updateAnswers(answers.map((item, at) => at === index ? { ...item, values: event.target.value.split('\n') } : item))} /><Button type="button" size="sm" variant="ghost" onClick={() => updateAnswers(answers.filter((_, at) => at !== index))}>Remover resposta</Button></div>)}
                <Button type="button" size="sm" variant="outline" onClick={() => updateAnswers([...answers, { name: '', values: [''] }])}>Adicionar resposta</Button>
              </div> : field.type === 'textarea' ? <Textarea id={`${id}-${field.key}`} value={draft[field.key] || ''} maxLength={9500} onChange={event => setDraft(previous => ({ ...previous, [field.key]: event.target.value }))} />
                : field.options ? <select id={`${id}-${field.key}`} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft[field.key] || ''} onChange={event => setDraft(previous => ({ ...previous, [field.key]: event.target.value }))}>{field.options.map(option => <option key={option}>{option}</option>)}</select>
                  : <Input id={`${id}-${field.key}`} type={field.type || 'text'} min={field.type === 'number' ? 0 : undefined} step={field.type === 'number' ? 'any' : undefined} value={draft[field.key] || ''} onChange={event => setDraft(previous => ({ ...previous, [field.key]: event.target.value }))} />}
            </div>)}
          </fieldset>
          <div><Label htmlFor={`${id}-reason`}>Motivo da alteração *</Label><Textarea id={`${id}-reason`} required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explique o que foi corrigido e por quê" /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? 'Salvando…' : 'Salvar com auditoria'}</Button></div>
        </form>}
    </DialogContent></Dialog>
  </>
}
