# Runbook: dashboard sem carregar / banco do dash travado

Projeto Supabase **dash** (`mbzwchnxtskysqplqiyy`), instância **Nano** (CPU compartilhada, 0,5 GB, até 60 conexões; plano gratuito). Escrito em 23/10/2026, depois de três quedas em 22 e 23/10.

## Como a queda aparece
- O site (`wsltda.com`) abre e o login funciona, mas telas ficam em "carregando" ou dão erro, porque **toda chamada de dados** (`/rest/v1/...`) demora 15-30 s ou volta 503/504. Auth, Realtime e Edge Functions seguem respondendo.
- A CLI (`supabase db query`) falha com `Failed to create login role: Connection terminated due to connection timeout`.

## O que aconteceu (e a cadeia de causas)
| Data | O que se viu | Causa |
| --- | --- | --- |
| 22/10 ~13:40 BRT | CRM inteiro com `upstream request timeout` | pico de CPU coincidente numa Nano; só voltou reiniciando o projeto |
| 22-23/10 (noite) | API quase parada por horas | **laço de repetição do PostgREST 14**: funções que levantavam `ERRCODE '40001'` eram repetidas sem fim e prendiam as ~10 conexões do pool (ver `POSTGREST_RETRY_LOOP_2026-10-23.md`) |
| 23/10 ~11:00 BRT | idem, só voltou com "Restart project" | ver abaixo |

Linha do tempo do pg_cron em 23/10 (UTC): normal até 13:50; às **14:00** cinco trabalhos pesados começam juntos no minuto `:00` (`meta_link_site_answers` a cada 5 min, `meta_refresh_form_contexts` a cada 10, `crm_context_reconcile(150)` a cada 15, mais quatro `net.http_post`); às **14:01:16** o primeiro `job startup timeout`; 338 falhas até 15:31; sete jobs de 911 s; durante ~10 min **nenhum job rodou**. O `pg_cron` abre **uma conexão nova por execução** (`cron.use_background_workers = off`): com o banco lento os jobs se empilham, ocupam as 60 conexões e nada mais entra (nem a API, nem a CLI) até alguém reiniciar.

Em repouso, cada RPC pesada leva 3-58 ms. O que as torna lentas é **disputar CPU** com as rajadas de fundo. Não ficou provado o gatilho exato das 14:00Z (o reinício zerou `pg_stat_statements` e os logs da Supabase estavam indisponíveis).

## Defesas que existem agora (em camadas)
1. **`PT409` em vez de `40001`** (`20261023020000_postgrest_no_retry_errcode`): mata o laço de repetição. Teste: `scripts/verify-postgrest-no-retry-errcode-db.mjs` (também proíbe `40001` em migrations futuras).
2. **Políticas de acesso avaliadas uma vez por consulta** (`20261023140000_rls_initplan_wrap`): 124 políticas chamavam funções de acesso a cada linha (listar a auditoria de 17 mil linhas levava ~12 s, passou a ~19 ms). Equivalência provada com 11 usuários x 270 combinações. Tabelas "quentes" (`profiles`, `user_roles`, `registration_requests`) ficaram de fora de propósito; incluir numa janela calma com `SET LOCAL app.rls_include_hot = 'on'`. Teste: `scripts/verify-rls-initplan-db.mjs`.
3. **Trabalho de fundo com freio** (`20261023150000_background_load_guards`): `public.db_under_pressure()` (>= 12 consultas ativas fora do cron **ou** >= 48 conexões); 10 jobs só rodam `WHERE NOT db_under_pressure()`; as varreduras têm `statement_timeout`/`lock_timeout`; horários espalhados, **nenhum no minuto :00**; lote da varredura da ponte de 150 para 40; transação pendurada da API (`authenticator`) encerrada em 20 s. Teste: `scripts/verify-background-guards-db.mjs` (reprova também **job novo sem guarda**).
4. **Navegador** (`src/lib/polling.ts`, `outage-guard.ts`, `outage-client.ts`, `OutageBanner`): nenhuma atualização automática abaixo de 45 s (60-120 s com folga aleatória), uma só nova tentativa por consulta (eram 3), releitura geral limitada a uma a cada 10 s por aba, e um **disjuntor**: 5 falhas de sobrecarga em 30 s pausam as atualizações automáticas (20 s, 40 s, 80 s, até 120 s) e mostram um aviso; **gravações da pessoa nunca são pausadas**. Teste: `scripts/verify-load-guards-ui.mjs`.

## Regras para não reintroduzir o problema
- **Nunca** `RAISE ... USING ERRCODE = '40001'` (use `PT409`).
- Job novo no `pg_cron`: horário fora do `:00`, `SET statement_timeout`/`lock_timeout` no comando e `WHERE NOT public.db_under_pressure()`. O teste reprova o contrário (exceção só com o comentário `-- guard-exempt: <motivo>`).
- Política RLS nova: embrulhe as funções de acesso, `(SELECT crm_has_access())`, não `crm_has_access()`.
- `refetchInterval` novo: use `pollEvery(POLL.<tipo>)` de `src/lib/polling.ts` (o teste reprova abaixo de 45 s).
- Trabalho pesado novo (varredura, importação em lote): meça antes (`scripts/db-incident-diag.sql`), limite o lote e dê teto de tempo.

## Se acontecer de novo (nesta ordem)
1. **Só leitura primeiro** (cada um termina sozinho, nada é gravado):
   - `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-pressure-check.sql --output json` e `node scripts/show-db-rows.cjs <saida.json>`: pressão atual, jobs e falhas recentes.
   - `... --file scripts/db-incident-diag.sql ...`: sessões, esperas, bloqueios, taxa de commits/rollbacks, I/O, consultas mais caras.
   - `... --file scripts/db-cron-timeline.sql ...`: linha do tempo do cron em faixas de 10 min (achar o minuto em que quebrou).
2. Se a CLI não conecta: **painel da Supabase › Settings › General › Restart project** (o que resolveu nas três vezes; leva ~2 min). Se não voltar, abrir chamado com o ID do projeto.
3. Depois de voltar, **antes de qualquer outra coisa**, rode o passo 1 (as estatísticas zeram no reinício) e guarde a saída.
4. Para soltar conexões presas da API sem reiniciar (precisa de autorização; escrita):
   ```sql
   select pg_terminate_backend(pid) from pg_stat_activity
   where datname = current_database() and application_name like 'PostgREST%' and backend_type = 'client backend'
     and state <> 'idle' and pid <> pg_backend_pid();
   ```
5. Pausar trabalho de fundo no susto: `select cron.alter_job(job_id := <id>, active := false);` nos jobs `crm-context-reconcile`, `meta-site-form-link`, `meta-form-context-refresh` (religar depois com `active := true`). A ponte tem interruptor próprio: `select public.crm_context_delivery_set_enabled(false);`.

## Reversões (guardadas em `.verification.local/`, não vão ao Git)
- `rls-initplan-ROLLBACK.sql`: devolve as 180 políticas ao texto de antes. Depois: `delete from supabase_migrations.schema_migrations where version = '20261023140000';`
- `background-guards-ROLLBACK.sql`: devolve os 10 jobs ao horário e comando de antes. Depois: `delete from supabase_migrations.schema_migrations where version = '20261023150000';` e, se quiser, `alter role authenticator reset idle_in_transaction_session_timeout;`.
- Para gerar uma reversão nova do estado atual: `node scripts/apply-background-guards-migration.mjs rollback` e rodar o SQL gerado (só lê).

## Capacidade (decisão do dono)
A Nano é a base do plano gratuito, com CPU compartilhada e orçamento de disco de 5 MB/s e 250 IOPS (documentação da Supabase). As defesas acima reduzem a carga e impedem o efeito dominó, mas **nenhum ajuste de código transforma uma Nano em uma instância dedicada**. A Supabase recomenda migrar para **Micro** (o plano Pro já inclui um Micro; a troca causa menos de 2 minutos de parada). Se o dashboard é o canal de venda da equipe, essa é a medida que mais reduz o risco que sobra.
