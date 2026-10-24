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
5. **Sinal do dashboard só quando algo muda** (`20261023200000_background_signals_only_on_change`): cada mudança em `dashboard_events` faz **toda aba aberta reler todas as consultas** (`DataSync` → `invalidateQueries()` sem filtro). Em 23/10 à tarde, sem ninguém mexer, chegavam **~11 sinais/min**: o robô da Meta grava `meta_sync_runs` (início/fim de execução, 304 de 304 execuções automáticas com 0 linhas em 4 h) e reivindica `meta_webhook_events` a cada minuto, e os dois gatilhos eram `FOR EACH STATEMENT` incondicionais, que **disparam até em UPDATE que não altera linha nenhuma**. Resultado: cada aba relia tudo a cada ~10 s, anulando o piso de 45 s da camada 4. Agora `meta_sync_runs` só sinaliza execução manual ou automática que trouxe linhas, e `meta_webhook_events` usa `meta_changed_signal` (só se alguma linha mudou). Os dados importados continuam sinalizando pelos próprios gatilhos. Teste: `scripts/verify-background-signals-db.mjs` (prova também que antes da migration o minuto ocioso sinalizava). Efeito em cadeia: o `arena_tick` (a cada 45 s) recalcula todas as metas abertas quando a revisão 'arena' muda, então ele também deixa de trabalhar à toa.
6. **Trabalho de fundo só quando há trabalho** (`20261023210000_background_skip_idle_work`): o robô de leads sem descoberta (a cada minuto) só é chamado com evento de webhook vencido na fila (estava vazia desde 15/10: 1.440 chamadas/dia para nada; a descoberta de 5 em 5 min continua igual e também esvazia a fila); a entrega da agenda (a cada minuto) só com item vencido e livre na fila ou ativação pendente; a reconciliação da agenda (a cada 15 min) só reconfere no Google call que não terminou ou terminou há menos de 1 dia (reconferia **todas** as não concluídas, 45, das quais 38 já tinham passado; mudança feita no CRM continua indo na hora pelo gatilho); `meta-insights-sync-frequent` e `-deep` saem do minuto :00 (9,39 e 3:11). Teste: `scripts/verify-background-idle-db.mjs` (inclui a reversão abaixo).
   Estado: 5 e 6 **no ar desde 23/10 à noite**. Medido em 24/10 (00:30 UTC, sem uso): 0 avisos em 55 s (antes 9 em 50 s); chamadas por hora às Edge Functions: robô de leads 72 → 12, agenda 64 → 4; jobs de fundo ~0,03 s cada, 0 falhas no cron, ~48 s de banco por hora somando todos os jobs.
7. **Histórico da pressão** (`20261024010000_db_pressure_history`): a cada 5 min (minutos 5-55, nunca :00) o job `db-pressure-snapshot` grava uma linha pequena em `public.db_pressure_history` (conexões, sessões por aplicação/estado, esperas, a consulta ativa mais antiga SEM literais nem números longos, jobs do cron rodando/falhando, contadores de commits/rollbacks). Sobrevive ao reinício da instância (o que apagou as evidências de 22-23/10) e guarda 7 dias. Passivo: só lê o catálogo; não derruba sessão, não pausa nada. Tabela sem acesso para a API (RLS ligado, sem política, sem GRANT). Leitura: `scripts/db-pressure-history.sql`. Teste: `scripts/verify-db-pressure-history-db.mjs`.
8. **Testes no CI** (`.github/workflows/db-guards.yml`, roda em todo push e pull request): `node scripts/run-guards.mjs` roda as 7 verificações (40001, RLS, guardas do cron, avisos do dashboard, trabalho ocioso, histórico de pressão, polling do navegador) em banco descartável. Antes disso nenhum deles rodava sozinho. Localmente: instalar o PGlite uma vez (`mkdir -p .verification.local/calendar-tools && npm install --prefix .verification.local/calendar-tools --no-package-lock --no-save @electric-sql/pglite@0.5.8`) e `node scripts/run-guards.mjs`.
- **Aplicar uma migration nova do dash** (uma transação; ou entram todas, ou nenhuma): `node scripts/apply-migrations.mjs preflight <versão>` (ensaio desfeito, mostra um relatório do banco real) e depois `node scripts/apply-migrations.mjs apply <versão>`; cada um imprime a linha `npx supabase db query ... --file ...` para rodar. Para a 7: versão `20261024010000`.

## Regras para não reintroduzir o problema
- **Nunca** `RAISE ... USING ERRCODE = '40001'` (use `PT409`).
- Job novo no `pg_cron`: horário fora do `:00`, `SET statement_timeout`/`lock_timeout` no comando e `WHERE NOT public.db_under_pressure()`. O teste reprova o contrário (exceção só com o comentário `-- guard-exempt: <motivo>`).
- Política RLS nova: embrulhe as funções de acesso, `(SELECT crm_has_access())`, não `crm_has_access()`.
- `refetchInterval` novo: use `pollEvery(POLL.<tipo>)` de `src/lib/polling.ts` (o teste reprova abaixo de 45 s).
- Trabalho pesado novo (varredura, importação em lote): meça antes (`scripts/db-incident-diag.sql`), limite o lote e dê teto de tempo.
- Gatilho novo que chama `dashboard_signal`/`meta_changed_signal` **precisa do comentário `-- signal-ok: <motivo>` na migration** (o teste `verify-background-signals-db.mjs` reprova sem ele) e **tabela de controle de trabalho de fundo** (execuções, filas, leases, heartbeats) não sinaliza o dashboard; se precisar, só na mudança que a tela mostra (ex.: `WHEN (OLD.status IS DISTINCT FROM NEW.status ...)`). Lembre que `FOR EACH STATEMENT` dispara mesmo quando o comando não altera linha; prefira `meta_changed_signal` (tabelas de transição) ou `FOR EACH ROW` com `WHEN`.
- Saúde do sinal (só leitura, ~1 min): `select set_config('m.r0', (select jsonb_object_agg(topic, revision)::text from public.dashboard_events), false); select pg_sleep(50); select topic, revision - (current_setting('m.r0')::jsonb ->> topic)::bigint as sinais_50s from public.dashboard_events order by 2 desc;`. Sem gente usando, o esperado é 0-1 por tópico; vários por minuto = algum trabalho de fundo sinalizando à toa.

## Se acontecer de novo (nesta ordem)
1. **Só leitura primeiro** (cada um termina sozinho, nada é gravado):
   - **Histórico da pressão (camada 7), o primeiro a olhar, mesmo depois de reinício**: `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-pressure-history.sql --output json > hist.json` e `node scripts/show-db-rows.cjs hist.json`. Procure o minuto em que `conexoes`/`ativas` sobem, `rollbacks_por_s` dispara ou `cron_falhas_10min` deixa de ser 0; `ativa_consulta` mostra o que estava preso. Buracos de 10+ min na lista = a instância não conseguia nem abrir a conexão do job (também é informação).
   - `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/db-pressure-check.sql --output json` e `node scripts/show-db-rows.cjs <saida.json>`: pressão atual, jobs e falhas recentes.
   - `... --file scripts/db-incident-diag.sql --output json > diag.json` e `node scripts/show-db-rows.cjs diag.json`: sessões, esperas, bloqueios, taxa de commits/rollbacks, I/O, tabelas que mais escrevem, cron, consultas mais caras (transação `READ ONLY`; até 23/10 o resultado vinha numa exceção que a CLI cortava em ~1000 caracteres).
   - Latência da API por faixa (MCP da Supabase, `query_logs`, até 24 h): `source='edge_logs'`, `request.path like '/rest/v1/%'`, `quantile(0.95)` de `response.origin_time` por 30 min. Em 23/10: saudável = mediana ~20 ms e p95 < 600 ms; a queda das 14:00Z mostrou p95 > 2 min.
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
- `20261023200000_background_signals_only_on_change` (devolve os gatilhos incondicionais de antes):
  ```sql
  begin;
  drop trigger if exists meta_sync_runs_signal_manual_start on public.meta_sync_runs;
  drop trigger if exists meta_sync_runs_signal_status on public.meta_sync_runs;
  drop trigger if exists meta_webhook_events_signal_insert on public.meta_webhook_events;
  drop trigger if exists meta_webhook_events_signal_update on public.meta_webhook_events;
  create trigger meta_sync_runs_signal after insert or update on public.meta_sync_runs for each statement execute function public.dashboard_signal('arena');
  create trigger meta_webhook_events_signal after insert or update on public.meta_webhook_events for each statement execute function public.dashboard_signal('crm');
  delete from supabase_migrations.schema_migrations where version = '20261023200000';
  commit;
  ```
- `20261024010000_db_pressure_history` (tira o job, as funções e a tabela do histórico; testado em `scripts/verify-db-pressure-history-db.mjs`, que roda ESTE bloco):
  <!-- rollback-20261024010000 -->
  ```sql
  begin;
  select cron.unschedule(jobid) from cron.job where jobname = 'db-pressure-snapshot';
  drop function if exists public.db_pressure_snapshot();
  drop function if exists public.db_pressure_mask(text);
  drop table if exists public.db_pressure_history;
  delete from supabase_migrations.schema_migrations where version = '20261024010000';
  commit;
  ```
- `20261023210000_background_skip_idle_work` (devolve a reconciliação de todas as calls, os jobs chamando a cada minuto e os horários no :00; testado em `scripts/verify-background-idle-db.mjs`, que roda ESTE bloco):
  <!-- rollback-20261023210000 -->
  ```sql
  begin;
  CREATE OR REPLACE FUNCTION public.google_calendar_scan_page(p_mode text, p_limit integer)
   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
  AS $function$
  DECLARE c calendar_private.connection; cur uuid; q record; n integer:=0; last_id uuid; cap integer:=greatest(1,least(500,p_limit)); more boolean;
  BEGIN
    IF p_mode NOT IN ('backfill','reconcile') THEN RAISE EXCEPTION 'invalid_scan_mode' USING ERRCODE='22023'; END IF;
    SELECT * INTO c FROM calendar_private.connection FOR SHARE;
    IF c.connection_status<>'connected' OR c.activated_at IS NULL THEN RETURN jsonb_build_object('processed',0,'done',true); END IF;
    SELECT cursor INTO cur FROM calendar_private.scan_state WHERE mode=p_mode FOR UPDATE;
    IF p_mode='backfill' THEN
      FOR q IN SELECT call_id,lead_id FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id ORDER BY call_id LIMIT cap
        LOOP PERFORM calendar_private.enqueue(q.call_id,q.lead_id); n:=n+1; last_id:=q.call_id; END LOOP;
      more:=EXISTS(SELECT 1 FROM calendar_private.activation_seeds WHERE calendar_id=c.calendar_id);
    ELSE
      FOR q IN SELECT id,call_id,lead_id FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND (cur IS NULL OR id>cur) ORDER BY id LIMIT cap
      LOOP
        INSERT INTO calendar_private.outbox(binding_id) VALUES(q.id) ON CONFLICT DO NOTHING;
        n:=n+1; last_id:=q.id;
      END LOOP;
      more:=n=cap AND EXISTS(SELECT 1 FROM calendar_private.bindings WHERE calendar_id=c.calendar_id AND NOT completed AND NOT removed AND id>last_id);
    END IF;
    UPDATE calendar_private.scan_state SET cursor=CASE WHEN more THEN last_id ELSE NULL END WHERE mode=p_mode;
    RETURN jsonb_build_object('processed',n,'done',NOT more);
  END $function$;
  select cron.alter_job(job_id := jobid, command := replace(command, 'AND EXISTS(SELECT 1 FROM public.meta_webhook_events e WHERE (e.status IN (''pending'',''error'') AND e.next_attempt_at<=clock_timestamp()) OR (e.status=''processing'' AND e.lease_until<=clock_timestamp())) ', '')) from cron.job where jobname = 'meta-lead-worker';
  select cron.alter_job(job_id := jobid, command := replace(command, 'AND (EXISTS(SELECT 1 FROM calendar_private.outbox o WHERE o.available_at<=clock_timestamp() AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())) OR EXISTS(SELECT 1 FROM calendar_private.activation_seeds)) ', '')) from cron.job where jobname = 'google-calendar-deliver';
  select cron.alter_job(job_id := jobid, schedule := '*/30 * * * *') from cron.job where jobname = 'meta-insights-sync-frequent';
  select cron.alter_job(job_id := jobid, schedule := '0 3 * * *') from cron.job where jobname = 'meta-insights-sync-deep';
  delete from supabase_migrations.schema_migrations where version = '20261023210000';
  commit;
  ```

## Capacidade (decisão do dono)
A Nano é a base do plano gratuito, com CPU compartilhada e orçamento de disco de 5 MB/s e 250 IOPS (documentação da Supabase). As defesas acima reduzem a carga e impedem o efeito dominó, mas **nenhum ajuste de código transforma uma Nano em uma instância dedicada**. A Supabase recomenda migrar para **Micro** (o plano Pro já inclui um Micro; a troca causa menos de 2 minutos de parada). Se o dashboard é o canal de venda da equipe, essa é a medida que mais reduz o risco que sobra.

Medido em 23/10 (16:30 BRT, 4 h depois do reinício, todas as defesas no ar): ociosas, as consultas mais caras da tela levam 12-120 ms (`arena_visible_goals` 82 ms, `arena_dashboard` 122 ms, `crm_context_summary` 73 ms), mas em produção a média foi 1,3-3 s e o pico 7-8 s (o teto do papel `authenticated` é 8 s): a diferença é fila por CPU. Ou seja, mesmo sem nenhuma queda, a Nano opera perto do limite em horário comercial.

Custo (documentação da Supabase, 23/10): a org `3211` está no plano **free** com **dois** projetos (`dash` e `321`). Pro = US$ 25/mês por org, com US$ 10/mês de crédito de computação, que cobre **um** Micro (~US$ 10). Cada projeto a mais na mesma org paga a própria computação (~US$ 10 no Micro), então: só o `dash` no Pro ≈ US$ 25/mês; `dash` + `321` ≈ US$ 35/mês (ou mover o `321` para outra org gratuita). Small (~US$ 15, 2 GB) fica em ≈ US$ 30/mês. Caminho: painel › Organization › Billing › mudar para Pro; depois Project `dash` › Settings › Compute and Disk › Micro (ou Small). Projeto que veio do free continua Nano até essa troca, e no plano pago a Nano é cobrada como Micro.
