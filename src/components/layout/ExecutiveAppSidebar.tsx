import { memo } from "react"
import { BarChart3 } from "lucide-react"
import { NavLink } from "react-router-dom"
import { useRoles } from '@/hooks/useRoles'
import { itensDoMenu } from '@/lib/navigation'
import { preloadRoute } from '@/lib/route-preload'

interface AppSidebarProps {
  isExecutive?: boolean
}

function ExecutiveAppSidebarBase({ isExecutive = false }: AppSidebarProps) {
  const { capabilities, roles, isSuperAdmin } = useRoles()
  const items = itensDoMenu({ isExecutive, isSuperAdmin, roles, capabilities })

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-dvh w-16 flex-col overflow-y-auto border-r border-white/[0.055] bg-[#0c0715]/92 sm:w-[72px]" data-lenis-prevent>
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
            onMouseEnter={() => preloadRoute(item.url)}
            onFocus={() => preloadRoute(item.url)}
            onTouchStart={() => preloadRoute(item.url)}
          >
            <item.icon className="h-[19px] w-[19px] transition-transform duration-200 group-hover:scale-105" strokeWidth={1.8} />
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export const ExecutiveAppSidebar = memo(ExecutiveAppSidebarBase)
