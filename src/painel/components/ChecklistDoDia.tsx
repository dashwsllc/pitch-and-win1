import { CheckCircle2Icon, Clock3Icon, FlameIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react'
import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { useDailyGoals, type DailyGoalTask } from '@/hooks/useGoals'
import { useLiveClock, useLiveClockSelector } from '@/hooks/useLiveClock'
import { formatDateKey, millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'
import { safePlainText } from '@/lib/plain-text'
import { errorMessage } from '@/lib/sales'
import { ritmoDoDia, rotuloDaContagem, urgenciaEm, type Urgencia } from '../lib/metas'
import { Bloco } from './KpiCard'

// Só este texto muda a cada segundo. O bloco em volta re-renderiza quando a urgência vira (6 h / 2 h antes da meia-noite).
function Contagem() {
  const restante = useLiveClockSelector((agora) => millisecondsUntilBrasiliaMidnight(agora))
  return <>{rotuloDaContagem(restante)} restantes</>
}

const TOM_DA_PILULA: Record<Urgencia, string> = {
  critico: 'bg-erro/10 text-foreground',
  atencao: 'bg-aviso/10 text-foreground',
  normal: 'bg-muted text-muted-foreground',
}

const TEXTO_DE_APOIO = 'text-xs text-muted-foreground'

/**
 * Checklist de hoje: as tarefas do dia da pessoa, com o ritmo esperado para o horário e a contagem até a meia-noite.
 * Mesma fonte (useDailyGoals) e mesmas contas do painel antigo; marcar uma tarefa chama a mesma RPC.
 */
function ChecklistDoDiaBase({ className = '' }: { className?: string }) {
  const { tasks, today, yesterday, previousTasks, previousError, loading, error, refreshing, refetch, setCompleted } = useDailyGoals()
  const { toast } = useToast()
  const urgencia = useLiveClockSelector(urgenciaEm)
  const agora = useLiveClock(5 * 60 * 1000)
  const [ocupadas, setOcupadas] = useState<Set<string>>(() => new Set())

  const ritmo = ritmoDoDia({ tarefas: tasks, tarefasOntem: previousTasks, erroOntem: previousError, hoje: today, ontem: yesterday, agora })
  const { concluidas, progresso, todasConcluidas, abaixoDoRitmo } = ritmo

  const alternar = async (tarefa: DailyGoalTask, marcada: boolean) => {
    if (ocupadas.has(tarefa.id)) return
    setOcupadas((atual) => new Set(atual).add(tarefa.id))
    try {
      await setCompleted(tarefa, marcada)
      const fechaODia = marcada && concluidas + 1 === tasks.length
      toast({
        title: fechaODia ? 'Metas do dia concluídas!' : marcada ? 'Tarefa concluída' : 'Tarefa reaberta',
        description: fechaODia ? 'Checklist em 100%. Excelente fechamento de dia.' : undefined,
      })
    } catch (causa) {
      toast({ title: 'Não foi possível atualizar a tarefa', description: errorMessage(causa), variant: 'destructive' })
      void refetch()
    } finally {
      setOcupadas((atual) => {
        const proximo = new Set(atual)
        proximo.delete(tarefa.id)
        return proximo
      })
    }
  }

  let corpo
  if (loading) {
    corpo = (
      <p role="status" className="py-8 text-center text-sm text-muted-foreground">
        Carregando…
      </p>
    )
  } else if (error) {
    corpo = (
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar suas metas de hoje.
        </p>
        <Button variant="outline" size="sm" className="h-7 text-[0.8rem]" onClick={() => void refetch()} disabled={refreshing}>
          <RefreshCwIcon className={`mr-1.5 size-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
          Tentar novamente
        </Button>
      </div>
    )
  } else if (!tasks.length) {
    corpo = (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-heading">Nenhuma tarefa definida para hoje</p>
        <p className="mt-1 text-xs text-muted-foreground">O Executive pode cadastrar seu checklist de {formatDateKey(today)}.</p>
        <Link to="/metas?tab=atribuicoes" className="mt-3 inline-block rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          Ver tarefas individuais em Metas ↗
        </Link>
      </div>
    )
  } else {
    corpo = (
      <>
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progresso}
            aria-label={`${progresso}% das metas concluídas${abaixoDoRitmo ? ', abaixo do ritmo' : ''}`}
            className="h-2 flex-1 rounded-full bg-viz-track/60"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${abaixoDoRitmo ? 'bg-erro' : todasConcluidas ? 'bg-ok' : 'bg-viz-1'}`}
              style={{ width: `${progresso}%` }}
            />
          </div>
          <span className="w-10 text-right text-sm font-semibold tabular-nums text-heading">{progresso}%</span>
        </div>
        {abaixoDoRitmo && (
          <p className={`mt-2 ${TEXTO_DE_APOIO}`}>
            Abaixo do ritmo · esperado neste horário: {Math.round(ritmo.decorridoDoDia)}%
            {ritmo.atrasadoEmRelacaoAOntem ? ` · ontem: ${ritmo.progressoOntem}%` : ''}
          </p>
        )}

        {todasConcluidas && (
          <div role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-sm font-medium text-foreground">
            <SparklesIcon className="size-4 text-ok-forte" aria-hidden="true" />
            Todas as metas do dia foram concluídas.
          </div>
        )}

        <ul className="mt-4 space-y-2" aria-label="Tarefas de hoje">
          {tasks.map((tarefa) => {
            const ocupada = ocupadas.has(tarefa.id)
            return (
              <li key={tarefa.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 ${
                    tarefa.is_completed ? 'bg-ok/5' : ''
                  } ${ocupada ? 'cursor-wait opacity-65' : ''}`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={tarefa.is_completed}
                    disabled={ocupada}
                    onCheckedChange={(valor) => void alternar(tarefa, valor === true)}
                    aria-label={`${tarefa.is_completed ? 'Reabrir' : 'Concluir'} ${safePlainText(tarefa.title, 280)}`}
                  />
                  <span className={`min-w-0 flex-1 break-words leading-5 ${tarefa.is_completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {safePlainText(tarefa.title, 280)}
                  </span>
                  {tarefa.is_completed && <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-ok-forte" aria-hidden="true" />}
                </label>
              </li>
            )
          })}
        </ul>
        <Link to="/metas?tab=atribuicoes" className="mt-4 inline-block rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          Ver tarefas individuais com prazo ↗
        </Link>
      </>
    )
  }

  const temTarefas = !loading && !error && tasks.length > 0
  return (
    <Bloco
      titulo="Checklist de hoje"
      descricao={temTarefas ? `${concluidas}/${tasks.length} concluídas` : 'As tarefas do dia, sincronizadas com Metas'}
      acao={
        temTarefas && (
          <span className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs tabular-nums ${todasConcluidas ? 'bg-ok/10 text-foreground' : TOM_DA_PILULA[urgencia]}`}>
            {todasConcluidas ? (
              <CheckCircle2Icon className="size-4 text-ok-forte" aria-hidden="true" />
            ) : urgencia === 'normal' ? (
              <Clock3Icon className="size-4" aria-hidden="true" />
            ) : (
              <FlameIcon className="size-4" aria-hidden="true" />
            )}
            <span>{todasConcluidas ? 'Dia concluído' : <Contagem />}</span>
          </span>
        )
      }
      className={className}
    >
      {corpo}
    </Bloco>
  )
}

export const ChecklistDoDia = memo(ChecklistDoDiaBase)
