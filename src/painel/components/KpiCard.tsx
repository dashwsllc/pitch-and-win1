import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Indicador do painel: rótulo, valor (grande, dígitos proporcionais), detalhe e um complemento visual opcional. */
export function KpiCard({
  rotulo,
  icone: Icone,
  valor,
  detalhe,
  lateral,
  destaque = false,
  children,
  className = '',
  dataSecao,
  valorClasse,
}: {
  rotulo: string
  icone?: LucideIcon
  valor: ReactNode
  detalhe?: ReactNode
  /** À direita do valor (anel, minigráfico). */
  lateral?: ReactNode
  /** Cartão principal da linha: brilho da cor da marca no canto. */
  destaque?: boolean
  children?: ReactNode
  className?: string
  /** Âncora estável para os testes de interface (data-dashboard-section). */
  dataSecao?: string
  /**
   * Tamanho do valor quando o padrão (36 px; 48 → 60 px no destaque) não cabe: dinheiro tem 10 a 15 caracteres, e a
   * referência mostrava contagens de 2 a 5. Segue sem dígitos tabulares, como os demais números grandes.
   */
  valorClasse?: string
}) {
  return (
    <section
      aria-label={rotulo}
      data-dashboard-section={dataSecao}
      className={`relative overflow-hidden rounded-2xl border p-4 md:p-5 ${destaque ? 'cartao-brilho border-transparent' : 'bg-card'} ${className}`}
    >
      <div className="flex items-center gap-2.5">
        {Icone && (
          <span className="flex size-8 items-center justify-center rounded-xl bg-viz-1/12 text-viz-1 ring-1 ring-viz-1/20" aria-hidden="true">
            <Icone className="size-4" />
          </span>
        )}
        <h2 className="text-sm font-medium text-muted-foreground">{rotulo}</h2>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={`${valorClasse ?? (destaque ? 'text-5xl md:text-6xl' : 'text-4xl')} font-semibold leading-none tracking-tight text-heading`}>{valor}</p>
          {detalhe && <div className="mt-2 text-xs text-muted-foreground">{detalhe}</div>}
        </div>
        {lateral}
      </div>
      {children}
    </section>
  )
}

/** Painel com título, descrição e ação à direita. */
export function Bloco({
  titulo,
  descricao,
  acao,
  children,
  className = '',
  id,
  dataSecao,
  compacto = false,
}: {
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  /** Âncora estável para os testes de interface (data-dashboard-section). */
  dataSecao?: string
  /** Respiro menor, para os cartões que dividem uma coluna (os pódios). */
  compacto?: boolean
}) {
  return (
    <section
      aria-labelledby={id}
      aria-label={id ? undefined : titulo}
      data-dashboard-section={dataSecao}
      className={`min-w-0 rounded-2xl border bg-card text-card-foreground ${compacto ? 'p-4' : 'p-4 md:p-5'} ${className}`}
    >
      <div className={`${compacto ? 'mb-1' : 'mb-4'} flex items-start justify-between gap-3`}>
        <div className="min-w-0">
          <h2 id={id} className="text-[0.95rem] font-semibold text-heading">
            {titulo}
          </h2>
          {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  )
}
