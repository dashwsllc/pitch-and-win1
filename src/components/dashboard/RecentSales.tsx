import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useSalesBoard } from '@/hooks/useSalesBoard'
import { useAuth } from '@/hooks/useAuth'
import { exactDate, money } from '@/lib/sales'

export function RecentSales() {
  const { data, isLoading, isError } = useSalesBoard('aprovada', '', 0, 10)
  const { user } = useAuth()
  const rail = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(true)
  const sales = data?.items ?? []
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!rail.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 })
    observer.observe(rail.current)
    return () => observer.disconnect()
  }, [isLoading])
  useEffect(() => {
    if (paused || hovered || focused || reducedMotion || !visible || sales.length < 2) return
    const timer = setInterval(() => {
      const el = rail.current
      if (!el || document.hidden || el.scrollWidth <= el.clientWidth) return
      const next = el.scrollLeft + 300
      el.scrollTo({ left: el.scrollLeft >= el.scrollWidth - el.clientWidth - 8 ? 0 : next, behavior: 'smooth' })
    }, 5000)
    return () => clearInterval(timer)
  }, [paused, hovered, focused, reducedMotion, visible, sales.length])
  const move = (direction: number) => {
    setPaused(true)
    rail.current?.scrollBy({ left: direction * 300, behavior: reducedMotion ? 'instant' : 'smooth' })
  }
  return (
    <section className="surface-panel overflow-hidden rounded-2xl" aria-label="Últimas dez vendas aprovadas" aria-roledescription="carrossel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
        <div><p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-ember">Cada conquista move o time</p><h2 className="flex items-center gap-2 text-lg font-medium text-white"><Trophy className="h-4 w-4 text-amber-300" />Últimas vendas</h2><p className="mt-1 text-xs text-muted-foreground">As 10 aprovações mais recentes. Quem será o próximo?</p></div>
        <div className="flex items-center gap-1"><Button asChild variant="ghost" size="sm" className="mr-1 text-xs"><Link to="/ranking">Ranking <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPaused(p => !p)} disabled={reducedMotion || sales.length<2} aria-label={paused ? 'Reproduzir últimas vendas' : 'Pausar últimas vendas'}>{paused || reducedMotion ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</Button><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(-1)} aria-label="Vendas anteriores"><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(1)} aria-label="Próximas vendas"><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
      {isError && <p role="alert" className="px-6 pb-3 text-xs text-rose-300">Atualização indisponível. Tentaremos novamente automaticamente.</p>}
      <div ref={rail} tabIndex={0} aria-label="Arraste para ver as últimas vendas" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }} onTouchStart={() => setPaused(true)} data-lenis-prevent className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-5 sm:px-6">
        {isLoading ? [1,2,3].map(i => <div key={i} className="h-40 w-72 shrink-0 animate-pulse rounded-xl bg-white/[0.03]" />)
          : sales.length===0 && !isError ? <div className="w-full rounded-xl border border-dashed border-white/[0.08] py-8 text-center text-sm text-muted-foreground">A primeira venda aprovada abre a competição.</div>
          : sales.map((sale,index) => <article key={sale.id} aria-label={`${index+1} de ${sales.length}: ${sale.seller_name}`} className="relative w-[280px] shrink-0 snap-start overflow-hidden rounded-xl bg-white/[0.025] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ember/50 to-transparent" /><div className="mb-3 flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ember/10 text-xs font-medium text-ember">{sale.seller_name.split(' ').map(n => n[0]).join('').slice(0,2)}</div><div className="min-w-0"><p className="truncate text-sm font-medium text-ash">{sale.seller_name}</p><p className="text-[9px] uppercase tracking-wider text-muted-foreground">{sale.user_id===user?.id ? 'Sua conquista' : 'Venda confirmada'}</p></div><Trophy className="ml-auto h-3.5 w-3.5 text-amber-300/60" /></div>
            <p className="text-2xl font-light tracking-tight text-white">{money(sale.valor_venda)}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={sale.nome_produto}>{sale.nome_produto}</p><p className="mt-4 border-t border-white/[0.05] pt-3 text-[10px] text-muted-foreground">{sale.reviewed_at ? 'Aprovada' : 'Registrada'} em <time dateTime={sale.reviewed_at || sale.created_at} title={sale.reviewed_at || sale.created_at}>{exactDate(sale.reviewed_at || sale.created_at)}</time> · BRT</p>
          </article>)}
      </div>
    </section>
  )
}
