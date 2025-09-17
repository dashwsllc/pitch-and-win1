import { 
  BarChart3, 
  Home,
  MessageSquare,
  ShoppingCart,
  Trophy
} from "lucide-react"
import { NavLink } from "react-router-dom"

const menuItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Abordagens", url: "/abordagens", icon: MessageSquare },
  { title: "Vendas", url: "/vendas", icon: ShoppingCart },
  { title: "Ranking", url: "/ranking", icon: Trophy },
]

export function AppSidebar() {
  return (
    <aside className="w-16 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col fixed left-0 top-0 z-40">
      <div className="p-4">
        <div className="flex flex-col items-center justify-center">
          <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center mb-1">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div className="text-xs font-bold text-sidebar-foreground text-center">
            WS<br/>LTDA
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-2 px-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            className={({ isActive }) =>
              `flex items-center justify-center w-12 h-12 rounded-lg transition-all ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary border border-sidebar-primary/20"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`
            }
            title={item.title}
          >
            <item.icon className="w-5 h-5" />
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}