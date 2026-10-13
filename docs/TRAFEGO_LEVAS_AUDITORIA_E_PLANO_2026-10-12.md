# Tráfego: auditoria e plano das levas de leads — 12/10/2026

## Situação deste documento

| Item | Estado |
| --- | --- |
| Fase 1: auditoria | Concluída, somente leitura. Nada foi alterado no código, no banco, nas funções Edge ou na configuração. |
| Decisões do usuário | Respondidas em 12/10 (seção 7). |
| Fase 2: implementação | Implementada e testada em 12/10 (seção 13). Publicação depende da migration rodada pelo usuário. |
| Base auditada | `main` no commit `8cebb5d`, Supabase `mbzwchnxtskysqplqiyy`. |
| Hora das consultas | 12/10/2026, entre 03h30 e 04h00 de Brasília. |
| Dados pessoais | Este documento não traz nome, telefone nem respostas de nenhum lead. |

Documentos anteriores que este complementa: [auditoria de 11/10](AUDITORIA_TRAFEGO_2026-10-11.md), [operação](TRAFEGO_CONFIABILIDADE_OPERACAO_2026-10-11.md), [validação](TRAFEGO_VALIDACAO_2026-10-11.md) e [retomada do token](TRAFEGO_RETOMADA_2026-10-12.md).

## 1. Pedido

- Levas de 20 leads no dashboard, sempre com as mais recentes primeiro.
- A leva mostra data e hora (do primeiro e do último lead). Ao clicar, aparecem os 20 leads, cada um com a própria data e hora.
- Status da leva: pendente, aprovada ou rejeitada.
- Aprovar envia os leads ao CRM do SDR e grava no campo próprio a data e hora em que o lead caiu, porque lead de formulário precisa de abordagem rápida.
- O envio não pode duplicar: aprovar duas vezes não cria nada novo. Falhas ficam visíveis e podem ser reenviadas.
- Campanhas de formulário e campanhas de Vendas que levam direto para o site. Gastos e métricas precisam ser exatos.
- Validar os números com dados reais e mostrar a evidência antes de considerar concluído.
- Fase 1 só leitura, com relatório por gravidade. Fase 2 só depois da aprovação.

## 2. O que foi feito na Fase 1

**Documentos lidos:** a auditoria, a operação, a validação e a retomada de 10 a 12/10.

**Código lido:**
- Tela: `src/pages/Trafego.tsx`, `src/components/traffic/MetaLeadApprovals.tsx`, `src/pages/Leads.tsx`, `src/hooks/useCRM.tsx`, `src/pages/CRM.tsx`, `src/components/crm/CRMLeadCard.tsx`, `src/lib/crm.ts`, `src/lib/meta-traffic-view.ts`, `src/components/traffic/MetaTrafficPerformance.tsx`.
- Funções Edge: `supabase/functions/_shared/meta-graph.ts` e `meta-lead-worker.ts`.
- As migrations de tráfego.

**Banco de produção (só consultas `SELECT`, pelo MCP do Supabase):**
- leads recebidos por dia e por campanha;
- métricas publicadas e revisões pendentes, com as ações brutas da Meta;
- execuções de captura, jobs do cron e recibos do webhook;
- estado da busca de leads;
- regras, gatilhos e restrições de `crm_leads` e `crm_lead_contexts`;
- definição das funções em uso: `meta_review_form_lead`, `meta_create_crm_lead_from_form`, `crm_guard_workflow`, `security_guard_crm_lead`, `crm_add_lead_context`, `meta_capture_prepare`, `meta_capture_review_decide`, `meta_import_leads`, `meta_lead_event_ingest` e `meta_traffic_lead_reconciliation`.

**Logs Edge:** a consulta não retornou linhas, então não serviu de evidência.

As consultas principais estão no [Apêndice A](#apêndice-a--consultas-usadas) e podem ser repetidas.

## 3. Resumo

1. **Nenhum lead de formulário chegou ao SDR.** 148 leads esperam aprovação, e o mais antigo foi gerado há cerca de 62 horas. Nenhum lead Meta está no CRM.
2. **Aprovar não envia ao CRM.** O formulário não pergunta e-mail nem nome do atleta, e o CRM exige os dois, além de nascimento e posição. Nenhum dos 148 passaria. Todos iriam para "Completar cadastro".
3. **277 leads nunca foram captados.** São leads gerados em 07/10, 08/10 e em 09/10 antes das 13h, que ficaram fora da janela inicial de 48 horas da busca automática.
4. **Desempenho mostra o dobro dos leads.** São 578 em vez de 316 (07 a 09/10), e o custo por lead aparece como R$ 0,41 em vez de R$ 0,79. Os números corretos já foram capturados, mas esperam aprovação manual. Os dias 10 e 11/10 não aparecem.
5. **As levas ainda não existem.** A aprovação é lead a lead, os mais antigos primeiro, 50 por tela.

## 4. Evidências

### 4.1 Leads informados pela Meta × leads recebidos

A Meta informa pela ação `lead` da captura de campanha. "Recebidos" são as linhas de `meta_form_leads`, contadas pela data de criação no fuso de Brasília.

| Dia | Meta informa | Recebidos | Diferença |
| --- | ---: | ---: | ---: |
| 07/10 | 113 | 0 | −113 |
| 08/10 | 123 | 0 | −123 |
| 09/10 | 80 | 39 (a partir das 13h00) | −41 |
| 10/10 | 83 | 83 | 0 |
| 11/10 | 26 | 26 | 0 |
| **Total** | **425** | **148** | **−277** |

Por campanha, Meta × recebidos, em 10/10 e 11/10:

| Campanha | 10/10 | 11/10 |
| --- | --- | --- |
| FORMULARIO ZYRON TST 01 (`…7947590088`) | 19 / 19 | 7 / 7 |
| FORMULARIO ZYRON TST 03 (`…8226450088`) | 43 / 43 | 10 / 10 |
| FORMULARIO ZYRON TST 04 (`…8254150088`) | 21 / 21 | 9 / 9 |
| FORMULARIO ZYRON TST 02 (`…8128660088`) | 0 / 0 (gasto zero) | — |

Desde a janela inicial, a captura não perde leads. Toda a diferença é anterior a 09/10 às 13h00. A campanha TST 02 teve 13 leads em 07/10 e 5 em 08/10, e nenhum deles foi recebido.

Os 148 recebidos foram criados entre 09/10 13h00 e 11/10 10h43. Todos entraram em 11/10, entre 14h13 e 14h16, pela busca automática. Hoje estão como `pendente`, `novo`, de origem API, sem vínculo com o CRM e sem aviso de importação.

### 4.2 Desempenho publicado × captura atual da Meta

| Dia | Gasto publicado | Gasto na captura atual | Leads publicados | Leads na captura atual |
| --- | ---: | ---: | ---: | ---: |
| 07/10 | R$ 117,65 | R$ 117,65 | 226 | 113 |
| 08/10 | R$ 92,95 | R$ 92,97 | 246 | 123 |
| 09/10 | R$ 26,53 (dia parcial, até 16h) | R$ 39,45 | 106 | 80 |
| 10/10 | não publicado | R$ 46,82 | — | 83 |
| 11/10 | não publicado | R$ 15,09 | — | 26 |

- **Publicado hoje:** R$ 237,13 e 578 leads, ou seja, custo por lead de R$ 0,41. Os três níveis (campanha, conjunto e anúncio) têm os mesmos totais.
- **Captura atual, 07 a 11/10:** R$ 311,98 e 425 leads, custo por lead de **R$ 0,73**. Só de 07 a 09/10: R$ 250,07 e 316 leads, custo por lead de R$ 0,79.
- **Por que dobrou:** na resposta bruta da Meta, `lead` e `onsite_conversion.lead_grouped` trazem sempre o mesmo número (por exemplo, TST 01 em 07/10: 33 e 33). O código antigo somava os dois. O atual escolhe uma única ação (`definition_version = canonical-v1`, `lead_action = lead`; ver `selectCanonicalAction` em `supabase/functions/_shared/meta-graph.ts`).
- **Por que a correção não aparece:** os dados corretos estão em três revisões `pendente`, uma por nível, cada uma com 18 linhas de 07 a 11/10 e só operações `upsert`.
- **Revisão trocada a cada 30 minutos:** cada captura troca a revisão pendente (a anterior vira `substituido`). Quem demora mais de 30 minutos para aprovar tem a aprovação recusada por versão.
- **A tela avisa sem corrigir:** ela mostra "Histórico legado: valores registrados preservados; disponibilidade e taxas não comprovadas", mas o número exibido continua em dobro.
- **Diferença de R$ 0,02 em 08/10:** é ajuste tardio da Meta. A recaptura diária de 8 dias cobre isso.
- **Conta de anúncios:** a API confirma `1615235116333866` ("CA 2 - MILHAO"), moeda BRL, fuso `America/Sao_Paulo`.

### 4.3 Os 148 leads diante das exigências do CRM

| Exigência atual do envio ao CRM | Leads que atendem |
| --- | ---: |
| Nome (2 caracteres ou mais) | 148 |
| WhatsApp com 8 caracteres ou mais | 146 |
| E-mail válido | 0 (o formulário não pergunta) |
| Nome do atleta | 0 (não há campo; 136 responderam "sou o atleta" e 12 "sou pai/mãe ou responsável") |
| Nascimento do atleta | 0 aproveitados (os 148 responderam `date_of_birth`, que não está entre os nomes reconhecidos por `meta_contact_from_form`) |
| Posição válida no CRM | 0 (a pergunta mistura posição e categoria em texto livre, por exemplo "atacante, sub-17") |

- **Formulário:** é um só, "FORMULÁRIO ZYRON" (`1839299797481185`). Pergunta nome, telefone, nascimento, estado e nove perguntas abertas sobre o atleta.
- **Campo `state`:** é texto livre e veio com muitas respostas que não são UF (datas, nomes, palavras soltas).
- **Duplicidade:** nenhum telefone se repete entre os 148, e nenhum já existe no CRM (comparando os últimos 9 dígitos).

### 4.4 Estado operacional

- **Jobs do cron:** os cinco estão ativos e terminaram com `succeeded` na última execução:
  - `meta-insights-sync-frequent` (a cada 30 min);
  - `meta-insights-sync-deep` (diário);
  - `meta-insights-resume` (a cada minuto);
  - `meta-lead-worker` (a cada minuto);
  - `meta-leads-reconciliation-hourly` (minuto 15 de cada hora).
- **Capturas de métricas:** nas últimas 30 horas houve 34 execuções completas por nível, todas `success` com cobertura `complete`.
- **Busca de leads:** falhou 11 vezes seguidas, de 11/10 16h15 a 12/10 02h15, com token de Página expirado. Ninguém foi avisado. Voltou às 03h15, depois da correção registrada na retomada. Não houve perda: não foi gerado lead depois de 11/10 10h43.
- **Webhook em tempo real:** só recebeu o evento de teste do painel da Meta (09/10 12h55, página `0`, formulário `444444444444`, ignorado). Nunca chegou um lead real por ele. Ainda não está provado que a Página está assinada para `leadgen`.
- **Campanhas:** o último lead é de 11/10 10h43, e o gasto do dia foi R$ 15,09. O usuário pediu para não investigar 11/10.

## 5. Achados por gravidade

### Crítico

**C1. Leads sem ninguém para atendê-los**
- Os 148 estão em `meta_form_leads` como `approval_status = pendente` desde 11/10 às 14h13.
- Nenhum lead Meta foi criado em `crm_leads`. Os 13 leads criados no CRM desde 06/10 têm `lead_source` nulo, ou seja, foram cadastrados à mão.

**C2. Aprovar não envia ao CRM**
- `meta_review_form_lead` chama `meta_create_crm_lead_from_form`, que exige e-mail, nome do atleta, nascimento e posição.
- Os gatilhos `zz_meta_crm_approval_guard` e `crm_guard_workflow` repetem a exigência (o segundo pede o nome do atleta em todo `INSERT`).
- Quando falta algo, o erro é capturado e vira `import_warning`, e o lead vai para "Completar cadastro" em `/leads`.
- Com o formulário atual, 0 de 148 passariam.

**C3. 277 leads nunca captados**
- Na primeira execução, a busca começa 48 horas antes (`meta_lead_discovery_claim`, `window_since = agora − 48h`).
- Ficaram de fora os leads de 07/10, 08/10 e de 09/10 antes das 13h. A Meta guarda leads por 90 dias, então dá para recuperar.

**C4. Métricas erradas e atrasadas**
- Os leads publicados estão em dobro e 10–11/10 não estão publicados (seção 4.2).
- As decisões de investimento estão sendo tomadas com o custo por lead pela metade.

### Alto

**A1. Não há levas**
- A aprovação é lead a lead, ordenada por `received_at` do mais antigo, com `limit(50)` ([MetaLeadApprovals.tsx:30](../src/components/traffic/MetaLeadApprovals.tsx#L30)).

**A2. O SDR não vê quando o lead caiu**
- `crm_leads.lead_generated_at` existe, é obrigatório e já é gravado com `meta_form_leads.created_time`.
- Nenhuma tela usa esse campo: `grep` em `src` só encontra os arquivos de tipos.
- O CRM ordena por `created_at`, a hora de inserção ([useCRM.tsx:152](../src/hooks/useCRM.tsx#L152)).

**A3. Sem idempotência visível e sem nova tentativa**
- Aprovar de novo gera o erro "Lead já revisado". Não duplica, porque `crm_leads.meta_form_lead_id` é único, mas também não devolve o resultado.
- Falha de envio vira só um texto em `/leads`. Em Tráfego não há status de envio por lead nem botão para reenviar.

**A4. Chegada lenta e sem alerta**
- O tempo real nunca foi provado (seção 4.4). Hoje o lead depende da busca de hora em hora, o que dá até cerca de 1 hora de atraso.
- A falha de 10 horas em 11/10 não gerou nenhum aviso na tela.

### Médio

**M1. Campanhas de Vendas para o site**
- Não se capturam visualizações da página de destino, adições ao carrinho nem finalizações de compra iniciadas.
- A tabela de Desempenho não mostra ROAS nem valor de compras. Os cartões já têm compras, custo por compra e ROAS.
- A captura não pede a atribuição por conjunto (`use_unified_attribution_setting`). Os parâmetros atuais são só `level`, `limit`, `fields`, `time_range` e `time_increment` ([meta-insights-capture.ts:50](../supabase/functions/_shared/meta-insights-capture.ts#L50)). Para compras no site, isso pode divergir do Gerenciador.

**M2. Métricas aprovadas em três níveis separados**
- Campanha, conjunto e anúncio são aprovados separadamente, e a revisão é substituída a cada 30 minutos (seção 4.2).

**M3. Campo `state` sem valor de UF**
- Não serve como UF.

**M4. Hora da tela de aprovação no fuso do navegador**
- `toLocaleString('pt-BR')` sem `timeZone` usa o fuso de quem abre a tela, e não o de Brasília.

### Já existe e pode ser reaproveitado
- `meta_traffic_lead_reconciliation(date,date)` conta leads recebidos por campanha, mas nenhuma tela usa.
- `private.crm_lead_registered_as_approach` já ignora `lead_source = 'meta_ads_form'`. Aprovar leads Meta não cria abordagens no ranking.
- O cartão do CRM já trata nome do atleta vazio e mostra cadastro incompleto ([CRMLeadCard.tsx:166](../src/components/crm/CRMLeadCard.tsx#L166)).

## 6. O que foi verificado e funciona

- Captura de métricas a cada 30 minutos, completa, com a ação canônica e as ações brutas guardadas em `metric_metadata.raw_actions`.
- Leads de 10 e 11/10: 100% conferem com a Meta, campanha por campanha.
- Recibos deduplicados: os 148 foram processados, nenhum com erro.
- Conta, moeda e fuso confirmados pela API.
- Busca de leads funcionando de novo desde 12/10 03h15.

## 7. Decisões do usuário (12/10)

| Pergunta | Resposta |
| --- | --- |
| Com o que o lead do formulário entra no CRM? | Nome, WhatsApp e contexto (as respostas escritas). O resto o SDR completa. |
| Métricas da API publicadas automaticamente? | Sim. |
| A leva aberta, com menos de 20, pode ser aprovada a qualquer momento? | Sim. |
| Dá para tirar um lead ruim da leva e aprovar os outros? | Sim, com motivo. |
| Buscar os 277 leads antigos? | Sim. |
| O que é "tráfego direto para a página"? | Campanhas com objetivo Vendas que levam direto ao site, diferentes de formulário. Para elas, só as métricas. O contexto vem pelo CRM. |
| Investigar a pausa de 11/10? | Não. |

A decisão de publicar automaticamente as métricas da API substitui, só para capturas da API sem conflito, a regra de 09/10 de aprovar todo recebimento. Planilhas e correções continuam com aprovação manual.

## 8. Plano de implementação (Fase 2)

### Etapa 1 — Métricas corretas e em dia

**Na tela**
- As capturas da API são publicadas sozinhas, a cada 30 minutos.
- Uma captura só fica pendente quando conflita com uma correção manual, e o motivo aparece em Aprovações.
- A primeira publicação substitui os números em dobro de 07 a 09/10 e inclui 10 e 11/10.
- Campanhas de Vendas ganham visualizações da página de destino, adições ao carrinho e finalizações de compra iniciadas, com custo por visualização e taxa de visualização para compra.
- A tabela ganha as colunas ROAS e valor das compras.
- Novo painel de conferência por dia e campanha: Meta informa × recebidos × no CRM.

**Mudanças técnicas**
- **Publicação automática:**
  - Extrair a aplicação da revisão de `meta_capture_review_decide` para uma função interna com ator explícito.
  - Criar `meta_capture_publish_system(p_review uuid)`, só para `service_role`, que publica quando não há `conflict_details` e registra `capture.auto_approved` na auditoria.
  - `meta_capture_review_decide` continua para a decisão humana.
  - `supabase/functions/meta-insights-sync` chama a publicação automática depois de `meta_capture_prepare`.
- **Novas colunas em `meta_traffic_daily`:** `landing_page_views`, `adds_to_cart` e `checkouts_initiated`. Junto com elas:
  - `available_metrics`, `meta_validate_traffic_row` e `meta_upsert_traffic_row`;
  - o payload da revisão e `shared/meta-contract.ts`;
  - os tipos regenerados.
- **Ações canônicas** em `supabase/functions/_shared/meta-graph.ts` e `meta-insights.ts`, uma só por métrica, nunca somadas:
  - visualização da página: `landing_page_view`, `omni_landing_page_view`;
  - carrinho: `add_to_cart`, `omni_add_to_cart`, `offsite_conversion.fb_pixel_add_to_cart`;
  - finalização de compra: `initiate_checkout`, `omni_initiated_checkout`, `offsite_conversion.fb_pixel_initiate_checkout`.
  - Conferir os nomes nas `raw_actions` reais no primeiro dia de campanha de Vendas.
- **Atribuição:** passar `use_unified_attribution_setting=true` na captura e subir `definition_version` para `canonical-v2`. A tela bloqueia taxas quando o período mistura definições, por isso será feita uma recaptura única de 05/10 até hoje.
- **Tela:** cartões do objetivo Vendas, colunas da tabela e exportação CSV em `src/components/traffic/MetaTrafficPerformance.tsx` e `src/lib/meta-traffic-view.ts`. O mapeamento de planilha das novas colunas é opcional, em `src/lib/meta-traffic.ts`.
- **Painel de conferência:** estender `meta_traffic_lead_reconciliation` com o dia e o total enviado ao CRM, e exibir em Desempenho.

### Etapa 2 — Levas de 20

**Na tela**
- Cada lead novo entra na leva aberta. Quando ela completa 20, fecha e abre a próxima.
- A lista mostra primeiro as levas com leads mais recentes. Cada leva tem número, status (pendente, aprovada ou rejeitada), quantidade, data e hora do primeiro e do último lead e o resumo do envio (enviados, com falha, aguardando).
- Ao abrir a leva, os leads aparecem do mais recente ao mais antigo. Cada um mostra "caiu em 12/10 14:32 · há 8 min" no horário de Brasília, o WhatsApp e as respostas.
- **Aprovar:** a leva aberta pode ser aprovada a qualquer momento. São aprovados exatamente os leads que estavam na tela; quem chegar enquanto a leva é conferida vai para a próxima.
- **Tirar e rejeitar:** um lead pode ser tirado da leva com motivo (fica rejeitado, e os demais são aprovados). Rejeitar a leva inteira exige motivo.
- **Leads antigos:** buscar os 277 de 07 a 09/10 e reorganizar em ordem cronológica as levas que ninguém revisou. O resultado esperado é 425 leads em 22 levas: 21 de 20 e a mais recente com 5.
- A tela atual de aprovação lead a lead é substituída pelas levas.

**Mudanças técnicas**
- **Tabela nova `meta_lead_waves`:**
  - campos: `id`, `number` (sequencial), `status` (`pendente` | `aprovada` | `rejeitada`), `is_open`, `lead_count` (até 20), `first_lead_at`, `last_lead_at`, `created_at`, `closed_at`, `reviewed_by`, `reviewed_at`, `review_note`, `version`, `updated_at`;
  - índice único parcial garantindo uma única leva aberta;
  - RLS de leitura por `traffic_has_access()`, sinais por `meta_changed_signal` e auditoria (`entity_type = 'lead_wave'`).
- **Colunas novas em `meta_form_leads`:** `wave_id`, `crm_sync_status` (`aguardando` | `enviado` | `falhou`), `crm_sync_error`, `crm_sync_attempts` e `crm_sync_last_at`.
- **Distribuição automática:** um gatilho `AFTER INSERT` em `meta_form_leads` põe cada lead pendente na leva aberta, com trava consultiva para que dois recebimentos simultâneos não estourem 20.
- **Funções:**
  - `meta_wave_list(p_limit, p_offset)` e `meta_wave_leads(p_wave)`, de leitura;
  - `meta_wave_decide(p_wave, p_action, p_lead_ids, p_excluded, p_note)`;
  - `meta_wave_retry(p_wave)`;
  - `meta_wave_rebuild_pending()`, só para o serviço e de uso único depois da busca dos antigos.
- **Busca dos antigos:** função só para o serviço que recua `last_completed_until` da Página para 07/10 00h00 de Brasília (com a Página livre, sem lease). A próxima busca percorre de 07/10 até agora, e os recibos repetidos são descartados por `meta_lead_id`.
- **Tela:** novo componente de levas em `src/components/traffic/`, substituindo `MetaLeadApprovals`, com consulta paginada só dos metadados e detalhe carregado ao abrir a leva.

### Etapa 3 — Envio ao CRM do SDR

**Na tela e no CRM**
- Ao aprovar, cada lead entra no CRM com nome, WhatsApp e um registro de contexto "Respostas do formulário" com todas as respostas escritas e quem preencheu.
- E-mail, atleta, nascimento e posição ficam vazios para o SDR completar.
- O campo "caiu em" (`lead_generated_at`) recebe a hora exata do formulário.
- O lead entra sem SDR definido, na fila compartilhada, como hoje, e não conta como abordagem.
- Aprovar de novo devolve o mesmo resultado, sem erro e sem duplicar.
- Cada lead mostra aguardando, enviado ou falhou (com o motivo). "Tentar de novo" reenvia só os que falharam.
- Os dois leads com WhatsApp curto vão aparecer como falha para correção (pela edição de lead já existente) e reenvio.

**Mudanças técnicas**
- **Função interna `meta_sync_form_lead_to_crm(p_lead uuid, p_actor uuid)`:**
  - executada em bloco com `EXCEPTION` por lead, para que uma falha não derrube a leva;
  - insere em `crm_leads` com `ON CONFLICT (meta_form_lead_id) DO NOTHING`; se o lead já existe, reaproveita o id;
  - preenche `name`, `phone`, `lead_source = 'meta_ads_form'`, `sdr_id = NULL`, `meta_form_lead_id`, `lead_generated_at = created_time` e um resumo curto em `observations`;
  - grava o contexto uma única vez por lead.
- **Mudanças em `crm_lead_contexts`:**
  - aceitar `context_type = 'meta_form'` e `author_role = 'trafego'`;
  - criar um índice único para um contexto de formulário por lead;
  - o contexto de formulário fica só leitura na tela.
- **Gatilhos do CRM:**
  - `crm_guard_workflow`: dispensa o nome do atleta no `INSERT` quando `meta_form_lead_id` não é nulo;
  - `meta_crm_approval_guard`: para leads Meta, exige só nome com 2 caracteres ou mais e WhatsApp com 8 dígitos ou mais;
  - as edições feitas pelo SDR continuam exigindo os campos de hoje (`validateContact`).
- **Quem executa o envio:** `security_guard_crm_lead` exige `auth.uid()`, por isso o envio roda com a conta de quem aprova e a nova tentativa é feita por uma pessoa (não há nova tentativa automática pelo cron).
- **Funções antigas:** `meta_review_form_lead` e o caminho de planilha (`meta_ingest_lead_import_row`) passam a usar a mesma função interna.
- **Tela do CRM:** rótulo "Respostas do formulário" em `src/components/crm/CRMContextPanel.tsx`.

### Etapa 4 — CRM mostra quando o lead caiu

- O cartão (`CRMLeadCard.tsx`) e a ficha (`CRMLeadDetail.tsx`) mostram "Caiu em 12/10 às 14:32 · há 8 min" para leads `meta_ads_form`, no horário de Brasília.
- A cor indica a urgência: verde até 15 minutos, amarelo até 1 hora e vermelho depois disso. O tempo se atualiza a cada minuto.
- A aba Importados de `src/pages/CRM.tsx` ordena por `lead_generated_at`, do mais recente para o mais antigo.

### Etapa 5 — Lead chegando rápido

- **Busca de reserva:** o job `meta-leads-reconciliation-hourly` passa a rodar a cada 5 minutos (`*/5 * * * *`). O nome fica igual para não quebrar o preflight e o runbook; isso será documentado.
- **Tempo real:** durante a busca, consultar `/{page_id}/subscribed_apps` com o token da Página e guardar se o campo `leadgen` está assinado (coluna nova no estado da busca). A aba Conexão mostra o resultado.
- **Alerta:** banner no topo de Tráfego quando a última captura de métricas ou de leads com erro for mais nova que o último sucesso há mais de 60 minutos. A informação sai de `meta_traffic_operation()`.
- **Contador:** quantidade de leads aguardando aprovação na aba Aprovações e no menu lateral, para Gestor de Tráfego, Executive e Super Admin.

## 9. Testes e validação com dados reais

Só se considera concluído depois de mostrar estas evidências:

1. **Leads:** Meta = recebidos, por dia e por campanha, de 07 a 11/10. O esperado é 113, 123, 80, 83 e 26 (425 no total).
2. **Levas:** 425 leads em 22 levas, nenhum repetido e nenhum fora de leva, e nenhuma leva com mais de 20. A ordem (mais recentes primeiro) e os horários do primeiro e do último lead são conferidos por SQL.
3. **Envio ao CRM:** teste no banco real dentro de `BEGIN … ROLLBACK`, com leads sintéticos:
   - aprovar duas vezes gera um lead só no CRM e devolve o mesmo resumo;
   - WhatsApp inválido vira `falhou` com o motivo;
   - corrigido e reenviado, vira `enviado`;
   - `lead_generated_at` é igual a `created_time` ao segundo;
   - o contexto é criado uma única vez;
   - nenhuma abordagem é criada.
4. **Métricas:** os valores publicados são iguais à captura da Meta, centavo a centavo e lead a lead (07/10: R$ 117,65 e 113 leads, e assim por diante). A comparação com a exportação do Gerenciador usa a mesma conta, período, nível e fuso.
5. **Tela em produção, pelo Chrome com o login do usuário:** lista de levas, abrir uma leva, horários, CRM com "caiu em" e o alerta. Uma leva real só é aprovada com OK explícito do usuário.
6. **Tempo de chegada:** um lead de teste da ferramenta da Meta aparece em até 5 minutos, e em segundos se a assinatura em tempo real estiver ativa.
7. **Testes automáticos:**
   - os existentes continuam passando: 75 regressões Node de tráfego, 8 Deno, verificações SQL, `tsc --noEmit`, ESLint dos arquivos alterados e build de produção;
   - testes novos: `scripts/verify-meta-lead-waves-db.sql` (distribuição, decisão, duplicidade, falha e nova tentativa, permissões), regressões Node do envio e das métricas de Vendas, e o teste de tela das levas.

## 10. Ordem de publicação

1. Código, migration e testes prontos e commitados, um commit por etapa.
2. O usuário roda a migration no SQL Editor do Supabase. A trava de produção do Claude Code bloqueia esse passo para o assistente. Depois, a migration é registrada em `supabase_migrations.schema_migrations` com o texto completo. A versão será escolhida depois de listar a pasta e o histórico remoto.
3. Publicação das funções `meta-insights-sync`, `meta-lead-worker` e `meta-leads-reconciliation`.
4. `git push` para a `main`, que publica o site na Vercel. O push vem só depois do banco, para a tela nova não quebrar com o esquema antigo.
5. Operação de dados: busca dos 277, reorganização das levas, recaptura das métricas e publicação automática.
6. Validação da seção 9 e relatório com as evidências.

**Rollback:** pausar a publicação automática e os jobs pelos nomes exatos. Não apagar levas, recibos, decisões nem leads do CRM. Voltar a tela e as funções para versões compatíveis com o esquema.

## 11. O que depende do usuário

- Rodar a migration no SQL Editor.
- Exportar do Gerenciador de Anúncios: por campanha e por dia, de 07 a 11/10, com gasto, leads e compras.
- Gerar um lead de teste na ferramenta de teste de anúncios de cadastro da Meta. O passo a passo será enviado.
- Dar o OK para aprovar uma leva real durante a validação.
- Confirmar que o site envia o evento de compra (`Purchase`) pelo pixel ou pela API de Conversões. Isso será conferido nas `raw_actions` do primeiro dia de campanha de Vendas.

## 12. Fora do escopo e riscos

- **Fora do escopo:**
  - investigar 11/10, por pedido do usuário;
  - captura individual de compras do site (o contexto vem pelo CRM);
  - a pendência antiga de `get_daily_call_ranking`, registrada na validação de 11/10.
- **Riscos:**
  - **Envio por quem aprova:** os leads entram no CRM com `created_by` = quem aprovou, o que é exigido pelo gatilho de segurança. O ranking não é afetado, porque leads Meta não contam como abordagem.
  - **Atribuição nova:** pode mudar compras e leads das campanhas em relação à captura atual. A comparação com o Gerenciador decide.
  - **Ações do site:** o nome das ações de página e de compra precisa ser conferido com a conta real.
  - **Webhook:** se a assinatura em tempo real não estiver ativa, ativá-la depende de permissão da Meta. Enquanto isso, a busca de 5 minutos garante a chegada.

## 13. Implementação (12/10)

Decisões aplicadas: as da seção 7 e o pedido de 12/10 à tarde: **nenhum lead pode se perder**, a **importação manual tem a mesma eficiência** dos formulários (mesmas levas, mesmo envio ao CRM) e a **leva mais recente vem primeiro**, com **data e horário exatos** de cada lead.

### O que mudou

| Área | Comportamento |
| --- | --- |
| Levas | Todo lead pendente (formulário da Meta ou planilha) entra numa leva de até 20, na ordem da data e hora em que caiu. A lista mostra a leva mais recente primeiro e a abre sozinha; dentro dela o lead mais novo fica no topo, com hora em segundos (horário de Brasília) e "há X min" colorido pela urgência. |
| Decisão | Aprovar em dois passos ("Aprovar leva" → "Confirmar envio de N leads ao CRM"). Tirar um lead da leva exige motivo. Lead que chega com a tela aberta vai para a próxima leva. Leva alterada no meio da decisão é recarregada (40001) sem decidir nada. Repetir a decisão devolve o mesmo resultado. |
| Nenhum lead perdido | Rejeitado não é apagado: lead ou leva rejeitados podem ser **reabertos** e voltam como pendentes na posição do horário. A reorganização nunca deixa lead pendente sem leva (a transação é desfeita). Planilha com data inválida entra com o horário do recebimento e aviso, em vez de ser recusada. |
| Envio ao CRM | Nome, WhatsApp, contexto "Respostas do formulário" (somente leitura) e `lead_generated_at` = hora do formulário. Sem SDR (fila compartilhada), sem contar abordagem. Falha fica no lead com o motivo; "Tentar de novo" reenvia só as falhas. Vínculo único impede duplicar. |
| Importação manual | Cada linha vira lead pendente nas mesmas levas (não vai direto ao CRM). Envio em blocos de 200 linhas; reenviar o arquivo não duplica (linhas já recebidas voltam como "já recebido", com a leva onde estão). Planilha só com data marca "horário aproximado". O arquivo inteiro fica guardado no lote. |
| CRM do SDR | Selo "Caiu em 11/10 às 10:43 · há 8 min" no cartão e na ficha (cor de urgência enquanto não abordado); aba Importados ordenada pela hora do formulário. |
| Métricas | Captura completa e sem conflito publicada automaticamente (`meta_capture_publish_system`); conflito com correção manual ou remoção em massa espera revisão. Atribuição do conjunto (`use_unified_attribution_setting`). Funil de Vendas: visualizações da página de destino, carrinho, finalização, custo por visualização e taxa página → compra. Recaptura de 8 dias a cada 30 min. |
| Conferência | Em Desempenho: por dia e campanha, Meta informa × recebidos × no CRM, com "faltam N" em destaque. |
| Chegada rápida | Busca de reserva a cada 5 min; a aba Conexão mostra se a Página está assinada para leads em tempo real; alerta no topo quando a captura falha por mais de 1 hora; contador de leads aguardando na aba e no menu lateral. |
| Leads antigos | A migration recua a busca para 07/10 00:00; os 277 que faltam entram nas levas e, ao fim da busca, as levas pendentes voltam à ordem cronológica. |

Arquivos principais: `supabase/migrations/20261012150000_meta_lead_waves_crm_sync_auto_publish.sql`, `src/components/traffic/MetaLeadWaves.tsx`, `src/components/traffic/MetaLeadConference.tsx`, `src/components/crm/CRMLeadArrival.tsx`, `src/lib/meta-waves.ts`, `supabase/functions/meta-insights-sync/index.ts`, `supabase/functions/_shared/meta-insights.ts`, `supabase/functions/_shared/meta-lead-worker.ts`.

### Testes executados

| Verificação | Resultado |
| --- | --- |
| SQL em PostgreSQL local com o esquema de produção (funções conferidas por hash), em transação desfeita | 14 arquivos, todos passam, incluindo `verify-meta-lead-waves-db.sql` e `verify-meta-lead-import-db.sql` |
| Concorrência com conexões reais (`verify-meta-lead-waves-concurrency.mjs`) | Fronteira 19/20 nunca gera 21; lead que chega durante a decisão vai para a próxima leva |
| Node (Edge, regras, tela) | 98/98 |
| Navegador real com o front React (`verify-meta-lead-waves-browser.mjs`, `verify-meta-review-browser.mjs`) | Passam |
| Tipos, lint, Deno, build | `tsc`, ESLint dos arquivos alterados, `deno check` das 4 funções, 8 testes Deno e `vite build` sem erro |

Testes de interface do CRM que já falhavam antes desta mudança (conferido num worktree do commit anterior): `verify-crm-importados-ui`, `verify-crm-edit-call-ui`, `verify-context-daily-ui`, `verify-closer-candidates-ui`.

### Publicação

1. O usuário roda a migration inteira no SQL Editor do Supabase (atômica; termina com a conferência das levas).
2. Publicar `meta-insights-sync`, `meta-lead-worker` e `meta-leads-reconciliation`.
3. `git push` da `main` (Vercel).
4. Conferir: levas formadas (esperado hoje: 7 de 20 + 1 de 8), busca dos leads de 07/10 a 09/10, captura publicada automaticamente e números de 07/10 a 11/10 iguais aos da Meta (113, 123, 80, 83, 26 leads).

### Trabalho paralelo

Em 12/10 de manhã outra sessão escreveu `docs/superpowers/specs/2026-10-12-traffic-lead-waves-design.md` e o plano correspondente (worktree `.worktrees/traffic-lead-waves`). As diferenças principais: lá a planilha mantém aprovação por lote, métricas não são publicadas automaticamente e levas nunca são reorganizadas. Esta implementação segue as respostas dadas ao usuário nesta conversa (seção 7) e o pedido posterior de importação com a mesma eficiência. As duas não devem ser publicadas juntas.

## 14. Revisão para publicação (12/10, à tarde)

A migration original já havia sido executada pelo usuário. Seu texto foi registrado no histórico remoto como `20261012150000`, sem executar novamente o SQL. As 29 funções conferidas (a listagem foi corrigida separadamente) têm a mesma impressão digital em UTF-8 no ensaio local e em produção: `fa385139b05d178273165239cd051afd`.

A revisão encontrou um caso em que um backfill ganhava número maior que uma leva já decidida e aparecia acima dela, apesar de seus leads serem antigos. `20261012173955_meta_lead_wave_chronological_listing.sql` corrige a listagem e a paginação pela data do último lead, usando o número apenas como desempate. O teste de regressão falhou antes da correção e passou depois. A migration original permanece intacta.

O risco de retomar uma captura antiga com atribuição diferente foi conferido: não havia captura de métricas `running` ou `partial` antes da publicação. A descoberta desde 07/10 concluiu e seus recibos foram drenados: 426 leads, 22 levas, nenhum lead pendente sem leva e ordem cronológica consistente. Nenhuma leva real foi aprovada nesta revisão.

Validação repetida: 100 testes Node, 8 Deno, 2 de concorrência em PostgreSQL e os 2 testes de navegador passaram; os 12 arquivos SQL de regressão passaram em banco descartável atualizado. Tipos, ESLint dos arquivos alterados, build e varredura de segredos passaram. Os testes adicionais de caixa de entrada e sugestões também passaram. A consulta de preflight do banco local conserva histórico incompleto, pois o ensaio aplica SQL diretamente; isso não foi usado como prova de prontidão da produção.

O check de segurança do GitHub já falhava no commit base por dependências de ferramentas de desenvolvimento (13 avisos altos e 5 moderados). Esta entrega não altera dependências nem desativa esse check.

## 15. Validação em produção (12/10, 19:20)

Todas as consultas foram somente leitura (`npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy`), sem nomes, telefones nem e-mails na saída.

**A publicação foi concluída em 12/10 às 14:41 (Brasília) por outra sessão, depois do limite de uso desta.** Estado conferido: commit `640450f` na `main` e em `origin/main`, árvore limpa; as três funções Edge (`meta-insights-sync`, `meta-lead-worker`, `meta-leads-reconciliation`) com o mesmo `updated_at` de 14:41:18; deploy de produção da Vercel criado às 14:41:55; migrations `20261012150000` e `20261012173955` registradas em `schema_migrations`. O site publicado carrega o código novo: o chunk `Trafego-*.js` contém `meta_wave_list`, `meta_traffic_conference`, "Lead mais recente aguardando", "Abrir leva", "Confirmar envio", "Tentar de novo" e "Horário aproximado".

| Verificação | Resultado |
| --- | --- |
| Levas | 22, todas pendentes: 21 com 20 leads e a aberta (nº 22) com 6; nenhuma leva decidida |
| Leads | 426 pendentes; 0 sem leva; 0 aprovados; 0 no CRM; 0 com falha de envio |
| Ordem | levas 1 a 22 em ordem cronológica estrita, sem sobreposição (leva 1: 07/10 03:57:40 a 06:36:19; leva 22: 11/10 09:25:35 a 10:43:52) |
| Listagem | `meta_wave_list` já com a ordenação da migration `20261012173955` |
| Busca de leads | `last_completed_until` = 12/10 19:15, sem erro; jobs `meta-lead-worker` (1 min) e `meta-leads-reconciliation-hourly` (5 min) com todas as rodadas `succeeded`; 426 recibos de webhook `processed`, nenhum lead sem recibo |
| Leads por dia (Brasília) | 07/10: 114 · 08/10: 123 · 09/10: 80 · 10/10: 83 · 11/10: 26 |
| Leads informados pela Meta | 113 · 123 · 80 · 83 · 26 |
| Gasto publicado | R$ 117,65 · 92,97 · 39,45 · 46,82 · 15,09 (total R$ 311,98), idêntico à captura da Meta |
| Métricas por nível | campanha, conjunto e anúncio com gasto, leads, impressões e cliques idênticos em todos os dias; sem chaves duplicadas, sem linha editada à mão, sem linha sem captura |
| Publicação automática | capturas de 18:00, 18:30 e 19:00 aprovadas sozinhas ("captura completa da API, sem conflitos") |
| Funil de Vendas | zero em todas as linhas: não há campanha de Vendas ativa; não foi validado com dados reais |

**Conferência de 07 a 11/10.** O total recebido (426) menos 1 lead de teste da Meta dá 425, igual ao total informado pela Meta (425). Por campanha e dia restam duas diferenças de 1 lead: 07/10, campanha TST 04 (painel 23, Meta 22), e 09/10, campanha TST 03 (painel 37, Meta 38). As duas aparecem na tela de conferência. Todos os leads vêm de um único formulário ("FORMULÁRIO ZYRON"), então nenhum formulário ficou sem cobertura. A causa provável é a atribuição da Meta, mas isso não foi provado.

**O que o usuário precisa saber antes de aprovar**

1. O lead de teste da Meta (09/10 12:51:01, sem campanha nem anúncio, nome e telefone "dummy") está na leva 14. Deve ser tirado da leva com o motivo "lead de teste". O telefone dele tem 40 caracteres, então o CRM o recusaria de qualquer forma.
2. Oito leads reais têm contato que o CRM recusa: 3 com nome de menos de 2 caracteres e 5 com WhatsApp fora de 8 a 32 caracteres (levas 1, 2, 3 com dois, 12, 13, 16 e 19). Ao aprovar, cada um fica como "falhou" com o motivo na tela; corrija em Editar e use "Tentar de novo". Os outros leads da leva são enviados normalmente.
3. O estado do webhook continua "não verificado": a consulta `subscribed_apps` não gravou resultado (a Meta provavelmente nega a leitura com o token atual, e o código foi feito para seguir sem a informação). Conferir no painel de desenvolvedores da Meta se o app está assinado no campo `leadgen` da Página. Sem webhook, a busca de 5 em 5 minutos ainda traz o lead em até cerca de 5 minutos. O recibo `ignored` de 09/10 12:55:47 (`page_id` "0", `form_id` "444444444444") é o evento do botão de teste do painel de webhooks da Meta, não um lead.
4. A velocidade de chegada ao vivo ainda não foi medida: os 148 leads anteriores chegaram em 11/10 por busca retroativa (mediana de 24 horas) e os 278 de 12/10 também (277 reais mais o lead de teste). O último lead é de 11/10 10:43:52 e não houve gasto em 12/10 até 13:30. O primeiro lead novo (ou um lead criado na ferramenta de teste de leads da Meta) mostra o tempo real: deve aparecer na leva aberta em segundos pelo webhook ou em até cerca de 6 minutos pela busca.
5. Não foi validado em produção: o envio ao CRM e o campo "Caiu em" (exige aprovar uma leva real, o que depende do OK do usuário) e a tela autenticada com dados reais (a sessão do navegador embutido estava na tela de login).
6. A branch `codex/traffic-lead-waves` (worktree `.worktrees/traffic-lead-waves`) tem outra especificação, com as mesmas tabelas. Ela não deve ser publicada; recomenda-se encerrar aquela sessão.

## Apêndice A — consultas usadas

Todas são somente leitura e foram executadas no projeto `mbzwchnxtskysqplqiyy`.

```sql
-- Leads recebidos por estado
select approval_status, status, (lead_import_batch_id is null) as from_api, (crm_lead_id is not null) as linked_crm,
  (import_warning is not null) as has_warning, count(*),
  min(created_time) at time zone 'America/Sao_Paulo', max(created_time) at time zone 'America/Sao_Paulo',
  min(received_at) at time zone 'America/Sao_Paulo', max(received_at) at time zone 'America/Sao_Paulo'
from public.meta_form_leads group by 1,2,3,4,5;

-- Leads recebidos por dia e campanha
select (created_time at time zone 'America/Sao_Paulo')::date dia, campaign_id, count(*)
from public.meta_form_leads group by 1,2 order by 1,2;

-- Métricas publicadas
select level, date, source, count(*), sum(spend), sum(leads), max(updated_at) at time zone 'America/Sao_Paulo'
from public.meta_traffic_daily group by 1,2,3 order by 1,2;

-- Captura atual (revisões pendentes) por nível e dia
select r.level, x.payload->>'date', count(*), sum((x.payload->>'spend')::numeric), sum((x.payload->>'leads')::int)
from public.meta_capture_reviews r join public.meta_capture_review_rows x on x.review_id=r.id
where r.status='pendente' group by 1,2 order by 1,2;

-- Ações brutas da Meta por campanha (explica o dobro)
select x.payload->>'date', x.payload->>'campaign_name', x.payload->'metric_metadata'->'raw_actions'
from public.meta_capture_reviews r join public.meta_capture_review_rows x on x.review_id=r.id
where r.status='pendente' and r.level='campaign';

-- Os 148 diante das exigências do CRM
select count(*) total,
  count(*) filter (where length(btrim(full_name))>=2) has_name,
  count(*) filter (where length(btrim(phone))>=8) has_phone,
  count(*) filter (where (public.meta_contact_from_form(l)->>'athlete_name') is not null) has_athlete,
  count(*) filter (where (public.meta_contact_from_form(l)->>'athlete_birth_date') is not null) has_birth,
  count(*) filter (where (public.meta_contact_from_form(l)->>'athlete_position') in
    ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante')) has_position
from public.meta_form_leads l;

-- Leads Meta no CRM
select lead_source, (meta_form_lead_id is not null), (created_at at time zone 'America/Sao_Paulo')::date, count(*)
from public.crm_leads where created_at > '2026-10-05' group by 1,2,3;

-- Jobs, capturas, busca de leads e webhook
select jobname, schedule, active from cron.job where jobname like 'meta%';
select kind, level, status, coverage_state, count(*) from public.meta_sync_runs
  where started_at > now() - interval '30 hours' group by 1,2,3,4;
select status, error_class, count(*), max(received_at) from public.meta_webhook_events group by 1,2;
select * from public.meta_lead_discovery_state;
```
