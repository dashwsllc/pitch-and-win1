import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Expand, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const thumbnails = useRef<(HTMLButtonElement | null)[]>([])
  const backButton = useRef<HTMLButtonElement>(null)
  const imageViewport = useRef<HTMLDivElement>(null)
  const lastSelected = useRef<number | null>(null)
  const reading = selected !== null
  const reference = selected === null ? null : references[selected]

  useEffect(() => {
    if (!open) return
    if (reading) backButton.current?.focus()
    else if (lastSelected.current !== null) thumbnails.current[lastSelected.current]?.focus()
  }, [open, reading])

  useEffect(() => {
    if (zoomed) imageViewport.current?.focus()
  }, [zoomed])

  const showReference = (index: number) => {
    if (index < 0 || index >= references.length) return
    lastSelected.current = index
    setSelected(index)
    setZoomed(false)
  }
  const showGallery = () => { setSelected(null); setZoomed(false) }

  return <Dialog open={open} onOpenChange={next => {
    setOpen(next)
    if (!next) { showGallery(); lastSelected.current = null }
  }}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm">Para se basear</Button></DialogTrigger>
    <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-7xl gap-5 overflow-y-auto rounded-2xl p-4 sm:p-6" data-lenis-prevent
      onEscapeKeyDown={event => { if (reading) { event.preventDefault(); showGallery() } }}
      onKeyDown={event => {
        if (selected === null || zoomed || event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          showReference(selected + (event.key === 'ArrowRight' ? 1 : -1))
        }
      }}>
      <DialogHeader className="space-y-2 pr-6 text-left">
        {!reading && <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Guia de métricas</span>}
        <DialogTitle className="text-xl sm:text-2xl">Para se basear</DialogTitle>
        <DialogDescription className={reading ? 'sr-only' : undefined}>Referências visuais para entender seus resultados. Os exemplos são sugestivos; compare campanhas com objetivos e públicos semelhantes.</DialogDescription>
      </DialogHeader>
      {!reference ? <>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>7 referências</span><span className="flex items-center gap-1.5"><Expand className="h-3.5 w-3.5" aria-hidden="true" />Clique para ampliar</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          {references.map((item, index) => <button key={item.id} ref={node => { thumbnails.current[index] = node }}
            type="button" aria-label={`Ampliar referência: ${item.title}`} onClick={() => showReference(index)}
            className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition duration-200 hover:border-primary/70 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-1">
            <span className="relative block aspect-[4/3] w-full bg-white p-1.5">
              <img src={`/images/metricas/${item.id}.png`} alt="" width={item.width} height={item.height}
                decoding="async" className="h-full w-full object-contain" />
              <span className="absolute bottom-2 right-2 rounded-full bg-black/75 p-1.5 text-white transition group-hover:bg-primary group-hover:text-primary-foreground"><Expand className="h-3 w-3" aria-hidden="true" /></span>
            </span>
            <span className="flex flex-1 items-start gap-2 px-3 py-3">
              <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
              <span className="text-xs font-medium leading-relaxed group-hover:text-primary">{item.title}</span>
            </span>
          </button>)}
        </div>
        <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Entenda cada indicador em contexto. Os valores ilustram os cálculos e não representam metas ou garantias de resultado.</p>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button ref={backButton} type="button" variant="ghost" size="sm" onClick={showGallery}><ArrowLeft aria-hidden="true" />Todas as referências</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setZoomed(!zoomed)} aria-pressed={zoomed}
            aria-label={zoomed ? 'Ajustar imagem à tela' : 'Ver imagem no tamanho original'}>
            {zoomed ? <ZoomOut aria-hidden="true" /> : <ZoomIn aria-hidden="true" />}{zoomed ? 'Ajustar à tela' : 'Tamanho original'}
          </Button>
        </div>
        <figure className="min-w-0 space-y-4">
          <h3 className="text-lg font-semibold" aria-live="polite">{reference.title}</h3>
          <div ref={imageViewport} role={zoomed ? 'region' : undefined} aria-label={zoomed ? `Imagem ampliada: ${reference.title}` : undefined}
            tabIndex={zoomed ? 0 : undefined}
            className="mx-auto max-h-[55dvh] w-fit max-w-full overflow-auto rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-lenis-prevent>
            <button type="button" onClick={() => setZoomed(!zoomed)} tabIndex={-1}
              className={zoomed ? 'mx-auto block w-max max-w-none cursor-zoom-out' : 'flex w-full cursor-zoom-in justify-center'}>
              <img key={reference.id} src={`/images/metricas/${reference.id}.png`}
                alt={`Guia ilustrado: ${reference.title}. ${reference.description}`} width={reference.width} height={reference.height}
                decoding="async" draggable={false} className={zoomed ? 'block max-w-none' : 'block h-auto max-h-[55dvh] w-auto max-w-full object-contain'} />
            </button>
          </div>
          <figcaption className="text-sm leading-relaxed text-muted-foreground">{reference.description}</figcaption>
        </figure>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <a href={`/images/metricas/${reference.id}.png`} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Abrir imagem original<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Referência anterior" aria-keyshortcuts="ArrowLeft" disabled={selected === 0} onClick={() => showReference(selected! - 1)}><ChevronLeft aria-hidden="true" /></Button>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{selected! + 1} de 7</span>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Próxima referência" aria-keyshortcuts="ArrowRight" disabled={selected === references.length - 1} onClick={() => showReference(selected! + 1)}><ChevronRight aria-hidden="true" /></Button>
          </div>
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
