import { Send, SquareX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useCRMContextSummary, type CRMLead } from '@/hooks/useCRM'
import { useCRMVoxenActions, useCRMVoxenStates } from '@/hooks/useCRMVoxen'
import { canSendToVoxen, canStopVoxen, describeSend, describeStop, VOXEN_TONE_CLASS, voxenStatusText, voxenViewOf, type VoxenLeadView } from '@/lib/voxen-send'

/** Controle do lead: um clique em "Enviar para a VOXEN" e pronto, sem janela de confirmação. Depois de enviado o lead fica em sincronia. */
export function VoxenSendControl({ view, at, ready, hasContext, busy, notice, onSend, onStop }: {
  view: VoxenLeadView; at?: string | null; ready: boolean; hasContext: boolean; busy: boolean; notice?: string | null; onSend: () => void; onStop: () => void
}) {
  const text = voxenStatusText(view, at)
  const sendable = view === 'available' || view === 'stopped'
  const blocked = sendable && !canSendToVoxen(view, hasContext, ready)
  const why = !sendable ? null : !ready ? 'Aguardando a Zyron liberar o recebimento de leads sem cadastro.' : !hasContext ? 'Este lead ainda não tem respostas, notas nem dados do atleta para enviar.' : null
  return <section aria-label="Envio para a VOXEN" className="space-y-1.5 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">VOXEN</p>
        <p role={text.tone === 'problem' ? 'alert' : 'status'} className={`text-xs font-medium ${VOXEN_TONE_CLASS[text.tone]}`}>{text.label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sendable && <Button size="sm" disabled={blocked || busy} onClick={onSend}><Send className="mr-1.5 h-3.5 w-3.5" />{busy ? 'Enviando…' : 'Enviar para a VOXEN'}</Button>}
        {canStopVoxen(view) && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={onStop}><SquareX className="mr-1.5 h-3.5 w-3.5" />Parar de sincronizar</Button>}
      </div>
    </div>
    {text.detail && <p className="text-xs text-muted-foreground">{text.detail}</p>}
    {why && <p className="text-xs text-muted-foreground">{why}</p>}
    {notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
  </section>
}

export function CRMVoxenSend({ lead }: { lead: CRMLead }) {
  const voxen = useCRMVoxenStates()
  const actions = useCRMVoxenActions()
  const summary = useCRMContextSummary()
  const { toast } = useToast()
  if (!voxen.supported || voxen.loading) return null
  if (voxen.error) return <p role="alert" className="text-xs text-destructive">Não foi possível consultar o envio para a VOXEN. <Button size="sm" variant="outline" onClick={() => void voxen.refetch()}>Tentar novamente</Button></p>
  const row = voxen.states.get(lead.id)
  return <VoxenSendControl view={voxenViewOf(voxen.states, lead.id)} at={row?.at} ready={voxen.ready} hasContext={summary.leadIds.has(lead.id)} busy={actions.busy} notice={actions.notice}
    onSend={() => { void actions.send([lead.id]).then(outcome => toast(describeSend(outcome))) }}
    onStop={() => { void actions.stop([lead.id]).then(outcome => toast(describeStop(outcome))) }} />
}
