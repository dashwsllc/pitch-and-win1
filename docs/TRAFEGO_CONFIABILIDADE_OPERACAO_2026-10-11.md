# Tráfego: operação e implantação seletiva — 11/10/2026

## Estado da entrega

Implementação integrada à `main` em 11/10/2026, com push e publicação da revisão `8571e15` na Vercel. As sete migrations do pacote e as quatro funções Edge foram instaladas seletivamente no Supabase. Após a regularização dos tokens pelo usuário, métricas e descoberta de leads responderam HTTP 200. Foram processados 148 recibos reais; os cinco jobs Meta estão ativos. A migration corretiva `20261011190000` alinha a finalização das execuções parciais ao worker durável. Nenhum lote comercial foi aprovado durante a implantação.

A intenção preservada é conferir investimento Meta, revisar recebimentos, encaminhar contatos aprovados e medir vendas reais pela data de geração do lead. A aprovação do software não aprova os dados recebidos.

Retomada em 12/10: o token de Página do Explorer expirou em 11/10 às 16h de Brasília. O usuário de sistema existente conseguiu obter um token para a mesma Página e consultar os formulários. O worker agora valida a identidade do token configurado e recupera o token da Página pelo usuário de sistema quando necessário. A resolução é feita somente quando há trabalho Graph e fica em memória por requisição, sem gravar credenciais em recibos, checkpoints ou logs. Ver [diagnóstico e validação da retomada](TRAFEGO_RETOMADA_2026-10-12.md).

## Fluxo implementado

1. Insights captura páginas duráveis por conta/nível/janela, com lease, cursor sem token e prazo limitado. Retomada não abre capturas novas. Resposta parcial é HTTP 202; falha é 502. Nenhuma página publica métricas diretamente; desde 12/10 a captura completa e sem conflito é publicada automaticamente ao terminar (ver `TRAFEGO_LEVAS_AUDITORIA_E_PLANO_2026-10-12.md`, seção 13).
2. A captura completa prepara uma revisão lógica versionada. As partes de 500 linhas servem para conferência; a decisão abrange a revisão inteira. Remoções propostas aparecem explicitamente. Recapturas preservam edições e evidências, expondo conflitos para resolução com motivo. Decisão concorrente ou versão antiga falha inteira.
3. Webhook verifica HMAC sobre o corpo original, grava o recibo antes do ACK e deixa Graph/extração para o worker. Falha de persistência responde 503. Recibos repetidos não reabrem processados nem apagam decisões.
4. Worker consome recibos antigos, recupera leases vencidos e aplica backoff. Descoberta tem janela congelada e checkpoint de formulários/páginas; 48 horas só delimitam a varredura inicial, não a validade dos recibos. Páginas alternam prioridade entre minutos na drenagem e entre horas na descoberta. Descoberta e drenagem têm registros separados, mantendo erros de autorização visíveis.
5. Extração determinística preserva respostas originais. IA só ajuda em contatos ausentes, com limite de três segundos e validação estrita. Contato completo aprovado segue ao CRM sem SDR atribuído; incompleto aprovado segue à fila de complemento.
6. Desempenho usa um recorte para cards, tabela, gráfico e CSV completo. Campanha, conjunto e anúncio mantêm identidades distintas. Ausência de métrica difere de zero. Ações sobrepostas são alternativas, não parcelas somadas. Definição, moeda e calendário acompanham cada captura. CPL, CPA, ROAS e custo por conversa verificam a ação efetivamente selecionada; diferenças bloqueiam somente a taxa afetada. O CSV inclui ações, métricas manuais, fuso e versão Graph.
7. Coorte combina leads aprovados realmente vinculados ao CRM e vendas confirmadas ainda válidas, pela geração do lead em Brasília. Origem desconhecida, cobertura parcial ou mistura incompatível impedem CPA/ROAS confirmados. Vendas não são rateadas entre API/CSV.
8. Sinais de revisão são transacionais por statement; rollback/no-op não anunciam mudanças. A segunda sessão atualiza por Realtime ou reconciliação dos contadores. Listas de revisão são leves; detalhes só carregam ao abrir.

## Pré-requisitos e baseline

Antes de publicar, salvar um snapshot de **schema, funções, triggers, políticas, grants, jobs e histórico de migrations**, sem contatos, respostas ou segredos. O histórico remoto observado tinha versões ausentes com objetos existentes. Não executar `supabase db push` sobre todo o histórico e não registrar versões sem verificar equivalência do SQL.

Executar `scripts/verify-meta-reliability-schema.sql` em conexão administrativa de leitura. `missing_object` exige implantação da migration correspondente. `present_unrecorded` exige comparar os objetos com o arquivo e reconciliar o histórico seletivamente; não reaplicar um `CREATE TABLE` já instalado. `ready=false` impede ativar jobs. O script também verifica triggers de fatos, staging privado e grants de RPCs.

Confirmar no projeto de destino: `pg_cron`, `pg_net`, Vault, privilégios administrativos para agendamento e baseline de aprovação/edições de 09/10. Esses transportes foram substituídos localmente; a prova local não verifica a execução real das extensões.

## Ordem de implantação

Pausar primeiro os jobs Meta existentes por nomes exatos, preservando os outros jobs. Aplicar somente estas oito migrations, em ordem, após conferir baseline e histórico:

| Versão | Arquivo |
| --- | --- |
| 20261011120000 | `20261011120000_meta_traffic_validation.sql` |
| 20261011130000 | `20261011130000_meta_capture_reviews.sql` |
| 20261011140000 | `20261011140000_meta_lead_queue.sql` |
| 20261011150000 | `20261011150000_meta_traffic_cohort.sql` |
| 20261011160000 | `20261011160000_meta_traffic_review_queries.sql` |
| 20261011161000 | `20261011161000_meta_traffic_signals.sql` |
| 20261011170000 | `20261011170000_meta_worker_cron.sql` |
| 20261011190000 | `20261011190000_meta_lead_partial_completion.sql` |

Os nomes reais devem coincidir com os arquivos do pacote; não renomear versões. A migration `20261011170000` substitui os jobs Meta conhecidos e deixa **os cinco pausados**. A corretiva `20261011190000` aceita `partial` na RPC de finalização, mantendo os demais estados e grants. Executar novamente o preflight e `scripts/verify-meta-sync-completion-db.sql`; este último usa execuções sintéticas e rollback. Conferir schema antes de avançar.

Publicar em seguida `meta-insights-sync`, `meta-lead-webhook`, `meta-leads-reconciliation` e `meta-lead-worker`. O webhook mantém `verify_jwt=false` e exige HMAC; as outras três mantêm `verify_jwt=true` e autorização própria. Reconciliação/worker exigem `x-cron-secret`; não habilitar sua chamada pública. Publicar a interface depois das funções. Os tipos Supabase foram regenerados do baseline real com as sete migrations; a camada de aplicação descreve separadamente o campo CRM preenchido pelo trigger.

Verificar presença dos secrets Edge: `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_SYNC_CRON_SECRET`, `META_PAGE_IDS`. `META_PAGE_ACCESS_TOKEN` mantém prioridade quando válido e correspondente à Página. Se estiver expirado, representar outra identidade ou estiver ausente, o worker consulta `/<page_id>?fields=id,access_token` com o usuário de sistema já autorizado e valida a identidade recebida. Erros de permissão/transporte continuam visíveis; não acionam essa recuperação. Ausência de credencial válida mantém os recibos recuperáveis e o backoff de configuração. `META_GRAPH_API_VERSION` está em `v26.0`, validada com métricas e leads. O validador de domínio, caminho e filtros foi preservado. Vault exige os nomes `meta_cron_anon_key` e `meta_sync_cron_secret`, com valor correspondente ao segredo Edge. Não colocar valores em arquivos, logs ou conversa.

Após banco → Edge → front, preflight aprovado e conferência de permissões, ativar **somente** estes nomes com `cron.alter_job(jobid, active := true)` em transação administrativa:

| Job | Agenda (conferir fuso do pg_cron) | Corpo |
| --- | --- | --- |
| meta-insights-sync-frequent | */30 * * * * | `{"days":8}` (desde 12/10) |
| meta-insights-sync-deep | 0 3 * * * | `{"days":8}` |
| meta-insights-resume | * * * * * | `{"resumeOnly":true}` |
| meta-leads-reconciliation-hourly | */5 * * * * (desde 12/10; o nome foi mantido) | `{"discover":true}` |
| meta-lead-worker | * * * * * | `{"discover":false}` |

Conferir exatamente cinco nomes únicos, agendas e o fuso configurado do pg_cron no destino. O transporte tem timeout de 60 segundos, acima do orçamento Edge escolhido de 45 segundos/reserva de 5. É uma escolha operacional dentro dos [limites oficiais](https://supabase.com/docs/guides/functions/limits); contas grandes retomam em vários ciclos. Secret Vault ausente impede enviar requisição. Agendas reais, execução pg_net, latência e limites do plano precisam de smoke test após publicação.

## Conferência depois de publicar

- Reexecutar preflight, conferir grants, políticas, triggers, cinco jobs e suas respostas HTTP.
- Em **Conexão**, distinguir tentativa, última captura completa, janela publicada e revisão pendente por nível. 200 legado não comprova cobertura completa. Erro da descoberta não desaparece por sucesso vazio da drenagem.
- Com conta autorizada, comparar API com Ads Manager no mesmo intervalo, conta, nível, fuso, moeda, definição de resultado e atribuição. Não corrigir histórico multiplicando/dividindo resultados sem comparação.
- Usar lead sintético da ferramenta oficial da Meta para validar assinatura → recibo → pendente. A aprovação desse lead deve ser explicitamente autorizada no teste comercial. Não aprovar lotes reais para smoke test.
- Abrir duas sessões autorizadas, revisar um dado sintético e conferir atualização da outra. Repetir acesso como SDR/suspenso. Comparar cards/tabela/CSV em campanha, conjunto e anúncio.
- Conferir vínculo real CRM, respostas preservadas, vendas aprovadas e cancelamento refletido na coorte. Dados insuficientes devem mostrar motivo e taxas indisponíveis.

## Recuperação

Recibo `pending/error` antigo continua elegível conforme `next_attempt_at`; não apagar nem reenfileirar manualmente um processado. Identificar classe da falha e regularizar autorização/configuração. Falhas transitórias têm retentativas limitadas com backoff. Lease vencido pode ser recuperado com novo token; finalização do dono antigo é rejeitada.

Captura parcial retoma o cursor salvo. Cursor expirado/permissão terminal aborta a tentativa sem preparar remoções; depois da correção, abrir captura nova da janela. Falha de persistência não avança cursor. Revisão alterada exige recarregar e conferir a versão atual; conflitos exigem escolher publicado/recebido/editado/remoção com motivo. Nova captura pode substituir uma revisão pendente, preservando edições e identificando colisões.

Na descoberta de leads, Graph código 100 em cursor paginado reinicia apenas o percurso afetado, com o mesmo claim/versionamento e a mesma janela congelada. Recibos existentes são deduplicados; a falha não marca cobertura completa. Erros de permissão mantêm o cursor até regularizar o acesso. A próxima execução retoma o percurso reiniciado.

CSV mantém semântica de patch/upsert. O servidor congela a identidade/versão de cada alvo no upload e verifica todos antes de publicar. Edição publicada ou aprovação concorrente posterior retorna `40001`; reimportar e conferir novamente. Lotes pendentes anteriores à mudança, sem versão de alvo, também exigem reimportação ou incorporação em nova captura. Não preencher versões manualmente para contornar a proteção.

Recaptura divergente ou ausência de proposta editada exige escolha explícita; ambas as observações ficam congeladas na revisão. Descartar uma proposta ainda não publicada não remove outro fato. Resolver uma identidade corrigida mantém o ID e a primeira origem, rejeita ocupação por outro fato e preserva a verificação de versão. Métricas informadas manualmente, inclusive zero antes ausente, ganham disponibilidade e marca de origem manual, com auditoria.

## Rollback conservador

Pausar os cinco jobs por nomes exatos; preservar recibos, staging, revisões, fatos, primeira origem e auditoria. Reverter front/Edge apenas para versões compatíveis com o schema e os recibos existentes. Não executar DROP/TRUNCATE, desfazer decisões comerciais, reabrir processados ou voltar workers antigos que confirmavam antes de persistir. Migration corretiva deve manter dados e compatibilidade. Validar novamente preflight e retomada antes de reativar jobs.

## Evidência e limites

Ver [relatório de validação](TRAFEGO_VALIDACAO_2026-10-11.md). PostgreSQL local usa funções, constraints, RLS e triggers reais; Graph, transporte Realtime, cron, pg_net e Vault são controlados/sintéticos. Navegador usa aplicação React real com fronteira HTTP sintética e duas sessões isoladas. Isso não demonstra autorização atual da conta comercial nem entrega real do Realtime.

Após a regularização em 11/10, a descoberta real concluiu sua janela sem cursores pendentes ou erro; 148 recibos foram processados. O reteste da descoberta e a captura de métricas responderam HTTP 200 com `ok=true`. O job horário só foi ativado depois desse resultado. A captura permanece sujeita à revisão humana em Tráfego → Aprovações.

Comparação com Ads Manager, recebimento de um novo webhook externo e navegação autenticada em produção continuam sem prova nesta implantação. O teste público de `/trafego` chegou à autenticação, sem erros de console. A CI de sincronização de vendas passou na revisão publicada; a CI de segurança apresentou 18 vulnerabilidades já existentes (13 altas e 5 moderadas), sem alterações de dependências nesta entrega.

A regeneração dos tipos revelou `get_daily_call_ranking` ausente no snapshot real embora o front já o chamasse. Seu contrato legado foi preservado na camada aditiva; essa pendência de ranking, fora do Tráfego, precisa ser conferida separadamente. Nenhuma migração de ranking foi aplicada por esta entrega.
