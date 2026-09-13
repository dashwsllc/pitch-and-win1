import { useRef, useState } from 'react'
import { Download, ExternalLink, FileText, Link2, Loader2, MessageSquareText, Pencil, Upload } from 'lucide-react'
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
import { CONTEXT_FILE_TYPE_ERROR, convertContextTxt, downloadContextMarkdown, MAX_CONTEXT_LENGTH, validateContextFileText, type CRMContextFile } from '@/lib/crm-context-file'
import { MAX_CONTEXT_MEDIA_URL_LENGTH, normalizeContextMediaUrl } from '@/lib/crm-context-media'

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
  const [mediaUrl, setMediaUrl] = useState('')
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const [attachment, setAttachment] = useState<CRMContextFile | null>(null)
  const fileReadVersion = useRef(0)

  const resetDialog = () => {
    setOpen(false)
    setEditing(null)
    setType('')
    setContent('')
    setMediaUrl('')
    setFailure('')
    setAttachment(null)
    setReadingFile(false)
    fileReadVersion.current++
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    if (!saving) resetDialog()
  }

  const startImport = () => {
    setEditing(null)
    setType('')
    setContent('')
    setMediaUrl('')
    setFailure('')
    setAttachment(null)
    setOpen(true)
  }

  const startEdit = (entry: CRMLeadContext) => {
    setEditing(entry)
    setType(entry.context_type)
    setContent(entry.content)
    setMediaUrl(entry.media_url ?? '')
    setFailure('')
    setOpen(true)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const version = ++fileReadVersion.current
    setReadingFile(true)
    try {
      const converted = await convertContextTxt(file)
      if (version !== fileReadVersion.current) return
      setAttachment(converted)
      setContent(converted.content)
      setFailure('')
    } catch (cause) {
      if (version === fileReadVersion.current) setFailure(errorMessage(cause))
    } finally {
      if (version === fileReadVersion.current) {
        setReadingFile(false)
        if (fileRef.current) fileRef.current.value = ''
      }
    }
  }

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (saving) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length !== 1 || !/\.txt$/i.test(files[0].name)) {
      setFailure(files.some(file => !/\.txt$/i.test(file.name)) ? CONTEXT_FILE_TYPE_ERROR : 'Envie um arquivo .txt por vez.')
      return
    }
    if (editing) { setFailure('Anexe o .txt em uma nova importação de contexto.'); return }
    void importFile(files[0])
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || readingFile) return
    let sanitized: string
    let normalizedMediaUrl: string | null
    try {
      sanitized = attachment ? validateContextFileText(content) : validatePlainText(content, MAX_CONTEXT_LENGTH)
      normalizedMediaUrl = normalizeContextMediaUrl(mediaUrl)
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
          normalizedMediaUrl,
        )
      } else {
        await context.importContext(
          type as 'whatsapp_summary' | 'call_transcript' | 'manual_note',
          sanitized,
          attachment ?? undefined,
          normalizedMediaUrl,
        )
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
          {entry.file_name && entry.file_content !== null && <Button type="button" variant="outline" size="sm" className="mt-2 max-w-full" onClick={() => downloadContextMarkdown(entry.file_name!, entry.file_content!)}>
            <Download className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Baixar {entry.file_name}</span>
          </Button>}
          {entry.media_url && <Button asChild type="button" variant="outline" size="sm" className="mt-2 max-w-full">
            <a href={entry.media_url} target="_blank" rel="noopener noreferrer" aria-label="Abrir mídia no Google Drive em uma nova aba">
              <ExternalLink className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Abrir mídia no Google Drive</span>
            </a>
          </Button>}
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{entry.file_name ? entry.content : safePlainText(entry.content, MAX_CONTEXT_LENGTH)}</p>
        </article>
      ))}

      <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[640px]" data-lenis-prevent onDrop={handleDrop}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar contexto' : 'Importar contexto do lead'}</DialogTitle>
            <DialogDescription>
              Cole o texto ou anexe um .txt. O arquivo será salvo automaticamente em .md, preservando o conteúdo original.
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
                  <Input ref={fileRef} id="context-file" type="file" accept=".txt" aria-describedby="context-file-help context-media-help" onChange={(event) => void importFile(event.target.files?.[0])} />
                  <p id="context-file-help" className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><FileText className="h-3.5 w-3.5" aria-hidden="true" />Apenas .txt, até 256 KB. Conversão automática para .md.</p>
                  {readingFile && <p role="status" className="text-xs text-muted-foreground">Preparando arquivo…</p>}
                  {attachment && !readingFile && <p role="status" className="break-words text-xs text-muted-foreground">{attachment.file.name} pronto para salvar. O arquivo original será preservado mesmo se você editar o contexto abaixo.</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="context-media-url">Link do Google Drive (opcional)</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="context-media-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_CONTEXT_MEDIA_URL_LENGTH}
                    className="pl-9"
                    value={mediaUrl}
                    onChange={(event) => { setMediaUrl(event.target.value); setFailure('') }}
                    placeholder="https://drive.google.com/file/d/..."
                    aria-describedby="context-media-help"
                  />
                </div>
                <p id="context-media-help" className="text-xs leading-5 text-muted-foreground">
                  Para vídeo, áudio ou outra mídia pesada, cole um link compartilhável do Google Drive. Confirme que qualquer pessoa com o link pode acessar. Não aceitamos upload direto de vídeo ou foto.
                </p>
              </div>
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
                <Button type="submit" disabled={readingFile || !type || !sanitizePlainText(content, MAX_CONTEXT_LENGTH)}>
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
