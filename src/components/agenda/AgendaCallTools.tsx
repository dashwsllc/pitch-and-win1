import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CRMActivity, CRMLead } from '@/hooks/useCRM'
import type { Json } from '@/integrations/supabase/types'
import { arenaRpc } from '@/lib/arena-api'
import { brasiliaLocalInputToIso } from '@/lib/brasilia-time'
import { normalizarLinkDaCall } from '@/lib/crm-call-meeting'
import { errorMessage, money } from '@/lib/sales'
import { refreshDashboardMutation } from '@/lib/sync'
import { lerValorEmReais, valorParaBanco } from '@/lib/valor-reais'

/** Campo do link da reunião ao lado da call: o Closer cola o link do Google Meet e salva. */
export function AgendaMeetingLink({ call, editavel }: { call: CRMActivity; editavel: boolean }) {
  const client = useQueryClient()
  const salvo = call.meeting_link ?? ''
  const [valor, setValor] = useState(salvo)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  // Outra pessoa (ou outra aba) mudou o link: o campo acompanha, a menos que esteja sendo editado.
  useEffect(() => setValor((atual) => (atual === '' || atual === salvo ? salvo : atual)), [salvo])

  if (!editavel) {
    return salvo
      ? <p className="flex items-center gap-1.5 text-sm"><Link2 className="h-4 w-4 text-primary" aria-hidden="true" />Link da call: <a className="break-all underline" href={salvo} target="_blank" rel="noopener noreferrer">{salvo}</a></p>
      : <p className="text-sm text-muted-foreground">O Closer ainda não colocou o link da reunião.</p>
  }

  const salvar = async () => {
    const { link, erro: invalido } = normalizarLinkDaCall(valor)
    if (invalido) { setErro(invalido); return }
    setSalvando(true); setErro(''); setAviso('')
    try {
      await arenaRpc('crm_set_call_meeting_link', { p_activity_id: call.id, p_link: link ?? '', p_expected_revision: call.updated_at })
      setValor(link ?? '')
      setAviso(link ? 'Link salvo. O botão "Entrar na call" aparece no CRM no horário da call.' : 'Link removido.')
      await refreshDashboardMutation(client)
    } catch (causa) {
      setErro(errorMessage(causa))
    } finally {
      setSalvando(false)
    }
  }

  const id = `meet-${call.id}`
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">Link do Google Meet</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          value={valor}
          onChange={(e) => { setValor(e.target.value); setAviso('') }}
          placeholder="https://meet.google.com/abc-defg-hij"
          inputMode="url"
          className="h-9 min-w-0 flex-1 sm:min-w-72"
          disabled={salvando}
        />
        <Button type="button" variant="outline" className="h-9" onClick={salvar} disabled={salvando || valor.trim() === salvo}>
          {salvando ? 'Salvando…' : 'Salvar link'}
        </Button>
      </div>
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      {aviso && <p role="status" className="text-xs text-muted-foreground">{aviso}</p>}
    </div>
  )
}

export type ResultadoDaCall = 'vendeu' | 'nao_vendeu' | 'pendente' | 'sinal'
const OPCOES: { valor: ResultadoDaCall; rotulo: string; descricao: string }[] = [
  { valor: 'vendeu', rotulo: 'Vendeu', descricao: 'Venda concluída. Em seguida, registre a venda em Vendas.' },
  { valor: 'nao_vendeu', rotulo: 'Não vendeu', descricao: 'Venda recusada: o lead é encerrado como venda perdida.' },
  { valor: 'pendente', rotulo: 'Pendente', descricao: 'Follow-up necessário: o lead segue com você, com a data do retorno.' },
  { valor: 'sinal', rotulo: 'Sinal', descricao: 'O lead pagou um sinal para segurar a vaga. Ele segue com você até a venda ser registrada.' },
]

/**
 * Encerrar a call pela agenda: Vendeu, Não vendeu, Pendente ou Sinal. Usa o mesmo fechamento do CRM (crm_transition
 * 'close'), então o lead, a linha do tempo, a Arena e o botão "Entrar na call" ficam sincronizados.
 */
export function AgendaCallResultDialog({
  lead,
  aberto,
  aoFechar,
  registrar,
}: {
  lead: CRMLead
  aberto: boolean
  aoFechar: () => void
  registrar: (lead: CRMLead, data: Json) => Promise<unknown>
}) {
  const [resultado, setResultado] = useState<ResultadoDaCall | ''>('')
  const [quando, setQuando] = useState('')
  const [sinal, setSinal] = useState('')
  const [nota, setNota] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando) return
    if (!resultado) { setErro('Escolha o resultado da call.'); return }
    const base = { call_performed: true, note: nota }
    let data: Json
    if (resultado === 'pendente') {
      const proxima = brasiliaLocalInputToIso(quando)
      if (!proxima || Date.parse(proxima) <= Date.now()) { setErro('Escolha a data e a hora do retorno (no futuro).'); return }
      data = { ...base, outcome: 'followup', next_at: proxima }
    } else if (resultado === 'sinal') {
      const valor = lerValorEmReais(sinal)
      if (valor === null) { setErro('Informe o valor do sinal (ex.: 500 ou 1.500,00).'); return }
      data = { ...base, outcome: 'sinal', deposit_amount: valorParaBanco(valor) }
    } else {
      data = { ...base, outcome: resultado === 'vendeu' ? 'venda_concluida' : 'venda_perdida' }
    }
    setSalvando(true); setErro('')
    try {
      await registrar(lead, data)
      aoFechar()
    } catch (causa) {
      setErro(errorMessage(causa))
    } finally {
      setSalvando(false)
    }
  }

  const valorDoSinal = lerValorEmReais(sinal)
  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open && !salvando) aoFechar() }}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto p-4 sm:max-w-[480px]" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle>Encerrar call</DialogTitle>
          <DialogDescription>{lead.athlete_name?.trim() || 'Atleta não informado'} · Responsável: {lead.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={confirmar} className="space-y-3">
          <fieldset disabled={salvando} className="space-y-3">
            <legend className="mb-1 text-xs font-medium">Resultado da call</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Resultado da call">
              {OPCOES.map((opcao) => (
                <label
                  key={opcao.valor}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors ${resultado === opcao.valor ? 'border-primary bg-primary/10' : 'hover:bg-muted/40'}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="resultado" value={opcao.valor} checked={resultado === opcao.valor} onChange={() => { setResultado(opcao.valor); setErro('') }} />
                    {opcao.rotulo}
                  </span>
                  <span className="text-xs text-muted-foreground">{opcao.descricao}</span>
                </label>
              ))}
            </div>
            {resultado === 'pendente' && (
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="retorno">Data e hora do retorno · Brasília *</Label>
                <Input id="retorno" type="datetime-local" className="h-9" value={quando} onChange={(e) => setQuando(e.target.value)} />
              </div>
            )}
            {resultado === 'sinal' && (
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="valor-sinal">Valor do sinal (R$) *</Label>
                <Input id="valor-sinal" inputMode="decimal" className="h-9" placeholder="Ex.: 500,00" value={sinal} onChange={(e) => setSinal(e.target.value)} />
                {valorDoSinal !== null && <p className="text-xs text-muted-foreground">Sinal de {money(valorDoSinal)}. Ao registrar a venda, esse valor já vem preenchido.</p>}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="nota-call">Observações da call</Label>
              <Textarea id="nota-call" className="min-h-20" maxLength={10000} value={nota} onChange={(e) => setNota(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Ao encerrar, o botão "Entrar na call" some do CRM e a call vai para o Histórico.</p>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <DialogFooter className="gap-1 sm:space-x-0">
              <Button className="h-9" type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
              <Button className="h-9" type="submit">{salvando ? 'Salvando…' : 'Encerrar call'}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
