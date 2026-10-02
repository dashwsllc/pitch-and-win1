import { iniciais } from '../lib/iniciais'

const TAMANHO = {
  xs: 'size-7 text-[10px]',
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-xs',
  lg: 'size-14 text-base',
} as const

/** Avatar neutro com as iniciais da pessoa (sem cor por pessoa: a cor do painel é reservada aos dados). */
export function Iniciais({ nome, tamanho = 'md', className = '' }: { nome: string | null | undefined; tamanho?: keyof typeof TAMANHO; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-avatar-de to-avatar-ate font-semibold text-heading ring-1 ring-border ${TAMANHO[tamanho]} ${className}`}
    >
      {nome ? iniciais(nome) : '—'}
    </span>
  )
}
