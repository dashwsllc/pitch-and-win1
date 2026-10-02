// Filtro do painel no endereço (?periodo=&de=&ate=): vale para a tela toda e acompanha o link compartilhado.
// "hoje" é o padrão do painel e não é gravado. "de" e "ate" são datas de Brasília (aaaa-mm-dd), só com "intervalo".
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isValidDateKey } from '@/lib/brasilia-time'
import {
  createDefaultDashboardCustomRange,
  validateDashboardCustomRange,
  type DashboardCustomRange,
  type DashboardDateFilter,
} from '@/lib/dashboard-period'

export const FILTRO_PADRAO: DashboardDateFilter = 'hoje'

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

export function useFiltroPainel() {
  const [params, setParams] = useSearchParams()
  const valor = useMemo(() => lerFiltro(params), [params])
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
