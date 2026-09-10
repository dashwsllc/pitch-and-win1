import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DataSync } from "@/components/DataSync";
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const EmailConfirmation = lazy(() => import("./pages/EmailConfirmation"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ExecutiveDashboard = lazy(() => import("./pages/ExecutiveDashboard"));
const Ranking = lazy(() => import("./pages/Ranking"));
const NovaAbordagem = lazy(() => import("./pages/NovaAbordagem"));
const RegistrarVenda = lazy(() => import("./pages/RegistrarVenda"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Perfil = lazy(() => import("./pages/Perfil"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const Saques = lazy(() => import("./pages/Saques"));
const CRM = lazy(() => import("./pages/CRM"));
const MinhasVendas = lazy(() => import("./pages/MinhasVendas"));
const VendasTime = lazy(() => import("./pages/VendasTime"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <DataSync />
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
                <ProtectedRoute executiveOnly>
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
                <ProtectedRoute>
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
              <Route path="/vendas-time" element={<ProtectedRoute><VendasTime /></ProtectedRoute>} />
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
