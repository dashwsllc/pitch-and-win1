import { BadgeDollarSignIcon, MessageSquareTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useHa } from '../hooks/relogio'
import { formatarReais } from '../lib/formatar'
import { formatarHoraCompleta } from '../lib/tempo'
import type { AtividadeItem } from '../lib/visao'

function Quando({ em }: { em: string }) {
  const ha = useHa(em)
  return (
    <time dateTime={em} title={formatarHoraCompleta(em)} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
      {ha}
    </time>
  )
}

/**
 * O que está acontecendo agora, no mesmo recorte da tela: vendas aprovadas e abordagens, do mais novo para o mais antigo.
 * O que chega enquanto a tela está aberta aparece com um realce que some.
 */
export function FeedAoVivo({ itens }: { itens: AtividadeItem[] }) {
  // Chaves já vistas na primeira pintura: só o que chegar depois ganha o realce (e perde quando a lavagem termina).
  const [vistos, setVistos] = useState(() => new Set(itens.map((i) => i.chave)))
  useEffect(() => {
    if (itens.every((i) => vistos.has(i.chave))) return
    const t = setTimeout(() => setVistos((v) => new Set([...v, ...itens.map((i) => i.chave)])), 2600)
    return () => clearTimeout(t)
  }, [itens, vistos])

  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">As vendas aprovadas e as abordagens aparecem aqui assim que acontecem.</p>
  }

  return (
    <ol aria-label="Atividade ao vivo" className="-mx-1.5 space-y-0.5">
      {itens.map((i) => {
        const novo = !vistos.has(i.chave)
        const classe = `flex items-start gap-3 rounded-xl px-1.5 py-2 ${novo ? 'painel-linha-nova' : ''}`
        if (i.tipo === 'venda') {
          return (
            <li key={i.chave} className={classe}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok-forte" aria-hidden="true">
                <BadgeDollarSignIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-heading">Venda aprovada · {formatarReais(i.valor)}</p>
                <p className="truncate text-xs text-muted-foreground" title={i.produto}>
                  {i.produto}
                </p>
              </div>
              <Quando em={i.em} />
            </li>
          )
        }
        return (
          <li key={i.chave} className={classe}>
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-viz-1/12 text-viz-1" aria-hidden="true">
              <MessageSquareTextIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-heading">Abordagem registrada</p>
              <p className="truncate text-xs text-muted-foreground">{i.mostrouIa ? 'Mostrou a IA funcionando' : 'Sem demonstração da IA'}</p>
            </div>
            <Quando em={i.em} />
          </li>
        )
      })}
    </ol>
  )
}
