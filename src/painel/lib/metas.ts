// Ritmo do checklist do dia, com as mesmas contas do painel antigo (GoalsProgress): o que se espera a esta hora, a
// comparação com o dia anterior no mesmo horário e a urgência pela contagem até a meia-noite de Brasília.
import { brasiliaDayBounds, brasiliaLocalToDate, brasiliaParts, millisecondsUntilBrasiliaMidnight } from '@/lib/brasilia-time'

export interface TarefaDoDia {
  is_completed: boolean
  created_at: string
  completed_at: string | null
}

export type Urgencia = 'critico' | 'atencao' | 'normal'

const DUAS_HORAS = 2 * 60 * 60 * 1000
const SEIS_HORAS = 6 * 60 * 60 * 1000

/** "05h 12m 09s". */
export function rotuloDaContagem(milissegundos: number): string {
  const total = Math.max(0, Math.floor(milissegundos / 1000))
  const horas = Math.floor(total / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  return `${String(horas).padStart(2, '0')}h ${String(minutos).padStart(2, '0')}m ${String(segundos).padStart(2, '0')}s`
}

/** Faltando 2 h ou menos para a meia-noite: crítico. Até 6 h: atenção. */
export function urgenciaEm(agora: Date): Urgencia {
  const restante = millisecondsUntilBrasiliaMidnight(agora)
  return restante <= DUAS_HORAS ? 'critico' : restante <= SEIS_HORAS ? 'atencao' : 'normal'
}

export interface RitmoDoDia {
  concluidas: number
  total: number
  /** 0 a 100, arredondado. */
  progresso: number
  todasConcluidas: boolean
  /** Quanto do dia já passou, 0 a 100 (não arredondado). */
  decorridoDoDia: number
  /** Progresso de ontem até este mesmo horário; null sem dados comparáveis. */
  progressoOntem: number | null
  atrasadoEmRelacaoAOntem: boolean
  abaixoDoRitmo: boolean
}

export function ritmoDoDia(entrada: {
  tarefas: TarefaDoDia[]
  tarefasOntem: TarefaDoDia[]
  erroOntem: unknown
  hoje: string
  ontem: string
  agora: Date
}): RitmoDoDia {
  const { tarefas, tarefasOntem, erroOntem, hoje, ontem, agora } = entrada
  const concluidas = tarefas.filter((t) => t.is_completed).length
  const progresso = tarefas.length ? Math.round((concluidas / tarefas.length) * 100) : 0
  const todasConcluidas = tarefas.length > 0 && concluidas === tarefas.length

  const { start, end } = brasiliaDayBounds(hoje)
  const decorridoDoDia = Math.min(100, Math.max(0, ((agora.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))

  const { hour, minute, second } = brasiliaParts(agora)
  const horario = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  const corteOntem = brasiliaLocalToDate(ontem, horario).getTime()
  const comparaveis = tarefasOntem.filter((t) => Date.parse(t.created_at) <= corteOntem)
  const progressoOntem =
    !erroOntem && comparaveis.length
      ? Math.round(
          (comparaveis.filter((t) => t.is_completed && t.completed_at && Date.parse(t.completed_at) <= corteOntem).length / comparaveis.length) * 100,
        )
      : null
  const atrasadoEmRelacaoAOntem = progressoOntem !== null && progresso < progressoOntem
  const abaixoDoRitmo = !todasConcluidas && (progresso < decorridoDoDia || atrasadoEmRelacaoAOntem)

  return { concluidas, total: tarefas.length, progresso, todasConcluidas, decorridoDoDia, progressoOntem, atrasadoEmRelacaoAOntem, abaixoDoRitmo }
}
