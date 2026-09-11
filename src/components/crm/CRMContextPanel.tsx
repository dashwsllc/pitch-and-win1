import { useRef, useState } from 'react'
import { FileText, Loader2, MessageSquareText, Pencil, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useRoles } from '@/hooks/useRoles'
import { CRMLead, CRMLeadContext, useCRMContexts } from '@/hooks/useCRM'
import { callDate } from '@/lib/crm'
import { safePlainText, sanitizePlainText, validatePlainText } from '@/lib/plain-text'
import { errorMessage } from '@/lib/sales'

const MAX_CONTEXT_LENGTH = 50_000
const MAX_FILE_BYTES = 256 * 1024

const contextLabels: Record<string, string> = {
  whatsapp_summary: 'Resumo de WhatsApp',
  call_transcript: 'Transcrição de ligação',
  manual_note: 'Anotação manual',
}

export function CRMContextPanel({ lead }: { lead: CRMLead }) {
  const context = useCRMContexts(lead.id)
  const { toast } = useToast()
  const { capabilities } = useRoles()
  const canWrite = capabilities.sdr || capabilities.closer
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CRMLeadContext | null>(null)
  const [type, setType] = useState('')
  const [content, setContent] = useState('')
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)

  const resetDialog = () => {
    setOpen(false)
    setEditing(null)
    setType('')
    setContent('')
    setFailure('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    if (!saving) resetDialog()
  }

  const startImport = () => {
    setEditing(null)
    setType('')
    setContent('')
    setFailure('')
    setOpen(true)
  }

  const startEdit = (entry: CRMLeadContext) => {
    setEditing(entry)
    setType(entry.context_type)
    setContent(entry.content)
    setFailure('')
    setOpen(true)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      setFailure('Use um arquivo de texto de até 256 KB.')
      return
    }
    const allowed = file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)
    if (!allowed) {
      setFailure('Use um arquivo de texto (.txt, .md ou .csv).')
      return
    }
    try {
      const text = validatePlainText(await file.text(), MAX_CONTEXT_LENGTH)
      if (!text) throw new Error('O arquivo está vazio.')
      setContent(text)
      setFailure('')
    } catch (cause) {
      setFailure(errorMessage(cause))
    }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    let sanitized: string
    try {
      sanitized = validatePlainText(content, MAX_CONTEXT_LENGTH)
    } catch (cause) {
      setFailure(errorMessage(cause))
      return
    }
    if (!type || !sanitized || saving) {
      setFailure(!type ? 'Classifique o conteúdo antes de salvar.' : 'Cole ou anexe o conteúdo antes de salvar.')
      return
    }
    setSaving(true)
    setFailure('')
    try {
      if (editing) {
        await context.updateContext(
          editing,
          type as 'whatsapp_summary' | 'call_transcript' | 'manual_note',
          sanitized,
        )
      } else {
        await context.importContext(type as 'whatsapp_summary' | 'call_transcript' | 'manual_note', sanitized)
      }
      toast({
        title: editing ? 'Contexto atualizado' : 'Contexto importado',
        description: 'Autor e data/hora foram registrados automaticamente.',
      })
      resetDialog()
    } catch (cause) {
      setFailure(errorMessage(cause))
      void context.refetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/50 p-3" aria-labelledby="lead-context-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="lead-context-title" className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareText className="h-4 w-4 text-primary" />
            Contexto para o contato
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Objeções, preocupações e transcrições consultáveis por SDR e Closer.</p>
        </div>
        {canWrite && <Button size="sm" className="h-8" onClick={startImport}>
          <Upload className="mr-2 h-3.5 w-3.5" />
          Importar conversa/transcrição
        </Button>}
      </div>

      {context.loading && <p role="status" className="text-xs text-muted-foreground">Carregando contexto...</p>}
      {context.error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-destructive">
          Não foi possível carregar o contexto.
          <Button size="sm" variant="outline" onClick={() => void context.refetch()}>Tentar novamente</Button>
        </div>
      )}
      {!context.loading && !context.error && !context.contexts.length && (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Sem contexto importado. Use o botão acima para colar ou anexar o bloco completo.
        </p>
      )}
      {context.contexts.map((entry) => (
        <article key={entry.id} className="rounded-md border border-border/50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Badge variant="outline" className="h-5 px-2 text-[10px]">{contextLabels[entry.context_type] || entry.context_type}</Badge>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {safePlainText(entry.author_name, 160)} · {entry.author_role === 'closer' ? 'Closer' : 'SDR'} · {callDate(entry.created_at)}
              </p>
              {entry.updated_by && (
                <p className="text-[11px] text-muted-foreground">Editado por {safePlainText(entry.updated_by_name, 160) || 'usuário CRM'} em {callDate(entry.updated_at)}</p>
              )}
            </div>
            {canWrite && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Editar ${contextLabels[entry.context_type] || 'contexto'}`} onClick={() => startEdit(entry)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{safePlainText(entry.content, MAX_CONTEXT_LENGTH)}</p>
        </article>
      ))}

      <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[640px]" data-lenis-prevent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar contexto' : 'Importar contexto do lead'}</DialogTitle>
            <DialogDescription>
              Importe o bloco completo. O conteúdo será salvo como texto seguro, com autor e horário automáticos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={saving} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="context-type">Tipo do conteúdo *</Label>
                <select id="context-type" required className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={type} onChange={(event) => setType(event.target.value)}>
                  <option value="">Classificar antes de salvar</option>
                  <option value="whatsapp_summary">Conversa de WhatsApp / resumo</option>
                  <option value="call_transcript">Transcrição de ligação</option>
                  <option value="manual_note">Anotação manual</option>
                </select>
              </div>
              {!editing && (
                <div className="space-y-2">
                  <Label htmlFor="context-file">Anexar texto transcrito (opcional)</Label>
                  <Input ref={fileRef} id="context-file" type="file" accept="text/plain,text/markdown,text/csv,.txt,.md,.csv" onChange={(event) => void importFile(event.target.files?.[0])} />
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><FileText className="h-3.5 w-3.5" />TXT, MD ou CSV, até 256 KB.</p>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="context-content">Conteúdo *</Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{content.length}/{MAX_CONTEXT_LENGTH}</span>
                </div>
                <Textarea id="context-content" className="min-h-64 resize-y" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Cole aqui a conversa exportada ou a transcrição completa..." required />
              </div>
              {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
                <Button type="submit" disabled={!type || !sanitizePlainText(content, MAX_CONTEXT_LENGTH)}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {editing ? 'Salvar alteração' : 'Importar e salvar'}
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
