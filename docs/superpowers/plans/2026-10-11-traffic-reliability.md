# Tráfego Confiável Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir captura, aprovação, cálculo e sincronização de Tráfego com dados recuperáveis, números coerentes e revisão humana preservada.

**Architecture:** Reutilizar as fronteiras atuais: adaptador Meta, RPCs transacionais, fatos publicados e React Query. Acrescentar staging com manifesto de captura e leases na fila existente; extrair um modelo de leitura comum para cards, gráfico, tabela e CSV. Implantar contratos compatíveis antes dos consumidores.

**Tech Stack:** React 18, TypeScript, Vite, React Query, Supabase/PostgreSQL, Deno Edge Functions, Node `node:test`, Graph API Meta e extrator TypeSafe existente.

**Spec:** [Tráfego: confiabilidade da captura, aprovação e leitura](../specs/2026-10-11-traffic-reliability-design.md). Ler também a [auditoria e reproduções](../../AUDITORIA_TRAFEGO_2026-10-11.md). A especificação foi aprovada pelo pedido “continua de onde parou”; este plano aguarda revisão e escolha do método de execução.

## Global Constraints

- Toda confirmação de recebimento de webhook corresponde a um evento persistido; toda publicação corresponde a uma aprovação explícita.
- Captura parcial nunca se apresenta como completa nem autoriza remoção de dados ausentes.
- Identidade original, respostas livres, primeira origem, motivos de edição e vínculos comerciais permanecem rastreáveis.
- Uma repetição da mesma operação não duplica fatos. Concorrência não pode sobrescrever uma decisão ou uma edição silenciosamente.
- Cards, gráfico, tabela e CSV usam o mesmo recorte e o mesmo nível. Campanha, conjunto e anúncio são níveis alternativos; seus totais não se somam entre si.
- Ausência de denominador, erro de consulta e cobertura desconhecida são estados distintos de um resultado real igual a zero.
- Resultados declarados pela Meta e contatos/vendas confirmados no CRM têm definições próprias e aparecem separados.
- RLS e validação nas RPCs protegem o banco independentemente da interface ou do papel informado pelo cliente.
- O escopo financeiro permanece BRL; partes de revisão têm até 2.000 linhas; a captura inteira não está limitada a 2.000 linhas.
- Backoff de leads: 1, 5, 15 e 60 minutos; 60 minutos como teto. Confiança mínima do extrator: preservar o valor atual de 0,5 e validar o intervalo 0–1.
- Nenhuma aprovação técnica aprova lotes comerciais; não recalcular/publicar histórico nem conceder permissões Meta implicitamente.
- Não tocar a sincronização de calendário, reconstruir o módulo ou aplicar todo o histórico de migrations com `db push`.

## Review Focus

1. Uma resposta Graph com `paging.next` fora de `graph.facebook.com`, token na URL ou cursor expirado não pode expor segredo, perder cobertura nem autorizar remoções — tarefa 2.
2. A virada do dia, ano bissexto e contas de fusos distintos não podem aceitar datas impossíveis nem misturar calendários — tarefas 1, 4 e 9.
3. Um upload com campos opcionais ausentes deve preservar o valor existente e marcar disponibilidade, inclusive quando a próxima captura troca a definição de ação — tarefas 1, 3 e 9.
4. Aprovar a revisão enquanto uma recaptura, edição publicada ou outro aprovador muda o mesmo fato precisa falhar sem publicar uma parte — tarefas 3 e 10.
5. Um webhook repetido de página com configuração ausente ou uma retomada após falha prolongada não pode apagar uma decisão, aceitar outra identidade nem abandonar o evento — tarefas 5 e 6.

## Mapa de arquivos e responsabilidade

| Unidade | Arquivos | Responsabilidade |
| --- | --- | --- |
| Identidade e contrato puro | criar `shared/meta-identity.ts`, `shared/meta-contract.ts`; alterar `src/lib/meta-traffic.ts`, `src/lib/meta-edit.ts` | IDs, chaves, metadados, tipos comuns sem ambiente Deno/React. |
| Adaptador Graph | alterar `supabase/functions/_shared/meta-graph.ts`; criar `supabase/functions/_shared/meta-insights.ts` | Página verificável, timeout/retry, ações canônicas e transformação de uma linha. |
| Captura | alterar `supabase/functions/meta-insights-sync/index.ts`; criar `supabase/functions/_shared/meta-insights-capture.ts` | Criar/retomar execução, persistir páginas, fechar manifesto e propor revisão. |
| Fila de leads | alterar `supabase/functions/_shared/meta-lead-ingest.ts`, `supabase/functions/meta-lead-webhook/index.ts`, `supabase/functions/meta-leads-reconciliation/index.ts`; criar `supabase/functions/_shared/meta-lead-worker.ts` | Recebimento durável separado de processamento, claim, retomada e descoberta. |
| Extração | alterar `supabase/functions/_shared/meta-lead-extract.ts`; criar `supabase/functions/_shared/meta-typesafe.ts` | Mapeamento determinístico, seleção ambígua e timeout da IA. |
| Leitura | criar `src/lib/meta-traffic-view.ts`, `src/lib/meta-traffic-queries.ts`; alterar `src/lib/meta-connection.ts` | Recorte, grupos, cobertura, consultas leves e estados operacionais. |
| Interface | alterar `src/pages/Trafego.tsx`, `src/components/traffic/MetaTrafficData.tsx`; criar `MetaTrafficPerformance.tsx`, `MetaPendingImports.tsx`, `MetaTrafficConnection.tsx` | Extrair somente as áreas modificadas; apresentar revisão, desempenho e operação. |
| Banco | criar migrations `20261011120000` a `20261011170000` descritas abaixo | Validação, staging/revisão, fila, coorte, sinais e cron; preservar migrations antigas. |
| Contrato Supabase | alterar `src/lib/arena-api.ts`; regenerar `src/integrations/supabase/types.ts` | Tipar RPCs novas e compatibilidade do cliente existente. |
| Verificação | criar `scripts/helpers/meta-edge-harness.mjs`, `scripts/helpers/meta-db-fixtures.sql`, suítes abaixo | Executar código real com fronteiras substituídas; testar SQL no PostgreSQL. |

Todos os caminhos deste plano são relativos ao checkout `pitch-and-win1`. As migrations novas não existem ainda; confirmar que os números continuam livres antes de criá-las. `DataSync.tsx` e `src/lib/sync.ts` são dependências preservadas; mudar somente se um teste demonstrar defeito próprio necessário a este fluxo.

## Preparação e comandos de verificação

No início da execução, seguir `using-git-worktrees`: preferir um checkout adequado já anexado e proteger trabalho alheio. Ler os skills de execução selecionado, TDD e verificação; usar debugging para falhas novas. Preparação faz parte da primeira tarefa, sem instalação de dependências de produto nesta fase de planejamento.

Node, Deno e as dependências do app estão disponíveis. `psql`, Docker e `supabase` não foram encontrados no PATH durante o planejamento. O CLI Supabase existe no cache npm; resolvê-lo com `Get-Command` ou pelo pacote instalado, sem imprimir credenciais. Para SQL com escrita, usar PostgreSQL local descartável ou um ambiente de testes confirmado, com schema compatível e fixtures sintéticas. Não usar a URL do projeto comercial como fallback. O executor deve preparar esse ambiente antes de declarar verificadas as migrations; ausência dele não autoriza substituir SQL real por busca textual.

Convenções das tarefas:

- **NODE(file):** `node --experimental-vm-modules --test <file>`; sucesso exige exit 0 e zero testes falhos. Exportar o loader existente de `scripts/verify-meta-sync-regressions.mjs` para `scripts/helpers/meta-edge-harness.mjs` na tarefa 2, preservando o nome `loadHandler(path, {fetch, admin, extraEnv, clock})` e retorno `{handler,exports}`; incluir relógio, timers e AbortController quando necessários. Dados e spies dos trechos de assertions abaixo são fixtures sintéticas construídas no próprio teste, não funções de produto adicionais.
- **SQL(file):** `supabase db query --db-url "$env:META_TRAFFIC_TEST_DB_URL" --file <file> --output json`; sucesso exige exit 0 e o marcador `PASS` retornado pelo arquivo. A variável aponta exclusivamente para o ambiente de testes confirmado. Cada arquivo usa `BEGIN`, fixtures, assertions e `ROLLBACK`; não deixa contatos, papéis ou decisões persistidos.
- **Fixtures SQL:** `scripts/helpers/meta-db-fixtures.sql` cria helpers `pg_temp.seed_meta_actor(p_registration text, p_suspended boolean, p_role text) RETURNS uuid`, `pg_temp.expect_error(p_sql text,p_state text) RETURNS void` e `pg_temp.assert(p_ok boolean,p_message text) RETURNS void`. Seed apenas usuários sintéticos; JWT e papel devem ser exercidos de fato, inclusive `SET LOCAL ROLE authenticated`/`service_role`.
- **Suite atual:** `node scripts/verify-meta-traffic.mjs`; `node scripts/verify-meta-lead-import.mjs`; `node --experimental-vm-modules --test scripts/verify-meta-sync-regressions.mjs scripts/verify-meta-lead-import-regressions.mjs scripts/verify-meta-edit-regressions.mjs`; `deno test supabase/functions/_shared/meta-lead-extract.test.ts`.

Cada tarefa termina com commit somente de seus arquivos e testes, depois de passar. Os comandos de commit indicam a mensagem exata; preparar os caminhos do bloco **Files**, verificar `git diff --cached --check` e nunca usar `git add .`.

---

### Task 1: Normalizar identidade e proteger validação/edições existentes

**Files:** criar `shared/meta-identity.ts`, `supabase/migrations/20261011120000_meta_traffic_validation.sql`, `scripts/verify-meta-identity-regressions.mjs`, `scripts/verify-meta-validation-db.sql`, `scripts/helpers/meta-db-fixtures.sql`; alterar `src/lib/meta-traffic.ts`, `src/lib/meta-edit.ts` e fixtures de conta nos testes Meta atuais.

**Interfaces:** produzir `normalizeMetaAccountId(value: string): string`, `metaTrafficKey(row: {date:string;account_id:string;campaign_id:string;adset_id?:string;ad_id?:string}): string` usando array JSON sem colisão por delimitador. SQL `meta_normalize_account_id(text) RETURNS text`; preservar `meta_validate_traffic_row(jsonb) RETURNS void`, `meta_connect_ad_account(text,text,text,text) RETURNS uuid`, `meta_disconnect_ad_account(text,text) RETURNS void` e assinaturas de `meta_import_daily`, `meta_edit_import_row`, `meta_edit_traffic_row`.

- [ ] **1. Escrever testes que falham:** identidade numérica/prefixada, prefixo repetido e chaves distintas; SQL rejeita nível nulo, moeda USD, gasto negativo, datas `2026-02-30`/`2026-02-29` e aceita `2024-02-29`, contagem fracionária, IDs hierárquicos ausentes, chaves duplicadas e edição A→B ocupado. Cadastro pendente/suspenso não conecta; arquivo parcial não zera campos publicados; lead sem contato permanece importável.

```js
assert.equal(normalizeMetaAccountId(' act_123 '), '123')
assert.throws(() => normalizeMetaAccountId('act_act_123'))
assert.notEqual(metaTrafficKey({ ...row, campaign_id: 'a:b', adset_id: 'c' }),
  metaTrafficKey({ ...row, campaign_id: 'a', adset_id: 'b:c' }))
```

- [ ] **2. Rodar RED:** NODE(`scripts/verify-meta-identity-regressions.mjs`) e SQL(`scripts/verify-meta-validation-db.sql`) no schema anterior; deve falhar especificamente nos defeitos reproduzidos, não em conexão ou fixture.
- [ ] **3. Implementar:** remover somente um prefixo e exigir 1–80 dígitos ASCII para conta. IDs de campanha/conjunto/anúncio mantêm compatibilidade histórica de texto 1–80; não aplicar a eles a regra numérica sem migração. Preflight identifica contas legadas que colidem após normalização e impede junção automática; referências históricas somente mudam por proposta explícita revisada. Validar dinheiro como JSON numérico finito, gasto ≤100.000.000, receita dentro de `numeric(16,2)`, leads/compras ≤2.147.483.647 e outras contagens ≤9.007.199.254.740.991, sem arredondar contagem inválida. Textos seguem limites do schema atual; ausência de nível falha explicitamente. Data de CSV/edição não supera hoje em Brasília; API usa hoje no fuso registrado pelo serviço, sem aceitar fuso arbitrário do cliente. Preservar disponibilidade de patches e checar colisões antes de atualizar. Gestão de conta exige `is_executive(auth.uid()) AND traffic_has_access()`.
- [ ] **4. Rodar GREEN:** os dois arquivos, verificadores CSV/edição e SQL de aprovação/edição atuais. Substituir contas sintéticas `qa-*`/`act_1` por IDs numéricos únicos nas fixtures; não enfraquecer a validação para manter testes antigos.
- [ ] **5. Commit:** `fix(traffic): validate identities and preserve edit uniqueness`.

### Task 2: Tornar Graph e definição de métricas verificáveis

**Files:** alterar `supabase/functions/_shared/meta-graph.ts` e `scripts/verify-meta-sync-regressions.mjs`; criar `shared/meta-contract.ts`, `supabase/functions/_shared/meta-insights.ts`, `scripts/helpers/meta-edge-harness.mjs`, `scripts/verify-meta-graph-regressions.mjs`.

**Interfaces:** `MetaGraphRequest = {path:string;params:Record<string,string>}`; `GraphBudget = {deadlineMs:number;signal?:AbortSignal}`; `fetchGraphPage<T>(request:MetaGraphRequest,token:string,budget:GraphBudget): Promise<{data:T[];next:MetaGraphRequest|null}>`; preservar `metaGraphGet` e fazer `fetchAllPages` lançar erro se não terminar. `selectCanonicalAction(actions:MetaAction[]|undefined,types:readonly string[]): {actionType:string|null;value:number|null}`. `buildInsightRow(input:MetaInsight,context:InsightContext): CapturedTrafficRow`.

`CapturedTrafficRow` estende `ImportRow` com `available_metrics:string[]` e `metric_metadata:{version:1;definition_version:'canonical-v1';lead_action:string|null;purchase_action:string|null;raw_actions:MetaAction[];raw_action_values:MetaAction[];account_timezone:string;graph_version:string;request_params:Record<string,string>}`. Não contém token. `MetaInsight` conserva os campos do `InsightRow` atual (`date_start`, hierarquia, métricas string opcionais, actions/action_values), sem depender do handler. `InsightContext = {account:{id:string;name:string;currency:'BRL';timezone:string};level:MetaLevel;objective:string;params:Record<string,string>;graphVersion:string}`. Tipos puro TS ficam em `shared/meta-contract.ts`, sem imports de Deno/React; contratos de linhas importadas também ficam nesse arquivo, reexportados em `src/lib/meta-traffic.ts`, para impedir dependência de Edge em módulos do cliente.

- [ ] **1. Escrever testes que falham:** aliases 10+10+10 produzem 10; `lead=0` prevalece sobre fallback 10; receita só usa a ação da compra escolhida. Próxima página em host estranho falha antes de enviar token; erro 429 respeita orçamento; cursor inválido não completa captura; campo não solicitado fica indisponível. Assertar que próximo request persistível não contém `access_token` nem `appsecret_proof`.

```js
assert.deepEqual(selectCanonicalAction([
  { action_type:'lead', value:'0' }, { action_type:'onsite_conversion.lead_grouped', value:'10' },
], ['lead','onsite_conversion.lead_grouped']), { actionType:'lead', value:0 })
```

- [ ] **2. Rodar RED:** NODE(`scripts/verify-meta-graph-regressions.mjs`); o teste de sobreposição deve demonstrar 30 antes da correção quando usar o adaptador atual.
- [ ] **3. Implementar:** ordem de aliases exata da especificação; validar números de ações sem `Number(value)||0`. Timeout por requisição `min(8.000ms, orçamento restante)`, até três tentativas apenas para rede/429/5xx e rate limit Graph, com esperas de 500/1.000ms ou `Retry-After`, sem iniciar tentativa fora do orçamento. Validar HTTPS, host e caminho da paginação; salvar caminho/parâmetros sem credenciais e reintroduzir token somente no fetch. Resposta com `data` inválido falha. Preservar ações brutas e não arredondar número malformado. Conferir campos de atribuição contra a versão configurada; se a Meta não fornecer a configuração, registrar desconhecida.
- [ ] **4. Rodar GREEN:** nova suíte e `verify-meta-sync-regressions.mjs`; fixtures Graph devem incluir metadados reais e hierarquia válida por nível.
- [ ] **5. Commit:** `fix(meta): select canonical actions and verify Graph pagination`.

### Task 3: Acrescentar staging e revisão atômica de janelas

**Files:** criar `supabase/migrations/20261011130000_meta_capture_reviews.sql`, `scripts/verify-meta-capture-db.sql`; alterar contratos em `shared/meta-contract.ts` quando necessário, preservando nomes aqui definidos.

**Interfaces e schema:**

- `meta_sync_runs`: acrescentar `level`, `coverage_state` (`legacy/partial/complete`), `request_params`, `account_metadata`, `definition_version`, `next_request`, `page_count`, `claim_token`, `lease_until`, `next_retry_at`; status admite `partial`. Índice de execução ativa v2 inclui nível; execuções legadas continuam com exclusão compatível.
- `meta_insights_pages(run_id,page_no,request_hash,rows,next_request,created_at)`: PK `(run_id,page_no)`, RLS/revoke para clientes. Página repetida de mesmo hash é idempotente; conteúdo diferente no mesmo índice falha.
- `meta_capture_reviews(id,account_id,level,window_start,window_end,status,version,manifest,sync_run_id,reviewed_by,reviewed_at,review_note,created_at,updated_at)` e `meta_capture_review_rows(review_id,row_no,original_key,effective_key,operation,payload,before_snapshot,before_version,edited,edit_reason,conflict_details)`. Operação `upsert/remove`; status `pendente/aprovado/rejeitado/substituido`; parte não é unidade de aprovação. Chaves únicas por revisão. Revisão pronta guarda snapshot completo; edição explícita cria nova versão, sem mutação silenciosa do manifesto observado. `conflict_details` preserva candidatos recebidos/editados/publicados e fica nulo quando resolvido.
- `meta_capture_open(p_account_id text,p_level text,p_start date,p_end date,p_params jsonb,p_metadata jsonb,p_triggered_by text,p_actor uuid) RETURNS uuid`; `meta_capture_claim(p_id uuid,p_lease_seconds integer DEFAULT 60) RETURNS jsonb`; `meta_capture_append(p_id uuid,p_claim uuid,p_page_no integer,p_request_hash text,p_rows jsonb,p_next jsonb) RETURNS jsonb`; `meta_capture_release(p_id uuid,p_claim uuid,p_error text DEFAULT NULL,p_retry_at timestamptz DEFAULT NULL) RETURNS void`; `meta_capture_prepare(p_id uuid,p_claim uuid) RETURNS uuid`. Somente serviço.
- `meta_capture_review_part(p_id uuid,p_version bigint,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS jsonb`; `meta_capture_review_edit(p_id uuid,p_version bigint,p_row_no integer,p_patch jsonb,p_reason text) RETURNS jsonb`; `meta_capture_review_resolve(p_id uuid,p_version bigint,p_row_no integer,p_action text,p_payload jsonb,p_reason text) RETURNS jsonb`; `meta_capture_review_decide(p_id uuid,p_version bigint,p_action text,p_note text DEFAULT '') RETURNS jsonb`. Auth ativo de Tráfego. Parte retorna `{id,version,total,rows,next_offset}`; decisão `{id,status,version,inserted,updated,removed}`; edição/resolução `{id,version}`. Resolução aceita `keep_published/use_incoming/use_edited/remove`: conservar fato exclui sua mudança proposta; recaptura usa candidato congelado; edição aplica payload validado; remoção exige fato publicado e motivo. Cada escolha é auditada, revalida unicidade e aumenta versão; conflito não resolvido bloqueia aprovação.
- `meta_traffic_daily` recebe `available_metrics text[]`, `metric_metadata jsonb`, `original_key jsonb`, `capture_review_id uuid`, todos opcionais para histórico. `meta_import_batches` recebe `replaced_by_review_id uuid` para preservar a evidência dos lotes API antigos incorporados à nova revisão e bloquear sua aprovação obsoleta. Auditoria admite revisão e remoção, com antes/depois e primeira origem. Não expor staging por RLS; partes de revisão usam RPC autorizada.

- [ ] **1. Escrever testes que falham:** captura incompleta não prepara revisão; replay da página não duplica; captura completa vazia propõe remoção de fatos API da janela; CSV/legado ausente nunca vira remoção automática. 2.001 linhas são uma revisão com duas partes e decisão única. A edição A→B ocupado falha; preservar edição por chave original e linhas fora da janela em recaptura. Conflito bloqueia aprovação até uma resolução com motivo, e cada escolha conserva primeira origem/candidatos auditados. Incorporar lote API legado bloqueia sua aprovação antiga sem mudar decisões anteriores; revisão substituída não pode ser aprovada. Outra aprovação ou edição publicada causa conflito `40001` e rollback de todos os fatos/auditoria.

```sql
-- Após preparar e ler a versão de uma revisão sintética:
SELECT pg_temp.assert((public.meta_capture_review_part(review_id,version,0,2000)->>'total')::int=2001,'total incompleto');
-- Alterar um fato antes de decidir deve produzir serialization_failure (40001).
```

- [ ] **2. Rodar RED:** SQL(`scripts/verify-meta-capture-db.sql`) antes da migration; falha pela ausência dos contratos novos, com fixture íntegra.
- [ ] **3. Implementar:** lock por conta/nível, páginas de até 500 linhas, leases de 60s e validação de claim. Criar manifesto apenas com páginas contíguas, pedidos compatíveis com o escopo e paginação terminada. Uma única revisão API pendente por conta/nível incorpora a proposta anterior: conserva linhas fora da nova janela e edições por chave original; substitui somente a janela completa recebida. Marcar revisão anterior como substituída na mesma transação e rejeitar sua decisão por versão/status. Na primeira preparação, incorporar igualmente linhas dos lotes API legados pendentes e marcar `replaced_by_review_id`; RPCs antigas recusam decidir esses lotes incorporados, sem registrá-los como aprovados/rejeitados. Manifesto guarda segmentos de cobertura e referências de execução por linha, sem afirmar completude de datas entre segmentos. Linhas publicadas editadas não viram remoção automática, recebem conflito para decisão explícita. Remoções alcançam somente fatos com linhagem API compatível; outros fatos ausentes são conflitos, nunca exclusão silenciosa. Lock dos fatos em ordem de chave e comparar versões antes de aplicar. Decisão aplica revisão inteira na transação. Atualizar payload/manifesto por versão durante edição; exigir motivo para remoção e rejeição. Manter RPCs antigas como patches pendentes; elas não podem decidir revisões v2. Sua seleção/índice de lote pendente exclui lotes incorporados, sem sobrescrever a evidência deles.
- [ ] **4. Rodar GREEN:** suíte nova, SQL de aprovação/edição atuais e conferir grants, FKs, RLS e audit de DELETE. Testar falha de auditoria forçada no ambiente de teste e verificar zero publicação parcial.
- [ ] **5. Commit:** `feat(traffic): stage complete captures for atomic human review`.

### Task 4: Retomar captura Insights dentro do orçamento

**Files:** criar `supabase/functions/_shared/meta-insights-capture.ts`, `scripts/verify-meta-capture-regressions.mjs`; alterar `supabase/functions/meta-insights-sync/index.ts`, `supabase/functions/_shared/meta-auth.ts` apenas se necessário ao contrato existente.

**Interfaces:** consumir Graph e RPCs das tarefas 2–3. Produzir `captureAccountLevel(admin:SupabaseClient,input:{accountId:string;level:MetaLevel;since:string;until:string;actor:string|null;triggeredBy:'cron'|'manual';deadlineMs:number},token:string): Promise<{runId:string;state:'complete'|'partial'|'error'|'skipped';rowsCaptured:number;reviewId?:string;error?:string}>`. Handler aceita `{days?:number;resumeOnly?:boolean}` e retorna `{ok,partial,results}`; 202 para progresso parcial sem falha, 200 completo, 502 falha, sem representar capture parcial como success.

- [ ] **1. Escrever testes que falham:** 21 páginas retomam após interrupção sem preparar manifesto antes do fim; conta `act_123` nunca produz prefixo duplicado; captura vazia chama preparação; metadados USD bloqueiam; falha ao finalizar/registrar revisão não responde sucesso. Duas contas em fusos diferentes e virada de dia usam suas próprias janelas; objetivos repetidos são buscados uma vez por campanha na execução.

Assertions do teste `capture_budget_exhaustion_persists_cursor_without_preparing_review`, com relógio terminando o orçamento após a primeira página:

```js
assert.equal(response.status,202)
assert.equal((await response.json()).partial,true)
assert.equal(rpcCalls.filter(call=>call.name==='meta_capture_append').length,1)
assert.equal(rpcCalls.filter(call=>call.name==='meta_capture_prepare').length,0)
```
- [ ] **2. Rodar RED:** NODE(`scripts/verify-meta-capture-regressions.mjs`) com handler real e banco/rede substituídos, relógio controlado.
- [ ] **3. Implementar:** consultar metadados `name,currency,timezone_name` da conta antes de iniciar captura; validar fuso IANA, BRL e ID canônico. Janela dos últimos `days` inclui hoje e `days-1` dias anteriores, calculada por calendário da conta. Orçamento total da requisição 45s, reserva de 5s para salvar/finalizar; processar páginas serialmente sob claim e persistir cada uma. Retomar trabalhos elegíveis antes de novos, com alternância justa de conta/nível; cursor expirado encerra a tentativa como erro e reinicia uma captura nova sem publicar a anterior. Não usar `waitUntil` como único mecanismo de continuação. `resumeOnly` é exclusivo cron e não cria uma captura nova.
- [ ] **4. Rodar GREEN:** nova suíte, Graph e sync antigas. Assertar que qualquer janela completa tem todas as páginas gravadas; segredo não aparece em erro, staging ou manifesto.
- [ ] **5. Commit:** `fix(meta): resume Insights captures without partial publication`.

### Task 5: Dar posse e recuperação à fila de leads

**Files:** criar `supabase/migrations/20261011140000_meta_lead_queue.sql`, `scripts/verify-meta-lead-queue-db.sql`.

**Interfaces:** preservar `meta_webhook_event_receive(text,text,text) RETURNS uuid`; acrescentar à tabela `next_attempt_at`, `lease_until`, `claim_token`, `processing_attempts`, `receipt_count`, `error_class` e status `processing`. Recebimento repetido aumenta recibos, não tentativas de processamento. `meta_lead_events_claim(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60,p_page_ids text[] DEFAULT '{}') RETURNS SETOF meta_webhook_events`; `meta_lead_event_ingest(p_id uuid,p_claim uuid,p_data jsonb) RETURNS uuid`; `meta_lead_event_fail(p_id uuid,p_claim uuid,p_error text,p_class text) RETURNS void`; `meta_lead_event_ignore(p_id uuid,p_reason text) RETURNS void`. Somente serviço; página autorizada entra no claim e a configuração vazia reivindica zero eventos.

Criar `meta_lead_discovery_state(page_id PRIMARY KEY,version bigint,window_since timestamptz,forms_next jsonb,form_id text,leads_next jsonb,last_completed_until timestamptz,lease_until timestamptz,claim_token uuid,last_error text)`. RPCs de serviço `meta_lead_discovery_claim(p_page_id text,p_lease_seconds integer DEFAULT 60) RETURNS jsonb`, `meta_lead_discovery_checkpoint(p_page_id text,p_claim uuid,p_expected_version bigint,p_state jsonb) RETURNS bigint`, `meta_lead_discovery_release(p_page_id text,p_claim uuid,p_error text DEFAULT NULL) RETURNS void`.

- [ ] **1. Escrever testes que falham:** dois claims não pegam o mesmo evento; token antigo não conclui/falha após novo claim; processado não regride; um replay com page/form divergentes não altera identidade original. Retomar evento de mais de 48h; verificar next_attempt em 1/5/15/60/60min; lease expirado volta. Ingestão e conclusão falham juntas em erro de banco; lead aprovado/corrigido conserva decisão/vínculo; cursor só avança se a página de eventos já foi gravada.

Assertions SQL do caso `processed_event_cannot_be_downgraded_by_old_worker`, dentro da fixture DO que criou o evento e os claims:

```sql
PERFORM pg_temp.expect_error(format('SELECT public.meta_lead_event_fail(%L,%L,%L,%L)',event_id,old_claim,'erro atrasado','transient'),'40001');
PERFORM pg_temp.assert((SELECT status='processed' FROM public.meta_webhook_events WHERE id=event_id),'evento processado regrediu');
```
- [ ] **2. Rodar RED:** SQL(`scripts/verify-meta-lead-queue-db.sql`); as assertions de conclusão atrasada e concorrência devem cobrir os defeitos atuais.
- [ ] **3. Implementar:** `FOR UPDATE SKIP LOCKED`, claim UUID e verificação de lease/posse. Ingestão reutiliza `meta_ingest_form_lead` e marca processado na mesma transação. Configuração/autorização usa classe e retry reduzido de 60min; erro transitório usa sequência definida; não há corte por idade de recebimento. Wrapper antigo `meta_webhook_event_complete(uuid,text,text,uuid)` não altera eventos em lease nem rebaixa processado; desativar cron legado antes de trocar worker na implantação. Descoberta salva requests sem token e nunca avança um cursor antes do recebimento durável da página inteira.
- [ ] **4. Rodar GREEN:** nova suíte e SQL atuais de leads/edições; usar duas conexões simultâneas para provar exclusão, além das assertions de token. Conferir que authenticated/anon não invocam claim, ingest, fail ou checkpoint.
- [ ] **5. Commit:** `fix(meta): lease lead events and recover failed processing`.

### Task 6: Separar ACK de webhook e executar worker recuperável

**Files:** criar `supabase/functions/_shared/meta-lead-worker.ts`, `scripts/verify-meta-webhook-regressions.mjs`, `scripts/verify-meta-lead-worker-regressions.mjs`; alterar `supabase/functions/_shared/meta-lead-ingest.ts`, `supabase/functions/meta-lead-webhook/index.ts`, `supabase/functions/meta-leads-reconciliation/index.ts`, `scripts/verify-meta-sync-regressions.mjs`.

**Interfaces:** `receiveLeadgenEvent(admin,event:{leadgenId:string;pageId:string;formId:string},allowedPages:string[]): Promise<{eventId:string;status:'pending'|'ignored'}>`; `processClaimedLead(admin,event:ClaimedLeadEvent,token:string,budget:GraphBudget): Promise<LeadIngestOutcome>`; `runLeadWorker(admin,input:{pageIds:string[];token:string|null;deadlineMs:number;discover:boolean}): Promise<{processed:number;failed:number;ignored:number;partial:boolean;errors:string[]}>`. `ClaimedLeadEvent` contém `id,leadgen_id,page_id,form_id,claim_token,processing_attempts`; manter `ingestLeadgenId` como wrapper de compatibilidade que recebe e reivindica pelo contrato protegido, sem conclusão antiga concorrente.

- [ ] **1. Escrever testes que falham:** assinar corpo real com HMAC; sem token Graph o POST persiste e responde 200; receive falhando responde 503; dois eventos com falha no segundo tornam o replay idempotente; assinatura inválida não grava. Allowlist vazia/outra página registra ignorado e não busca contato. Worker processa pendência antiga sem descoberta; processado não chama Graph/IA; permissão `pages_manage_ads` falha de forma visível sem descartar evento; orçamento esgotado salva progresso.

Assertions de `webhook_without_graph_token_still_persists_before_ack`, executado com requisição assinada e `META_SYSTEM_USER_TOKEN` vazio:

```js
assert.equal(response.status,200)
assert.equal(rpcCalls.filter(call=>call.name==='meta_webhook_event_receive').length,1)
assert.equal(graphCalls.length,0)
```
- [ ] **2. Rodar RED:** NODE dos dois arquivos, executando handlers reais; evitar teste que apenas compara texto da implementação.
- [ ] **3. Implementar:** webhook somente valida corpo/estrutura e grava recebimentos; JSON inválido ou leadgen sem identidade responde 400. Não invocar Graph/IA antes do ACK. Worker usa orçamento 45s/reserva 5s, claim de no máximo dez por vez e requisições limitadas pela tarefa 2. Drain da fila precede descoberta, mas reserva parte do orçamento para descoberta quando houver progresso; persistir cursor de forms/leads e deduplicar eventos antes de chamar detalhes. Falta de token/configuração vira diagnóstico e mantém pendências; ausência de página autorizada não libera acesso. Sanitizar erros e não logar contatos/URLs com token.
- [ ] **4. Rodar GREEN:** suites novas e sync atual com assertions adaptadas ao recebimento/processamento separado. Preservar validação de assinatura bruta, segredo cron e uso do token de página configurado.
- [ ] **5. Commit:** `fix(meta): acknowledge durable webhook receipts and drain lead queue`.

### Task 7: Preservar contatos determinísticos e limitar IA

**Files:** alterar `supabase/functions/_shared/meta-lead-extract.ts`, `supabase/functions/_shared/meta-lead-extract.test.ts`, `supabase/functions/_shared/meta-lead-ingest.ts`; criar `supabase/functions/_shared/meta-typesafe.ts`.

**Interfaces:** manter `extractLeadFields(fieldData:FieldAnswer[]|undefined,askJev:SystemOneCaller): Promise<ExtractedLeadFields>`; ampliar `SystemOneCaller` para consumir instruções parciais `Partial<Record<keyof ExtractedLeadFields,string>>`. Produzir `callJev(criteria:Record<string,string>,instructions:Partial<Record<keyof ExtractedLeadFields,string>>,budget:GraphBudget): Promise<Record<string,ChoiceAnswer>>` no adaptador TypeSafe, usando o endpoint/modelo existentes.

- [ ] **1. Escrever testes que falham:** todos os campos exatos evitam IA; nome exato e telefone ambíguo enviam somente instrução de telefone; baixa confiança não apaga nome. Rejeitar `f-1`, `x1`, `f1abc`, índice fora da lista, confiança NaN/Infinity/<0/>1. `0,5` aceita seleção válida, `0,49` não aceita. Timeout devolve determinísticos e conserva `field_data` intacto.

```ts
const known = [{name:'full_name',values:['Maria']},{name:'phone_number',values:['11999990000']},{name:'email',values:['m@example.invalid']}]
let calls = 0
const result = await extractLeadFields(known, async () => { calls++; throw new Error('indisponível') })
assertEquals(result.full_name,'Maria'); assertEquals(calls,0)
```

- [ ] **2. Rodar RED:** `deno test supabase/functions/_shared/meta-lead-extract.test.ts`; novas assertions devem demonstrar apagamento/chamada desnecessária atuais.
- [ ] **3. Implementar:** consumir o skill TypeSafe pertinente antes de mudar o adaptador; rótulos atuais determinísticos por campo, IA somente para os restantes, regex `^f(0|[1-9][0-9]*)$` e índice inteiro seguro. Timeout IA `min(3.000ms, orçamento restante)` sem retry dentro da mesma tentativa; persistir respostas mesmo quando extração falhar.
- [ ] **4. Rodar GREEN:** suíte Deno e worker; comparar input antes/depois para provar ausência de mutação dos originais.
- [ ] **5. Commit:** `fix(meta): retain known contacts when AI extraction is uncertain`.

### Task 8: Publicar coorte comercial com cobertura explícita

**Files:** criar `supabase/migrations/20261011150000_meta_traffic_cohort.sql`, `scripts/verify-meta-cohort-db.sql`; alterar `shared/meta-contract.ts`, `src/lib/arena-api.ts` e tipos gerados após validar o schema de teste.

**Interfaces:** preservar as duas RPCs atuais de atribuição/reconciliação. Criar `meta_traffic_cohort(p_start date,p_end date,p_account_id text DEFAULT NULL,p_campaign_id text DEFAULT NULL,p_source text DEFAULT NULL) RETURNS jsonb` com `TrafficCohortResult = {state:'ready'|'insufficient';reasons:string[];campaigns:CampaignCohort[];unattributed_contacts:number}`. `CampaignCohort = {campaign_id:string;campaign_name:string;received:number;pending:number;approved:number;linked_crm:number;confirmed_sales:number;confirmed_revenue:number;coverage:'complete'|'partial'|'unknown'}`. Exportar ambos os tipos em `shared/meta-contract.ts`. Não retorna contatos. Falha de SQL continua erro da consulta, não um `state` pronto.

- [ ] **1. Escrever testes que falham:** lead gerado no intervalo com venda posterior entra na coorte; cancelada/estornada sai; aprovação pendente não gera venda atribuída; origem parcial bloqueia cobertura para taxas; conta/fuso não comprovado retorna unknown; campanha desconhecida aparece em não atribuídos. SDR sem Tráfego e cadastro suspenso falham com `42501`.

Assertions do caso SQL `cohort_source_filter_cannot_proportionally_assign_sales`, com gasto API e CSV misturados na mesma campanha:

```sql
result:=public.meta_traffic_cohort('2026-10-07','2026-10-09','123','A','api');
PERFORM pg_temp.assert(result->>'state'='insufficient','origem parcial recebeu cobertura completa');
PERFORM pg_temp.assert((result->'campaigns'->0->>'confirmed_sales')::int=1,'venda foi rateada pelo gasto');
```
- [ ] **2. Rodar RED:** SQL(`scripts/verify-meta-cohort-db.sql`) antes da RPC nova.
- [ ] **3. Implementar:** reutilizar joins e status comerciais atuais. Datas da coorte conservam Brasília; outra conta/fuso fica incompatível para taxas até haver vínculo/calendário comprovados. Identificar conta por identidade canônica da campanha quando unívoca; não adivinhar por nome. Origem CSV/API restringe gasto, não inventa origem do contato: marcar parcial se não houver comprovação de cobertura. Consultar manifesto/revisões aprovadas para cobertura API; patches/histórico sem evidência suficiente permanecem unknown. Incluir revisão/captura parcial e contatos sem vínculo nos motivos.
- [ ] **4. Rodar GREEN:** suíte nova e atuais de aprovação, reversão e CRM relevantes; conferir que nenhuma linha de contato é retornada.
- [ ] **5. Commit:** `feat(traffic): report CRM cohorts with verified spend coverage`.

### Task 9: Unificar recorte, dimensão e apresentação de desempenho

**Files:** criar `src/lib/meta-traffic-view.ts`, `src/components/traffic/MetaTrafficPerformance.tsx`, `scripts/verify-meta-view-regressions.mjs`, `scripts/verify-meta-performance-ui.mjs`; alterar `src/pages/Trafego.tsx`, `src/lib/meta-traffic.ts` e contratos.

**Interfaces:** `TrafficScope = {start:string;end:string;level:MetaLevel;accountId:string|null;campaignId:string|null;source:'api'|'csv'|'manual_legacy'|null}`; `selectTrafficRows(rows:MetaDailyRow[],scope:TrafficScope): MetaDailyRow[]`; `buildTrafficView(rows:MetaDailyRow[],scope:TrafficScope): TrafficView`; `buildTrafficCsv(view:TrafficView): {headers:string[];rows:(string|number)[][]}`; `crmTrafficRates(cohort:TrafficCohortResult,view:TrafficView): {cpa:number|null;roas:number|null;reason:string|null}`. `TrafficView` contém `scope,rows,total,daily,groups,warnings`; grupos têm chave completa por conta/campanha/conjunto/anúncio e identificações; métricas indisponíveis usam null. Props `MetaTrafficPerformance({view,queryState,cohortState,onRetry})`; queryState/cohortState discriminam loading/ready/error.

`TrafficMetricTotals` tem os nomes atuais de `aggregateMeta` (`spend,leads,purchases,purchaseValue,impressions,linkClicks,messagesStarted,cpl,cpa,roas,cpm,cpc,costPerMessage,ctr`), todos `number|null`. `TrafficView.total:TrafficMetricTotals`; `daily:{date:string;metrics:TrafficMetricTotals}[]`; `groups:{key:string;account_id:string;campaign_id:string;campaign_name:string;adset_id:string;adset_name:string;ad_id:string;ad_name:string;metrics:TrafficMetricTotals}[]`; `warnings:string[]`. `QueryState<T> = {state:'loading'}|{state:'ready';data:T}|{state:'error';message:string}`. Props: `view:TrafficView|null,queryState:QueryState<MetaDailyRow[]>,cohortState:QueryState<TrafficCohortResult>|null,onRetry:()=>void`; não calcular view de consulta em erro como conjunto vazio conhecido.

- [ ] **1. Escrever testes que falham:** A selecionada exclui B em total, grupos, daily e CSV; dois anúncios do mesmo conjunto continuam dois grupos; mesmo nome em contas distintas não junta entidades. Erro CRM rende alerta e “—”, nunca 0.00x. Data impossível, origem parcial, metadados incompatíveis e mistura de fusos não produzem taxa consolidada; total de tabela paginada usa recorte completo. `nao_informado` continua nessa categoria. Ausência de contagem em CSV não vira zero conhecido.

```js
const view = buildTrafficView([rowA,rowB],{...scope,campaignId:'A'})
assert.equal(view.total.spend,100)
assert.deepEqual(view.groups.map(group=>group.campaign_id),['A'])
assert.equal(buildTrafficCsv(view).rows.length,1)
assert.deepEqual(crmTrafficRates({state:'insufficient',reasons:['origem parcial'],campaigns:[],unattributed_contacts:0},view),
  {cpa:null,roas:null,reason:'origem parcial'})
```

- [ ] **2. Rodar RED:** NODE dos dois arquivos; reutilizar a reprodução de tela da auditoria como fixture, transformando-a em teste do componente real exportado.
- [ ] **3. Implementar:** seleção única, acumulação em maps por dia/chave e taxas dos totais; disponibilidade derivada de `available_metrics`/definição. Histórico sem disponibilidade preserva valores registrados com rótulo legado, e taxas de definição/cobertura desconhecida ficam indisponíveis. Manter `aggregateMeta` compatível para consumidores antigos, sem fazê-lo calcular disponibilidade por suposição; a nova view usa agregador consciente dos metadados. CSV contém IDs, período, origem e definição, com escape correto. Exibir Meta/CRM separados, reconciliar campanhas pelo mesmo recorte e oferecer repetir consulta em erro. Paginação visual de grupos em 50 linhas; exportar recorte inteiro.
- [ ] **4. Rodar GREEN:** suites novas, CSV atual e TypeScript. Confirmar que tabela não usa lista de campanhas anterior ao filtro como conjunto de dados.
- [ ] **5. Commit:** `fix(traffic): align performance filters tables and exports`.

### Task 10: Carregar revisões sob demanda e decidir a versão vista

**Files:** criar `src/lib/meta-traffic-queries.ts`, `src/components/traffic/MetaPendingImports.tsx`, `scripts/verify-meta-review-ui.mjs`; alterar `src/pages/Trafego.tsx`, `src/components/traffic/MetaTrafficData.tsx`, `src/lib/arena-api.ts`; atualizar tipos gerados de RPC.

**Interfaces:** `fetchTrafficReviewList(input:{kind:'metrics'|'leads';status:string|null;offset:number;limit:number}): Promise<{rows:TrafficReviewSummary[];count:number}>`; `fetchTrafficReviewPart(input:{id:string;version:number;offset:number;limit:number}): Promise<TrafficReviewPart>`; `fetchLegacyBatchRows(kind:'metrics'|'leads',id:string): Promise<ImportRow[]|LeadImportRow[]>`. Summary distingue `format:'legacy'|'capture-v1'`, id/version ou updated_at, contagem, janela, origem e status; não contém rows. Componente recebe `active:boolean,canReview:boolean,onReviewed:()=>Promise<unknown>` e usa os contratos de decisão existentes ou v2 conforme format.

Exportar em `src/lib/meta-traffic-queries.ts`: `TrafficReviewSummary = {format:'legacy'|'capture-v1';kind:'metrics'|'leads';id:string;filename:string;version:number|null;updated_at:string;status:string;row_count:number;source:'api'|'csv';window_start:string|null;window_end:string|null;replaced_by_review_id:string|null}` e `TrafficReviewPart = {id:string;version:number;total:number;rows:{row_no:number;operation:'upsert'|'remove';payload:ImportRow|null;before_snapshot:MetaDailyRow|null;edit_reason:string|null;conflict_details:Record<string,unknown>|null}[];next_offset:number|null}`. Remoções não exigem um payload de inserção; a UI apresenta before_snapshot e motivo.

- [ ] **1. Escrever testes que falham:** listas não selecionam coluna rows; abrir revisão busca só sua parte/version; troca de aba desliga polling pesado; dois detalhes não compartilham cache errado. Aprovar sem carregar/mostrar resumo de remoções não ocorre; “Aprovar todas” decide revisões lógicas inteiras, não suas partes. Conflito `40001` informa alteração e recarrega; aprovação bem-sucedida seguida de falha de refresh não aparece como decisão falha. Upload A lento seguido de B rápido deixa B na prévia.

Assertions de `review_list_never_fetches_embedded_rows` e `upload_latest_file_wins`, com spy de query e promises de leitura resolvidas em ordem inversa:

```js
assert(selectedColumns.every(columns=>columns!=='*' && !columns.split(',').includes('rows')))
assert.equal(renderedPreview.filename,'B.csv')
assert.equal(reviewDecisionCalls.length,0)
```
- [ ] **2. Rodar RED:** NODE(`scripts/verify-meta-review-ui.mjs`) com funções/componentes reais e fronteiras de consulta controladas.
- [ ] **3. Implementar:** lista paginada em 50, detalhes em 500 (máximo 2.000 imposto pelo banco), query keys com user/id/version/offset; queries leves de contagem para badge, polling 30s somente na aba ativa. Separar revisão v2 dos arrays de lotes legados; lotes com `replaced_by_review_id` aparecem no histórico como incorporados e não entram no badge/decisão. Motivo, antes/depois e conflitos visíveis; oferecer as quatro escolhas de `meta_capture_review_resolve` com motivo obrigatório e bloquear decisão enquanto houver conflito. Montar RPC args tipados em `arena-api.ts`; regenerar tipos do schema de teste e conservar contratos aditivos existentes. Proteger upload métrico com `loadVersion` equivalente ao de leads. Histórico de lotes carregado por página, com sort created_at/id.
- [ ] **4. Rodar GREEN:** nova suíte, edição/lead import atuais e TypeScript; verificar payload de listagem com 100 lotes sintéticos e confirmar que o tamanho cresce com metadados da página, não com linhas internas.
- [ ] **5. Commit:** `perf(traffic): fetch review details lazily and guard stale decisions`.

### Task 11: Restaurar sinais e tornar operação visível

**Files:** criar `supabase/migrations/20261011160000_meta_traffic_signals.sql`, `src/components/traffic/MetaTrafficConnection.tsx`, `scripts/verify-meta-signals-db.sql`, `scripts/verify-meta-operation-ui.mjs`; alterar `src/pages/Trafego.tsx`, `src/lib/meta-connection.ts`, `src/lib/meta-traffic-queries.ts`.

**Interfaces:** `trafficRunSummary(runs:MetaSyncRun[],accountId:string|null): {lastAttempt:MetaSyncRun|null;lastComplete:MetaSyncRun|null;partial:MetaSyncRun|null;error:string|null}`; ampliar `MetaSyncRun` com campos da tarefa 3 sem exigir metadados em runs legadas. `MetaTrafficConnection({active,onProposeChange})` preserva gestão de conta e usa metadados/resumos, sem credenciais no cliente.

- [ ] **1. Escrever testes que falham:** tabela de métricas recebe INSERT/UPDATE/DELETE signal; lotes e revisões sinalizam decisões/edições; rollback não incrementa revisão; grant/RLS continua restrito. UI distingue último erro, sucesso completo, pendências e janela publicada; execução partial não recebe label sucesso. Falha `pages_manage_ads` orienta regularizar autorização e mantém importação manual.

Assertions de `partial_run_is_distinct_from_last_success`, com um run partial mais recente que o último completo:

```js
const status = trafficRunSummary([partialRun,completeRun],'123')
assert.equal(status.lastAttempt.id,partialRun.id)
assert.equal(status.lastComplete.id,completeRun.id)
assert.equal(status.partial.id,partialRun.id)
```
- [ ] **2. Rodar RED:** SQL(`scripts/verify-meta-signals-db.sql`) e NODE(`scripts/verify-meta-operation-ui.mjs`); falta real do trigger deve ser reproduzida no snapshot do banco de teste.
- [ ] **3. Implementar:** migrations idempotentes por inspeção, restaurar `meta_traffic_signal` para INSERT/UPDATE/DELETE, sinais de lote/revisão/auditoria conforme necessidade de leitura e leads nos tópicos atuais arena/crm. Evitar ruído de updates sem mudança com transition tables ou condição de revisão; sem PII no evento. Reutilizar DataSync e refreshDashboardMutation. Extrair Conexão, normalizar input e mostrar captura completa/publicação/pendência separadamente; erro sanitizado específico para autorização. Query operacional com campos resumidos, ativa conforme aba e indicador leve no desempenho.
- [ ] **4. Rodar GREEN:** SQL/suite novas e verificadores `scripts/verify-dashboard-sync-unit.mjs` e `scripts/verify-approval-sync-ui.mjs`. Não alterar sincronização global sem teste que prove necessidade.
- [ ] **5. Commit:** `fix(traffic): restore database signals and expose sync coverage`.

### Task 12: Integrar agendamento, verificar e preparar implantação seletiva

**Files:** criar `supabase/migrations/20261011170000_meta_worker_cron.sql`, `scripts/verify-meta-reliability-schema.sql`, `scripts/verify-meta-reliability-integrated.mjs`, `docs/TRAFEGO_CONFIABILIDADE_OPERACAO_2026-10-11.md`; atualizar `docs/META_ADS_OFFICIAL_API_SETUP_2026-09-27.md`, `supabase/functions/meta-leads-reconciliation/index.ts` (modo discover do cron) e testes antigos impactados.

**Interfaces:** conservar jobs de captura */30 e profundo diário; adicionar job `meta-insights-resume` a cada minuto com `{resumeOnly:true}` e `meta-lead-worker` a cada minuto com `{discover:false}` na função de reconciliação. Job horário passa `{discover:true}`; `meta-leads-reconciliation` valida esse booleano e é sempre cron-only. `net.http_post` dos workers/capturas usa 60.000ms para orçamento Edge de 45s/reserva 5s. Jobs antigos não ficam duplicados. Secrets continuam no Vault, sem valores em docs/SQL/logs.

- [ ] **1. Escrever testes que falham:** fluxo API paginado→revisão→aprovação→view preserva chaves/totais; webhook→fila→pendente→aprovação→CRM preserva respostas; sem aprovação não há publicação/CRM. Após crash/lease vencido a operação retoma uma vez. Em integração, decisão concorrente falha inteira. Preflight de schema detecta trigger/grant errado e versão de migration ausente com objeto presente, sem propor `db push` geral.

Assertions de `capture_does_not_publish_until_review_is_approved`, com handlers reais e a camada SQL verificada separadamente:

```js
assert.equal(beforeDecision.publishedRows.length,0)
assert.equal(beforeDecision.pendingReview.total,2001)
assert.equal(afterDecision.publishedRows.length,2001)
assert.equal(buildTrafficView(afterDecision.publishedRows,scope).total.spend,expectedSpend)
```
- [ ] **2. Rodar RED:** NODE(`scripts/verify-meta-reliability-integrated.mjs`) antes da adaptação de integração e SQL read-only de schema com estado anterior.
- [ ] **3. Implementar cron/runbook:** escolher jobs por nome e alterar de forma seletiva; desativar worker antigo durante troca. Documentar pré-requisitos reais Meta, fila antiga, recuperação de cursor expirado, comparação com Ads Manager, diagnóstico de origem/coorte e rollback conservando artefatos. Registrar schema baseline real antes de preparar pacote seletivo. Os limites oficiais de [Edge Functions](https://supabase.com/docs/guides/functions/limits) permitem esse orçamento; ele é uma escolha operacional abaixo do limite, não garantia de completar contas grandes numa única execução. Não mudar a versão da Graph API sem verificar compatibilidade do app real.
- [ ] **4. Rodar GREEN e revisão final:** suites novas/atuais, todos os SQL em banco de teste, `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.app.json`, `node node_modules/eslint/bin/eslint.js src/pages/Trafego.tsx src/components/traffic src/lib/meta-traffic.ts src/lib/meta-traffic-view.ts src/lib/meta-traffic-queries.ts src/lib/meta-connection.ts src/lib/meta-edit.ts shared supabase/functions/_shared/meta*.ts supabase/functions/meta-insights-sync/index.ts supabase/functions/meta-lead-webhook/index.ts supabase/functions/meta-leads-reconciliation/index.ts`, `node node_modules/vite/bin/vite.js build`. No Windows, expandir o glob de arquivos Meta para argumentos reais se o shell não o expandir. Zero testes falhos e exit 0; investigar falhas específicas antes de repetir checks.
- [ ] **5. Verificar interação real e registrar limites:** navegador autenticado no ambiente de teste, dados sintéticos, dois usuários/sessões e papéis executivo/gestor/SDR/cadastro suspenso. Publicar/editar/rejeitar sintéticos e observar atualização da segunda sessão. Comparar CSV/tabela/cards em três níveis. Conta real exige confronto com Ads Manager e autorização de leads regularizada; se indisponível, registrar essa parte como não verificada e não afirmar integração plenamente funcional.
- [ ] **6. Commit:** `test(traffic): verify recovery review and dashboard consistency`.
- [ ] **7. Preparar resultado reviewable:** relatório de testes, diff, migrations seletivas, ordem banco→Edge→front, jobs a pausar/retomar e caminho de rollback. A implantação no projeto comercial é uma etapa separada: só executar quando houver autorização aplicável para publicar. Nunca aprovar os lotes reais para fazer smoke test. Após implantação autorizada, conferir schema, estados, erros, permissões e revisão de outra sessão sem modificar decisões comerciais.

## Autorrevisão e rastreabilidade

| Seção da especificação | Tarefas que a implementam |
| --- | --- |
| Identidade, moeda, fuso e definições | 1, 2, 4, 9 |
| Captura completa, vazia, paginação, edição e remoções aprovadas | 2, 3, 4, 10 |
| Fila durável, autorização de página, posse e recuperação | 5, 6, 12 |
| Extração e encaminhamento preservado | 6, 7, 8 |
| Validação, RLS, gestão e auditoria | 1, 3, 5, 8, 11 |
| Recorte, dimensões, exportação e coorte | 8, 9 |
| Consultas leves, upload e sincronização entre sessões | 10, 11, 12 |
| Compatibilidade, implantação, recuperação e prova real | 3, 5, 8, 12 |

Checagens de cobertura, passos, tipos, cinco condições de Review Focus e proporção realizadas. Contratos legados permanecem patches; contratos v2 não podem publicá-los automaticamente. As tarefas formam um único fluxo de Tráfego, com dependências explícitas, e não incluem trabalho de calendário ou novos produtos.

Método recomendado: **execução direta nesta sessão (`executing-plans`)**, com uma revisão independente do conjunto ao final, porque banco, worker e interface compartilham contratos e precisam avançar em sequência. A alternativa `subagent-driven-development` adiciona implementador e revisão independentes por tarefa. O usuário deve revisar este plano e escolher o método antes da implementação.
