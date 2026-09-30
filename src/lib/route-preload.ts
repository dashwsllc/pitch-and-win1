// One loader per lazy page. App.tsx builds its routes from these same functions,
// so calling a loader early requests exactly the chunk React.lazy needs later and
// the module system shares the in-flight request (no duplicate download).
export const pageLoaders = {
  index: () => import("@/pages/Index"),
  auth: () => import("@/pages/Auth"),
  emailConfirmation: () => import("@/pages/EmailConfirmation"),
  resetPassword: () => import("@/pages/ResetPassword"),
  executive: () => import("@/pages/ExecutiveDashboard"),
  ranking: () => import("@/pages/Ranking"),
  approaches: () => import("@/pages/NovaAbordagem"),
  registerSale: () => import("@/pages/RegistrarVenda"),
  subscriptions: () => import("@/pages/Clientes"),
  leads: () => import("@/pages/Leads"),
  profile: () => import("@/pages/Perfil"),
  settings: () => import("@/pages/Configuracoes"),
  withdrawals: () => import("@/pages/Saques"),
  crm: () => import("@/pages/CRM"),
  mySales: () => import("@/pages/MinhasVendas"),
  arena: () => import("@/pages/Arena"),
  goals: () => import("@/pages/Metas"),
  traffic: () => import("@/pages/Trafego"),
  notFound: () => import("@/pages/NotFound"),
} as const

const pathLoaders: Record<string, () => Promise<unknown>> = {
  "/": pageLoaders.index,
  "/auth": pageLoaders.auth,
  "/email-confirmation": pageLoaders.emailConfirmation,
  "/reset-password": pageLoaders.resetPassword,
  "/executive": pageLoaders.executive,
  "/ranking": pageLoaders.ranking,
  "/abordagens": pageLoaders.approaches,
  "/vendas": pageLoaders.registerSale,
  "/assinaturas": pageLoaders.subscriptions,
  "/leads": pageLoaders.leads,
  "/perfil": pageLoaders.profile,
  "/configuracoes": pageLoaders.settings,
  "/saques": pageLoaders.withdrawals,
  "/crm": pageLoaders.crm,
  "/minhas-vendas": pageLoaders.mySales,
  "/arena": pageLoaders.arena,
  "/metas": pageLoaders.goals,
  "/trafego": pageLoaders.traffic,
}

// Starts downloading the chunk for a route. Safe to call repeatedly. It is only
// used for the page being opened and for links the user points at, never as a
// blind background prefetch: a stale chunk after a deploy is handled by the same
// vite:preloadError recovery (one reload) that React.lazy already relies on.
export function preloadRoute(pathname: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  const loader = pathLoaders[path]
  if (loader) void loader().catch(() => undefined)
}
