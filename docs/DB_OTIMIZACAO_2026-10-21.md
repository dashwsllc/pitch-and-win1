# Otimização do banco — 21/10/2026

Projeto dash (`mbzwchnxtskysqplqiyy`). Alerta do Supabase: "Your project is about to deplete its Disk IO Budget". Tudo abaixo foi **medido por leitura** antes de propor qualquer mudança.

## Estado do deploy (21/10/2026, 22:18 UTC): CONCLUÍDO

Tudo aplicado em produção e verificado por leitura:

- Migration `20261021230000` (função, 3 jobs, proteção do job `meta-insights-resume`, registrada no histórico); `crm_context_delivery_invoke` com prazo de 50 s e só com evento vencido.
- Frequências: `arena-cycle-deadlines` em `15 seconds` e `crm-context-reconcile` em `*/15 * * * *` (aplicadas pelo dono no SQL Editor; o classificador de permissões barrou a minha tentativa).
- Primeira drenagem da retenção (rodada pelo dono): vencidos foram de 496.939 (cron), 12.208 (batidas vazias), 9.085 (candidatas de revisão) e 500 (páginas) para **~0**. `db_housekeeping_run()` devolve `more:false` e `errors:{}`. Nada que devia ficar foi tocado: leads (1.046), leads do CRM (228), vendas (92), métricas publicadas (63), fila da ponte (211), revisões (1.535), eventos de auditoria; erros e execuções parciais do Meta seguem todos.
- Compactação (`VACUUM (FULL, ANALYZE)`, só reescreve linhas vivas): `net._http_response` 79,6 → 2 MB; `cron.job_run_details` 163 → 13 MB; `meta_capture_review_rows` 68 → 33 MB; `meta_sync_runs` 10 → 3 MB; `meta_insights_pages` 6,6 → 3,6 MB. **Banco inteiro: ~400 MB → 103 MB.**
- Saúde depois da compactação: todos os jobs do pg_cron `succeeded` (Arena a cada 15 s), pg_net enviando e gravando respostas (136 `200` em 40 min, fila vazia), `meta-insights-resume` devolvendo `0 rows` (não chama mais a Edge Function), nenhuma consulta presa nem trava advisory.

O que sobrou de "running" na tela do SQL Editor era só a interface: uma consulta longa (a drenagem) perdeu a resposta e a aba ficou pendurada, enquanto o banco já tinha terminado. O `{"skipped":"running"}` é a trava da função (`pg_try_advisory_xact_lock`): ela se recusa a rodar duas vezes ao mesmo tempo, e naquele instante a drenagem ainda estava em andamento. Se acontecer de novo: atualize a página e confira `select public.db_housekeeping(true);`; se vier `skipped`, espere um minuto.

Daqui para frente não há passo manual: o job das 03:17 BRT apaga o vencido (alguns milhares de linhas por dia) e os `VACUUM` agendados devolvem o espaço para reuso.

## O que as medições mostram

| Medida (desde 30/08, 52 dias) | Valor | Leitura |
|---|---|---|
| WAL total | 976 MB | ~19 MB/dia. Em 4 min ao vivo: 0,8 MB (3 KB/s). O banco está quase parado. |
| CPU somada das consultas | ~25.000 s | ~0,5% de um núcleo. Nada pesado. |
| Cache | 100% de acerto | Praticamente não lê do disco. |
| Leitura de disco total | ~2,2 GB | **2,0 GB foram uma só consulta diagnóstica** que varreu o histórico do cron 12 vezes. |
| Índices nunca usados | 3 (todos de constraint única) | Nada a remover. |
| Realtime | sem spill, só tabelas centrais | Saudável. |
| Arquivos temporários (pg_stat_database) | 244 GB / 77 mil arquivos | Origem principal não rastreada pelo `pg_stat_statements`. Ver "Não resolvido". |

**Onde está o peso:**

| Objeto | Tamanho | Natureza |
|---|---:|---|
| `cron.job_run_details` | 162 MB | Histórico do pg_cron. 540 mil linhas; **90% do `arena-cycle-deadlines` a cada 5 s** (17.125 execuções/dia). Nunca foi limpo. Nenhuma função do app lê. |
| `net._http_response` | 77 MB | 1.206 linhas de ~80 bytes = 100 KB de dado em 76 MB de arquivo. **Espaço morto**. Nenhuma função do app lê. |
| `meta_capture_review_rows` | 67 MB | Candidatas de revisão do Tráfego. **+6,7 MB/dia, sem limite**. |
| `meta_audit_events` | 13 MB | 74% é `metric.updated` (origem API): ruído de máquina. +1,1 MB/dia (~390 MB/ano). |
| `meta_sync_runs` | 10 MB | 17.413 batidas do worker de leads; **99,9% vazias** (sincronizaram 115 leads no total). |
| `meta_insights_pages` | 6,6 MB | Páginas brutas da API, nunca relidas depois da captura. |

65% de todo o WAL do banco é o pg_cron anotando as próprias execuções (1 insert + 4 updates por execução).

### Por que apagar linhas não bastava (a causa do lixo CONTÍNUO)

`cron.job_run_details` e `net._http_response` aparecem com `n_live_tup = 0`, `autovacuum_count = 0` e **nenhum vacuum, desde sempre**: o launcher do pg_cron e o worker do pg_net gravam sem reportar estatísticas ao autovacuum, que por isso nunca as limpa. Sem vacuum, o espaço das linhas apagadas não é reaproveitado e o arquivo só cresce: `net._http_response` cresce ~7,6 MB/dia (76 MB em 10 dias, para ~1.200 linhas vivas, com TTL de 6 h). Um `TRUNCATE` único resolveria por alguns dias e o problema voltaria. Por isso a solução inclui `VACUUM` **agendado dentro do próprio pg_cron** (`cron.use_background_workers = off`, então o comando roda fora de bloco de transação; o `postgres` tem o privilégio `MAINTAIN` nas duas tabelas).

## O que foi feito

1. **`TRUNCATE` único de `cron.job_run_details` e `net._http_response`** (−238 MB, sem varrer). Zero risco: nenhum código do app lê essas tabelas.
2. **Três jobs novos** (migration `20261021230000_db_housekeeping`, horários em UTC; Brasília = UTC−3):
   - `db-housekeeping`, 06:17 (03:17 BRT): `db_housekeeping_run()`, a retenção abaixo, em lotes de até 10 mil, até 6 lotes por execução.
   - `db-vacuum-cron-history`, 06:27: `VACUUM cron.job_run_details` (logo depois do DELETE, para o espaço ser reaproveitado).
   - `db-vacuum-net-responses`, a cada 6 h: `VACUUM net._http_response` (a tabela que mais gira: ~5 mil respostas por dia).
3. **Retenção** (`db_housekeeping`). Só apaga registro de máquina vencido, com proteções:

| Regra | Prazo | O que NUNCA apaga |
|---|---|---|
| Histórico do cron | 2 dias | Execução em andamento. |
| Batida vazia do worker de leads (`leads_reconciliation`, sucesso, 0 linhas, sem erro) | 3 dias | A mais recente de cada (conta, modo) e a última com sucesso (são as que a tela de Tráfego e os alertas leem); erro, parcial, em andamento, qualquer execução com linhas; qualquer uma referenciada por revisão, lote, métrica ou página. |
| Auditoria `metric.updated` (origem API) | 30 dias | Publicação, edição manual, remoção, leads, levas, decisões de revisão: **sem prazo**. |
| Eventos automáticos da captura (`capture.prepared`, `capture.auto_approved`, origem API; cada um carrega o manifest inteiro) | 60 dias | As decisões de pessoa (`capture.aprovado`, `capture.rejeitado`...): sem prazo. |
| Páginas brutas de captura concluída | 7 dias | Páginas de captura com erro, parcial ou em andamento. |
| Candidatas de revisão decididas pelo sistema (aprovada automaticamente ou substituída) | 7 dias | Linhas editadas ou em conflito; **toda revisão aprovada ou rejeitada por pessoa**; pendentes. |
| A própria revisão decidida pelo sistema, já sem linhas | 30 dias | As que ainda têm linha editada/em conflito, as decididas por pessoa e as que uma métrica publicada (`capture_review_id`) ou um lote ainda referenciam (origem do dado). |
| Execução de captura de insights concluída (`kind='insights'`, sucesso) | 30 dias | A mais recente de cada (conta, nível) e a última captura **completa** (a tela de Tráfego a usa para dizer até quando os dados estão em dia); erro, parcial, em andamento; as referenciadas por revisão, lote, métrica ou página. |
| Revisão SUPERADA já entregue na ponte dash→VOXEN | 14 dias | **A mais recente de cada atleta** (dá o próximo número de revisão e a comparação de conteúdo igual); pendente, em processamento, bloqueada. |

   As regras rodam em cascata na mesma execução (páginas → linhas → revisões → execuções), então o que fica sem referência sai junto. `db_housekeeping(true)` (padrão) só conta; na contagem a cascata não aparece.
4. **Job `meta-insights-resume` (1 min):** só chama a Edge Function quando existe captura de insights `running`/`partial` (a função lê exatamente essa condição e sai sem fazer nada; eram 1.440 chamadas HTTP por dia, cada uma com resposta gravada no pg_net e uma execução da Edge Function). O comando só é alterado se terminar na cláusula `WHERE` conhecida e se o resultado for um `SELECT` válido (`EXPLAIN`); do contrário fica como está. Validado contra o comando real em produção por leitura.
5. **Ponte dash→VOXEN:** `crm_context_delivery_invoke` só chama a Edge Function quando há evento vencido (antes: 1.440 chamadas/dia, quase todas inúteis), com prazo de 50 s (o de 5 s expirava sempre). Varredura de 5 → 15 min (os gatilhos já cobrem o tempo real).
6. **Arena:** `arena-cycle-deadlines` de 5 s → 15 s. O resultado de cada ciclo usa janela fixa (a venda conta pela data em que foi lançada), então os números são os mesmos; só a notificação de ciclo pode chegar até 15 s depois. Reversível em uma linha.

**Efeito esperado:** execuções do cron por dia ~23.900 → ~12.500 (−48%) e −1.440 chamadas HTTP/dia do job de insights; histórico do cron limitado a 2 dias (~25 mil linhas, ~10 MB) com o arquivo reaproveitado pelo VACUUM; espaço liberado ~240 MB na hora e ~40 MB depois do `VACUUM FULL`.

### Tamanho em regime (o que sobra, e com teto)

| Tabela | Regime estável (aprox.) |
|---|---:|
| Histórico do cron (2 dias) | ~10 MB |
| Respostas do pg_net (6 h, com VACUUM de 6 em 6 h) | ~2–4 MB |
| `meta_capture_review_rows` (7 dias × 6,7 MB/dia) | ~47 MB |
| `meta_audit_events` (ruído 30 d ≈ 23 MB + captura 60 d ≈ 12 MB + o resto, que é por lead) | ~40 MB |
| `meta_sync_runs` (batidas 3 d + insights 30 d) | ~6 MB |
| `meta_capture_reviews` (30 d) + `meta_insights_pages` (7 d) | ~10 MB |

O maior item é `meta_capture_review_rows`: o prazo de 7 dias é uma constante na função e pode cair para 3 dias (≈ 20 MB) se o dono preferir.

### Como conferir que não está acumulando lixo (a qualquer momento)

`select public.db_housekeeping(true);` só conta. Depois da primeira execução real, as contagens ficam em zero ou perto de zero (qualquer coisa que apareça é o que venceu desde as 03:17), `errors` fica `{}`, e `cron_heap_bytes` / `net_heap_bytes` ficam na casa de poucos MB. **Acima de ~50 MB em qualquer um dos dois significa que o VACUUM agendado não está funcionando**: veja `cron.job_run_details` do job `db-vacuum-*` (campo `status` e `return_message`).

## Efeito visível no dashboard (honesto)

- **Revisões de captura do Tráfego com mais de 7 dias decididas pelo sistema:** a lista de histórico passa a mostrar **0 linhas** nelas (a contagem vem das linhas) e o detalhe abre vazio; com mais de 30 dias a própria revisão some da lista (se nenhuma métrica a referencia). A auditoria (`capture.auto_approved`, com inserções/atualizações/remoções, por 60 dias) e `meta_traffic_daily` continuam. O que mudou nos valores publicados está nos eventos `metric.updated` por 30 dias.
- **Prévia no banco real (só contagem, 21/10):** 12.176 batidas vazias, 9.022 candidatas, 497 páginas vencidas; **0 revisões feitas por pessoa e 0 pendentes** (nada humano em jogo). As regras de 30/60/14 dias hoje contam 0 (o sistema tem 10 dias de vida) e passam a agir a partir de 20/11.
- Mudar um prazo: é uma constante `interval` na função `db_housekeeping` (um `CREATE OR REPLACE`).

## Não alterado, de propósito

- **Lógica da Arena** (`arena_tick`, 14 ms/execução, 1,9 h de CPU em 52 dias): é o núcleo das metas; só o intervalo mudou.
- **Cadência dos jobs `meta-lead-worker` (1 min) e do Google Agenda (1 min):** o funil de levas, a recuperação de dados da Meta e o envio ao CRM dependem dela; o worker de leads faz também a "recuperação" de leads já recebidos, então não há um critério simples de "ocioso" como no job de insights. As batidas vazias que ele gera agora têm retenção.
- **`meta_webhook_events`, `site_import_events`, `meta_form_leads`, `meta_lead_raw`:** dado do negócio ou recibos que a deduplicação e a data de primeiro recebimento do lead consultam.
- **Sinal em tempo real das batidas vazias:** `meta_sync_runs_signal` chama `dashboard_signal('arena')` a cada insert/update (a revisão `arena` mudou às 21:33:01, na virada do minuto). O front invalida todas as consultas a cada mudança de revisão. Suprimir o sinal só das batidas vazias reduziria atualizações de todo dashboard aberto, mas altera o comportamento em tempo real da tela de Tráfego; fica como melhoria separada.
- **Integração do Google Agenda:** `calendar_private.outbox` é fila transitória (18 mil inseridas e apagadas em 10 dias, 0 vivas); `calendar_private.connection` recebeu 51 mil updates em uma linha. Custo desprezível; sem acúmulo.
- **Índices:** nenhum candidato.

## Não resolvido

- **Origem exata dos 244 GB de arquivos temporários.** Medi 7 arquivos em 4 min, mas só ~5 MB eram de consultas rastreadas (as minhas). O candidato mais provável é a leitura de `pg_stat_statements` (4.753 entradas com texto longo > work_mem de 2 MB) por telas do Supabase (Query Performance/relatórios/assistente). `select pg_stat_statements_reset();` encolhe isso; manter essas telas fechadas ajuda. Não consegui provar a causa.
- **Se o alerta de IO some só com isso:** o consumo constante do banco é baixo. O pico provável foi a soma de varreduras de 150 MB do histórico do cron (a minha, a do assistente e a do painel) com o backfill da ponte. Isso deixa de existir com as tabelas esvaziadas; se o alerta persistir depois, o próximo passo é o plano de compute, não mais código.

## Reversão

- Retenção e VACUUMs: `select cron.unschedule('db-housekeeping'); select cron.unschedule('db-vacuum-cron-history'); select cron.unschedule('db-vacuum-net-responses'); drop function public.db_housekeeping_run(), public.db_housekeeping(boolean,integer);` (dados apagados não voltam; são registros de máquina).
- Job de insights: restaurar o comando original removendo a linha `AND EXISTS (SELECT 1 FROM public.meta_sync_runs ...)` do final (`cron.alter_job`).
- Arena: `select cron.alter_job((select jobid from cron.job where jobname='arena-cycle-deadlines'), schedule := '5 seconds');`
- Varredura da ponte: `schedule := '*/5 * * * *'` no job `crm-context-reconcile`.

## Testes

`node scripts/verify-db-housekeeping-db.mjs` (banco descartável; **34 mutações das proteções são pegas**), `node scripts/verify-crm-context-bridge-db.mjs`.
