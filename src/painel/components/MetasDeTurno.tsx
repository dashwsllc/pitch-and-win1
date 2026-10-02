import { useQuery } from '@tanstack/react-query'
import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useLiveClock } from '@/hooks/useLiveClock'
import { arenaRpc } from '@/lib/arena-api'
import { progressPercent } from '@/lib/arena'
import { formatBrasiliaDate } from '@/lib/brasilia-time'
import { errorMessage } from '@/lib/sales'
import { Bloco } from './KpiCard'

interface MetaDeTurno {
  id: string
  assignee_id: string
  display_name: string
  title: string
  target_approaches: number
  approach_source: 'crm' | 'manual'
  actual: number
  starts_at: string
  ends_at: string
  created_at: string
  cancelled_at: string | null
}

const POR_PAGINA = 50

const horaDoTurno = (valor: Date | string | number) => formatBrasiliaDate(valor, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * Metas de abordagens por turno da pessoa, no dia. Mesma consulta (RPC arena_shift_approach_progress, mesma chave
 * de cache) que o painel antigo usava, só leitura: criar e cancelar metas continua em Metas, para quem pode.
 */
function MetasDeTurnoBase({ data, className = '' }: { data: string; className?: string }) {
  const { user } = useAuth()
  const agora = useLiveClock(30_000)
  const [pagina, setPagina] = useState(0)

  useEffect(() => setPagina(0), [data])

  const consulta = useQuery({
    queryKey: ['shift-approach-goals', user?.id, false, data, user?.id, pagina],
    enabled: !!user && !!data,
    queryFn: () =>
      arenaRpc<MetaDeTurno[]>('arena_shift_approach_progress', {
        p_day: data,
        p_person: user!.id,
        p_offset: pagina * POR_PAGINA,
      }),
  })
  const metas = consulta.data ?? []

  return (
    <Bloco
      titulo="Metas de abordagens por turno"
      descricao="Contagem automática somente para o colaborador responsável, dentro do turno e na fonte escolhida pelo Executive."
      className={className}
    >
      {consulta.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {errorMessage(consulta.error)}
        </p>
      )}
      {consulta.isLoading ? (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Carregando…
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Metas de turno">
          {metas.map((meta) => {
            const percentual = progressPercent(meta.actual, meta.target_approaches)
            const largura = Math.min(100, Math.max(0, percentual))
            const texto = percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
            const estado = meta.cancelled_at
              ? 'Cancelada'
              : agora.getTime() < Date.parse(meta.starts_at)
                ? 'Programada'
                : agora.getTime() >= Date.parse(meta.ends_at)
                  ? 'Encerrada'
                  : 'Em andamento'
            return (
              <li key={meta.id} className="rounded-xl border px-3 py-2.5">
                <h3 className="text-sm font-medium text-heading">{meta.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {estado} · {horaDoTurno(meta.starts_at)} → {horaDoTurno(meta.ends_at)} · Fonte: {meta.approach_source === 'crm' ? 'CRM' : 'Registros de Abordagens'}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(largura)}
                    aria-label={`${texto}% da meta de abordagens`}
                    className="h-2 flex-1 rounded-full bg-viz-track/60"
                  >
                    <div className="h-full rounded-full bg-viz-1 transition-[width] duration-700 ease-out" style={{ width: `${largura}%` }} />
                  </div>
                  <span className="text-sm tabular-nums text-foreground">
                    {meta.actual}/{meta.target_approaches} · {texto}%
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!consulta.isLoading && !consulta.isError && metas.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma meta de turno para esta seleção.</p>
      )}
      {(pagina > 0 || metas.length === POR_PAGINA) && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[0.8rem]" disabled={!pagina} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[0.8rem]" disabled={metas.length < POR_PAGINA} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </Bloco>
  )
}

export const MetasDeTurno = memo(MetasDeTurnoBase)
