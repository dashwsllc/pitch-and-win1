import { ReactNode } from "react"
import { ExecutiveAppSidebar } from "./ExecutiveAppSidebar"
import { UserProfile } from "@/components/dashboard/UserProfile"
import { useRoles } from "@/hooks/useRoles"

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { isExecutive } = useRoles()
  
  return (
    <div className="min-h-screen bg-transparent">
      <ExecutiveAppSidebar isExecutive={isExecutive} />
      
      <div className="ml-16 flex min-h-screen flex-col sm:ml-[72px]">
        <header className="sticky top-0 z-30 h-16 border-b border-white/[0.055] bg-[#0e0918]/80 backdrop-blur-xl">
          <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="relative flex h-2 w-2 items-center justify-center">
                <span className="absolute h-2 w-2 animate-ping rounded-full bg-ember/35" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-ember" />
              </div>
              <h1 className="text-sm font-medium tracking-[-0.01em] text-ash sm:text-base">
                Dashboard Comercial
              </h1>
            </div>
            
            <UserProfile />
          </div>
        </header>
        
        <main className="relative flex-1 overflow-hidden p-4 sm:p-6 lg:p-8">
          <div aria-hidden="true" className="dashboard-grid pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-50" />
          {children}
        </main>
      </div>
    </div>
  )
}
