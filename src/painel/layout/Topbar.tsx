import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NotificationInbox } from '@/components/arena/ArenaNotifications'
import { useHa } from '../hooks/relogio'
import type { StatusAoVivo } from '../hooks/statusAoVivo'
import { formatarHoraCompleta } from '../lib/tempo'
import { LiveBadge } from './LiveBadge'
import { NivelPill } from './NivelPill'

interface Props {
  status: StatusAoVivo
  /** Quando os dados terminaram de carregar pela última vez (ISO). */
  atualizadoEm: string | null
  recarregando: boolean
  erro: string | null
  onAtualizar(): void
}

/**
 * Barra superior fixa. À direita: falha de atualização (quando houver), selo ao vivo, "atualizado há X" e o botão de
 * atualizar, e depois o que o cabeçalho antigo já tinha (nível e notificações). A conta (Perfil, Configurações, Sair)
 * fica no rodapé do menu lateral, como na referência.
 */
export function Topbar({ status, atualizadoEm, recarregando, erro, onAtualizar }: Props) {
  const ha = useHa(atualizadoEm)
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger className="-ml-1" aria-label="Mostrar ou ocultar o menu" />
      {/* No celular o título da página logo abaixo já diz onde se está, e o nome apertaria o selo e o nível. */}
      <Separator orientation="vertical" className="mr-1 hidden h-4 sm:block" />
      <p className="hidden min-w-0 truncate text-sm font-semibold text-heading sm:block">Dashboard Comercial</p>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {erro && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-1 text-xs text-destructive" role="alert">
                <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Falha ao atualizar</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="border-0 bg-foreground text-xs text-background">{erro} — os dados na tela são os da última atualização.</TooltipContent>
          </Tooltip>
        )}
        <LiveBadge status={status} />
        {atualizadoEm && (
          <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:inline" title={formatarHoraCompleta(atualizadoEm)}>
            atualizado {ha}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAtualizar} disabled={recarregando} aria-label="Atualizar os dados agora">
              <RefreshCwIcon className={recarregando ? 'motion-safe:animate-spin' : undefined} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="border-0 bg-foreground text-xs text-background">Atualizar agora</TooltipContent>
        </Tooltip>
        <NivelPill />
        <NotificationInbox />
      </div>
      {recarregando && <span className="painel-progresso" aria-hidden="true" />}
    </header>
  )
}
