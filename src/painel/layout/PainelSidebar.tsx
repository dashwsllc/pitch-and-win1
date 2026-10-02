import { BarChart3, ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun, User } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { ROLE_LABELS, useRoles } from '@/hooks/useRoles'
import { itensDoMenu, type MenuItem } from '@/lib/navigation'
import { preloadRoute } from '@/lib/route-preload'
import { iniciais } from '../lib/iniciais'

// Os itens e o que cada papel enxerga vêm de src/lib/navigation.ts (os mesmos do trilho das outras telas).
const GRUPOS: Array<{ titulo: string; urls: string[] }> = [
  { titulo: 'Acompanhar', urls: ['/', '/executive', '/arena', '/metas', '/ranking', '/trafego'] },
  { titulo: 'Operação', urls: ['/vendas', '/minhas-vendas', '/leads', '/crm', '/assinaturas', '/saques'] },
  { titulo: 'Conta', urls: ['/perfil', '/configuracoes'] },
]

const TEMAS = [
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
  { valor: 'system', rotulo: 'Sistema', icone: Monitor },
] as const

function agrupar(itens: MenuItem[]) {
  const nomeados = new Set(GRUPOS.flatMap((g) => g.urls))
  return GRUPOS.map((g) => ({
    titulo: g.titulo,
    itens: [...itens.filter((i) => g.urls.includes(i.url)), ...(g.titulo === 'Operação' ? itens.filter((i) => !nomeados.has(i.url)) : [])],
  })).filter((g) => g.itens.length > 0)
}

export function PainelSidebar() {
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const { capabilities, roles, isSuperAdmin, primaryRole } = useRoles()
  const { theme, setTheme } = useTheme()
  const { pathname } = useLocation()
  const navegar = useNavigate()
  // A dica só serve com o menu recolhido em ícones. Na gaveta do celular ela fica invisível, mas abre no foco e
  // "engole" o primeiro Esc, que então não fecharia a gaveta.
  const { isMobile } = useSidebar()
  const dica = (texto: string) => (isMobile ? undefined : texto)

  // O trilho antigo recebe isExecutive={isSuperAdmin}: a lista completa (com "Executive") é só do super admin.
  const grupos = agrupar(itensDoMenu({ isExecutive: isSuperAdmin, isSuperAdmin, roles, capabilities }))
  const IconeTema = TEMAS.find((t) => t.valor === theme)?.icone ?? Monitor
  const nome = profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Usuário'

  return (
    <Sidebar collapsible="icon">
      {/* No celular o menu é uma gaveta (diálogo): ela precisa de nome e descrição para o leitor de tela. */}
      {isMobile && (
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Navegação do dashboard comercial, conta e tema.</SheetDescription>
        </SheetHeader>
      )}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={dica('WS LTDA · Dashboard comercial')}>
              <NavLink to="/" aria-label="WS LTDA, ir para o dashboard">
                <span
                  className="flex aspect-square size-8 items-center justify-center rounded-lg text-white shadow-md shadow-primary/25"
                  style={{ backgroundImage: 'var(--gradiente-corrente)' }}
                >
                  <BarChart3 className="size-4" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold text-heading">WS LTDA</span>
                  <span className="truncate text-xs text-muted-foreground">Dashboard comercial</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {grupos.map((grupo) => (
          <SidebarGroup key={grupo.titulo}>
            <SidebarGroupLabel>{grupo.titulo}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {grupo.itens.map((item) => {
                  const ativo = item.url === '/' ? pathname === '/' : pathname === item.url || pathname.startsWith(`${item.url}/`)
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={ativo} tooltip={dica(item.title)}>
                        <NavLink
                          to={item.url}
                          end={item.url === '/'}
                          onMouseEnter={() => preloadRoute(item.url)}
                          onFocus={() => preloadRoute(item.url)}
                          onTouchStart={() => preloadRoute(item.url)}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={dica('Conta e tema')}>
                  <Avatar className="size-8 rounded-lg">
                    <AvatarImage src={profile?.avatar_url || ''} alt="" className="object-cover" />
                    <AvatarFallback delayMs={300} className="rounded-lg bg-gradient-to-br from-avatar-de to-avatar-ate text-xs font-semibold text-heading">
                      {iniciais(nome)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{nome}</span>
                    <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[primaryRole]}</span>
                  </span>
                  <ChevronsUpDown className="ml-auto" />
                  <span className="sr-only">Abrir o menu da conta e do tema (tema atual: {TEMAS.find((t) => t.valor === theme)?.rotulo})</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60" align="start" side="top">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <IconeTema className="size-4" aria-hidden="true" /> Tema
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                  {TEMAS.map((t) => (
                    <DropdownMenuRadioItem key={t.valor} value={t.valor}>
                      <t.icone className="mr-2 size-4" aria-hidden="true" />
                      {t.rotulo}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onSelect={() => navegar('/perfil')}>
                  <User className="mr-2 size-4" /> Perfil
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onSelect={() => navegar('/configuracoes')}>
                  <Settings className="mr-2 size-4" /> Configurações
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onSelect={() => void signOut()}>
                  <LogOut className="mr-2 size-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
