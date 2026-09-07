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
    <div className="min-h-screen bg-background">
      <ExecutiveAppSidebar isExecutive={isExecutive} />
      
      <div className="ml-16 min-h-screen flex flex-col">
        <header className="h-16 border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center justify-between h-full px-6">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-gradient-ember animate-pulse" />
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                Dashboard Comercial
              </h1>
            </div>
            
            <UserProfile />
          </div>
        </header>
        
        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}