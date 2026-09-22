import { Award, Crown, Gift, Medal, Percent, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SDRRewards() {
  const rewards = [
    { title: '1º Lugar SDR', value: 'R$ 1.000', detail: 'Maior volume de repasses qualificados', icon: Crown, tone: 'text-amber-400' },
    { title: '2º Lugar SDR', value: 'R$ 500', detail: 'Consistência de abordagem e conversão', icon: Medal, tone: 'text-slate-300' },
    { title: '3º Lugar SDR', value: 'R$ 250', detail: 'Terceira melhor performance do ciclo', icon: Award, tone: 'text-amber-700' },
  ]

  return (
    <Card className="relative overflow-hidden border-cyan-400/15">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      <CardHeader className="relative pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg font-light">
            <Gift className="h-5 w-5 text-cyan-400" />
            Premiação SDR
          </CardTitle>
          <Badge variant="outline" className="border-cyan-400/25 text-cyan-300">Valores provisórios</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Valores provisórios para colaboradores SDR. Não são lançados automaticamente no saldo.</p>
      </CardHeader>
      <CardContent className="relative space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Card className="border-cyan-400/15 bg-cyan-400/[0.03]">
            <CardContent className="p-4 text-center">
              <Percent className="mx-auto h-5 w-5 text-cyan-400" />
              <h3 className="mt-2 text-sm font-semibold">Bônus adicional</h3>
              <p className="mt-1 text-2xl font-bold text-cyan-300">+3%</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Sobre a comissão SDR elegível</p>
            </CardContent>
          </Card>
          {rewards.map(reward => (
            <Card key={reward.title} className="border-border/40 bg-white/[0.015]">
              <CardContent className="p-4 text-center">
                <reward.icon className={`mx-auto h-5 w-5 ${reward.tone}`} />
                <h3 className="mt-2 text-sm font-semibold">{reward.title}</h3>
                <p className={`mt-1 text-2xl font-bold ${reward.tone}`}>{reward.value}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{reward.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.025] p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-cyan-400" />Critérios do ciclo SDR</h4>
          <ul className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <li>Conversão para Closer acima de 30%</li>
            <li>Mínimo de 80 abordagens registradas</li>
            <li>Mínimo de 15 repasses qualificados</li>
            <li>Contexto dos leads mantido atualizado</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
