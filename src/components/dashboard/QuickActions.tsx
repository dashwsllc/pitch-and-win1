import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRight, BadgeDollarSign, MessageSquareText, Trophy } from "lucide-react"
import { useNavigate } from "react-router-dom"

const secondaryButton = "group h-11 w-full justify-between rounded-lg border-0 bg-white/[0.035] px-3.5 text-ash shadow-[rgba(255,255,255,0.065)_0_0_0_1px_inset] transition-colors hover:bg-white/[0.065] hover:text-white"

export function QuickActions() {
  const navigate = useNavigate()

  return (
    <Card className="surface-panel overflow-hidden rounded-2xl border-0">
      <CardHeader className="border-b border-white/[0.05] px-5 py-4">
        <CardTitle className="text-base font-medium tracking-[-0.015em] text-white">Ações rápidas</CardTitle>
        <p className="text-xs text-muted-foreground">Continue o fluxo comercial</p>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        <Button onClick={() => navigate("/abordagens?new=true")} className="group h-11 w-full justify-between rounded-lg border-0 bg-gradient-ember px-3.5 text-white shadow-none hover:opacity-90">
          <span className="flex items-center gap-2.5"><MessageSquareText className="h-4 w-4" /> Nova abordagem</span>
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Button>
        <Button onClick={() => navigate("/vendas?new=true")} className={secondaryButton}>
          <span className="flex items-center gap-2.5"><BadgeDollarSign className="h-4 w-4 text-success" /> Registrar venda</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Button>
        <Button onClick={() => navigate("/ranking")} className={secondaryButton}>
          <span className="flex items-center gap-2.5"><Trophy className="h-4 w-4 text-amber-400" /> Ver ranking</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Button>
      </CardContent>
    </Card>
  )
}
