-- Passo final (opcional): devolve ao disco o espaco das tabelas que a retencao acabou de esvaziar.
-- DELETE/retencao nao encolhe o arquivo da tabela (o espaco e reaproveitado, mas o tamanho no painel nao cai). VACUUM FULL reescreve a tabela e encolhe.
-- Rode DEPOIS de `select public.db_housekeeping_run();`, UM COMANDO POR VEZ (VACUUM nao roda dentro de transacao; o SQL Editor executa um comando por clique
-- se voce selecionar so a linha). Cada um trava a tabela por 1 a 5 segundos; o worker do Meta espera e continua. Faca fora de horario de pico.
--
-- Antes (tamanho total no banco, medido em 21/10): meta_capture_review_rows 67 MB, meta_sync_runs 10 MB, meta_insights_pages 6,6 MB.
VACUUM (FULL, ANALYZE) public.meta_capture_review_rows;
VACUUM (FULL, ANALYZE) public.meta_sync_runs;
VACUUM (FULL, ANALYZE) public.meta_insights_pages;

-- Estatisticas de consulta (pg_stat_statements): zera os ~4.700 textos acumulados desde 30/08. Cada leitura da tela "Query Performance" ou do assistente
-- materializa essa lista e gravava arquivo temporario em disco (work_mem de 2 MB). Perde so o historico de desempenho, que ja foi analisado.
-- select pg_stat_statements_reset();

-- Conferir o resultado (tamanho total por tabela):
-- select relname, pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and relname in ('meta_capture_review_rows','meta_sync_runs','meta_insights_pages') order by pg_total_relation_size(c.oid) desc;
