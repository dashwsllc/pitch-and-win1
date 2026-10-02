/** Controle segmentado (um único valor ativo), no padrão `radiogroup` do painel. */
export function Segmentos<T extends string>({
  rotulo,
  opcoes,
  valor,
  onChange,
  tamanho = 'normal',
}: {
  rotulo: string
  opcoes: Array<{ valor: T; rotulo: string }>
  valor: T
  onChange(v: T): void
  tamanho?: 'normal' | 'pequeno'
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex max-w-full flex-wrap rounded-xl border bg-card p-0.5">
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.valor)}
            className={`${tamanho === 'pequeno' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'} rounded-[0.6rem] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${
              ativo ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
