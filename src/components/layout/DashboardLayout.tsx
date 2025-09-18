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
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex items-center justify-between h-full px-6">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-foreground">
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