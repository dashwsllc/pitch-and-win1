# Tráfego: importação de métricas e leads fica pendente até o gestor aprovar, sincronizada ao CRM

Data: 29/09/2026. Estende `docs/TRAFEGO_METRICAS_ESSENCIAIS_SYNC_2026-09-27.md` sem alterar a aba **Conexão** (sync automático via API Meta) nem o webhook individual de leads (`/leads`, `meta_promote_form_lead`), que continuam existindo exatamente como antes.

## 1. Por que

Até aqui, o CSV de métricas subido em `/trafego` entrava direto em `meta_traffic_daily`, sem revisão. Não havia como importar leads/formulário em planilha — só chegavam um a um pelo webhook Meta. O pedido: o que o gestor de tráfego sobe (métricas e leads) fica **pendente**, um Executive confere e aprova ou rejeita, e só então os dados valem — métricas aparecem em Desempenho, leads sincronizam com o CRM. Mesmo padrão que `vendas` já usa (pendente → Executive aprova/rejeita via `manage_sale`), replicado aqui em vez de inventado.

## 2. Métricas (CSV de desempenho)

- `meta_import_batches` ganhou `status` (`pendente`/`aprovado`/`rejeitado`), `rows` (payload validado da importação), `updated_at`, `reviewed_by`, `reviewed_at`, `review_note`. Lotes já existentes viram `aprovado` na migration (já estavam refletidos em `meta_traffic_daily`, nada para reaplicar).
- `meta_import_daily` (`p_filename`, `p_rows`) agora só valida (via `meta_validate_traffic_row`, extraído de `meta_upsert_traffic_row`) e grava o lote como `pendente`. **Não escreve mais em `meta_traffic_daily`** — isso passa a acontecer só na aprovação.
- `meta_review_traffic_import(p_batch_id, p_action, p_expected_updated_at, p_note)`: só Executive/Super Admin (`is_executive`), concorrência otimista por `updated_at` (mesmo padrão de `manage_sale`). `aprovar` roda `meta_upsert_traffic_row` por linha (preserva a lógica de `present_metrics` em reimportação parcial, sem mudança); `rejeitar` exige motivo (3–500 caracteres) e nunca escreve em `meta_traffic_daily`. Um lote já decidido não pode ser revisado de novo.
- API (`meta_import_daily_system`, sync automático da aba Conexão) **não muda**: continua trusted, sem pendência.

## 3. Leads/formulário por planilha (novo)

Antes só existia entrada de lead via webhook individual (`/leads`). Agora dá para importar uma planilha também — pensado para contas/históricos sem webhook, não para substituir o webhook. Desenho ajustado depois de conferir uma planilha real (formulário "Zyron"): o formulário real não pergunta e-mail, traz posição do atleta em texto livre (não no enum do CRM) e tem várias perguntas próprias (motivação, dificuldade, autoavaliação, histórico de clube) sem coluna dedicada — a regra abaixo assume que isso é a norma, não a exceção.

- Nova tabela `meta_lead_import_batches`, mesmo desenho de pendência da Parte 2. `meta_import_leads(p_filename, p_rows)` só exige o mínimo estrutural — identificador e data (o cliente sempre preenche os dois, com fallback quando a planilha não traz) — e grava `pendente`. Nome, telefone, e-mail e dados do atleta podem vir vazios sem travar o arquivo inteiro.
- **Nenhuma linha é bloqueada na importação.** `src/lib/meta-lead-import.ts` nunca lança erro por causa do conteúdo de uma linha: data/hora ilegível vira "agora" (só pra ordenar a fila), nascimento ilegível fica vazio, posição em texto livre entra exatamente como está (sem tentar corrigir ou encaixar no enum), ID duplicado no arquivo ganha um sufixo em vez de rejeitar a linha. Isso é intencional: sincronizar o que a planilha realmente tem, sem gatekeeping — dado ruim vira lead incompleto na fila, não erro de importação.
- Colunas mapeadas para um campo estruturado (nome, telefone, data, e-mail, dados do atleta) alimentam esse campo; **qualquer outra coluna da planilha vira resposta de formulário** (`field_data`, mesmo formato `{name, values}` que o webhook já usa) — reaproveita a aba "Ver respostas" que `/leads` já tem, sem mudança nenhuma lá.
- Na aprovação (`meta_review_lead_import`), cada linha vira uma linha em `meta_form_leads` (`status='novo'`, dedup por `meta_lead_id` igual ao webhook, `field_data` preservado) via `meta_ingest_lead_import_row`. **Se a linha já trouxer nome, telefone, e-mail e os três campos de atleta (nome, nascimento, posição válida no enum)**, o mesmo lote a promove automaticamente para `crm_leads` — reaproveitando `meta_create_crm_lead_from_form`, extraído do `meta_promote_form_lead` original (mesma validação, mesmo texto de erro; usado tanto pela promoção manual do SDR quanto pela aprovação em massa). As colunas extras (`raw_notes`, derivado de `field_data`) entram concatenadas em `observations` **só quando a promoção automática acontece** — a promoção manual do SDR via `/leads` não muda, porque nunca envia essa chave. Linha sem e-mail, sem dados de atleta completos, ou com posição fora do enum fica só em `meta_form_leads` (`novo`), aparecendo em `/leads` pro SDR completar — **nada muda em `/leads` nem em `meta_promote_form_lead`**, é o mesmo caminho de sempre.
- Cada etapa da aprovação em massa roda em sua própria subtransação (`BEGIN...EXCEPTION`): uma linha malformada nunca derruba o lote inteiro nem impede as outras linhas de serem processadas.
- `meta_form_leads` ganhou `lead_import_batch_id` (nulo para leads do webhook) só para rastreabilidade de qual planilha originou um item da fila.
- `src/lib/spreadsheet.ts` (novo): além de `.csv`, aceita `.xls`/`.xlsx` via SheetJS (`xlsx`). **Instalado a partir do CDN oficial do projeto (`cdn.sheetjs.com`), não do registro npm** — a versão publicada no npm está desatualizada e tem vulnerabilidade alta sem correção (`npm audit` confirma); o próprio SheetJS recomenda instalar assim. Usado tanto pelo import de métricas quanto pelo de leads.

## 4. Front-end (`src/pages/Trafego.tsx`)

- Aba **Importar**: `ImportPanel` (métricas, inalterado na UX de mapeamento de colunas) e o novo `LeadImportPanel` (mesmo padrão de drag-and-drop + conferência de colunas, campos de `src/lib/meta-lead-import.ts`) agora só avisam "enviado para aprovação", sem mais mexer em Desempenho na hora.
- Nova seção **Pendentes de aprovação**, logo abaixo de "Importações recentes": lista lotes `pendente` de métricas e leads juntos, com preview recalculado no cliente (`aggregateMeta`/`summarizeObjectives` para métricas, `summarizeLeadImport` para leads — quantos ficam prontos pro CRM automaticamente vs. quantos vão pra fila manual). Botões Aprovar/Rejeitar só para quem tem `useRoles().isExecutive`; motivo obrigatório na rejeição, mesmo padrão visual já usado em "Desconectar conta"/"Ignorar lead".
- "Importações recentes" ganhou selo de status (Pendente/Aprovado/Rejeitado, com o motivo quando rejeitado) e passou a listar métricas e leads juntos.

## 5. Testes

- `scripts/verify-meta-lead-import.mjs` (novo, unitário): parsing/mapeamento da planilha de leads, datas BR/ISO, posição fora do enum entrando sem bloquear (e não contando como "pronta pro CRM"), geração de ID sintético quando a planilha não traz um, ID duplicado ganhando sufixo em vez de travar a linha, linha sem nome/telefone/e-mail entrando mesmo assim, e colunas extras virando `field_data`/`raw_notes`.
- `scripts/verify-meta-import-approval-roundtrip-real.mjs` (novo, roda contra o Supabase real): cobre import→pendente→rejeitar (nada gravado)→novo import→aprovar (linha em `meta_traffic_daily`) e um lote de leads com três linhas: completa (vira `crm_leads` + `meta_form_leads.importado`, com as respostas extras em `observations`), sem e-mail (como o formulário real) e com posição em texto livre — as duas últimas ficam `meta_form_leads.novo` com o dado original preservado em `field_data`. Limpa tudo em `finally`, inclusive quebrando o par de FKs cruzadas `crm_leads.meta_form_lead_id`/`meta_form_leads.crm_lead_id` antes de apagar. Executar com:
  ```
  node scripts/verify-meta-import-approval-roundtrip-real.mjs --run-disposable-check
  ```

## Migrations desta entrega (ordem de aplicação)

1. `20260929100000_meta_traffic_import_pending.sql`
2. `20260929110000_meta_lead_import.sql` (depende de 1, reusa o padrão de `meta_import_batches`)
