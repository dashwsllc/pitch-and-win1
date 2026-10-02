import { ArrowRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Link de seção no canto do bloco: substantivo curto e seta, só quando existe a página de destino. */
export function LinkSecao({ para, children }: { para: string; children: ReactNode }) {
  return (
    <Link
      to={para}
      className="flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {children} <ArrowRightIcon className="size-3" aria-hidden="true" />
    </Link>
  )
}
