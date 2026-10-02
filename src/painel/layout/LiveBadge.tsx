import type { StatusAoVivo } from '../hooks/statusAoVivo'

const ROTULOS: Record<StatusAoVivo, { texto: string; cor: string; pulso: boolean }> = {
  ao_vivo: { texto: 'Ao vivo', cor: 'bg-ok', pulso: true },
  conectando: { texto: 'Conectando…', cor: 'bg-aviso', pulso: false },
  offline: { texto: 'Offline — reconectando', cor: 'bg-erro', pulso: false },
}

/** Selo de conexão com o canal ao vivo. O ponto pulsa só com o canal inscrito e só para quem aceita movimento. */
export function LiveBadge({ status }: { status: StatusAoVivo }) {
  const r = ROTULOS[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card/60 px-2.5 py-1 text-xs font-medium"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2" aria-hidden="true">
        {r.pulso && <span className={`absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping ${r.cor}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${r.cor}`} />
      </span>
      {r.texto}
    </span>
  )
}
