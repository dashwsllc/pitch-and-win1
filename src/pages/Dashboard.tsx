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
import { CartaoDoPodio } from '@/painel/components/CartaoDoPodio'
import { ChecklistDoDia } from '@/painel/components/ChecklistDoDia'
import { FeedAoVivo } from '@/painel/components/FeedAoVivo'
import { FiltroPainel } from '@/painel/components/FiltroPainel'
import { Iniciais } from '@/painel/components/Iniciais'
import { LegendaDaDivisao } from '@/painel/components/LegendaDaDivisao'
import { Bloco, KpiCard } from '@/painel/components/KpiCard'
import { MetasDeTurno } from '@/painel/components/MetasDeTurno'
import { NumeroAnimado } from '@/painel/components/NumeroAnimado'
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
  montarAtividade,
  montarIntervalos,
  passoDaSerie,
  serieDeCalls,
  somarNaUltimaHora,
  ultimoInstante,
} from '@/painel/lib/visao'

// Dinheiro tem 10 a 15 caracteres: num cartão de 3 colunas o valor encolhe com a janela em vez de vazar.
const VALOR_EM_REAIS = 'text-[clamp(1.5rem,2.1vw,2.25rem)]'

/**
 * Home: "Visão geral", na grade da referência; os indicadores formam a seção "Indicadores comerciais". Lê a mesma camada de dados do painel antigo
 * (useDashboardData, ranking, metas e vendas do time, todos atualizados pelo DataSync) e só compõe: cada bloco recebe
 * dados prontos. O período vale para os blocos de vendas, abordagens e calls; ranking, metas e vendas do time têm janela
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
  const { ranking, sdrRanking, loading: carregandoRanking, error: erroRanking, sdrError: erroSdr } = useRankingDataWithMock()
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

  // Tudo abaixo sai das mesmas linhas que deram os totais (rows e metrics chegam juntos, na mesma carga). Uma linha do
  // tempo só para os três gráficos: as colunas de vendas, as de abordagens (com a divisão pela IA) e o de abordagens e calls.
  const intervalos = useMemo(() => montarIntervalos(periodo, umDiaSo, rows.vendas, rows.abordagens, rows.calls), [periodo, umDiaSo, rows])
  const pontosDeCalls = useMemo(() => serieDeCalls(intervalos), [intervalos])
  const passo = passoDaSerie(intervalos, umDiaSo)
  const naUltimaHora = useMemo(() => contarNaUltimaHora(rows.vendas, agora), [rows.vendas, agora])
  const receitaNaUltimaHora = useMemo(() => somarNaUltimaHora(rows.vendas, agora), [rows.vendas, agora])
  const ultimaVenda = useMemo(() => ultimoInstante(rows.vendas), [rows.vendas])
  const divisao = useMemo(() => dividirAbordagens(rows.abordagens), [rows.abordagens])
  const atividade = useMemo(() => montarAtividade(rows.vendas, rows.abordagens), [rows])
  const produtos = useMemo(() => barrasDeProdutos(metrics.produtosMaisVendidos, metrics.totalVendas), [metrics.produtosMaisVendidos, metrics.totalVendas])
  // Os pódios do mês, na ordem que o servidor devolve (a mesma da tela Ranking): Closers pela receita aprovada, SDRs pelos
  // repasses para Closers.
  const podioDosClosers = useMemo(
    () => ranking.slice(0, 3).map((r, i) => ({ posicao: i + 1, chave: r.user_id, nome: r.name, valor: r.totalVendas, apoio: pluralizar(r.quantidadeVendas, 'venda', 'vendas') })),
    [ranking],
  )
  const podioDosSdrs = useMemo(
    () => sdrRanking.slice(0, 3).map((r, i) => ({ posicao: i + 1, chave: r.user_id, nome: r.name, valor: r.repasses, apoio: pluralizar(r.abordagens, 'abordagem', 'abordagens') })),
    [sdrRanking],
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
          {/* Linha 1: destaque · abordagens · taxa sobre meta (5 · 4 · 3). */}
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
                colunas={intervalos.map((p) => ({ chave: p.chave, rotulo: p.rotulo, partes: [p.vendas] }))}
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
          <KpiCard rotulo="Abordagens" icone={UsersRoundIcon} valor={<NumeroAnimado valor={metrics.abordagens} />} className={`xl:col-span-4 ${esmaecer}`}>
            {/* Altura maior que a das vendas: o número é menor, e assim as duas molduras terminam alinhadas no xl. */}
            <div className="mt-4">
              <ColunasKpi
                colunas={intervalos.map((p) => ({ chave: p.chave, rotulo: p.rotulo, partes: [p.mostrou, p.abordagens - p.mostrou] }))}
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
          {/* Os dois indicadores de anel dividem uma coluna: cada um ganha largura para o número e a frase. */}
          <div className="grid grid-rows-2 gap-4 xl:col-span-3">
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
              className={esmaecer}
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
            />
          </div>

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

        {/* O funil logo depois da abordagem: as calls feitas (área) contra as abordagens (linha), na mesma linha do tempo
            dos indicadores. Ao lado, os dois pódios do mês, compactos e empilhados. */}
        <Bloco
          titulo="Abordagens e calls"
          descricao={umDiaSo ? 'Abordagens registradas e calls feitas em cada hora do período.' : 'Abordagens registradas e calls feitas ao longo do período.'}
          dataSecao="commercial-evolution"
          className={`md:col-span-2 xl:col-span-8 ${esmaecer}`}
        >
          {/* Mais alto que o padrão: ocupa a altura dos dois pódios ao lado, sem vão embaixo. */}
          <SeriesChart
            pontos={pontosDeCalls}
            altura={344}
            textos={{
              principal: 'Calls feitas',
              secundaria: 'Abordagens',
              unidades: { principal: ['call feita', 'calls feitas'], secundaria: ['abordagem', 'abordagens'] },
              coluna: umDiaSo ? 'Hora' : 'Período',
              resumo: `Calls feitas e abordagens ${umDiaSo ? 'por hora' : 'ao longo do período'}, no horário de Brasília`,
              vazio: 'Sem abordagens nem calls no período.',
            }}
          />
        </Bloco>

        {/* Empilhados ao lado do gráfico (xl); abaixo dele, lado a lado só quando cada um ainda tem largura (lg). */}
        <div className="grid gap-4 md:col-span-2 lg:grid-cols-2 xl:col-span-4 xl:grid-cols-1 xl:grid-rows-2">
          <CartaoDoPodio
            titulo="Pódio dos Closers"
            descricao="Receita aprovada no mês"
            linhas={podioDosClosers}
            formatar={formatarReaisInteiros}
            carregando={carregandoRanking}
            erro={erroRanking !== null}
            vazio="Nenhum Closer elegível no ranking."
            destaque={user?.id}
          />
          <CartaoDoPodio
            titulo="Pódio dos SDRs"
            descricao="Repasses para Closers no mês"
            linhas={podioDosSdrs}
            formatar={(n) => pluralizar(n, 'repasse', 'repasses')}
            carregando={carregandoRanking}
            erro={erroSdr !== null}
            vazio="Nenhum SDR elegível no ranking."
            destaque={user?.id}
          />
        </div>

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
