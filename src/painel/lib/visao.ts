// Derivações puras da Home: cada bloco recebe dados prontos e nunca consulta nada. Todas recebem as linhas que a
// hook de dados (useDashboardData) já buscou para o período escolhido; nenhuma lê relógio nem faz requisição.
import type { PontoDaSerie } from '../charts/SeriesChart'
import { chaveDaHora } from './tempo'

/** Venda aprovada do período (as colunas que a consulta do painel já traz). */
export interface VendaLinha {
  id: string
  nome_produto: string
  valor_venda: number
  created_at: string
}

/** Abordagem do período. `mostrou_ia` é a resposta obrigatória do formulário ("Mostrou a IA funcionando?"). */
export interface AbordagemLinha {
  id: string
  created_at: string
  mostrou_ia?: boolean
}

/** Item do feed ao vivo: o mais novo primeiro. */
export type AtividadeItem =
  | { tipo: 'venda'; chave: string; em: string; produto: string; valor: number }
  | { tipo: 'abordagem'; chave: string; em: string; mostrouIa: boolean }

const QUINZE_MIN = 15 * 60 * 1000
const UMA_HORA = 60 * 60 * 1000

const instanteValido = (iso: string) => Number.isFinite(Date.parse(iso))

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

/**
 * Vendas (área) e abordagens (linha) por hora de Brasília, série contínua. Rótulo "14h" ou "30/09 14h" quando a série
 * cruza dias. Usada quando o período é um dia só; nos períodos longos vale a série diária, mensal ou anual da hook.
 */
export function serieHoraria(vendas: AbordagemLinha[], abordagens: AbordagemLinha[]): PontoDaSerie[] {
  const validas = (linhas: AbordagemLinha[]) => linhas.filter((l) => instanteValido(l.created_at))
  const v = validas(vendas)
  const a = validas(abordagens)
  const contar = (linhas: AbordagemLinha[]) => {
    const mapa = new Map<string, number>()
    for (const l of linhas) {
      const h = chaveDaHora(l.created_at)
      mapa.set(h, (mapa.get(h) ?? 0) + 1)
    }
    return mapa
  }
  const porHoraVendas = contar(v)
  const porHoraAbordagens = contar(a)

  const horas = horasContinuas([...v, ...a].map((l) => Date.parse(l.created_at)))
  const variosDias = horas.length > 0 && horas[0].slice(0, 10) !== horas[horas.length - 1].slice(0, 10)
  return horas.map((hora) => {
    const [data, hh] = hora.split(' ')
    const [, mes, dia] = data.split('-')
    return {
      chave: hora,
      rotulo: variosDias ? `${dia}/${mes} ${hh}h` : `${hh}h`,
      principal: porHoraVendas.get(hora) ?? 0,
      secundaria: porHoraAbordagens.get(hora) ?? 0,
    }
  })
}

/** Série diária, mensal ou anual que a hook já calculou (buildDashboardSeries), no formato do gráfico. */
export function serieDaHook(vendasMes: Array<{ month: string; vendas: number; abordagens: number }>): PontoDaSerie[] {
  return vendasMes.map((p) => ({ chave: p.month, rotulo: p.month, principal: p.vendas, secundaria: p.abordagens }))
}

/** Sem nenhuma venda e nenhuma abordagem não há o que desenhar: vale o estado vazio, não uma linha de zeros. */
export const serieSemMovimento = (pontos: PontoDaSerie[]) => pontos.every((p) => p.principal === 0 && p.secundaria === 0)

/** Soma acumulada da série principal (o minigráfico do indicador em destaque). */
export function acumulado(pontos: PontoDaSerie[]): number[] {
  let soma = 0
  return pontos.map((p) => (soma += p.principal))
}

/** Registros com horário a partir de `agora − 1 h`. */
export function contarNaUltimaHora(linhas: AbordagemLinha[], agoraIso: string): number {
  const limite = Date.parse(agoraIso) - UMA_HORA
  let total = 0
  for (const l of linhas) if (Date.parse(l.created_at) >= limite) total++
  return total
}

/** Soma dos valores das vendas a partir de `agora − 1 h`. */
export function somarNaUltimaHora(vendas: VendaLinha[], agoraIso: string): number {
  const limite = Date.parse(agoraIso) - UMA_HORA
  let soma = 0
  for (const v of vendas) if (Date.parse(v.created_at) >= limite) soma += Number(v.valor_venda)
  return soma
}

/** Horário (ISO) do registro mais recente, ou null sem registros. */
export function ultimoInstante(linhas: AbordagemLinha[]): string | null {
  let melhor: string | null = null
  let melhorMs = -Infinity
  for (const l of linhas) {
    const ms = Date.parse(l.created_at)
    if (ms > melhorMs) {
      melhorMs = ms
      melhor = l.created_at
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

/** União de vendas e abordagens, do mais novo para o mais antigo, cortada em `limite`. */
export function montarAtividade(vendas: VendaLinha[], abordagens: AbordagemLinha[], limite = 9): AtividadeItem[] {
  const itens: AtividadeItem[] = [
    ...vendas.map((v): AtividadeItem => ({ tipo: 'venda', chave: `v${v.id}`, em: v.created_at, produto: v.nome_produto, valor: Number(v.valor_venda) })),
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
