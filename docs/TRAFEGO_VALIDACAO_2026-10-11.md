# Validação da confiabilidade de Tráfego — 11/10/2026

## Escopo e ambiente

Branch `codex/traffic-reliability`, base `4d720775fc278522d18038a4f439f91a43acd305`, worktree `.worktrees/traffic-reliability`. Implementação das 12 tarefas do plano aprovado, com revisão independente do conjunto antes da entrega. Não houve implantação remota nem aprovação comercial.

PostgreSQL 17.6 descartável em loopback, dois bancos com baseline real (schema sem dados comerciais), sete migrations novas e aplicação independente em um terceiro banco vazio. Funções de aplicação, constraints, RLS, grants, triggers e transações reais. Somente transportes Realtime/cron/pg_net/Vault e Graph são controlados. As fixtures usam `example.invalid`; cada verificação SQL desfaz seus dados. O teste integrado cria e remove apenas seu banco local temporário.

Navegador Chromium executa o front React real; HTTP Supabase é substituído na fronteira por dados sintéticos, com dois contextos isolados e WebSocket desabilitado para exercitar a recuperação por contadores. Permissões reais de banco são testadas separadamente sob `SET LOCAL ROLE authenticated`.

## Verificações executadas

| Verificação | Evidência |
| --- | --- |
| Regressões Node de identidade/Graph/captura/worker/webhook/importação/edição/view/interface + integração | 75/75 passaram; zero falhas |
| Extração determinística e contrato TypeSafe | 8/8 passaram, incluindo opções/confiança inválidas e preservação de dados |
| SQL | 12 arquivos em dois bancos: 24/24 passaram com rollback |
| Migrations | Todas as sete aplicadas em sequência sobre reconstrução vazia do baseline real |
| Integração SQL + handlers reais | 2.001 linhas, cinco páginas, três retomadas, claimant vencido, nenhuma publicação antes da aprovação, decisão concorrente `40001` inteira |
| Webhook + CRM | HMAC real, replay deduplicado, recibo durável, worker real, original preservado, aprovação explícita, um vínculo CRM |
| Cron/preflight | Cinco jobs únicos e pausados; modos executados sobre transporte sintético; ausência de secret não envia; grant/trigger/objeto/histórico incorretos detectados |
| Concorrência da fila | Duas conexões reais não recebem o mesmo claim; dono vencido não finaliza novo claim |
| Navegador de Tráfego | Detalhes lazy, parte de 500, remoção reconhecida, versão stale, quatro escolhas de conflito; aprovação/edição/rejeição atualizam outra sessão; SDR e suspenso sem tela |
| Consistência dos níveis | Renderização real e CSV em campanha/conjunto/anúncio; valores fora do recorte excluídos; tabela de 50 não limita totais/exportação |
| Regressão global | Invalidação/broadcast sem loop e quatro cenários reais de navegador de aprovação de vendas |
| Tipos | TypeScript da aplicação e Deno das quatro funções Edge: exit 0 |
| Estática/build | ESLint dos arquivos de Tráfego/shared/Edge: zero erros/avisos; Vite production build: exit 0 |

Não existe `npm test` neste repositório. Foram executadas as suites pertinentes do diretório `scripts`, mais regressões globais de sincronização/aprovação, sem executar utilitários comerciais destrutivos ou testes antigos que exigiam usuários reais.

## Comandos reproduzíveis

- `node --experimental-vm-modules --test scripts/verify-meta-identity-regressions.mjs scripts/verify-meta-graph-regressions.mjs scripts/verify-meta-capture-regressions.mjs scripts/verify-meta-sync-regressions.mjs scripts/verify-meta-webhook-regressions.mjs scripts/verify-meta-lead-worker-regressions.mjs scripts/verify-meta-lead-import-regressions.mjs scripts/verify-meta-edit-regressions.mjs scripts/verify-meta-view-regressions.mjs scripts/verify-meta-performance-ui.mjs scripts/verify-meta-review-ui.mjs scripts/verify-meta-operation-ui.mjs`
- `node scripts/verify-meta-traffic.mjs` e `node scripts/verify-meta-lead-import.mjs`.
- `deno test --no-lock supabase/functions/_shared/meta-lead-extract.test.ts`.
- `deno check --no-lock supabase/functions/meta-insights-sync/index.ts supabase/functions/meta-lead-webhook/index.ts supabase/functions/meta-leads-reconciliation/index.ts supabase/functions/meta-lead-worker/index.ts`.
- `node scripts/verify-meta-review-browser.mjs` com Vite local em 5199; `TRAFFIC_TEST_ORIGIN` permite outro endereço local.
- `node scripts/verify-dashboard-sync-unit.mjs`; `node scripts/verify-approval-sync-ui.mjs --dist <build-sintetico>`.
- `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.app.json`; `node node_modules/vite/bin/vite.js build`.

Integração: `node --experimental-vm-modules --test scripts/verify-meta-reliability-integrated.mjs`, com `TRAFFIC_TEST_DATABASE_URL` apontando exclusivamente para o template descartável `traffic_migration_check` em `127.0.0.1:55432`, sem fixtures persistidas, e `TRAFFIC_PG_MODULE` para o módulo `pg` da ferramenta local de teste. Esse teste recusa outro destino. O template precisa do baseline, sete migrations registradas e transportes sintéticos de cron/net/Vault. Não apontar os testes a produção.

SQL: `verify-meta-review-fixes-db.sql`, `verify-meta-validation-db.sql`, `verify-meta-capture-db.sql`, `verify-meta-lead-queue-db.sql`, `verify-meta-cohort-db.sql`, `verify-meta-review-list-db.sql`, `verify-meta-signals-db.sql`, `verify-meta-approval-db.sql`, `verify-meta-edit-db.sql`, `verify-meta-lead-import-db.sql`, `verify-meta-form-inbox.sql`, `verify-meta-traffic-suggestions.sql`. Incluir `scripts/helpers/meta-db-fixtures.sql` depois de `BEGIN`; os três testes legados de aprovação/edição/importação precisam de atores sintéticos executivo e seller antes de executar o bloco. Os outros criam seus atores. O preflight `verify-meta-reliability-schema.sql` é somente leitura e tem uso operacional separado.

## Provas RED → GREEN

Os testes foram escritos e observados falhando antes das mudanças: identidade/soma de ações/paginação; aprovação atômica e validação; recuperação da fila; webhook antes do ACK; extração/timeout; coorte; recorte/CSV; detalhe/versionamento/upload; sinais transacionais e auditoria. Na integração final: worker sem rotação deixava a segunda página pendente; auditoria não nomeava as novas decisões nem mostrava snapshots; preflight de RPC ausente lançava `42883`. Cada caso passou após a alteração correspondente.

O erro de versão do lead no teste integrado foi isolado no parser do driver de teste, que descartava microssegundos. O adaptador agora mantém o timestamp PostgreSQL original; a regra de concorrência do produto foi preservada.

## Limites explícitos

- Meta real e confronto com Ads Manager não executados nesta entrega; `pages_manage_ads` era a pendência do último diagnóstico real de 09/10.
- Cron, pg_net, Vault e entrega Realtime reais não demonstrados pelo ambiente local; exigir smoke test após implantação.
- Navegador valida comportamento do front contra HTTP sintético; não simula o servidor PostgREST, cuja fronteira SQL foi verificada diretamente.
- Histórico legado e fontes incompletas continuam visíveis com aviso e taxas indisponíveis quando não há prova de comparabilidade.
- `get_daily_call_ranking` está ausente no baseline real e permanece uma pendência independente, com contrato legado conservado.

Roteiro de implantação/rollback: [operação](TRAFEGO_CONFIABILIDADE_OPERACAO_2026-10-11.md). Decisões de implementação e resultado da revisão final estão registrados abaixo.

## Registro de execução

```text
Task 1: complete (commits 4d72077..7c7d14f, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-1.mjs → PASS: Task 1 Node, CSV, validation, approval and edit regressions)
Task 2: complete (commits 7c7d14f..709811a, tests: node --experimental-vm-modules --test scripts/verify-meta-graph-regressions.mjs scripts/verify-meta-sync-regressions.mjs → ℹ duration_ms 1910.5972)
Task 3: complete (commits 709811a..dc423e2, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-3.mjs → PASS: Task 3 capture SQL, >2000 atomic publication, legacy edits, audit rollback, permissions and prior regressions)
Task 4: complete (commits dc423e2..8d3f086, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-4.mjs → PASS: Task 4 Node capture/Graph/sync, Deno types, fresh-schema SQL and previous regressions)
Task 5: complete (commits 8d3f086..859ea91, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-5.mjs → PASS: Task 5 queue on two schemas, concurrent claims, permissions and lead/approval/edit regressions)
Task 6: complete (commits 859ea91..27fd929, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-6.mjs → PASS: Task 6 webhook/worker/Graph/capture/sync regressions, Deno types and durable queue SQL)
Task 7: complete (commits 27fd929..df428f9, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-7.mjs → PASS: Task 7 deterministic extraction, malformed choices/confidence, real abort timeout, original answer preservation and worker regressions)
Task 8: complete (commits df428f9..cb784b5, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-8.mjs → (Use `node --trace-deprecation ...` to show where the warning was created))
Task 9: complete (commits cb784b5..d664322, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-9.mjs → PASS: Task 9 single scope/dimensions/availability/CSV and real React rendering, existing CSV, application and Edge types)
Task 10: complete (commits d664322..4168465, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-10.mjs → PASS: Task 10 bounded lists/parts/history, stale review and file races, real browser, edit/import regressions and application types)
Task 11: complete (commits 4168465..d8c1460, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-11.mjs → PASS: Task 11 transactional signals/no-op/rollback/deletion audit/roles, operational UI, global sync and four approval browser regressions, app types)
Task 12: complete (commits d8c1460..c1e0a5c, tests: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-12.mjs → PASS: Task 12 integrated recovery/approval/CRM, fresh seven migrations, 22 SQL checks, browser two sessions/roles, Deno, TypeScript, ESLint and production build)
```

## Decisões registradas durante a implementação

- Ruling: native worktree creation targeted the parent repository and failed on the app commit; created the approved app worktree through Git fallback — correct repository isolation — cost if wrong: checkout transfer at integration. Native attach refused the unmanaged checkout; files remain in the verified app worktree.

- Ruling: the approved plan's isolated workspace requirement supplies the worktree preference; no additional permission round — user explicitly approved applying that concrete plan — cost if wrong: worktree can be retained without integrating.

- Ruling: use temporary embedded PostgreSQL tooling outside product dependencies to execute SQL and concurrent sessions — no PostgreSQL/Docker in PATH — cost if wrong: tooling initialization can be replaced without changing product schema.

- Ruling: local PostgreSQL substitutes only realtime.broadcast_changes transport with a no-op; all 205 application functions, constraints, policies and triggers are real — external transport absent locally — SQL data/permission behavior remains exercised. Task 1 RED: canonical identity tests failed and SQL accepted negative spend; GREEN: all validation and existing approval/edit/CSV checks pass.

- Ruling: preserve configured Graph version and mark attribution configuration unknown when not returned — official Meta SDK/collection expose attribution parameters but cannot establish real account settings — no guessed attribution window. Task 2 RED: aliases yielded 30 vs 10, unsafe pagination and silent page limit accepted; GREEN: 14 real-module Graph/handler tests.

- Ruling: add first_origin JSON alongside original_key — identity alone cannot retain the original API/CSV lineage after a reviewed replacement — existing history stays untouched until its next explicit approval. Review and CSV writes share fact advisory locks; target lookups use existing composite indexes to avoid scanning all published rows. Staging remains service-only; dashboard access exercised under authenticated role.

- Ruling: terminal cursor/permission errors require meta_capture_abort(uuid,uuid,text) — release keeps a resumable partial run and cannot safely restart an expired cursor — new service-only contract checks the same live claim. Extend the unshipped capture migration before consumers. Review validators use only its persisted account timezone, never a client timezone. Each handler turn takes at most two pages per account/level to give other work a turn; the saved cursor imposes no total page cap. SQL transport requests are bounded by the shared 45s deadline. Metadata failures remain durable operational error runs with unknown coverage.

- Ruling: discovery persists window_until, form_queue and active_form_name — freeze the time window and retain every form on a Graph page across worker turns — cost if wrong: unfinished forms or wrong reconciliation coverage.

- Ruling: compatibility ingest can return pending if another lease owns the receipt — avoids reporting unprocessed work as processed; real handlers now use the worker — cost if wrong: legacy internal caller must handle pending. Discovery freezes a coverage boundary but may receive newer leads returned by Meta; five-minute overlap safely deduplicates them.

- Ruling: reserve one second within the processing budget after AI and reject more than 255 Choice options — current TypeSafe API limit verified in https://docs.typesafe.ai/api; known data and originals survive — cost if wrong: exceptionally large form remains incomplete for human review.

- Ruling: generated cohort uses the authoritative meta_form_leads.created_time (audited edits synchronize the CRM timestamp), accepts at most ten years, and checks unioned approved capture ranges including zero-spend days — avoids sale-date substitution or false missing-day gaps — cost if wrong: unsupported legacy link remains unknown. Full generated Supabase schema refresh consolidated into Task 12 after all migrations; typed additive RPC contract added now.

- Ruling: legacy stored values remain visible with a legacy warning; absent exported columns are null; API/CSV definition or calendar differences disable consolidated Meta rates — prevents interpreting an omitted result as zero — cost if wrong: old reports need recapture or a complete declared CSV before rates reappear.

- Ruling: add metadata-only meta_traffic_review_list SQL bridge with actual operation/conflict counts, and allow version-checked read-only parts of decided captures — manifest rows_captured omits proposed removals and existing part RPC rejected history — cost if wrong: history remains readable but mutations still use pending-only guards. Badge uses a one-summary page; full generated schema consolidated in Task 12.

- Ruling: signals migration renamed 20261011161000 because Task 10 uses 160000; audit UI refresh follows fact/batch/review/lead signals, avoiding an additional event for each imported audit row. Traffic managers lacked arena/crm revision read policy; add only these counter topics with traffic_has_access — cost if wrong: extra revision reads, no PII payload. Capture deletions retain their existing explicit audit; direct deletions get an audit trigger. Operational RPC returns last attempt/complete per account/level, sanitized diagnostics and publication/pending metadata, not cursors/tokens.

- Ruling: separate minute drain from hourly discovery operation records and rotate authorized page priority — prevent empty drain success hiding discovery permission errors and busy first-page starvation — cost if wrong: extra operation records requiring storage/retention monitoring.

- Ruling: install all five jobs paused, activate only after bank→Edge→front verification — deploying DB first must not call old handlers with new modes — cost if wrong: ingestion waits until explicit operational activation.

- Ruling: regenerate whole actual public schema, retain legacy ranking RPC in additive contract and expose CRM BEFORE INSERT trigger's optional input in application types — generated catalog cannot infer trigger-supplied NOT NULL values; ranking function absent in baseline is outside traffic — cost if wrong: ranking remains a separately documented runtime gap.

- Ruling: replace two unsafe legacy SQL checks using named commercial users/nontransactional data with synthetic rollback fixtures under current approval contract — safe repeatable verification — cost if wrong: obsolete implicit-publication assumptions are deliberately not preserved.

- Ruling: most-capable reviewer gpt-6-astra failed before reviewing due usage limit — retry the single fresh review seat using available gpt-6.1-sol, no duplicate completed review — cost if wrong: reviewer model capability differs, disclosed in final report.

- Ruling: production Meta permissions/responses and Ads Manager equivalence remain unverified — real account evidence is absent and synthetic transport cannot prove it; the runbook keeps activation conditional on a real-account check — cost if wrong: account-specific capture may require correction before activation.

- Ruling: hosted webhook/cron/pg_net/Vault/Realtime and runtime limits remain deployment checks — local real SQL and handlers prove logic, not external delivery; deployment and activation are outside this authorized local change — cost if wrong: hosted transport needs repair before live ingestion.

- Ruling: large production-history performance is not established — bounded review reads and >2000-row capture are verified, with no representative production load available — cost if wrong: indexing or scheduling tuning may be required at actual volume.

- Ruling: missing legacy ranking RPC remains outside Tráfego — baseline already lacks its runtime implementation and changing unrelated ranking expands the approved scope — cost if wrong: the pre-existing ranking runtime gap persists.

- Ruling: CSV/legacy pending batches without a server-owned target version must be reimported or incorporated into a new capture review — a historical expected version cannot be reconstructed safely, so approval fails closed rather than overwriting an unseen correction — cost if wrong: legacy pending CSV requires another upload/review; history and published facts remain intact.

## Revisão independente e correções finais

Revisor independente `gpt-6.1-sol` (contexto novo, somente leitura): nenhum Critical, oito Important e nenhum Minor. O modelo inicialmente escolhido `gpt-6-astra` falhou por limite de uso antes de revisar; houve uma única revisão concluída. A classificação foi confirmada pelo efeito sobre o usuário antes de iniciar a única passagem de correção.

| Achado | Reprodução RED | Correção e prova dirigida GREEN |
| --- | --- | --- |
| Identidade corrigida duplicada ao escolher recebido | Dois fatos e gasto duplicado após A→B→recaptura A | Mesmo ID/origem, um fato e total correto; alvo e versão preservados |
| CSV editado não aprovável | Gasto/nome em `present_metrics` causavam `22023` na aprovação | Somente métricas opcionais válidas; edição de gasto/nome→aprovação |
| Divergência/ausência de edição pendente escondida | Nova captura descartava gasto recebido ou omissão | Candidatos congelados e conflito obrigatório para identidade igual/corrigida e ausência completa |
| Ações diferentes consolidadas | CPL 10 apesar de lead vs pixel lead | Contrato/export preservam ações; taxas por métrica bloqueadas; taxas independentes continuam corretas |
| Cursor de descoberta expirado sem recuperação | Dois ciclos retomavam `after=expired` | Reinício versionado de formulários/leads na mesma janela, recibos preservados; permissão não reinicia |
| Descoberta horária sem rotação | Duas horas atendiam somente uma página ocupada | Horas consecutivas dão prioridade às duas páginas; drenagem mantém rotação por minuto |
| CSV sobrescrevia correção posterior | Aprovação stale aceita após edição/publicação rival | Todos os alvos versionados no servidor, `40001` antes de qualquer escrita |
| Métrica manual continuava indisponível | Valor salvo sem disponibilidade; zero ignorado como no-op | Disponibilidade/origem manual em edição pendente/publicada/resolução e zero explícito |

As migrations ainda não implantadas foram ajustadas no pacote local; o histórico remoto não foi alterado. O caso legado de recaptura agora exige resolver explicitamente a divergência antes da decisão inteira. Nenhum Minor ficou adiado. A validação completa após esta passagem terminou com exit 0: 75/75 Node, 8/8 Deno, 24/24 SQL, sete migrations do zero, navegador com duas sessões/roles, regressões globais, TypeScript/Deno, ESLint sem erros/avisos e build de produção. Grants das duas novas funções auxiliares também foram conferidos: anon, authenticated e service_role não podem invocá-las diretamente.

## Encerramento da passagem final

```text
Final: fixed identity resolution duplicated facts — review-fixes identity; capture incoming identity stable ID/origin RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed CSV spend/name edit failed approval — edit-db present_metrics spend/name → approval RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed pending edit divergence and absence hidden — review-fixes pending-divergence/pending-absence RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed different selected actions produced rates — selected action definitions gate only their affected rates and are exported RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed expired discovery cursors did not recover — expired forms/leads cursor restarts frozen window RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed hourly discovery starved later pages — hourly discovery rotates busy first pages RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed stale CSV overwrote published edits — review-fixes csv-stale-target edit and rival publication RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: fixed manual metrics remained unavailable — review-fixes manual-availability/manual-zero RED→GREEN, suite 75/75 Node, 8/8 Deno, 24/24 SQL, browser, types, ESLint and build green.
Final: complete single fix pass; no Critical/Important outstanding, no Minor deferred, no re-review. Full verification command: node .superpowers/sdd/2026-10-11-traffic-reliability/verify-task-12.mjs; exit 0. All final changes verified before commit.
```
