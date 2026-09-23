# Arena Comercial

Implementação autorizada por `EXECUTAR`. A TV usa a conta normal fecass1507@gmail.com, sem exceção de RBAC.

## Contratos

- Pontos internos fixos por evento: SDR 0,2 / 0,4 / 0,5; Closer 10. Metas padrão de pontuação: 100 pontos para 100% de avanço. A interface mostra o percentual calculado como pontos realizados / meta vigente × 100, inclusive quando uma meta individual substitui o padrão.
- Faturamento bruto pela data da aprovação, preservado após estorno. Conversão mantém vendas / registros de abordagem. Ticket é calculado; 2.997 é somente referência.
- `activity_feed` registra fatos reais imutáveis, com responsável, autor, origem e chave única. Não registra contatos de clientes.
- `company_goals` contém versões; `goal_cycles` preserva resultados encerrados. Brasília define dias, semanas e meses.
- Duas exclusões históricas de vendas aprovadas com motivo “Recusada.” exigem classificação administrativa; não entram automaticamente no faturamento.
- Rotas: `/arena`, `/metas` (abas vendas, atribuições, gestão, histórico, auditoria, configurações), `/trafego`. `/vendas-time` permanece como alias.

## Sequência

1. Eventos, autorização, integrações CRM/vendas e idempotência no banco.
2. Metas versionadas, encerramento no servidor, atribuições, notificações e agregados.
3. Arena, central de metas, tráfego e ajustes de navegação.
4. Verificação de SQL em transação revertida, tipos, lint, build e fluxos reais disponíveis.

Sem dados comerciais fictícios. Validação de estabilidade por 24 horas exige observação real e não pode ser substituída por teste curto.

## Entrega e operação

Código integrado à `main` e mantido na branch `codex/arena-comercial`; commit de implementação `5fe3fce`. Após a autorização explícita de deploy, as três migrations foram instaladas atomicamente e o frontend foi publicado em 23/09/2026. A prévia local permanece uma fotografia das consultas reais; a experiência autenticada está em [Arena publicada](https://wsltda.com/arena), que redireciona para `www.wsltda.com`.

Para o monitor, entrar normalmente com `fecass1507@gmail.com`, abrir `/arena`, acionar tela cheia e ativar o sino uma vez por interação. A conta conserva suas roles existentes. Não há conta de monitor, credencial especial, bypass por e-mail ou rotina de automação adicional.

As barras operacionais mantêm seus ciclos próprios; os cards, gráfico, ranking do período e feed acompanham Hoje/7/30/personalizado. Os ciclos diários, semanais e mensais usam Brasília. O percentual do time é a soma dos pontos dividida pela soma das metas individuais; uma meta individual habilitada substitui a meta padrão do cargo.

O tempo usado nas estimativas de ritmo e do valor ainda necessário avança em intervalos de cinco minutos; novas ações registradas alteram o realizado imediatamente. O contador regressivo continua em segundos. Nos rankings da Arena e nos ciclos, a pontuação aparece como avanço da meta até 100% e pode ultrapassar 100% quando o alvo é excedido. O feed mostra o impacto percentual de eventos do ciclo aberto para a meta individual aplicável; para períodos anteriores, mantém o fato sem inferir um percentual a partir da meta atual.

O gráfico usa faturamento bruto historicamente aprovado. Cancelar, estornar ou excluir uma venda aprovada reverte uma única vez os pontos originais; não elimina o faturamento aprovado. Remarcação de compra ou troca posterior do vendedor preserva o fato original na Arena. Ajustes de pontuação exigem um evento existente, motivo e confirmação administrativa.

A realização de Call Q é registrada na resolução da qualificação. O fechamento tem confirmação explícita de que a call agendada ocorreu. Encerramentos automáticos não presumem presença. Registros antigos sem evidência de realização não recebem retrospectivamente os 0,5 pontos de qualificação realizada.

Metas são versões imutáveis. Valor, visibilidade, recorrência e countdown podem mudar por nova versão. O prazo de um ciclo operacional aberto pode mudar com vigência imediata, mantendo o início e registrando motivo. O mês civil do faturamento e seu ranking permanecem fixos. Desativar a meta mensal não interrompe o arquivo mensal. Resultados encerrados não são reabertos nem recalculados.

Realtime reaproveita `DataSync`. A contingência consulta um único número de revisão a cada 5 segundos enquanto a página está visível; busca os agregados somente quando a revisão mudou. O cursor inclui revisões do CRM e das abordagens. O servidor encerra ciclos pelo job `arena-cycle-deadlines`, independentemente de a TV estar aberta. A condição de ritmo exibida acompanha o tempo mesmo sem novos eventos.

Os popups têm prioridade, limite de cinco itens e deduplicação. O sino depende de um INSERT novo de aprovação de Closer após o cursor de conexão confirmado pelo servidor. Consultas iniciais, refresh, backfill e eventos anteriores ao reconnect não disparam o sino. A preferência de som é local; os dados comerciais permanecem no banco.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| TypeScript da aplicação e configuração Node | Sem erros |
| ESLint de `src` e scripts novos | Sem erros; 11 avisos preexistentes de Fast Refresh |
| Build de produção | Aprovado |
| Testes unitários de Arena, CRM e contexto/metas diárias | Aprovados |
| Varredura de segredos do repositório | Aprovada |
| Três migrations no banco vinculado, em uma transação revertida | Aprovadas |
| Permissões/RLS para cada perfil real; conta da TV | Aprovadas |
| Feed imutável, repetição de evento, estorno único e receita preservada | Aprovados com registros reais |
| Reagendamento neutro, cancelamento único, versões e prazo de meta | Aprovados em transação revertida |
| Encerramento pelo servidor, ranking mensal congelado e ciclo fechado imutável | Aprovados em transação revertida |
| Consulta de revisão após sinal de abordagens; worker ocioso sem invalidar | Aprovados |
| Prévia com dados reais em 1366×768, 1920×1080 e 390×844 | Conferida; sem excesso horizontal no celular |

Comandos reproduzíveis, a partir da raiz do repositório:

```powershell
npx tsc -p tsconfig.app.json --noEmit --incremental false
npx tsc -p tsconfig.node.json --noEmit --incremental false
npx eslint src scripts/verify-arena-unit.mjs scripts/check-arena-db.mjs
node scripts/verify-arena-unit.mjs
node scripts/verify-crm-unit.mjs
node scripts/verify-context-daily-unit.mjs
node scripts/security-scan.mjs
npm run build
node scripts/check-arena-db.mjs
```

O último comando requer Supabase CLI autenticado; `SUPABASE_CLI` pode indicar o executável local. Ele roda apenas a verificação anterior à instalação, sem commit. O teste de prazo altera temporariamente o fim de um ciclo real e verifica seu fechamento; toda a transação é revertida. Não cria pessoas, leads, vendas ou valores comerciais fictícios.

## Publicação e verificações operacionais

Instalar, na ordem, somente as migrations revisadas `20260923100000_arena_events.sql`, `20260923110000_arena_goals.sql` e `20260923120000_arena_operations.sql`, registrando cada versão no histórico de migrations. O repositório possui migrations antigas aplicadas por scripts próprios; não executar um push indiscriminado de todo o histórico. Publicar o frontend após o banco.

`node scripts/apply-arena-migrations.mjs` verifica a instalação com rollback. Após autorização de deploy, `node scripts/apply-arena-migrations.mjs --apply` instala as três migrations e seus registros de histórico em uma transação única; interrompe se alguma versão já estiver instalada. `SUPABASE_CLI` aceita o caminho do executável autenticado. Na Vercel vinculada, preparar com `deploy --prod --skip-domain`, instalar o banco e promover a versão pronta com `promote` reduz o intervalo entre as atualizações.

Depois da instalação, verificar o job `arena-cycle-deadlines`, a publicação Realtime de `activity_feed`, `dashboard_events` e `arena_notifications`, e os fluxos autenticados com as roles existentes. Medir a propagação de uma operação comercial legítima entre CRM e TV, o sino único e a recuperação de conexão. Esses testes de Realtime ponta a ponta e a observação contínua de 24 horas ainda não foram realizados; o teste SQL revertido não produz eventos comprometidos para validá-los.

Verificação após o deploy: a publicação vinculada ao GitHub do commit `4274ee1` concluiu com sucesso em `wsltda.com`; `/arena` redirecionou para `www.wsltda.com/arena`, respondeu HTTP 200 e entregou o bundle novo. Sem sessão, a rota protegida redireciona ao login. As três versões constam no histórico do Supabase. As três tabelas constam na publicação Realtime. O job está ativo a cada 5 segundos e suas três últimas execuções verificadas terminaram com sucesso. A consulta autenticada por contexto SQL da conta da TV retornou acesso autorizado, três ciclos e os agregados reais. Nenhuma venda, lead ou conta de teste foi criada para publicar.

As duas vendas históricas excluídas com motivo “Recusada.” aparecem para decisão explícita em `/metas?tab=auditoria`. Sua classificação não foi inferida. O arquivo mensal consolidado passa a existir a partir da instalação; não foram inventados snapshots de meses anteriores.
