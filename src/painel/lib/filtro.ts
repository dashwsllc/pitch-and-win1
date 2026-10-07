// Filtro do painel no endereço (?periodo=&de=&ate=): vale para a tela toda enquanto a pessoa está na visita.
// "30dias" é o padrão do painel e não é gravado: a Visão geral abre mostrando as vendas anteriores, não só as de hoje
// (aberta em "hoje", ela ficava zerada sempre que o dia ainda não tinha venda). "de" e "ate" são datas de Brasília
// (aaaa-mm-dd), só com "intervalo".
//
// Uma CARGA NOVA da página (abrir o site, recarregar com F5, endereço salvo ou colado) sempre começa nos últimos 30 dias,
// mesmo que o endereço traga um filtro de uma visita anterior (a pessoa escolheu "Hoje", recarregou e continuava vendo
// zeros). A escolha feita na tela continua valendo enquanto a pessoa navega, inclusive ao voltar pelo histórico.
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isValidDateKey } from '@/lib/brasilia-time'
import {
  createDefaultDashboardCustomRange,
  validateDashboardCustomRange,
  type DashboardCustomRange,
  type DashboardDateFilter,
} from '@/lib/dashboard-period'

export const FILTRO_PADRAO: DashboardDateFilter = '30dias'

const PARA_ENDERECO: Record<DashboardDateFilter, string> = {
  hoje: 'hoje',
  ontem: 'ontem',
  '7dias': '7dias',
  '14dias': '14dias',
  '30dias': '30dias',
  all: 'tudo',
  custom: 'intervalo',
}
const DO_ENDERECO = Object.fromEntries(Object.entries(PARA_ENDERECO).map(([filtro, endereco]) => [endereco, filtro])) as Record<string, DashboardDateFilter>

export interface FiltroUrl {
  periodo: DashboardDateFilter
  de: string
  ate: string
}

export function lerFiltro(params: URLSearchParams): FiltroUrl {
  const bruto = params.get('periodo')
  const de = params.get('de') ?? ''
  const ate = params.get('ate') ?? ''
  return {
    periodo: bruto && DO_ENDERECO[bruto] ? DO_ENDERECO[bruto] : FILTRO_PADRAO,
    de: isValidDateKey(de) ? de : '',
    ate: isValidDateKey(ate) ? ate : '',
  }
}

/** Grava o filtro sem apagar os outros parâmetros do endereço. */
export function escreverFiltro(atual: URLSearchParams, f: FiltroUrl): URLSearchParams {
  const p = new URLSearchParams(atual)
  for (const chave of ['periodo', 'de', 'ate']) p.delete(chave)
  if (f.periodo !== FILTRO_PADRAO) p.set('periodo', PARA_ENDERECO[f.periodo])
  if (f.periodo === 'custom' && f.de) p.set('de', f.de)
  if (f.periodo === 'custom' && f.ate) p.set('ate', f.ate)
  return p
}

/** O intervalo que a hook de dados usa: o do endereço ou, sem ele, os últimos 7 dias (como o painel antigo). */
export function intervaloDoFiltro(f: FiltroUrl): DashboardCustomRange {
  const padrao = createDefaultDashboardCustomRange()
  return { start: f.de || padrao.start, end: f.ate || padrao.end }
}

export const filtroAtivo = (f: FiltroUrl) => f.periodo !== FILTRO_PADRAO

const FILTRO_INICIAL: FiltroUrl = { periodo: FILTRO_PADRAO, de: '', ate: '' }

// Vira verdadeiro depois que a Home pinta pela primeira vez nesta carga da página. O módulo só é carregado de novo numa carga
// nova, então navegar para outra tela e voltar não reinicia o filtro; recarregar a página sim.
let filtroJaLidoNestaCarga = false

export function useFiltroPainel() {
  const [params, setParams] = useSearchParams()
  const [reiniciar, setReiniciar] = useState(() => !filtroJaLidoNestaCarga && filtroAtivo(lerFiltro(params)))
  // Marcado depois da pintura (não na renderização: uma renderização interrompida e refeita não pode gastar a "primeira vez").
  useLayoutEffect(() => {
    filtroJaLidoNestaCarga = true
  }, [])
  // Na primeira pintura o endereço é ignorado (nada é buscado com o filtro velho) e logo depois é limpo.
  const valor = useMemo(() => (reiniciar ? FILTRO_INICIAL : lerFiltro(params)), [params, reiniciar])
  useLayoutEffect(() => {
    if (reiniciar) setParams((p) => escreverFiltro(p, FILTRO_INICIAL), { replace: true })
  }, [reiniciar, setParams])
  // Só volta a ler o endereço depois que ele já está limpo: nenhuma pintura intermediária com o filtro velho.
  useLayoutEffect(() => {
    if (reiniciar && !filtroAtivo(lerFiltro(params))) setReiniciar(false)
  }, [reiniciar, params])
  const intervalo = useMemo(() => intervaloDoFiltro(valor), [valor])
  // Um intervalo inválido no endereço não filtra (a hook cai nos últimos 7 dias) e é dito na tela, nunca em silêncio.
  const erro = valor.periodo === 'custom' ? validateDashboardCustomRange(intervalo) : null
  const mudar = useCallback(
    (parcial: Partial<FiltroUrl>) => setParams((p) => escreverFiltro(p, { ...lerFiltro(p), ...parcial }), { replace: true }),
    [setParams],
  )
  const limpar = useCallback(() => setParams((p) => escreverFiltro(p, { periodo: FILTRO_PADRAO, de: '', ate: '' }), { replace: true }), [setParams])
  return { valor, intervalo, erro, mudar, limpar, ativo: filtroAtivo(valor) }
}
