# Entrega: contexto de leads, metas diárias e atualização

## Contexto e decisões

A implementação anterior ficou interrompida com alterações locais, sem migração,
commit ou publicação. A arquitetura foi preservada: Vite, React/TypeScript,
Tailwind/shadcn, React Router, TanStack Query e Supabase/PostgreSQL com RPC,
RLS e Realtime. Não há dependência do projeto vide-match.

- O CRM abre em lista, ordenado automaticamente pelo próximo compromisso.
  Agendamentos vencidos ainda abertos aparecem primeiro, do mais antigo ao mais
  recente; seguem os futuros em ordem crescente e os leads sem agenda/encerrados.
  Datas equivalentes com offsets diferentes são comparadas como instantes.
  A ordem é recalculada com cada atualização dos dados; UUID desempata registros.
- Temperatura e abordagem usam os campos estruturados existentes. Seleção múltipla
  em cada grupo, combinação entre grupos e seleção vazia mostrando todos.
  “Abordado” também inclui o estado histórico “reabordado”. Os controles continuam
  dentro da área de filtros existente.
- Contextos são entradas independentes vinculadas ao lead: WhatsApp, transcrição
  de ligação ou anotação. SDR e Closer podem importar ambos os tipos e editar
  contexto; autor/data originais são preservados, com identificação do editor.
  O ícone vazio/preenchido abre a ficha com o contexto em destaque.
- A janela das metas é o dia civil de Brasília, de 00h até a próxima meia-noite,
  não 24 horas desde a criação. A interface troca de dia automaticamente e o
  banco impede conclusão fora do dia corrente. Histórico não é apagado nem editado.
- Checklist com percentual, concluídas/total, confirmação de 100%, atenção nas
  últimas seis horas e alerta nas últimas duas. O executivo cadastra tarefas por
  colaborador/data; apenas o próprio colaborador marca/desmarca a conclusão.
- O pedido posterior substituiu o intervalo inicial de três minutos: o refresh
  periódico padrão/mínimo agora é **50 segundos**, centralizado e configurável por
  `VITE_AUTO_REFRESH_INTERVAL_MS`. Realtime e atualização ao voltar à janela continuam.
  Relógios/contadores locais não representam consultas ao banco.
- A pedido do usuário, Alex corresponde a Sinclair. Metas de 11/09: Sinclair 7,
  Pedro 2, Pedro iago 2 e Ismael 3. David permanece sem tarefas pré-definidas e pode
  recebê-las pelo painel, sem mudança de código.

## Correções concluídas

- Importação não corta arquivos/textos grandes silenciosamente: limites de
  50.000 caracteres e 256 KB, com erro claro; validação também no servidor.
- Remoção de caracteres de controle, normalização de quebras de linha e rejeição
  de conteúdo vazio. HTML importado aparece literalmente como texto React,
  nunca por `innerHTML`. Autor, papel, data e versão não vêm do payload do usuário.
- Novas tabelas com RLS e acesso de escrita somente pelas RPCs autorizadas.
  Anônimos, suspensos e cargos sem capacidade de operação não importam contexto.
  Usuários comuns não criam/editam/removem tarefas e não concluem tarefas alheias.
- Versões e bloqueio de linha rejeitam revisões antigas no contexto/checklist;
  as transações de repasse, agenda, resultado e venda existentes foram preservadas.
- Consultas de contextos, metas e dashboards paginam os resultados para evitar
  truncamento pelo limite da Data API. Consultas desabilitadas não deixam loading preso.
- Respostas antigas dos dashboards não substituem uma seleção mais recente.
- Datas e agrupamentos usam Brasília mesmo em dispositivos de outro fuso.
  Datas inválidas e campo de data vazio não causam normalização indevida ou crash.
- Gráficos comparam contagens de vendas e abordagens no período selecionado;
  receita permanece nos indicadores monetários e usa somente vendas aprovadas.
- O ranking legado foi direcionado à mesma RPC auditada do ranking usado pelo app.
- O teste de CRM voltou a resolver o utilitário compartilhado de datas; o linter
  aceita a sanitização sem desligar a regra de caracteres de controle.

## Arquivos e motivos

| Arquivo(s) | Alteração |
| --- | --- |
| `.env.example`, `src/lib/sync.ts` | Configuração e rótulo do refresh de 50 segundos. |
| `src/lib/brasilia-time.ts` | Datas civis, limites de período, inputs e meia-noite em Brasília. |
| `src/lib/plain-text.ts` | Sanitização, limite explícito e exibição de texto. |
| `src/lib/crm-order.ts` | Próximo compromisso e ordenação estável. |
| `src/lib/crm.ts` | Validação de nascimento e horários do CRM. |
| `src/pages/CRM.tsx` | Ordenação inicial, multiseleção, resumo de contextos e atualização. |
| `src/components/crm/CRMContextPanel.tsx` | Importação, arquivos, edição, autor, datas e tipos. |
| `src/components/crm/CRMLeadCard.tsx`, `CRMLeadDetail.tsx` | Indicador e acesso ao contexto; datas da call. |
| `src/components/crm/CRMActionDialog.tsx`, `CRMCalls.tsx` | Interpretação dos agendamentos no fuso operacional. |
| `src/hooks/useCRM.tsx` | Consultas paginadas, RPCs e sincronização dos contextos. |
| `src/hooks/useGoals.tsx` | Consultas diárias, mutações, troca de dia e paginação. |
| `src/components/dashboard/GoalsProgress.tsx` | Checklist, contagem regressiva, progresso e conclusão. |
| `src/components/executive/ExecutiveGoalsManagement.tsx` | Cadastro/edição por colaborador e consulta do histórico. |
| `src/hooks/useDashboardData.tsx`, `useExecutiveDashboard.tsx` | Períodos, contagens e proteção contra respostas antigas. |
| `src/hooks/useRankingData.tsx`, `useRankingDataWithMock.tsx` | Uma fonte de ranking e intervalo compartilhado. |
| `src/hooks/useProducts.ts`, `useProfile.tsx`, `useRoles.tsx`, `useSalesBoard.ts` | Intervalo centralizado de atualização. |
| `src/components/DataSync.tsx` | Invalidação das metas e fallback compartilhado. |
| `src/components/executive/ExecutiveAudit.tsx`, `ExecutiveWithdrawals.tsx` | Refresh compartilhado. |
| `src/components/executive/ExecutiveSellerDetails.tsx` | Contagens e datas corretas no relatório individual. |
| `src/components/executive/ExecutivePasswordRequests.tsx` | Horários explícitos de Brasília. |
| `src/pages/Dashboard.tsx` | Relógio, saudação e rótulo de atualização. |
| `src/pages/MinhasVendas.tsx`, `Saques.tsx` | Formatação das datas em Brasília. |
| `src/integrations/supabase/types.ts` | Tipos das duas tabelas e respectivas RPCs. |
| `supabase/migrations/20260911030000_crm_context_daily_goals.sql` | Schema, RLS, RPCs, auditoria, Realtime e metas iniciais. |
| `supabase/tests/crm_context_daily_goals.sql`, `scripts/check-context-daily-db.mjs` | Teste transacional e aplicação de uma única migração. |
| `scripts/verify-context-daily-unit.mjs` | Datas, meia-noite, limites, sanitização e ordenação. |
| `scripts/verify-context-daily-ui.mjs` | Interface desktop/mobile com API em memória. |
| `scripts/verify-crm-unit.mjs`, `verify-crm-ui.mjs`, `crm-real-fixtures.mjs` | Resolução de imports, polling e fixture SDR alinhados ao comportamento atual. |
| `docs/SDR_CLOSER_CRM.md`, este documento | Operação e evidências da entrega. |

Nenhuma folha de estilo, token de cor, espaçamento ou estrutura geral do dashboard
foi redesenhada. As áreas novas são contexto e metas; os filtros existentes foram
adaptados para multiseleção e os textos/dados de horário foram corrigidos.

## Validação e limites

- TypeScript, build de produção e linter (sem erros; avisos de Fast Refresh e refs).
- Varredura de segredos aprovada; `npm audit` sem vulnerabilidades.
- Testes unitários de CRM e das novas regras aprovados.
- SQL novo aprovado antes e depois da instalação, com fixtures transacionais e
  `ROLLBACK`: RLS, papéis, autor, tamanho, conflitos, conclusão própria, datas e histórico.
- Regressões SQL de CRM compartilhado, catálogo e controles executivos aprovadas.
- Navegador com API em memória: ordenação sem clique, filtros combinados,
  importação por SDR/Closer, arquivo excessivo, texto HTML inerte, reload,
  checkbox/100%, refresh de 50 segundos, virada da meia-noite e cadastro executivo.
  Verificação visual em 1440 e 390 px, incluindo dispositivo no fuso de Tóquio.
- O teste de interface não usa contas/fixtures de produção: a autorização e a
  persistência são verificadas no SQL real. Não foi executada uma nova sessão
  completa de Auth/JWT/Realtime com dois usuários reais porque não há staging
  separado configurado. Os canais existentes foram mantidos; as novas tabelas
  estão incluídas na publicação Realtime e têm fallback de 50 segundos.

## Operação

A migração foi aplicada em 11/09/2026 e registrada no histórico. Não reaplicar.
`node scripts/check-context-daily-db.mjs --deployed` apenas verifica e desfaz suas
fixtures; sem opções faz pré-validação somente antes da instalação; `--apply`
aplica exclusivamente esta migração, recusando duplicidade. Nunca usar `db push`
para reconciliar o histórico antigo deste projeto.

Continuam fora deste escopo as duas ações administrativas da auditoria anterior:
proteção de senhas vazadas e ligação do deploy automático ao GitHub. O fluxo
existente de publicação manual na Vercel foi preservado.
