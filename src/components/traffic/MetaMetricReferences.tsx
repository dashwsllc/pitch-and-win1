import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const references = [
  { id: 'connect-rate', title: 'Connect rate', width: 926, height: 689,
    description: 'Entradas na página ÷ cliques no link × 100. Exemplo: 200 entradas ÷ 250 cliques × 100 = 80%. Ajuda a perceber perdas entre o clique e o carregamento da página.' },
  { id: 'cpm', title: 'CPM', width: 926, height: 696,
    description: 'Investimento ÷ impressões × 1.000. Exemplo: R$ 200 ÷ 10.000 impressões × 1.000 = R$ 20 por mil impressões. Analise junto com a qualidade do público e os resultados da campanha.' },
  { id: 'ctr', title: 'CTR', width: 927, height: 688,
    description: 'Cliques ÷ impressões × 100. Exemplo: 150 cliques ÷ 10.000 impressões × 100 = 1,5%. Ajuda a avaliar o interesse pelo anúncio; mais cliques não garantem vendas.' },
  { id: 'conversao-pagina', title: 'Taxa de conversão da página', width: 921, height: 691,
    description: 'Conversões ÷ visitas × 100. Exemplo: 45 cadastros ÷ 900 visitas × 100 = 5%. A ação de conversão depende do objetivo; no painel, a taxa página → compra considera compras.' },
  { id: 'leads-gerados', title: 'Quantidade de leads gerados', width: 929, height: 689,
    description: 'Total de cadastros ou entradas no período. Exemplo: 120 leads em 7 dias representam 120 contatos captados. Compare quantidade com qualidade e custo de aquisição.' },
  { id: 'leads-qualificados', title: 'Número de leads qualificados', width: 914, height: 689,
    description: 'Leads totais × taxa de qualificação. Exemplo: 120 leads × 25% = 30 leads qualificados. São contatos que atendem aos critérios do time comercial; captar um contato não significa que ele já esteja qualificado.' },
  { id: 'reunioes-marcadas', title: 'Número de reuniões marcadas', width: 922, height: 684,
    description: 'Leads qualificados × taxa de agendamento. Exemplo: 30 leads qualificados × 50% = 15 reuniões marcadas. Considere também a qualidade dos leads e o comparecimento às reuniões.' },
]

export function MetaMetricReferences() {
  const [selected, setSelected] = useState(references[0].id)
  const reference = references.find(item => item.id === selected) ?? references[0]
  const image = `/images/metricas/${reference.id}.png`

  return <Dialog>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm">Para se basear</Button></DialogTrigger>
    <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-xl p-4 sm:p-6" data-lenis-prevent>
      <DialogHeader className="pr-6 text-left">
        <DialogTitle>Para se basear</DialogTitle>
        <DialogDescription>Material de apoio para entender as métricas. As imagens e os valores são exemplos sugestivos, não metas ou garantias de resultado. Compare sempre campanhas com objetivos e públicos semelhantes.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <label htmlFor="metric-reference" className="text-sm font-medium">Escolher referência</label>
        <select id="metric-reference" value={selected} onChange={event => setSelected(event.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {references.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </div>
      <figure className="min-w-0 space-y-3">
        <figcaption className="space-y-1" aria-live="polite">
          <p className="font-medium">{reference.title}</p>
          <p className="text-sm text-muted-foreground">{reference.description}</p>
        </figcaption>
        <img key={reference.id} src={image} alt={`Guia ilustrado: ${reference.title}. ${reference.description}`}
          width={reference.width} height={reference.height} decoding="async"
          className="mx-auto h-auto max-w-full rounded-md" />
      </figure>
      <a href={image} target="_blank" rel="noopener noreferrer" className="w-fit text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Abrir imagem original</a>
    </DialogContent>
  </Dialog>
}
