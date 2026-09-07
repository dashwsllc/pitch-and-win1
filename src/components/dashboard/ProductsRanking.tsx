import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Boxes, Medal } from "lucide-react"

interface ProductsRankingProps {
  data?: Array<{ nome: string; quantidade: number; valor: number }>
  loading?: boolean
}

const medals = ["text-amber-400", "text-slate-300", "text-amber-700"]

export function ProductsRanking({ data = [], loading = false }: ProductsRankingProps) {
  const topProducts = data.slice(0, 3)
  const maxValue = Math.max(...topProducts.map((product) => product.valor), 1)

  return (
    <Card className="surface-panel overflow-hidden rounded-2xl border-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-white/[0.05] px-5 py-4 sm:px-6">
        <div>
          <CardTitle className="text-base font-medium tracking-[-0.015em] text-white">Produtos em destaque</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Ranking por receita aprovada</p>
        </div>
        <Boxes className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((item) => <div key={item} className="h-[74px] animate-pulse rounded-xl bg-white/[0.025]" />)}
          </div>
        ) : topProducts.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.035] shadow-[rgba(255,255,255,0.07)_0_0_0_1px_inset]">
              <Boxes className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Nenhum produto vendido no período</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topProducts.map((product, index) => (
              <div key={product.nome} className="group relative overflow-hidden rounded-xl bg-white/[0.025] p-4 shadow-[rgba(255,255,255,0.055)_0_0_0_1px_inset] transition-colors hover:bg-white/[0.04]">
                <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-gradient-to-r from-electric-violet/[0.08] to-transparent transition-[width] duration-700" style={{ width: `${Math.max((product.valor / maxValue) * 100, 8)}%` }} />
                <div className="relative flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#100b19]/75">
                    <Medal className={`h-4 w-4 ${medals[index]}`} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ash" title={product.nome}>{product.nome}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{product.quantidade} {product.quantidade === 1 ? "venda" : "vendas"}</p>
                  </div>
                  <p className="text-sm font-medium tabular-nums text-white">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(product.valor)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
