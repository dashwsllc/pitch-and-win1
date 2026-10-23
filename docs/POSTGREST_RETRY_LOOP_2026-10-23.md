# Laço de repetição do PostgREST (SQLSTATE 40001) — 22 e 23/10/2026

## O que aconteceu
Funções RPC que levantavam `RAISE ... USING ERRCODE='40001'` (claim/lease vencido, trava otimista de tela) faziam o **PostgREST 14 repetir a transação sem fim**
(`BEGIN → set_config → check_registration_access → chamada → ABORT`, a cada ~40 ms). Cada laço prende uma conexão do pool (10 no plano Nano). Com o pool
inteiro preso, TODA rota da API dava 504/`PGRST003`, enquanto o banco direto (CLI, SQL Editor) respondia normal. Sintomas: CPU 100%, ~2.000 rollbacks/s,
"310 mil requisições/h com 0,4% de sucesso" no painel (o gateway quase não registra: o tráfego é interno ao PostgREST). A repetição continua mesmo depois de
o cliente desistir. Corrigido só no PostgREST 16 (Supabase: "SQLSTATE 40001 in an RPC function causes infinite retries").

Realimentação: banco lento → lease de 60 s vence → `Stale claim`/`Lease ... expirado` (40001) → laço → mais CPU → mais leases vencidos.

## Correção
- Migration `20261023020000_postgrest_no_retry_errcode`: toda função (schemas `public` e `calendar_private`) que levanta `40001` passa a levantar `PT409` (HTTP 409, sem repetição).
- Telas: `src/lib/stale-conflict.ts` (`isStaleConflict`) aceita `PT409` e `40001`.
- **Regra:** nenhuma migration nova pode conter `40001` (o teste `scripts/verify-postgrest-no-retry-errcode-db.mjs` falha se contiver). Use `PT409`.

## Como detectar de novo (só leitura)
Logs do Postgres (MCP da Supabase `query_logs`, `source='postgres_logs'`): poucas sessões `PostgREST` com milhares de erros por minuto, `user_name='authenticator'`.
```sql
-- sessões do PostgREST que não estão ociosas, com idade
select pid, state, now() - backend_start as conn_age, left(regexp_replace(query,'\s+',' ','g'),90) q
from pg_stat_activity where application_name like 'PostgREST%' order by backend_start;
```
Várias sessões com `conn_age` de horas, ciclando `check_registration_access`/`BEGIN` = laço.

## Como destravar (escrita; só com autorização)
```sql
select pg_terminate_backend(pid) from pg_stat_activity
where datname = current_database() and application_name like 'PostgREST%' and backend_type = 'client backend'
  and state <> 'idle' and pid <> pg_backend_pid();
```
O PostgREST reconecta limpo. Só corrija a função de fato (a migration acima); sem isso, o próximo claim vencido cria outro laço.
