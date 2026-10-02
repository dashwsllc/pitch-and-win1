import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChartSplineIcon,
  CircleDollarSignIcon,
  MedalIcon,
  MessageSquareTextIcon,
  PercentIcon,
  ShoppingBagIcon,
  TargetIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useDailyGoals, useBrasiliaToday } from '@/hooks/useGoals'
import { useProfile } from '@/hooks/useProfile'
import { useRankingDataWithMock } from '@/hooks/useRankingDataWithMock'
import { useRoles } from '@/hooks/useRoles'
import { resolveDashboardPeriod } from '@/lib/dashboard-period'
import { refreshDashboardData } from '@/lib/sync'
import { Cabecalho } from '@/painel/components/Cabecalho'
import { ChecklistDoDia } from '@/painel/components/ChecklistDoDia'
import { FeedAoVivo } from '@/painel/components/FeedAoVivo'
import { FiltroPainel } from '@/painel/components/FiltroPainel'
import { Iniciais } from '@/painel/components/Iniciais'
import { LegendaDaDivisao } from '@/painel/components/LegendaDaDivisao'
import { Bloco, KpiCard } from '@/painel/components/KpiCard'
import { LinkSecao } from '@/painel/components/LinkSecao'
import { MetasDeTurno } from '@/painel/components/MetasDeTurno'
import { NumeroAnimado } from '@/painel/components/NumeroAnimado'
import { Podio } from '@/painel/components/Podio'
import { UltimasVendas } from '@/painel/components/UltimasVendas'
import { VendasDoTime } from '@/painel/components/VendasDoTime'
import { Barras } from '@/painel/charts/Barras'
import { ColunasKpi } from '@/painel/charts/ColunasKpi'
import { RingGauge } from '@/painel/charts/RingGauge'
import { formatarNumero } from '@/painel/charts/scale'
import { SeriesChart } from '@/painel/charts/SeriesChart'
import { useAgora } from '@/painel/hooks/relogio'
import { useStatusAoVivo } from '@/painel/hooks/statusAoVivo'
import { PainelLayout } from '@/painel/layout/PainelLayout'
import { ACAO_DO_BLOCO } from '@/painel/lib/estilos'
import { useFiltroPainel } from '@/painel/lib/filtro'
import { emCentavos, formatarCentavos, formatarPercentual, formatarReais, formatarReaisInteiros, pluralizar } from '@/painel/lib/formatar'
import { formatarHoraMinuto } from '@/painel/lib/tempo'
import {
  barrasDeProdutos,
  contarNaUltimaHora,
  dividirAbordagens,
  dividirSerie,
  montarAtividade,
  passoDaSerie,
  serieDaHook,
  serieHoraria,
  serieSemMovimento,
  somarNaUltimaHora,
  ultimoInstante,
} from '@/painel/lib/visao'

// Dinheiro tem 10 a 15 caracteres: num cartão de 3 colunas o valor encolhe com a janela em vez de vazar.
const VALOR_EM_REAIS = 'text-[clamp(1.5rem,2.1vw,2.25rem)]'

/**
 * Home: "Visão geral", na grade da referência; os indicadores formam a seção "Indicadores comerciais". Lê a mesma camada de dados do painel antigo
 * (useDashboardData, ranking, metas e vendas do time, todos atualizados pelo DataSync) e só compõe: cada bloco recebe
 * dados prontos. O período vale para os blocos de vendas e abordagens; ranking, metas e vendas do time têm janela
 * própria, dita na barra de filtros e na descrição de cada bloco.
 */
export default function Dashboard() {
  const filtro = useFiltroPainel()
  const { user } = useAuth()
  const { profile } = useProfile()
  const { isExecutive } = useRoles()
  const today = useBrasiliaToday()
  const queryClient = useQueryClient()
  const navegar = useNavigate()
  const agora = useAgora()
  const status = useStatusAoVivo()
  const { metrics, rows, loading, fetching, error, updatedAt, generation, loadedPeriod, refetch } = useDashboardData(filtro.valor.periodo, filtro.intervalo)
  const { ranking, sdrRanking, loading: carregandoRanking, error: erroRanking } = useRankingDataWithMock()
  const metas = useDailyGoals()

  const nomeCompleto = profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Usuário'
  const primeiroNome = nomeCompleto.split(' ')[0]

  const posicaoCloser = ranking.findIndex((r) => r.isCurrentUser) + 1
  const posicaoSdr = sdrRanking.findIndex((r) => r.isCurrentUser) + 1
  const posicao = posicaoCloser || posicaoSdr
  const rotuloDoRanking = posicaoCloser ? 'Closers' : posicaoSdr ? 'SDRs' : ''
  const tamanhoDoRanking = posicaoCloser ? ranking.length : sdrRanking.length

  // O recorte dos números que estão na tela (enquanto o filtro novo carrega, ainda o anterior): um dia só vira série
  // por hora; o que não inclui o momento atual não tem "última hora".
  const { periodo, umDiaSo, incluiAgora } = useMemo(() => {
    const periodo = loadedPeriod ?? resolveDashboardPeriod(filtro.valor.periodo, filtro.intervalo)
    const agoraMs = Date.parse(agora)
    return {
      periodo,
      umDiaSo: !periodo.allTime && periodo.startKey === periodo.endKey,
      incluiAgora: periodo.allTime || (periodo.start!.getTime() <= agoraMs && periodo.end!.getTime() > agoraMs),
    }
  }, [loadedPeriod, filtro.valor.periodo, filtro.intervalo, agora])

  // Tudo abaixo sai das mesmas linhas que deram os totais (rows e metrics chegam juntos, na mesma carga).
  const serie = useMemo(() => {
    const pontos = umDiaSo ? serieHoraria(rows.vendas, rows.abordagens) : serieDaHook(metrics.vendasMes)
    return serieSemMovimento(pontos) ? [] : pontos
  }, [umDiaSo, rows, metrics.vendasMes])
  // Os gráficos dos indicadores usam os mesmos intervalos do gráfico grande; o das abordagens, com a divisão pela IA.
  const serieDividida = useMemo(() => dividirSerie(serie, umDiaSo, rows.vendas, rows.abordagens, periodo), [serie, umDiaSo, rows, periodo])
  const passo = passoDaSerie(serie, umDiaSo)
  const naUltimaHora = useMemo(() => contarNaUltimaHora(rows.vendas, agora), [rows.vendas, agora])
  const receitaNaUltimaHora = useMemo(() => somarNaUltimaHora(rows.vendas, agora), [rows.vendas, agora])
  const ultimaVenda = useMemo(() => ultimoInstante(rows.vendas), [rows.vendas])
  const divisao = useMemo(() => dividirAbordagens(rows.abordagens), [rows.abordagens])
  const atividade = useMemo(() => montarAtividade(rows.vendas, rows.abordagens), [rows])
  const produtos = useMemo(() => barrasDeProdutos(metrics.produtosMaisVendidos, metrics.totalVendas), [metrics.produtosMaisVendidos, metrics.totalVendas])
  const linhasDoPodio = useMemo(
    () => ranking.slice(0, 6).map((r, i) => ({ posicao: i + 1, chave: r.user_id, nome: r.name, total: r.totalVendas, vendas: r.quantidadeVendas })),
    [ranking],
  )

  const primeiraCarga = loading && updatedAt === null && !error
  // A carga inicial falhou e não há números para mostrar: nada de zeros que parecem dados.
  const falhouAntesDeCarregar = !loading && updatedAt === null && error !== null
  // Troca de filtro: os números anteriores ficam na tela, só mais discretos, até os novos chegarem.
  const recarregando = loading && updatedAt !== null
  const esmaecer = recarregando ? 'painel-recarregando' : ''

  const conversao = metrics.abordagens > 0 ? metrics.conversao : null
  const tarefas = metas.tasks
  const tarefasConcluidas = tarefas.filter((t) => t.is_completed).length
  const progressoDasTarefas = tarefas.length ? Math.round((tarefasConcluidas / tarefas.length) * 100) : 0

  return (
    <PainelLayout
      status={status}
      atualizadoEm={updatedAt}
      recarregando={fetching}
      erro={updatedAt !== null ? error : null}
      onAtualizar={() => void refreshDashboardData(queryClient)}
    >
      <Cabecalho nome={primeiroNome} escopo={isExecutive ? 'visão consolidada do time' : 'somente os seus números'} />
      <FiltroPainel valor={filtro.valor} intervalo={filtro.intervalo} erro={filtro.erro} ativo={filtro.ativo} onMudar={filtro.mudar} onLimpar={filtro.limpar} />

      {primeiraCarga && (
        <div role="status" aria-live="polite" className="flex min-h-[40dvh] items-center justify-center">
          <span className="size-7 rounded-full border-[3px] border-muted border-t-foreground motion-safe:animate-spin" aria-hidden="true" />
          <span className="sr-only">Carregando os indicadores…</span>
        </div>
      )}

      {falhouAntesDeCarregar && (
        <div role="alert" className="flex min-h-[40dvh] flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-lg font-semibold text-heading">Não foi possível carregar os indicadores</p>
          <p className="text-sm text-muted-foreground">{error}.</p>
          <Button variant="outline" size="sm" className={`mt-2 ${ACAO_DO_BLOCO}`} onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {/* Montada desde o começo: as consultas dos blocos independentes saem em paralelo com a das métricas. */}
      <div aria-busy={recarregando} className={`${primeiraCarga || falhouAntesDeCarregar ? 'hidden' : 'grid'} gap-4 md:grid-cols-2 xl:grid-cols-12`}>
        <section data-dashboard-section="commercial-indicators" aria-label="Indicadores comerciais" className="contents">
          {/* Linha 1 da referência: destaque · barra dividida · taxa · meta (5 · 3 · 2 · 2). */}
          <KpiCard
            destaque
            rotulo="Quantidade de Vendas"
            icone={ShoppingBagIcon}
            valor={<NumeroAnimado valor={metrics.quantidadeVendas} />}
            detalhe={
              incluiAgora ? (
                <>
                  <strong className="font-semibold text-heading">+{formatarNumero(naUltimaHora)}</strong> na última hora
                  {ultimaVenda && <> · última às {formatarHoraMinuto(ultimaVenda)}</>}
                </>
              ) : ultimaVenda ? (
                <>Negócios confirmados · última às {formatarHoraMinuto(ultimaVenda)}</>
              ) : (
                <>Negócios confirmados</>
              )
            }
            className={`md:col-span-2 xl:col-span-5 ${esmaecer}`}
          >
            <div className="mt-4">
              <ColunasKpi
                colunas={serie.map((p) => ({ chave: p.chave, rotulo: p.rotulo, partes: [p.principal] }))}
                series={[{ nome: 'vendas', cor: 'viz-1', ponto: 'bg-viz-1' }]}
                unidade={['venda', 'vendas']}
                passo={passo}
                resumo={`Vendas por ${passo}`}
                vazio="Sem vendas no período."
                media
                acumulado
              />
            </div>
          </KpiCard>
          <KpiCard rotulo="Abordagens" icone={UsersRoundIcon} valor={<NumeroAnimado valor={metrics.abordagens} />} className={`xl:col-span-3 ${esmaecer}`}>
            {/* Altura maior que a das vendas: o número é menor, e assim as duas molduras terminam alinhadas no xl. */}
            <div className="mt-4">
              <ColunasKpi
                colunas={serieDividida.map((p) => ({ chave: p.chave, rotulo: p.rotulo, partes: [p.mostrou, p.abordagens - p.mostrou] }))}
                series={[
                  { nome: 'mostraram a IA', cor: 'viz-1', ponto: 'bg-viz-1' },
                  { nome: 'não mostraram', cor: 'viz-2', ponto: 'bg-viz-2' },
                ]}
                unidade={['abordagem', 'abordagens']}
                passo={passo}
                resumo={`Abordagens por ${passo}`}
                vazio="Sem abordagens no período."
                altura={152}
              />
              <LegendaDaDivisao
                partes={[
                  { rotulo: 'Mostrou a IA', valor: divisao.mostrou },
                  { rotulo: 'Não mostrou', valor: divisao.naoMostrou },
                ]}
              />
            </div>
          </KpiCard>
          <KpiCard
            rotulo="Conversão"
            icone={PercentIcon}
            valor={conversao === null ? '—' : formatarPercentual(conversao)}
            detalhe={`${pluralizar(metrics.quantidadeVendas, 'venda', 'vendas')} para ${pluralizar(metrics.abordagens, 'abordagem', 'abordagens')}`}
            lateral={
              conversao !== null && (
                <RingGauge fracao={Math.min(1, conversao / 100)} rotulo="Vendas por abordagem">
                  <UsersRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </RingGauge>
              )
            }
            className={`xl:col-span-2 ${esmaecer}`}
          />
          <KpiCard
            rotulo="Meta do dia"
            icone={TargetIcon}
            valor={metas.error ? '—' : <NumeroAnimado valor={tarefasConcluidas} />}
            detalhe={
              metas.loading ? 'Carregando…' : metas.error ? 'Metas indisponíveis agora' : tarefas.length ? `${progressoDasTarefas}% das tarefas de hoje` : 'Sem tarefas hoje'
            }
            lateral={
              !metas.error && (
                <RingGauge fracao={tarefas.length ? tarefasConcluidas / tarefas.length : 0} rotulo={`${tarefasConcluidas} de ${tarefas.length} tarefas do dia concluídas`}>
                  <span className="text-base font-semibold tabular-nums text-heading">{tarefasConcluidas}</span>
                  <span className="text-[10px] text-muted-foreground">de {tarefas.length}</span>
                </RingGauge>
              )
            }
            className="md:col-span-2 xl:col-span-2"
          >
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              {tarefas.length
                ? 'Cada tarefa concluída avança a meta do dia. O checklist completo está logo abaixo.'
                : 'O Executive pode cadastrar o checklist do dia em Metas.'}
            </p>
          </KpiCard>

          {/* Os outros indicadores do painel antigo, numa segunda linha (6 · 3 · 3). */}
          <KpiCard
            rotulo="Total de Vendas"
            icone={CircleDollarSignIcon}
            valor={<NumeroAnimado valor={emCentavos(metrics.totalVendas)} formatar={formatarCentavos} />}
            detalhe={
              <>
                Receita aprovada no período
                {incluiAgora && metrics.quantidadeVendas > 0 && (
                  <>
                    {' · '}
                    <strong className="font-semibold text-heading">+{formatarReais(receitaNaUltimaHora)}</strong> na última hora
                  </>
                )}
              </>
            }
            className={`md:col-span-2 xl:col-span-6 ${esmaecer}`}
          />
          <KpiCard
            rotulo="Ticket Médio"
            icone={ChartSplineIcon}
            valor={<NumeroAnimado valor={emCentavos(metrics.ticketMedio)} formatar={formatarCentavos} />}
            valorClasse={VALOR_EM_REAIS}
            detalhe="Receita média por venda"
            className={`xl:col-span-3 ${esmaecer}`}
          />
          <KpiCard
            rotulo="Posição no ranking"
            icone={MedalIcon}
            valor={posicao > 0 ? <NumeroAnimado valor={posicao} formatar={(n) => `#${n}`} /> : '—'}
            detalhe={carregandoRanking ? 'Carregando…' : posicao > 0 ? `de ${tamanhoDoRanking} ${rotuloDoRanking}` : 'Ranking não iniciado'}
            className="xl:col-span-3"
          />
        </section>

        <section data-dashboard-section="goals-in-progress" aria-label="Metas em andamento" className="contents">
          <ChecklistDoDia className="md:col-span-2 xl:col-span-6" />
          <MetasDeTurno data={today} className="md:col-span-2 xl:col-span-6" />
        </section>

        <Bloco
          titulo="Evolução comercial"
          descricao={umDiaSo ? 'Vendas e abordagens em cada hora do período.' : 'Volume de vendas e abordagens no período.'}
          dataSecao="commercial-evolution"
          className={`md:col-span-2 xl:col-span-8 ${esmaecer}`}
        >
          <SeriesChart
            pontos={serie}
            textos={{
              principal: 'Vendas',
              secundaria: 'Abordagens',
              coluna: umDiaSo ? 'Hora' : 'Período',
              resumo: `Vendas e abordagens ${umDiaSo ? 'por hora' : 'ao longo do período'}, no horário de Brasília`,
              vazio: 'Aguardando as primeiras vendas.',
            }}
          />
        </Bloco>

        <Bloco
          titulo="Pódio dos Closers"
          descricao={
            linhasDoPodio[0]
              ? `${linhasDoPodio[0].nome} lidera o mês com ${formatarReaisInteiros(linhasDoPodio[0].total)}`
              : 'Quem mais vendeu neste mês (receita aprovada)'
          }
          acao={<LinkSecao para="/ranking">Ranking</LinkSecao>}
          className="md:col-span-2 xl:col-span-4"
        >
          {erroRanking && (
            <p role="alert" className="mb-3 text-xs text-destructive">
              Não foi possível atualizar o ranking.
            </p>
          )}
          {carregandoRanking ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : (
            <>
              <div className="pt-6">
                <Podio linhas={linhasDoPodio.slice(0, 3)} destaque={user?.id} />
              </div>
              {ranking.length === 0 && !erroRanking && <p className="mt-4 text-center text-xs text-muted-foreground">Nenhum Closer elegível no ranking.</p>}
              {ranking.length > 3 && (
                <ol className="mt-4 space-y-1.5 border-t pt-3 text-sm" start={4}>
                  {linhasDoPodio.slice(3, 6).map((l) => (
                    <li key={l.chave} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-6 text-xs tabular-nums text-muted-foreground">{l.posicao}º</span>
                        <span className="truncate text-heading">{l.nome}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{formatarReaisInteiros(l.total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Bloco>

        {/* Trio da referência (4 · 4 · 4): sem funil real no negócio, o 2º lugar fica com as vendas do time. */}
        <Bloco titulo="Produtos em destaque" descricao="Ranking por receita aprovada" dataSecao="featured-products" className={`md:col-span-2 xl:col-span-4 ${esmaecer}`}>
          <Barras
            rotulo="Receita aprovada por produto"
            vazio="Nenhum produto vendido no período"
            formatarTotal={formatarReaisInteiros}
            itens={produtos.map((p) => ({
              chave: p.chave,
              rotulo: p.nome,
              rotuloTexto: p.nome,
              total: p.valor,
              fracao: p.fracao,
              complemento: pluralizar(p.quantidade, 'venda', 'vendas'),
              inicio: <Iniciais nome={p.nome} tamanho="xs" />,
            }))}
          />
        </Bloco>

        <VendasDoTime className="md:col-span-2 xl:col-span-4" />

        <Bloco
          titulo="Ao vivo"
          descricao="O que acabou de acontecer no período"
          acao={
            <Button size="sm" className={`botao-acao ${ACAO_DO_BLOCO}`} onClick={() => navegar('/abordagens?new=true')}>
              <MessageSquareTextIcon aria-hidden="true" /> Nova abordagem
            </Button>
          }
          className={`md:col-span-2 xl:col-span-4 ${esmaecer}`}
        >
          <FeedAoVivo key={generation} itens={atividade} />
        </Bloco>

        <UltimasVendas className="md:col-span-2 xl:col-span-12" />
      </div>
    </PainelLayout>
  )
}
