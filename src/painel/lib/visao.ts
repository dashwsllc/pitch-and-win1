// Derivações puras da Home: cada bloco recebe dados prontos e nunca consulta nada. Todas recebem as linhas que a
// hook de dados (useDashboardData) já buscou para o período escolhido; nenhuma lê relógio nem faz requisição.
import { brasiliaDateKey, isValidDateKey } from '@/lib/brasilia-time'
import { buildDashboardSeries, type ResolvedDashboardPeriod } from '@/lib/dashboard-period'
import type { PontoDaSerie } from '../charts/SeriesChart'
import { chaveDaHora } from './tempo'

/** Venda aprovada do período (as colunas que a consulta do painel já traz). */
export interface VendaLinha {
  id: string
  nome_produto: string
  valor_venda: number
  /** Quando foi comprada: é ela que define o período dos totais e dos gráficos. */
  created_at: string
  /** Quando o executivo aprovou. Vazia só em registro antigo, importado sem revisão: vale a hora da compra. */
  reviewed_at?: string | null
}

/** Abordagem do período. `mostrou_ia` é a resposta obrigatória do formulário ("Mostrou a IA funcionando?"). */
export interface AbordagemLinha {
  id: string
  created_at: string
  mostrou_ia?: boolean
}

/** Call feita no período (concluída no CRM, sem cancelamento) e o momento em que ela aconteceu (momentoDaCall). */
export interface CallLinha {
  id: string
  feita_em: string
}

/**
 * Item do feed ao vivo: o mais novo primeiro. Numa venda, `em` é a hora da aprovação (o que aconteceu agora) e
 * `compraEm` só existe quando a compra foi em outro dia.
 */
export type AtividadeItem =
  | { tipo: 'venda'; chave: string; em: string; produto: string; valor: number; compraEm?: string }
  | { tipo: 'abordagem'; chave: string; em: string; mostrouIa: boolean }

const QUINZE_MIN = 15 * 60 * 1000
const UMA_HORA = 60 * 60 * 1000

const instanteValido = (iso: string) => Number.isFinite(Date.parse(iso))

/** Um registro com hora: venda (compra e, depois, aprovação) ou abordagem (só a hora do registro). */
interface Datado {
  created_at: string
  reviewed_at?: string | null
}

/**
 * Quando o registro "aconteceu" para os sinais ao vivo (feed, "na última hora", "última às"): a aprovação, se a venda
 * já foi aprovada, senão a hora do registro. O período dos totais e dos gráficos continua sendo o da compra
 * (created_at); só o que a tela anuncia como "agora" segue a aprovação.
 */
export function instanteDoRegistro(l: Datado): string {
  return l.reviewed_at && instanteValido(l.reviewed_at) ? l.reviewed_at : l.created_at
}

/**
 * Quando uma call concluída aconteceu: a hora marcada (scheduled_at); se ela foi fechada antes disso (um repasse
 * antecipado, por exemplo), a hora do fechamento (completed_at). Nunca cai no futuro, porque o fechamento já aconteceu.
 */
export function momentoDaCall(call: { scheduled_at: string | null; completed_at: string | null }): string | null {
  const instantes = [call.scheduled_at, call.completed_at].filter((v): v is string => typeof v === 'string' && instanteValido(v))
  if (instantes.length === 0) return null
  return instantes.reduce((cedo, v) => (Date.parse(v) < Date.parse(cedo) ? v : cedo))
}

/** As calls concluídas cujo momento (momentoDaCall) cai no período, na forma que os gráficos usam. */
export function callsDoPeriodo(
  linhas: Array<{ id: string; scheduled_at: string | null; completed_at: string | null }>,
  periodo: ResolvedDashboardPeriod,
): CallLinha[] {
  const calls: CallLinha[] = []
  for (const l of linhas) {
    const feitaEm = momentoDaCall(l)
    if (feitaEm === null) continue
    const ms = Date.parse(feitaEm)
    if (!periodo.allTime && (ms < periodo.start!.getTime() || ms >= periodo.end!.getTime())) continue
    calls.push({ id: l.id, feita_em: feitaEm })
  }
  return calls
}

/**
 * Horas contínuas (no fuso de Brasília) entre o primeiro e o último instante, inclusive as sem evento.
 * Percorre o intervalo em passos de 15 minutos e anota a hora local de cada passo.
 */
export function horasContinuas(instantes: number[]): string[] {
  if (instantes.length === 0) return []
  let inicio = Infinity
  let fim = -Infinity
  for (const ms of instantes) {
    if (ms < inicio) inicio = ms
    if (ms > fim) fim = ms
  }
  const horas: string[] = []
  const adicionar = (ms: number) => {
    const h = chaveDaHora(ms)
    if (horas[horas.length - 1] !== h) horas.push(h)
  }
  for (let ms = inicio; ms < fim; ms += QUINZE_MIN) adicionar(ms)
  adicionar(fim)
  return horas
}

/** Um intervalo dos gráficos da Home, com tudo o que eles mostram contado sobre as mesmas linhas dos totais. */
export interface IntervaloDoPainel {
  /** 'yyyy-MM-dd HH' (por hora) ou o rótulo do dia, mês ou ano. */
  chave: string
  /** '14h', '30/09 14h', '30/09', 'set 26', '2026'. */
  rotulo: string
  vendas: number
  abordagens: number
  /** Abordagens do intervalo em que a IA foi mostrada (as demais não mostraram). */
  mostrou: number
  calls: number
}

/**
 * A linha do tempo de todos os gráficos da Home, a mesma para todos. Num dia só, as horas de Brasília entre o primeiro e
 * o último registro (vendas, abordagens ou calls), sem pular as vazias; nos períodos longos, os dias, meses ou anos de
 * buildDashboardSeries, a mesma função da série que o painel antigo desenhava. Em "todo o período" o primeiro e o último
 * dia saem de TODOS os registros, para nenhuma call ficar fora. Sem registro nenhum, [] (os gráficos mostram a moldura).
 */
export function montarIntervalos(
  periodo: ResolvedDashboardPeriod,
  porHora: boolean,
  vendas: AbordagemLinha[],
  abordagens: AbordagemLinha[],
  calls: CallLinha[],
): IntervaloDoPainel[] {
  const v = vendas.filter((l) => instanteValido(l.created_at))
  const a = abordagens.filter((l) => instanteValido(l.created_at))
  const comIa = a.filter((l) => l.mostrou_ia === true)
  // As calls na forma de registro datado (created_at = quando aconteceram), para as mesmas contas das outras linhas.
  const c = calls.filter((l) => instanteValido(l.feita_em)).map((l) => ({ id: l.id, created_at: l.feita_em }))
  if (v.length + a.length + c.length === 0) return []

  if (porHora) {
    const contar = (linhas: Array<{ created_at: string }>) => {
      const mapa = new Map<string, number>()
      for (const l of linhas) {
        const h = chaveDaHora(l.created_at)
        mapa.set(h, (mapa.get(h) ?? 0) + 1)
      }
      return mapa
    }
    const [porVendas, porAbordagens, porIa, porCalls] = [v, a, comIa, c].map(contar)
    const horas = horasContinuas([...v, ...a, ...c].map((l) => Date.parse(l.created_at)))
    const variosDias = horas[0].slice(0, 10) !== horas[horas.length - 1].slice(0, 10)
    return horas.map((hora) => {
      const [data, hh] = hora.split(' ')
      const [, mes, dia] = data.split('-')
      return {
        chave: hora,
        rotulo: variosDias ? `${dia}/${mes} ${hh}h` : `${hh}h`,
        vendas: porVendas.get(hora) ?? 0,
        abordagens: porAbordagens.get(hora) ?? 0,
        mostrou: porIa.get(hora) ?? 0,
        calls: porCalls.get(hora) ?? 0,
      }
    })
  }

  let fixo = periodo
  if (periodo.allTime) {
    const dias = [...v, ...a, ...c].map((l) => brasiliaDateKey(l.created_at)).filter(isValidDateKey).sort()
    fixo = { ...periodo, startKey: dias[0], endKey: dias[dias.length - 1] }
  }
  const base = buildDashboardSeries(v, a, fixo)
  const ia = buildDashboardSeries([], comIa, fixo)
  const feitas = buildDashboardSeries([], c, fixo)
  return base.map((p, i) => ({
    chave: p.month,
    rotulo: p.month,
    vendas: p.vendas,
    abordagens: p.abordagens,
    mostrou: ia[i]?.abordagens ?? 0,
    calls: feitas[i]?.abordagens ?? 0,
  }))
}

/**
 * Pontos do gráfico de abordagens e calls: as calls feitas na área (a medida mais funda do funil) e as abordagens na
 * linha. Sem calls nem abordagens (só vendas), [] e o gráfico fica na moldura vazia, nunca numa linha de zeros.
 */
export function serieDeCalls(intervalos: IntervaloDoPainel[]): PontoDaSerie[] {
  if (intervalos.every((p) => p.calls === 0 && p.abordagens === 0)) return []
  return intervalos.map((p) => ({ chave: p.chave, rotulo: p.rotulo, principal: p.calls, secundaria: p.abordagens }))
}


/** Registros que aconteceram a partir de `agora − 1 h` (numa venda, a aprovação: ver instanteDoRegistro). */
export function contarNaUltimaHora(linhas: Datado[], agoraIso: string): number {
  const limite = Date.parse(agoraIso) - UMA_HORA
  let total = 0
  for (const l of linhas) if (Date.parse(instanteDoRegistro(l)) >= limite) total++
  return total
}

/** Soma dos valores das vendas aprovadas a partir de `agora − 1 h`. */
export function somarNaUltimaHora(vendas: VendaLinha[], agoraIso: string): number {
  const limite = Date.parse(agoraIso) - UMA_HORA
  let soma = 0
  for (const v of vendas) if (Date.parse(instanteDoRegistro(v)) >= limite) soma += Number(v.valor_venda)
  return soma
}

/** Horário (ISO) do registro mais recente (numa venda, o da aprovação), ou null sem registros. */
export function ultimoInstante(linhas: Datado[]): string | null {
  let melhor: string | null = null
  let melhorMs = -Infinity
  for (const l of linhas) {
    const instante = instanteDoRegistro(l)
    const ms = Date.parse(instante)
    if (ms > melhorMs) {
      melhorMs = ms
      melhor = instante
    }
  }
  return melhor
}

/**
 * As abordagens do período repartidas pela demonstração da IA (a barra dividida do indicador). As duas partes somam
 * sempre o total de abordagens que o painel antigo já contava.
 */
export function dividirAbordagens(abordagens: AbordagemLinha[]): { mostrou: number; naoMostrou: number } {
  let mostrou = 0
  for (const a of abordagens) if (a.mostrou_ia === true) mostrou++
  return { mostrou, naoMostrou: abordagens.length - mostrou }
}

export type Passo = 'hora' | 'dia' | 'mês' | 'ano'

/** O passo dos intervalos, para as legendas: hora num dia só; nos longos, pelo rótulo que a hook escreveu. */
export function passoDaSerie(serie: Array<{ rotulo: string }>, porHora: boolean): Passo {
  if (porHora) return 'hora'
  const rotulo = serie[0]?.rotulo ?? ''
  if (/^\d{2}\/\d{2}$/.test(rotulo)) return 'dia'
  if (/^\d{4}$/.test(rotulo)) return 'ano'
  return 'mês'
}

/** A venda como item do feed: na hora da aprovação, dizendo quando foi a compra se ela foi em outro dia. */
function eventoDeVenda(v: VendaLinha): AtividadeItem {
  const em = instanteDoRegistro(v)
  const item: AtividadeItem = { tipo: 'venda', chave: `v${v.id}`, em, produto: v.nome_produto, valor: Number(v.valor_venda) }
  if (instanteValido(v.created_at) && instanteValido(em) && brasiliaDateKey(v.created_at) !== brasiliaDateKey(em)) item.compraEm = v.created_at
  return item
}

/**
 * União de vendas e abordagens, do mais novo para o mais antigo, cortada em `limite`. As vendas entram pela hora da
 * aprovação, e `compradasAntes` (aprovadas no período, mas compradas antes dele) também: aprovar é um acontecimento
 * de agora, seja qual for o dia da compra. A mesma venda nas duas listas aparece uma vez.
 */
export function montarAtividade(vendas: VendaLinha[], abordagens: AbordagemLinha[], limite = 9, compradasAntes: VendaLinha[] = []): AtividadeItem[] {
  const vendasDoFeed = new Map<string, VendaLinha>()
  for (const v of [...vendas, ...compradasAntes]) vendasDoFeed.set(v.id, v)
  const itens: AtividadeItem[] = [
    ...[...vendasDoFeed.values()].map(eventoDeVenda),
    ...abordagens.map((a): AtividadeItem => ({ tipo: 'abordagem', chave: `a${a.id}`, em: a.created_at, mostrouIa: a.mostrou_ia === true })),
  ].filter((i) => instanteValido(i.em))
  return itens.sort((x, y) => Date.parse(y.em) - Date.parse(x.em) || (x.chave < y.chave ? 1 : -1)).slice(0, limite)
}

/** Produtos mais vendidos no formato das barras: a fração é a parte da receita do período. */
export function barrasDeProdutos(
  produtos: Array<{ nome: string; quantidade: number; valor: number }>,
  receitaTotal: number,
): Array<{ chave: string; nome: string; quantidade: number; valor: number; fracao: number | null }> {
  return produtos.map((p) => ({
    chave: p.nome,
    nome: p.nome,
    quantidade: p.quantidade,
    valor: p.valor,
    fracao: receitaTotal > 0 ? p.valor / receitaTotal : null,
  }))
}
