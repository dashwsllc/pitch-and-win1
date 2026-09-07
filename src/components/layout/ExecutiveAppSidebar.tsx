import { 
  BarChart3, 
  Home,
  MessageSquare,
  DollarSign,
  Trophy,
  Users,
  User,
  Settings,
  Shield,
  Wallet,
  Target,
  ShoppingBag
} from "lucide-react"
import { NavLink } from "react-router-dom"

const menuItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Executive", url: "/executive", icon: Shield },
  { title: "Abordagens", url: "/abordagens", icon: MessageSquare },
  { title: "Vendas", url: "/vendas", icon: DollarSign },
  { title: "Minhas Vendas", url: "/minhas-vendas", icon: ShoppingBag },
  { title: "Ranking", url: "/ranking", icon: Trophy },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "CRM", url: "/crm", icon: Target },
  { title: "Saques", url: "/saques", icon: Wallet },
  { title: "Perfil", url: "/perfil", icon: User },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

const sellerMenuItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Abordagens", url: "/abordagens", icon: MessageSquare },
  { title: "Vendas", url: "/vendas", icon: DollarSign },
  { title: "Minhas Vendas", url: "/minhas-vendas", icon: ShoppingBag },
  { title: "Ranking", url: "/ranking", icon: Trophy },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "CRM", url: "/crm", icon: Target },
  { title: "Saques", url: "/saques", icon: Wallet },
  { title: "Perfil", url: "/perfil", icon: User },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

interface AppSidebarProps {
  isExecutive?: boolean
}

export function ExecutiveAppSidebar({ isExecutive = false }: AppSidebarProps) {
  const items = isExecutive ? menuItems : sellerMenuItems
  
  return (
    <aside className="fixed left-0 top-0 z-40 flex min-h-screen w-16 flex-col border-r border-white/[0.055] bg-[#0c0715]/92 backdrop-blur-xl sm:w-[72px]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ember/70 to-transparent" />
      
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-ember shadow-[rgba(255,142,93,0.28)_0_0_18px]">
            <BarChart3 className="h-[18px] w-[18px] text-white" strokeWidth={2} />
          </div>
        </div>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col items-center gap-1 px-2 pt-2">
        {items.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            className={({ isActive }) =>
              `relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 group ${
                isActive
                  ? "bg-white/[0.07] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] before:absolute before:-left-[11px] before:h-5 before:w-0.5 before:rounded-full before:bg-ember"
                  : "text-sidebar-foreground/50 hover:bg-white/[0.045] hover:text-sidebar-foreground"
              }`
            }
            title={item.title}
          >
            <item.icon className="h-[19px] w-[19px] transition-transform duration-200 group-hover:scale-105" strokeWidth={1.8} />
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
