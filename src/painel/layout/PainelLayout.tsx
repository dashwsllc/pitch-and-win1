import type { ReactNode } from 'react'
import '@fontsource-variable/dm-sans/wght.css'
import '../painel.css'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type { StatusAoVivo } from '../hooks/statusAoVivo'
import { usePainelEscopo } from '../usePainelEscopo'
import { PainelSidebar } from './PainelSidebar'
import { Topbar } from './Topbar'

interface Props {
  status: StatusAoVivo
  atualizadoEm: string | null
  recarregando: boolean
  erro: string | null
  onAtualizar(): void
  children: ReactNode
}

/**
 * Casco da Home: menu lateral, barra superior fixa e o contêiner de 1600 px. Liga os tokens do painel no <html>
 * enquanto estiver montado; as demais telas seguem com DashboardLayout.
 */
export function PainelLayout({ status, atualizadoEm, recarregando, erro, onAtualizar, children }: Props) {
  usePainelEscopo()
  return (
    <SidebarProvider>
      <PainelSidebar />
      <SidebarInset className="atmosfera min-w-0">
        <Topbar status={status} atualizadoEm={atualizadoEm} recarregando={recarregando} erro={erro} onAtualizar={onAtualizar} />
        <div className="relative z-[1] mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 pb-12 pt-5 md:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
