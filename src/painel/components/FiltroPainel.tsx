import { XIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { brasiliaDateKey, formatDateKey } from '@/lib/brasilia-time'
import { validateDashboardCustomRange, type DashboardCustomRange, type DashboardDateFilter } from '@/lib/dashboard-period'
import type { FiltroUrl } from '../lib/filtro'
import { Segmentos } from './Segmentos'

const PERIODOS: Array<{ valor: DashboardDateFilter; rotulo: string }> = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7dias', rotulo: '7 dias' },
  { valor: '14dias', rotulo: '14 dias' },
  { valor: '30dias', rotulo: '30 dias' },
  { valor: 'all', rotulo: 'Todo o período' },
  { valor: 'custom', rotulo: 'Tempo personalizado' },
]

/**
 * Uma linha de filtros acima de tudo o que ela recorta: o período, no horário de Brasília. O tempo personalizado
 * segue a regra do painel antigo: o rascunho só vale ao aplicar, e as datas são validadas antes.
 */
export function FiltroPainel({
  valor,
  intervalo,
  erro,
  ativo,
  onMudar,
  onLimpar,
}: {
  valor: FiltroUrl
  /** O intervalo que está valendo (o do endereço ou os últimos 7 dias). */
  intervalo: DashboardCustomRange
  /** Erro do intervalo que está no endereço, quando for inválido. */
  erro: string | null
  ativo: boolean
  onMudar(parcial: Partial<FiltroUrl>): void
  onLimpar(): void
}) {
  const [rascunho, setRascunho] = useState(intervalo)
  const [erroDoRascunho, setErroDoRascunho] = useState<string | null>(null)

  useEffect(() => {
    setRascunho(intervalo)
  }, [intervalo])

  const aplicar = (evento: FormEvent) => {
    evento.preventDefault()
    const problema = validateDashboardCustomRange(rascunho)
    setErroDoRascunho(problema)
    if (problema) return
    onMudar({ periodo: 'custom', de: rascunho.start, ate: rascunho.end })
  }

  // Um intervalo inválido vindo do endereço não filtra: a hook de dados cai nos últimos 7 dias (regra do painel
  // antigo) e a tela diz isso, em vez de mostrar números de outro recorte em silêncio.
  const mensagemDeErro = erroDoRascunho ?? (erro ? `${erro} Enquanto isso, valem os últimos 7 dias.` : null)

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Segmentos
        rotulo="Período"
        opcoes={PERIODOS}
        valor={valor.periodo}
        onChange={(periodo) => {
          setErroDoRascunho(null)
          onMudar({ periodo })
        }}
      />
      {valor.periodo === 'custom' && (
        <form onSubmit={aplicar} aria-label="Selecionar tempo personalizado" className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            aria-label="Data inicial"
            value={rascunho.start}
            max={rascunho.end || brasiliaDateKey()}
            onChange={(e) => {
              setRascunho((atual) => ({ ...atual, start: e.target.value }))
              setErroDoRascunho(null)
            }}
            className="h-9 w-[12.5rem] rounded-lg"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="date"
            aria-label="Data final"
            value={rascunho.end}
            min={rascunho.start}
            max={brasiliaDateKey()}
            onChange={(e) => {
              setRascunho((atual) => ({ ...atual, end: e.target.value }))
              setErroDoRascunho(null)
            }}
            className="h-9 w-[12.5rem] rounded-lg"
          />
          <Button type="submit" variant="outline" size="sm" className="h-9 px-3 text-sm">
            Aplicar período
          </Button>
        </form>
      )}
      {ativo && (
        <Button variant="ghost" size="sm" className="h-8 px-2.5 text-[0.8rem]" onClick={onLimpar}>
          <XIcon className="size-3.5" /> Limpar filtros
        </Button>
      )}
      {valor.periodo === 'custom' &&
        (mensagemDeErro ? (
          <p role="alert" className="w-full text-sm font-medium text-destructive">
            {mensagemDeErro}
          </p>
        ) : (
          <p className="w-full text-xs text-muted-foreground" aria-live="polite">
            Período aplicado: {formatDateKey(intervalo.start)} a {formatDateKey(intervalo.end)} (inclusive)
          </p>
        ))}
      <p className="w-full text-xs text-muted-foreground">O período vale para os indicadores, a evolução, os produtos e a atividade. Ranking, metas e vendas do time têm janela própria.</p>
    </div>
  )
}
