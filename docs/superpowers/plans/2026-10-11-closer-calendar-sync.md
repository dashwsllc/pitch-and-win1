# Closer Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar as calls da fila Closer com a agenda Google compartilhada existente da empresa, mantendo um evento ativo por call e status fiel à revisão vigente.

**Architecture:** Triggers nos registros comerciais gravam uma fila transacional privada; um worker entrega o estado atual ao Google usando identidade persistente, leases e ETags. OAuth da conta administradora permite selecionar o destino existente, que fica fixado após o primeiro vínculo. A interface consome somente configuração e status sanitizados; cron também faz backfill e reconciliação retomáveis.

**Tech Stack:** React 18, TypeScript, React Query, Supabase/Postgres/Vault, Deno Edge Functions, Google Calendar REST/OAuth, testes `node:test` com TypeScript/VM já usados pelo projeto.

**Spec:** `docs/superpowers/specs/2026-10-11-closer-calendar-sync-design.md` — aprovada em 2026-10-11.

## Global Constraints

- Destino: uma única agenda compartilhada **já existente e sem calls**, **“agenda - closers”**, da conta Google **`admvoxenai@gmail.com`**; seleção explícita pelo ID canônico, com edição validada no servidor, sem criar agenda ou escolher `primary` automaticamente. Nome/email não substituem ID ou OAuth; nomes iguais devem ser distinguíveis pelo ID na seleção.
- Fonte de verdade: CRM → Google; duração de **30 minutos**; fuso **`America/Sao_Paulo`**; início é o instante absoluto de `scheduled_at`.
- Elegibilidade inicial: `fechamento_closer`, lead `repassado_closer`, pendente, não cancelada, horário finito e responsável preenchido; no backfill, `scheduled_at >= instante da ativação`.
- Prioridade: exclusão → cancelamento → `devolvido_sdr`/`followup_sdr` → conclusão preservada → saída da fila → publicação pendente → dados insuficientes.
- Calls já registradas sobrevivem ao avanço do relógio; nova atividade significa nova identidade; remarcação/responsável mantêm a identidade.
- Nenhum HTTP em transações do CRM; nenhuma alteração de regras, permissões, auditoria, pontuação ou resultados comerciais existentes.
- Scopes: `https://www.googleapis.com/auth/calendar.events` e `https://www.googleapis.com/auth/calendar.calendarlist.readonly`; OAuth offline, estado único com validade de **10 minutos**.
- Tokens/client secret somente no servidor, tokens persistentes criptografados no Vault; tabelas internas e RPCs de segredos/worker não acessíveis a PUBLIC/anon/authenticated.
- Não acrescentar convites, Meet, recorrência, disponibilidade, outros provedores ou duração editável; manter campos Google não controlados pelo CRM.
- Cron de entrega **a cada minuto**; reconciliação **a cada 15 minutos**; completed confirmado sai da reconciliação periódica; erros temporários nunca descartam definitivamente trabalhos.
- Sem dependências novas de produção/testes. Usar os testes Node/VM e fixtures SQL do projeto; ensaios Google somente em agenda de teste.
- Histórico remoto diverge do local: aplicar apenas as migrations novas identificadas deste plano, nunca `db push`/reset genérico. Rollback suspende escritas e conserva vínculos/eventos.

## Review Focus

1. Sucesso Google seguido de timeout/falha local: repetir recupera o mesmo ID e deixa um único evento ativo — testes da tarefa 5.
2. Call concluída/cancelada/excluída entre ativação e processamento do backfill: a seleção inicial é durável e entrega o estado final correto — tarefas 2 e 5.
3. Mudança do CRM durante uma requisição ou perda de lease: não confirmar a revisão nova com uma resposta antiga nem continuar escrevendo após perder posse — tarefas 2 e 5.
4. 404 de agenda inacessível, tombstone Google ou ID ocupado por terceiro: não inferir exclusão, rotacionar identidade sem prova ou sobrescrever terceiros — tarefas 3 e 5.
5. Login, logout ou mudança de usuário enquanto um link/status carrega: abrir apenas o lead permitido e não reaproveitar dados administrativos/caches de outra sessão — tarefa 6.

---

## Arquivos e responsabilidades

| Arquivos a criar | Responsabilidade |
| --- | --- |
| `supabase/functions/_shared/google-calendar-contract.ts` | DTOs públicos, status e constantes; módulo puro, sem credenciais/importações de servidor. |
| `supabase/functions/_shared/google-calendar-projection.ts` | Ciclo de vida, campos controlados, identidade e comparação normalizada. |
| `supabase/functions/_shared/google-calendar-client.ts` | REST Google, OAuth, paginação, timeout e erros estruturados. |
| `supabase/functions/_shared/google-calendar-store.ts` | Adapter tipado dos RPCs privados, leases e Vault; usado só pelas Edge Functions. |
| `supabase/functions/_shared/google-calendar-auth.ts` | JWT/capacidade administrativa, segredo de cron e utilitários OAuth. |
| `supabase/functions/_shared/google-calendar-worker.ts` | Entrega/reconciliação com dependências injetáveis. |
| `supabase/functions/google-calendar-manage/index.ts` | Endpoint administrativo de conexão/configuração/retry. |
| `supabase/functions/google-calendar-oauth-callback/index.ts` | Callback público autenticado pelo estado persistido. |
| `supabase/functions/google-calendar-sync/index.ts` | Entrada do worker autenticada por segredo específico. |
| `supabase/migrations/20261011100000_google_calendar_storage.sql` | Estrutura privada, OAuth/credenciais, projeção segura e grants. |
| `supabase/migrations/20261011103000_google_calendar_queue.sql` | Triggers, revisão, fila, leases, seed de ativação e paginação. |
| `supabase/migrations/20261011110000_google_calendar_cron.sql` | Dois jobs cron autenticados e idempotentes. |
| `src/lib/google-calendar-api.ts` | Cliente da configuração e parser das respostas públicas. |
| `src/hooks/useGoogleCalendar.ts` | Queries/mutações administrativas e status por call. |
| `src/components/settings/GoogleCalendarIntegration.tsx` | Conexão, seleção da agenda e ações administrativas. |
| `src/components/crm/CRMCalendarStatus.tsx` | Estado seguro por call e ação útil em erro. |
| `src/lib/crm-deeplink.ts` | Validação do link e destino após login. |
| `scripts/verify-google-calendar-sync.mjs` | Testes de projeção, cliente, auth e worker com Google/store simulados. |
| `scripts/verify-google-calendar-ui.mjs` | Testes de contrato UI, cache por sessão e links autenticados. |
| `scripts/check-google-calendar-db.mjs`, `supabase/tests/google_calendar_sync.sql` | Fixtures SQL isoladas, RLS, fila e concorrência transacional. |
| `docs/GOOGLE_CALENDAR_CLOSERS_SETUP.md` | Instalação, teste externo, operação e rollback. |

| Arquivos a modificar | Mudança limitada |
| --- | --- |
| `supabase/config.toml` | Registro dos três endpoints e verificação JWT adequada ao callback/cron. |
| `src/integrations/supabase/types.ts` | Tipo da nova tabela pública de status; não regenerar schemas remotos divergentes. |
| `src/pages/Configuracoes.tsx` | Inserir cartão da integração. |
| `src/components/crm/CRMLeadDetail.tsx` | Badge junto às calls no histórico. |
| `src/pages/CRM.tsx` | Abrir `lead` autorizado após carga; preservar query ao trocar tab e limpar ao fechar. |
| `src/components/ProtectedRoute.tsx`, `src/pages/Auth.tsx` | Preservar somente o destino CRM válido durante login, mantendo gates de cadastro/suspensão. |

## Task 1: Contrato público e projeção da call

**Files:** contrato, projeção e `scripts/verify-google-calendar-sync.mjs` listados acima.

**Interfaces:**
- `SyncStatus = 'disabled' | 'awaiting_connection' | 'pending' | 'syncing' | 'synced' | 'removal_pending' | 'removed' | 'error'`.
- `ConnectionStatus = 'not_connected' | 'connected' | 'reconnect_required' | 'permission_denied' | 'disconnected'`.
- `CalendarChoice = { id: string; name: string; accessRole: 'writer' | 'owner'; timeZone: string | null }`.
- `AdminStatus = { configured: boolean; connection: ConnectionStatus; calendar: CalendarChoice | null; destinationLocked: boolean; activatedAt: string | null; lastRunAt: string | null; pendingCount: number; errorCount: number; backfillPending: boolean; errorCode: string | null }`.
- `ManageRequest` é união discriminada com um membro separado para cada ação: `{action:'status'}`, `{action:'start_oauth'}`, `{action:'list_calendars'}`, `{action:'disconnect'}`, `{action:'activate';calendarId:string}`, `{action:'retry';callId?:string}`. `ManageResultByAction={status:AdminStatus,activate:AdminStatus,disconnect:AdminStatus,retry:AdminStatus,start_oauth:{authorizationUrl:string},list_calendars:{calendars:CalendarChoice[]}}`.
- `CallSource = { id: string; leadId: string; callType: string | null; scheduledAt: string | null; assignedTo: string | null; isCompleted: boolean; cancelledAt: string | null; outcome: string | null }`; `LeadSource = { id: string; name: string; pipelineStage: string }`.
- `Binding = { id: string; callId: string; leadId: string; calendarId: string; eventId: string; generation: number; revision: string; confirmedRevision: string | null; confirmedHash: string | null; etag: string | null }`; bigint revisions cross JSON as decimal **strings**.
- `ProjectionInput = { call: CallSource | null; lead: LeadSource | null; closerName: string | null; binding: Binding; projectId: string; dashboardOrigin: string }`.
- `DesiredEvent = { kind: 'upsert' | 'completed'; event: ManagedEvent } | { kind: 'remove' } | { kind: 'blocked'; code: 'incomplete_call' }`; `ManagedEvent` contém `summary`, `description`, `start/end:{dateTime,timeZone}`, `extendedProperties.private`.
- Produz `projectCall(input: ProjectionInput): DesiredEvent`, `googleEventId(uuid: string): string`, `managedEventHash(event: ManagedEvent): Promise<string>` e `eventMatches(actual: GoogleEvent, expected: ManagedEvent): boolean`. `GoogleEvent` inclui `id/status/etag/htmlLink` e campos controlados, permitindo campos extras.

- [ ] **Step 1: Escrever testes de projeção com fixtures pequenas e harness Node/VM baseado em `verify-meta-sync-regressions.mjs`.** Fixar prioridades, calls distintas, privacidade e instantes:
  ```js
  assert.equal(projectCall(cancelledCompleted).kind, 'remove');
  assert.equal(projectCall(completedAfterLeadMoved).kind, 'completed');
  assert.equal(projectCall(returnedToSdr).kind, 'remove');
  assert.equal(projectCall(missingAssignee).kind, 'blocked');
  assert.equal(projectCall(crossMidnight).event.start.dateTime, '2026-10-12T02:50:00.000Z');
  assert.equal(projectCall(crossMidnight).event.end.dateTime, '2026-10-12T03:20:00.000Z');
  assert.equal(projectCall(crossMidnight).event.start.timeZone, 'America/Sao_Paulo');
  assert.equal(googleEventId('6e90a88c-c917-4071-b2bf-7fd789600cff'), '6e90a88cc9174071b2bf7fd789600cff');
  assert.ok(!JSON.stringify(projectCall(withPrivateNotes)).includes('NOTA_INTERNA'));
  assert.ok(projectCall(validCall).event.description.includes('/crm?tab=closer&lead='));
  ```
  Qualificação/`pronto_closer` sem binding não passam pelo registro inicial (tarefa 2); projeção de binding existente decide remoção. Hash ignora revisão privada e campos externos; comparação verifica também marcadores de propriedade. Title exato da spec; resultado concluído usa rótulos comerciais existentes via mapa explícito, sem importar módulo que carregue React.
- [ ] **Step 2: Rodar `node --experimental-vm-modules --test --test-name-pattern="projection" scripts/verify-google-calendar-sync.mjs`.** Esperar falha por módulo/export ainda ausente.
- [ ] **Step 3: Implementar os contratos e funções puras acima.** Fim = início + `1_800_000` ms; rejeitar data sem offset/instante finito; propriedade privada `project_id/call_id/binding_id/revision`; descrição mínima, sem telefone/notas. Dados incompletos bloqueiam confirmação e não publicam payload inválido.
- [ ] **Step 4: Repetir os testes de projeção com `TZ=UTC` e `TZ=America/Sao_Paulo` no processo filho do harness.** Esperar mesmos ISO/hashes e todos PASS.
- [ ] **Step 5: Commit dos três arquivos:** `feat(crm): define closer calendar projection`.

## Task 2: Persistência privada, fila transacional e status seguro

**Files:** migrations storage/queue, store, testes/runner SQL; utiliza contrato/projeção da tarefa 1.

**Interfaces:**
- Schema **`calendar_private`**: `connection` singleton; `oauth_states`; `bindings`; `outbox`; `activation_seeds`; `scan_state` com cursores. `bindings`/seeds guardam UUIDs sem FKs que apaguem identidade ao excluir lead/call. Unicidades `(call_id, calendar_id)` e `(calendar_id, event_id)`.
- `public.crm_google_calendar_status` contém apenas `call_id`, `desired_revision`/`confirmed_revision` (text), `status`, `error_code`, `last_synced_at`, `updated_at`. FK comercial pode limpar **essa projeção pública**; nunca bindings/seeds. RLS SELECT exige usuário CRM ativo e a call visível segundo as mesmas regras de `crm_activities`; sem grants de escrita para clientes/anon.
- RPCs públicos **service_role only**, `SECURITY DEFINER`, `search_path=pg_catalog`, todas as referências qualificadas. Formas e retornos do adapter:
  | RPC / método de `CalendarStore` | Argumentos / retorno |
  | --- | --- |
  | `google_calendar_admin_status` / `adminStatus` | `p_actor uuid → AdminStatus`; banco revalida `crm_user_can(p_actor,'admin')`. |
  | `google_calendar_oauth_start` / `startOAuth` | `p_actor uuid,p_state_hash text,p_origin text → {stateId,expiresAt}`; TTL fixo 10 min. |
  | `google_calendar_oauth_consume` / `consumeOAuth` | `p_state_hash text → {stateId,actorId,origin}`; uso único/expiração/autorização. |
  | `google_calendar_credential_claim` / `claimCredential` | `p_lease_seconds integer → CredentialLease|null`. |
  | `google_calendar_credential_read` / `readCredential` | `p_token uuid → Credential`; Vault somente com lease vigente. |
  | `google_calendar_credential_save` / `saveCredential` | `p_token uuid,p_expected_revision bigint,p_actor uuid,p_state_id uuid,p_account_id text,p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_scopes text[] → boolean`; `p_state_id` obrigatório em OAuth, null somente renovação sem trocar conta; `p_actor` null apenas nesta renovação interna. |
  | `google_calendar_credential_release` / `releaseCredential` | `p_token uuid → void`. |
  | `google_calendar_activate` / `activate` | `p_actor uuid,p_calendar_id text,p_calendar_name text,p_time_zone text,p_credential_revision bigint → AdminStatus`; caller prova writer/owner antes e revisão ainda coincide. |
  | `google_calendar_disconnect` / `disconnect` | `p_actor uuid,p_token uuid → AdminStatus`; suspende, elimina referências de tokens; preserva destino/vínculos/fila. |
  | `google_calendar_set_connection_error` / `setConnectionError` | `p_credential_revision bigint,p_code text → void`; atualização condicional, sem erro bruto. |
  | `google_calendar_retry` / `retry` | `p_actor uuid,p_call_id uuid nullable → AdminStatus`; libera jobs bloqueados sem mudar identidade. |
  | `google_calendar_claim` / `claim` | `p_limit integer,p_lease_seconds integer → Job[]`, SKIP LOCKED; só conectado/ativo. |
  | `google_calendar_snapshot` / `snapshot` | `p_binding_id uuid,p_token uuid → Snapshot|null`; leitura consistente + propriedade/validade de lease. |
  | `google_calendar_renew` / `renew` | `p_binding_id uuid,p_token uuid,p_lease_seconds integer → boolean`. |
  | `google_calendar_ack` / `ack` | `p_binding_id uuid,p_token uuid,p_revision bigint,p_hash text,p_etag text,p_removed boolean → boolean`; revisão antiga não confirma atual. |
  | `google_calendar_fail` / `fail` | `p_binding_id uuid,p_token uuid,p_revision bigint,p_code text,p_retry_at timestamptz nullable → void`; null = bloqueado até correção/retry. |
  | `google_calendar_rotate_event_id` / `rotateEventId` | `p_binding_id uuid,p_token uuid,p_revision bigint,p_old_event_id text → Binding|null`; prova externa de tombstone definitiva exigida pelo worker. |
  | `google_calendar_scan_page` / `scanPage` | `p_mode text ('backfill'|'reconcile'),p_limit integer → {processed:number,done:boolean}`; cursor/chunks atômicos, sem executar HTTP. |
  | `google_calendar_record_run` / `recordRun` | `p_started_at timestamptz → void`; lastRunAt monotônico. |
  `CredentialLease={token:string,revision:string,expiresAt:string}`; `Credential={accountId:string|null,accessToken:string,refreshToken:string|null,expiresAt:string,scopes:string[],revision:string}`. `Job={binding:Binding,leaseToken:string,leaseExpiresAt:string}`; `Snapshot=ProjectionInput & {connectionRevision:string}`. `CalendarStore` exporta os métodos da tabela, recebendo camelCase e traduzindo para os argumentos SQL; resultado secreto nunca é DTO público.

- [ ] **Step 1: Escrever fixtures SQL isoladas e runner de transação com rollback, seguindo `check-crm-edit-call-db.mjs`.** Assertions com `RAISE EXCEPTION`:
  ```sql
  -- handoff_and_schedule_closer_call válido: count(bindings)=1, count(outbox)=1;
  -- qualificação/pronto_closer/next_followup_at isolado: count(bindings)=0;
  -- update_crm_call/remarcação/troca: mesmo event_id, revisão aumentada;
  -- coluna comercial sem efeito no evento: revisão inalterada;
  -- cancelar/devolver/concluir pelos RPCs atuais: snapshot final na prioridade da spec;
  -- DELETE lead/call: binding + identificadores continuam, estado desejado remove;
  -- claim duas vezes: segundo lote não contém o binding já adquirido;
  -- ack(v1) após alteração v2: desired_revision<>confirmed_revision e job permanece;
  -- status SELECT não autorizado e RPC secreto como authenticated/anon: negados;
  -- ativar → concluir/excluir antes do backfill → scan: seed não se perde;
  -- >500 sementes, reexecutar scan: todas processadas, sem duplicar;
  -- desconectar/reconectar/tentar outro destino: IDs mantidos/destino bloqueado.
  ```
- [ ] **Step 2: Rodar `node scripts/check-google-calendar-db.mjs --local`.** Usar banco Supabase local/teste identificado; esperar falha por estrutura/funções ausentes, nunca sobre dados comerciais. Runner não assume produção como fallback.
- [ ] **Step 3: Implementar storage e RPCs de OAuth/credenciais/admin.** Vault criptografa; revogar defaults de EXECUTE imediatamente em cada criação. Refresh usa lease + CAS de revisão; OAuth precisa state consumido do mesmo ator, autorização atual e duas permissões; não aceitar `p_actor` cliente. Registrar estado seguro ao suspender/desconectar. Destino imutável se houver qualquer vínculo, mesmo removido, ou seed pendente no destino escolhido.
- [ ] **Step 4: Implementar queue/triggers e métodos do store.** Triggers em fields relevantes de calls, `crm_leads.name/pipeline_stage` e `profiles.display_name`; não substituir RPC comercial. Ao ativar, capturar atomicamente instante + coorte mínima de IDs futuros elegíveis em seeds; processar seeds em páginas de 500 e sempre projetar estado **atual**. Mudanças/deletes reconhecem também seeds ainda não materializados. Binding/revisão/outbox criados na mesma transação; coalescer por binding. Claims de 60 s, renovação pelo token; ack só marca synced se revisão ainda coincidir. Dados insuficientes ficam acionáveis, sem sucesso falso. Cursores de scan usam ordem estável de IDs e encerram/reiniciam ciclos; novas mudanças são cobertas pelos triggers.
- [ ] **Step 5: Repetir SQL e verificar duas sessões concorrentes pelo runner.** Cada sessão usa fixtures próprias/limpeza explícita em banco de teste; disputa sobre fixture compartilhada confirma SKIP LOCKED e rollback de transação não deixa fila. Esperar PASS, nenhum segredo nas saídas. Se não houver banco de teste executável, registrar impedimento e criar o alvo de teste autorizado antes de aplicar migrations de produção.
- [ ] **Step 6: Commit dos arquivos desta tarefa:** `feat(crm): persist calendar sync jobs and permissions`.

## Task 3: Cliente Google e renovação de tokens

**Files:** client e testes `verify-google-calendar-sync.mjs`; adapter store da tarefa 2.

**Interfaces:**
- `TokenProvider = (forceRefresh?:boolean)=>Promise<Credential>`; `GoogleCalendarClient` recebe `{tokenProvider,fetchImpl,now}`.
- Métodos: `listWritableCalendars():Promise<CalendarChoice[]>`, `getCalendar(id:string):Promise<CalendarChoice>`, `getEvent(calendarId:string,eventId:string):Promise<GoogleEvent|null>`, `insertEvent(calendarId:string,eventId:string,event:ManagedEvent):Promise<GoogleEvent>`, `patchEvent(calendarId:string,eventId:string,event:ManagedEvent,etag:string):Promise<GoogleEvent>`, `deleteEvent(calendarId:string,eventId:string,etag:string):Promise<void>`.
- Ausência de evento é `null` **só depois** de provar destino com acesso writer/owner; retornos cancelled/410 preservam condição de tombstone distinguível de ausência comum.
- `GoogleError={status:number,code:string,retryAfterMs:number|null,retryable:boolean}`: códigos sanitizados `rate_limit`, `network`, `google_unavailable`, `reconnect_required`, `calendar_access`, `invalid_payload`, `conflict`, `precondition_failed`, `event_deleted`.
- `OAuthTokenResult={accessToken:string,refreshToken:string|null,expiresAt:string,scopes:string[]}`; `exchangeOAuthCode(code:string):Promise<OAuthTokenResult>`, `refreshOAuthToken(refreshToken:string):Promise<OAuthTokenResult>`, `revokeOAuthToken(token:string):Promise<void>`. `getAccountId():Promise<string>` lê ID canônico da agenda **principal como referência da conta**; jamais como destino. Esse ID sozinho não comprova identidade estável suficiente para reutilizar refresh token de outra autorização: OAuth com os scopes aprovados e prompt=consent exige refresh novo se o Google não fornecer essa prova. Recusar salvamento incompleto conserva a credencial anterior, sem misturar tokens de contas.
- `getCredential(store:CalendarStore,forceRefresh?:boolean):Promise<Credential>` exportado pelo store: usa claim/read/save/release, espera curta limitada quando ocupado; renovação do token existente preserva refresh anterior se a própria resposta de refresh omitir outro. Não reutilizar esse fallback na troca de código OAuth sem prova de identidade. Invalid_grant suspende com CAS.

- [ ] **Step 1: Escrever casos `client:*` e `credentials:*` com fetch simulado.** Fixar todas as páginas, 401/refresh único, refresh concorrente, limites e ETags:
  ```js
  assert.equal((await client.listWritableCalendars()).length, 503);
  assert.equal(recordedPatch.headers.get('If-Match'), 'etag-v1');
  assert.equal(recordedDelete.headers.get('If-Match'), 'etag-v2');
  assert.ok(!('attendees' in recordedPatchBody));
  assert.ok(!('reminders' in recordedPatchBody));
  assert.equal(refreshCallsAfterConcurrentRequests, 1);
  assert.equal(statusAfterMissingCalendar404, 'permission_denied');
  assert.equal(retryAfterMs, 120000);
  assert.ok(!JSON.stringify(publicError).includes('TOKEN_SENTINELA'));
  ```
  Incluir 403 quota versus permission, 409, 410, 412, 5xx, corpo não JSON, refresh sem novo token e troca de conta sem refresh novo.
- [ ] **Step 2: Rodar `node --experimental-vm-modules --test --test-name-pattern="client|credentials" scripts/verify-google-calendar-sync.mjs`.** Esperar funções ainda ausentes ou assertions falhando.
- [ ] **Step 3: Implementar cliente/token provider.** `AbortController` 8 s por HTTP, encode de calendar/event IDs, máximo uma renovação por 401; erros não incluem body/token. Paginação calendarList continua por nextPageToken. Validar concessão dos scopes; confirmação de writer/owner usa CalendarList.get, não assume que um 404 significa remoção. Patch só campos controlados, `sendUpdates=none`; insert ID persistido, sem guests/Meet e com reminders padrão.
- [ ] **Step 4: Repetir testes client/credentials; esperar PASS e token sentinela ausente das respostas/logs capturados.**
- [ ] **Step 5: Commit de client, store e testes:** `feat(crm): add Google Calendar API client`.

## Task 4: OAuth e configuração administrativa

**Files:** auth, manage/callback entrypoints, `supabase/config.toml`, testes de handler.

**Interfaces:** `requireCalendarAdmin(req:Request):Promise<{userId:string}>`, `requireCalendarCron(req:Request):void`, `createOAuthState():Promise<{raw:string,hash:string}>`, `buildAuthorizationUrl(state:string):string`; handlers `handleManage(req:Request):Promise<Response>`, `handleOAuthCallback(req:Request):Promise<Response>`. Utilizar `_shared/http.ts` para RequestError/JSON/CORS e store/client das tarefas anteriores.

- [ ] **Step 1: Escrever testes `auth:*`/`manage:*`/`callback:*` no harness real dos handlers.** Assertions:
  ```js
  assert.equal((await manage(ordinaryUserRequest)).status, 403);
  assert.equal((await callback(expiredStateRequest)).status, 400);
  assert.equal((await callback(replayedStateRequest)).status, 400);
  assert.equal((await callback(adminLostPermission)).status, 403);
  assert.equal((await callback(deniedGoogleConsent)).status, 303);
  assert.equal((await manage(otherCalendarAfterBinding)).status, 409);
  assert.equal(redirect.origin, configuredDashboardOrigin);
  assert.equal(await storeEventIdAfterReconnect(), originalEventId);
  ```
  Cobrir origem arbitrária, JWT falso/ausente, callback sem estado, scopes incompletos, conta diferente, refresh ausente e desconexão durante job. Assert nenhum segredo/body OAuth bruto no JSON/Location/log.
- [ ] **Step 2: Rodar `node --experimental-vm-modules --test --test-name-pattern="auth|manage|callback" scripts/verify-google-calendar-sync.mjs`.** Esperar falhas genuínas antes dos handlers.
- [ ] **Step 3: Implementar utilitários de auth e handler manage.** `auth.getUser` real + `crm_can('admin')` com cliente do usuário; servidor ainda revalida ator em RPC. Zod/schema rejeita ações/campos arbitrários. `start_oauth`: 32 bytes aleatórios, SHA-256 só persistido, origem de `GOOGLE_CALENDAR_DASHBOARD_ORIGIN` allowlist, access_type=offline/prompt=consent. `activate` valida calendar role/revisão antes de RPC; retry só enfileira. Disconnect suspende atomicamente antes da revogação best effort, mantém eventos e retorna só AdminStatus.
- [ ] **Step 4: Implementar callback e configurar endpoints.** Consumir estado inclusive em consentimento negado, revalidar admin; adquirir lease de credencial antes de trocar/persistir tokens; reaproveitar refresh anterior só com identidade estável comprovada, conforme tarefa 3. Redirect 303 somente `/configuracoes?google_calendar=connected|denied|error`, sem código/token/erro bruto. `verify_jwt=true` em manage/sync; callback `false`. Sync cron envia anon JWT de Vault para gateway **e** `x-cron-secret` validado no handler; não aceitar JWT sozinho.
- [ ] **Step 5: Repetir testes auth/manage/callback; esperar PASS.**
- [ ] **Step 6: Commit:** `feat(crm): connect company calendar with secure OAuth`.

## Task 5: Entrega idempotente, reconciliação e cron

**Files:** worker/sync entrypoint, cron migration, testes worker/handler; usa store/client/projeção.

**Interfaces:** `WorkerDeps={store:CalendarStore,client:GoogleCalendarClient,now:()=>number,random:()=>number}`; `deliverJob(job:Job,deps:WorkerDeps):Promise<void>`; `runCalendarSync(mode:'deliver'|'reconcile',deps:WorkerDeps):Promise<{processed:number,pending:boolean}>`; `handleCalendarSync(req:Request):Promise<Response>`. `nextRetryAt(attempt:number,now:number,random:number,retryAfterMs:number|null):string` usa exponencial 30 s–6 h com jitter e nunca antecipa Retry-After.

- [ ] **Step 1: Escrever testes `worker:*`/`sync:*`, usando fake Google **com estado** e store que impõe revisão/token.** Fixar efeitos e status:
  ```js
  assert.equal(activeManagedEventsAfterInsertTimeoutAndRetry, 1);
  assert.equal(activeManagedEventsAfterLocalAckFailureAndRetry, 1);
  assert.equal(activeManagedEventsAfterConcurrentWorkers, 1);
  assert.notEqual(statusAfterAckOfOldRevision, 'synced');
  assert.equal(statusAfterDeliveringNewestRevision, 'synced');
  assert.equal(googleWritesAfterLeaseLost, 0);
  assert.equal(foreignEvent.summary, 'Evento de outra integração');
  assert.equal(newIdAfterUnknownResponse, originalId);
  assert.equal(activeEventsAfterProvenDeletedIdRecovery, 1);
  assert.equal((await sync(noCronSecretRequest)).status, 401);
  ```
  Incluir cancelamento durante insert, conclusão antes da primeira entrega, perda de acesso 404 sem ack removal, delete410, patch/delete412 com releitura CRM+Google, recuperação cancelled com geração persistida **antes** do insert, >500 itens/reinício do cursor, completed sem reconciliação periódica e atraso que atravessa o horário da call.
- [ ] **Step 2: Rodar `node --experimental-vm-modules --test --test-name-pattern="worker|sync" scripts/verify-google-calendar-sync.mjs`.** Esperar export/efeitos ausentes.
- [ ] **Step 3: Implementar deliverJob.** Sempre ler ID persistido e verificar propriedade antes de alterar/apagar; 409 recupera esse ID. Antes de cada escrita: renew lease, snapshot atual, confirmar conexão/revisão e recomputar projeção. ETag obrigatório para patch/delete; 412 relê ambos com no máximo 2 repetições nesta execução. Compare conteúdo normalizado para não escrever noop. Remoção ausente com acesso comprovado confirma; 410 confirma. Restaurar cancelled no mesmo ID quando possível; só rotacionar com ausência definitiva/prova de acesso, ownership quando disponível e CAS de token/revisão. Não rotacionar por timeout/409/erro desconhecido. Ack só confirma a revisão entregue. Falhas bloqueadas/exponenciais acionam fail; resposta inválida nunca vira synced.
- [ ] **Step 4: Implementar runCalendarSync/handler/cron.** Budget 45 s, máximo 20 jobs por execução, claim individual com lease de 60 s, páginas de scan/backfill 500; liberar job não processado pelo fail/retry. Verificar segredo antes de operações. Cron nomes `google-calendar-deliver` e `google-calendar-reconcile`; headers obtidos de Vault `google_calendar_cron_anon_key`/`google_calendar_cron_secret`, timeout 50 s. Agendamento em bloco separado do DDL de pg_net, sem duplicar jobs. Jobs inertes sem configuração/secrets; nunca registrar conteúdo secreto. Cursor não zera enquanto há páginas; reconcile só enfileira pendentes/remoções não confirmadas, conclusão explícita chega pelos triggers.
- [ ] **Step 5: Rodar todos os testes sync e SQL; esperar PASS.** Exercitar falhas reais de handler/store contract, não apenas procurar strings nos arquivos. Confirmar fila preservada após reconexão e nenhuma escrita Google para chamada anônima/JWT sem segredo.
- [ ] **Step 6: Commit:** `feat(crm): deliver and reconcile closer calendar events`.

## Task 6: Configurações, status das calls e link após login

**Files:** API/hook/card/badge/deeplink; modificar Configuracoes/CRM/CRMLeadDetail/ProtectedRoute/Auth/types; criar testes UI.

**Interfaces:** frontend importa **somente tipos/constantes públicas** do contract puro. `manageCalendar<A extends ManageRequest['action']>(request:Extract<ManageRequest,{action:A}>):Promise<ManageResultByAction[A]>`; `useGoogleCalendarAdmin()` queries/mutations de manage; `useGoogleCalendarStatuses(callIds:string[]):{statuses:Map<string,CallSyncStatus>;loading:boolean;error:unknown}` com `CallSyncStatus` da tabela pública. `GoogleCalendarIntegration():JSX.Element`; `CRMCalendarStatus({callId}:{callId:string}):JSX.Element|null`.
- `parseCrmLeadLink(search:string):{leadId:string}|null`, `safeCrmReturnPath(value:unknown):string|null`, `resolveCrmLeadLink(leadId:string,visibleLeadIds:string[],loading:boolean,error:boolean):'waiting'|'open'|'unavailable'|'load_error'`.
- `CallSyncStatus={callId:string,desiredRevision:string,confirmedRevision:string|null,status:SyncStatus,errorCode:string|null,lastSyncedAt:string|null}`. API exporta `adminQueryKey(userId:string):readonly string[]`, `callStatusesQueryKey(userId:string,callIds:string[]):readonly string[]`, `effectiveCallStatus(row:CallSyncStatus):SyncStatus`. Chaves: `['google-calendar','admin',userId]` e `['google-calendar','calls',userId,...sortedCallIds]`; sem dados administrativos em sessão sem capacidade executive/admin.

- [ ] **Step 1: Escrever `verify-google-calendar-ui.mjs` com adapter Supabase simulado e funções reais de link.** Assertions:
  ```js
  assert.equal(safeCrmReturnPath('https://outro.site/crm'), null);
  assert.equal(safeCrmReturnPath('//outro.site/crm'), null);
  assert.equal(safeCrmReturnPath(validCrmLink), validCrmLink);
  assert.equal(resolveCrmLeadLink(id, [], true, false), 'waiting');
  assert.equal(resolveCrmLeadLink(id, [], false, false), 'unavailable');
  assert.equal(resolveCrmLeadLink(id, [id], false, false), 'open');
  assert.equal(publicStatusWhenRevisionsDiffer, 'pending');
  assert.notDeepEqual(adminQueryKey(userA), adminQueryKey(userB));
  assert.equal(adminCallsForCloserSession, 0);
  ```
  Testar UUID malformado, erro de fetch distinto de inacessível, lista de calendários sem seleção automática, contrato negado, mutations invalidam queries e logout remove dados sensíveis do cache. Fallback para call nunca registrada é `disabled`, não `synced`.
- [ ] **Step 2: Rodar `node --experimental-vm-modules --test scripts/verify-google-calendar-ui.mjs`.** Esperar testes falharem antes da UI/contrato/link.
- [ ] **Step 3: Implementar API/hook/componentes e inserir cartão/badge.** Usar UI/shadcn existentes; cache só metadados, poll 30 s/refetch on focus; chamadas em lotes de até 100 IDs, sem fila privada/Realtime secreto. Cartão somente para `capabilities.executive`; mostrar Não conectado até prova real, agenda, pending/errors/lastRun, select explícito, reconectar/retry/desconectar. Explicar manutenção de eventos ao desconectar. Desabilitar destino quando destinationLocked. Badge diferencia synced da revisão desejada; erros exibem Reconectar Google/Revisar acesso à agenda/Tentar novamente, com ações administrativas só a quem pode.
- [ ] **Step 4: Implementar link CRM/login e atualizar somente o tipo novo de status.** ProtectedRoute carrega `state.from` apenas para `/crm` válido; Auth volta ao destino validado quando cadastro aprovado, conserva comportamento atual `/` nos outros casos e bloqueio de suspensão. CRM espera auth/permissões/leads, abre somente lead presente na lista RLS; fechar/editar limpa parâmetro lead sem apagar tab; trocar tab não perde lead antes da abertura. Mensagem genérica para inválido/inacessível, erro de carga com retry.
- [ ] **Step 5: Rodar testes UI, `npx.cmd tsc --noEmit -p tsconfig.app.json` e `npm.cmd run build`.** Esperar PASS. Verificar no browser estados disconnected/OAuth negado/escolha/reconnect, badge pendente/erro/synced e deeplink com login, reload, fechar sheet e usuário sem acesso; sessão de teste, sem publicar eventos comerciais. Capturar evidência das ações e erros de console, corrigir somente regressões deste escopo.
- [ ] **Step 6: Commit:** `feat(crm): show shared calendar integration and call sync status`.

## Task 7: Guia, validação final e instalação controlada

**Files:** `docs/GOOGLE_CALENDAR_CLOSERS_SETUP.md`; conjunto completo de artefatos anteriores.

**Interfaces operacionais:** Edge secrets `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_DASHBOARD_ORIGIN`, `GOOGLE_CALENDAR_CRON_SECRET`; callback exato `https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/google-calendar-oauth-callback`; origem produção `https://www.wsltda.com`. Vault cron recebe segredo correspondente e anon JWT somente via canal privado; nenhum `VITE_*` para credencial Google.

- [ ] **Step 1: Escrever guia com pré-requisitos e sequência concreta.** Cloud Calendar API + OAuth web/consentimento adequado à produção; callbacks; segredo instalado no servidor; migration storage→queue→cron; funções; UI; agenda de teste; uso da conta **`admvoxenai@gmail.com`** e seleção da agenda compartilhada **“agenda - closers” pelo ID canônico, na ativação comercial apenas no final**. Compartilhamento com closers é configurado no Google. Documentar cada status, retry, acesso revogado, destino fixado, 30 min/fuso e fonte CRM.
- [ ] **Step 2: Executar testes backend/UI/SQL, TypeScript, build e lint só dos arquivos TS/TSX novos/alterados.** `node --experimental-vm-modules --test scripts/verify-google-calendar-sync.mjs scripts/verify-google-calendar-ui.mjs`; `node scripts/check-google-calendar-db.mjs --local`; `npx.cmd tsc --noEmit -p tsconfig.app.json`; `npm.cmd run build`; `npx.cmd eslint` com caminhos explícitos. Consultar `verification-before-completion` e realizar review final exigido pelo modo escolhido. Registrar falhas pré-existentes com evidência, sem esconder falha do recurso.
- [ ] **Step 3: Identificar histórico/alvo remoto e preparar somente as três migrations e deployments desta integração.** Revisar grants, cron/segredos e wrapper transacional SQL; nunca publicar credenciais no log. Se OAuth ainda não estiver configurado, instalar artefatos inertes quando autorizado e conservar Não conectado. Impedimento externo não permite alegar integração ativa.
- [ ] **Step 4: Ensaio com conta/agenda exclusivas de teste e fixtures autorizadas.** Encaminhar → worker repetido → remarcar → trocar closer → concluir → nova call → cancelar/devolver → excluir fixture; conferir quantidade de eventos ativos, eventId/revisão/horário a cada etapa. Manualmente editar/apagar evento pendente e conferir reconciliação. Testar desconexão/reconexão no mesmo destino. Se não houver credencial/acesso, pedir **somente o passo externo faltante**, após código verificável pronto; senha/token nunca na conversa.
- [ ] **Step 5: Ativar a agenda comercial existente após ensaio validado e autorização operacional aplicável.** Instalação da produção é o resultado concreto a revisar quando necessário. Não usar a agenda comercial para testes; conferir destino, backfill/pendências e primeiro ciclo com calls reais autorizadas. Fixação do destino da agenda de teste precisa estar em projeto de teste isolado, nunca na conexão de produção que depois deveria mudar de agenda.
- [ ] **Step 6: Registrar evidências e commit do guia:** `docs(crm): document shared Google Calendar setup`. Rollback: unschedule os dois jobs, suspender integração/credencial, manter bindings/IDs; sem apagar eventos externos ou tabelas com trabalhos pendentes. Informar separadamente implementação entregue e ativação real concluída/pendente.

## Autorrevisão do plano

- Cobertura da spec: seleção/ciclo/horário → tarefas 1–2; OAuth/permissões → 2–4; identidade/concorrência/reconciliação → 2–3–5; produto/link → 6; instalação/ensaio/rollback → 7. Todos os 20 critérios da seção 9 têm tarefa e verificação correspondentes.
- Interfaces: contrato compartilhado puro; revisions text no JSON/bigint no SQL; store traduz camelCase para RPCs; nenhum tipo frontend contém token. Nenhum endpoint público depende de JWT ausente no callback.
- Review Focus: os cinco cenários possuem assertions/fixtures nas tarefas responsáveis. A captura da coorte na ativação evita omissão por conclusão/exclusão antes do scan; ensaio em projeto separado evita fixar destino comercial na agenda de teste.
- Proporção: plano define decisões, limites e assertions; corpos de implementação ficam para a execução. Não introduz framework de testes, importação de eventos manuais nem refatoração geral do CRM.
- Contratos adicionais conferidos: [CalendarList.get, primary e scope readonly](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get); [Vault: segredos criptografados e acesso à view de decrypt restrito](https://supabase.com/docs/guides/database/vault). Usar primary como referência é decisão deste plano, sem tratá-lo como prova suficiente de identidade estável.

## Handoff

**Execução nativa nesta sessão autorizada em 2026-10-11**, pelo pedido “continue de onde parou” após a apresentação do plano e da recomendação. Aplicar `executing-plans`, TDD em cada tarefa e revisão independente do conjunto no final; fila, OAuth e worker dependem dos mesmos contratos e o usuário priorizou rapidez.
