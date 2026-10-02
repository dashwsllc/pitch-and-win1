import {
  Home,
  Monitor,
  Megaphone,
  DollarSign,
  Trophy,
  Users,
  User,
  Settings,
  Shield,
  Wallet,
  Target,
  ShoppingBag,
  ListChecks,
  type LucideIcon,
} from "lucide-react"
import { canAccessArena, canAccessTraffic } from "@/lib/arena"
import type { crmCapabilities } from "@/lib/crm-capabilities"
import type { UserRole } from "@/hooks/useRoles"

export interface MenuItem {
  title: string
  url: string
  icon: LucideIcon
}

// Um só lugar para os itens do menu: o trilho de ícones das telas em geral (ExecutiveAppSidebar) e o menu da
// Home (src/painel/layout) leem daqui, então o que cada papel enxerga nunca diverge entre os dois.
export const menuItems: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Executive", url: "/executive", icon: Shield },
  { title: "Arena Comercial", url: "/arena", icon: Monitor },
  { title: "Metas", url: "/metas", icon: ListChecks },
  { title: "Tráfego", url: "/trafego", icon: Megaphone },
  { title: "Vendas", url: "/vendas", icon: DollarSign },
  { title: "Minhas Vendas", url: "/minhas-vendas", icon: ShoppingBag },
  { title: "Ranking", url: "/ranking", icon: Trophy },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Assinaturas", url: "/assinaturas", icon: ShoppingBag },
  { title: "CRM", url: "/crm", icon: Target },
  { title: "Saques", url: "/saques", icon: Wallet },
  { title: "Perfil", url: "/perfil", icon: User },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

export const sellerMenuItems: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Arena Comercial", url: "/arena", icon: Monitor },
  { title: "Metas", url: "/metas", icon: ListChecks },
  { title: "Tráfego", url: "/trafego", icon: Megaphone },
  { title: "Vendas", url: "/vendas", icon: DollarSign },
  { title: "Minhas Vendas", url: "/minhas-vendas", icon: ShoppingBag },
  { title: "Ranking", url: "/ranking", icon: Trophy },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Assinaturas", url: "/assinaturas", icon: ShoppingBag },
  { title: "CRM", url: "/crm", icon: Target },
  { title: "Saques", url: "/saques", icon: Wallet },
  { title: "Perfil", url: "/perfil", icon: User },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

interface MenuAccess {
  isExecutive: boolean
  isSuperAdmin: boolean
  roles: UserRole[]
  capabilities: ReturnType<typeof crmCapabilities>
}

/** Os itens que o papel atual enxerga, na ordem do menu. */
export function itensDoMenu({ isExecutive, isSuperAdmin, roles, capabilities }: MenuAccess): MenuItem[] {
  return (isExecutive ? menuItems : sellerMenuItems).filter(item =>
    (item.url !== '/crm' || capabilities.leads) && (item.url !== '/vendas' || capabilities.sales) &&
    (item.url !== '/leads' || roles.some(role => ['sdr','executive','super_admin'].includes(role))) &&
    (item.url !== '/assinaturas' || isSuperAdmin) && (item.url !== '/arena' || canAccessArena(roles)) &&
    (item.url !== '/trafego' || canAccessTraffic(roles)))
}
