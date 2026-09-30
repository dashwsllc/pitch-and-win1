import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DataSync } from "@/components/DataSync";
import { SaleAlerts } from "@/components/arena/ArenaNotifications";
import { pageLoaders, preloadRoute } from "@/lib/route-preload";
const Index = lazy(pageLoaders.index);
const Auth = lazy(pageLoaders.auth);
const EmailConfirmation = lazy(pageLoaders.emailConfirmation);
const ResetPassword = lazy(pageLoaders.resetPassword);
const ExecutiveDashboard = lazy(pageLoaders.executive);
const Ranking = lazy(pageLoaders.ranking);
const NovaAbordagem = lazy(pageLoaders.approaches);
const RegistrarVenda = lazy(pageLoaders.registerSale);
const Clientes = lazy(pageLoaders.subscriptions);
const Leads = lazy(pageLoaders.leads);
const Perfil = lazy(pageLoaders.profile);
const Configuracoes = lazy(pageLoaders.settings);
const Saques = lazy(pageLoaders.withdrawals);
const CRM = lazy(pageLoaders.crm);
const MinhasVendas = lazy(pageLoaders.mySales);
const Arena = lazy(pageLoaders.arena);
const Metas = lazy(pageLoaders.goals);
const Trafego = lazy(pageLoaders.traffic);
const NotFound = lazy(pageLoaders.notFound);

// ProtectedRoute only renders (and so only requests) a page after the session,
// registration, profile and role requests finish. Start the chunk of the page in
// the address bar now so its download overlaps with those requests.
preloadRoute(window.location.pathname);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <DataSync />
        <SaleAlerts />
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={
              <div className="flex min-h-screen items-center justify-center bg-[#0e0918]">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-ember" />
                  Preparando seu dashboard
                </div>
              </div>
            }>
              <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/email-confirmation" element={<EmailConfirmation />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              } />
              <Route path="/executive" element={
                <ProtectedRoute superAdminOnly>
                  <ExecutiveDashboard />
                </ProtectedRoute>
              } />
              <Route path="/ranking" element={
                <ProtectedRoute>
                  <Ranking />
                </ProtectedRoute>
              } />
              <Route path="/abordagens" element={
                <ProtectedRoute>
                  <NovaAbordagem />
                </ProtectedRoute>
              } />
              <Route path="/vendas" element={
                <ProtectedRoute salesOnly>
                  <RegistrarVenda />
                </ProtectedRoute>
              } />
              <Route path="/clientes" element={
                <Navigate to="/leads" replace />
              } />
              <Route path="/leads" element={
                <ProtectedRoute leadInboxOnly>
                  <Leads />
                </ProtectedRoute>
              } />
              <Route path="/assinaturas" element={
                <ProtectedRoute superAdminOnly>
                  <Clientes />
                </ProtectedRoute>
              } />
              <Route path="/perfil" element={
                <ProtectedRoute>
                  <Perfil />
                </ProtectedRoute>
              } />
              <Route path="/configuracoes" element={
                <ProtectedRoute>
                  <Configuracoes />
                </ProtectedRoute>
              } />
              <Route path="/saques" element={
                <ProtectedRoute>
                  <Saques />
                </ProtectedRoute>
              } />
              <Route path="/crm" element={
                <ProtectedRoute>
                  <CRM />
                </ProtectedRoute>
              } />
              <Route path="/minhas-vendas" element={
                <ProtectedRoute>
                  <MinhasVendas />
                </ProtectedRoute>
              } />
              <Route path="/arena" element={<ProtectedRoute arenaOnly><Arena /></ProtectedRoute>} />
              <Route path="/metas" element={<ProtectedRoute><Metas /></ProtectedRoute>} />
              <Route path="/trafego" element={<ProtectedRoute trafficOnly><Trafego /></ProtectedRoute>} />
              <Route path="/vendas-time" element={<Navigate to="/metas?tab=vendas" replace />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
