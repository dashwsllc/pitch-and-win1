import { useRef, useState } from 'react'
import { FileText, Loader2, Upload } from 'lucide-react'
import type { CRMLead } from '@/hooks/useCRM'
import { useCRMContexts } from '@/hooks/useCRM'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { CONTEXT_FILE_TYPE_ERROR, convertContextTxt, MAX_CONTEXT_LENGTH, validateContextFileText, type CRMContextFile } from '@/lib/crm-context-file'
import { errorMessage } from '@/lib/sales'

type ContextType = 'whatsapp_summary' | 'call_transcript' | 'manual_note'

export function CRMRemarketingImportDialog({ lead, onClose }: { lead: CRMLead; onClose: () => void }) {
  const context = useCRMContexts(lead.id)
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<CRMContextFile | null>(null)
  const [type, setType] = useState<ContextType | ''>('')
  const [content, setContent] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setFailure('')
    setAttachment(null)
    setContent('')
    try {
      const converted = await convertContextTxt(file)
      setAttachment(converted)
      setContent(converted.content)
    } catch (cause) {
      setAttachment(null)
      setContent('')
      setFailure(errorMessage(cause))
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    if (saving || reading) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length !== 1 || !/\.txt$/i.test(files[0].name)) {
      setFailure(files.some(file => !/\.txt$/i.test(file.name)) ? CONTEXT_FILE_TYPE_ERROR : 'Envie um arquivo .txt por vez.')
      return
    }
    void importFile(files[0])
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || reading || !attachment) return
    if (!type) { setFailure('Classifique o conteúdo antes de importar.'); return }
    try {
      const checked = validateContextFileText(content)
      setSaving(true)
      setFailure('')
      await context.importContext(type, checked, attachment)
      toast({ title: 'Contexto de remarketing importado', description: `O arquivo ${attachment.file.name} foi associado ao lead ${lead.name}.` })
      onClose()
    } catch (cause) {
      setFailure(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving && !reading) onClose() }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[640px]" data-lenis-prevent
      onDrop={handleDrop} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}>
      <DialogHeader>
        <DialogTitle>Importar contexto para remarketing</DialogTitle>
        <DialogDescription className="space-y-2 text-left">
          <span className="block">Você está importando uma conversa, transcrição ou anotação para <strong>{lead.athlete_name || lead.name}</strong> (lead: {lead.name}).</span>
          <span className="block">O texto será convertido para .md e acrescentado ao histórico de contextos deste lead, disponível para SDR e Closer.</span>
          <span className="block">A importação não cria leads nem altera a situação ou o agendamento do remarketing.</span>
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="remarketing-context-type">Tipo do conteúdo *</Label>
          <select id="remarketing-context-type" required className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={type} onChange={(event) => setType(event.target.value as ContextType | '')} disabled={saving}>
            <option value="">Classificar antes de salvar</option>
            <option value="whatsapp_summary">Conversa de WhatsApp / resumo</option>
            <option value="call_transcript">Transcrição de ligação</option>
            <option value="manual_note">Anotação manual</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="remarketing-context-file">Arquivo de texto do lead *</Label>
          <Input ref={fileRef} id="remarketing-context-file" type="file" accept=".txt" aria-describedby="remarketing-context-help" disabled={saving || reading} onChange={(event) => void importFile(event.target.files?.[0])} />
          <p id="remarketing-context-help" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Apenas um .txt de até 256 KB e 50.000 caracteres. Conversão automática para .md, preservando o texto original.
          </p>
          {reading && <p role="status" className="text-xs text-muted-foreground">Preparando arquivo…</p>}
          {attachment && !reading && <p role="status" className="break-words text-xs text-muted-foreground">{attachment.sourceName} → {attachment.file.name} pronto para importar.</p>}
        </div>
        {attachment && <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="remarketing-context-content">Conteúdo que será exibido no contexto do lead *</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{content.length}/{MAX_CONTEXT_LENGTH}</span>
          </div>
          <Textarea id="remarketing-context-content" className="min-h-48 resize-y" value={content} onChange={(event) => setContent(event.target.value)} required disabled={saving} />
          <p className="text-xs text-muted-foreground">Se editar este texto, o .md original continuará disponível para download no histórico.</p>
        </div>}
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving || reading}>Cancelar</Button>
          <Button type="submit" disabled={saving || reading || !attachment || !type || !content.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
            {saving ? 'Importando…' : 'Importar para este lead'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
