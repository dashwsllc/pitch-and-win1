# Tráfego: métricas essenciais por objetivo + sincronização rigorosa com o CRM

Data: 27/09/2026. Estende `docs/PLANO_TRAFEGO_META_E_SUGESTOES_2026-09-24.md` e `docs/META_ADS_SYNC_SETUP_2026-09-24.md` sem alterar rota, permissões, layout ou o assistente de importação/fila de leads já existentes.

## 1. Card essencial dinâmico por objetivo de campanha

- Nova coluna `objective text NOT NULL DEFAULT 'nao_informado'` em `meta_traffic_daily` (migration `20260927100000_meta_traffic_objective.sql`). Linhas antigas e novas CSVs sem a coluna Objetivo continuam válidas com o default — **nenhuma mudança visual até a operação começar a exportar essa coluna**.
- `meta_import_daily` foi recriada para aceitar `objective` com a mesma lógica de `present_metrics` das demais métricas opcionais (reimportação parcial preserva o valor já gravado).
- `src/lib/meta-traffic.ts` ganhou `classifyObjective(rawObjective)` e `summarizeObjectives(rows)`: uma heurística por palavra-chave normalizada que bucketiza o texto livre da coluna Objetivo em `leads | vendas | mensagens | reconhecimento | nao_informado | outro`.
  - **Essa heurística ainda não foi validada contra uma exportação real com a coluna Objetivo preenchida.** Antes de confiar no destaque automático para decisão de investimento, exporte um CSV real com a coluna e confira se `classifyObjective` bucketiza corretamente os valores que a conta realmente usa; ajuste `objectiveKeywords` em `meta-traffic.ts` se necessário.
  - `nao_informado` nunca conta como "objetivo misto" — só dispara aviso quando duas categorias **reconhecidas ou não** e diferentes de `nao_informado` aparecem juntas no recorte filtrado (`summarizeObjectives.mixed`). Um único objetivo não reconhecido (`outro`) sozinho não gera aviso nem promove métricas — mostra a grade completa silenciosamente, do mesmo jeito que hoje.
- `src/pages/Trafego.tsx`: a aba Desempenho agora calcula `objectiveSummary = summarizeObjectives(rows)` e usa `essentialMetricsByCategory` para promover 4 cards ao topo quando o recorte tem um único objetivo reconhecido; o restante fica em "Ver todas as métricas" (`Collapsible`, fechado por padrão). Recorte misto mostra aviso e a grade completa, no mesmo padrão visual já usado para janelas de atribuição diferentes.
- CPM (`aggregateMeta().cpm`, já calculado desde antes) agora aparece como card — inclusive na grade completa e como card essencial quando o objetivo dominante for `reconhecimento`, mesmo que a conta não rode esse objetivo hoje (o código não quebra se aparecer; só não é forçado como destaque sem dado real).

## 2. `lead_generated_at` — por que `created_at` não muda

`meta_promote_form_lead` perdia a data real de preenchimento do formulário Meta (`meta_form_leads.created_time`): o INSERT em `crm_leads` não a passava, então valia o `now()` do momento em que o SDR clicava "Confirmar no CRM".

**`crm_leads.created_at` não foi reaproveitada para isso.** Dois motivos, não só um:

1. **Estrutural**: o trigger `security_guard_crm_lead` (`20260908120000_security_hardening.sql`) força `NEW.created_at := clock_timestamp()` em todo INSERT em `crm_leads`, para impedir forjar colunas de auditoria — inclusive dentro de uma função `SECURITY DEFINER`. Passar `v_form.created_time` diretamente seria silenciosamente sobrescrito.
2. **Semântico**: `created_at` já é usado como referência de período em `src/lib/crm-pipeline-period.ts` (`leadApproachReference`, esteira/pipeline board) e em `20260923180000_arena_sync_all_roles.sql` (ranking Arena). Se um lead foi preenchido na Meta há dias mas só é triado hoje, ele precisa continuar aparecendo nos filtros operacionais "hoje/7 dias" desses dois lugares.

Solução: nova coluna `crm_leads.lead_generated_at timestamptz` (migration `20260927110000_crm_lead_generated_at.sql`), com trigger `BEFORE INSERT` que aplica `COALESCE(NEW.lead_generated_at, NEW.created_at, clock_timestamp())` — cobre qualquer caminho de INSERT, não só `meta_promote_form_lead`. `meta_promote_form_lead` (migration `20260927120000`) agora passa `v_form.created_time` explicitamente. **Esteira e ranking Arena continuam lendo `created_at`/`approached_at`, sem nenhuma mudança.** Não existe hoje relatório de SLA (tempo até primeiro contato) no CRM; a coluna fica documentada via `COMMENT ON COLUMN` para uso futuro.

## 3. Origem "Meta Ads" com rótulo amigável

`lead_source='meta_ads_form'` (gravado por `meta_promote_form_lead`) aparecia cru na tela — e não só ele: `LEAD_SOURCES` (`src/hooks/useCRM.tsx`) nunca alimentou nenhum `<select>` da UI (o campo é um `<Input>` de texto livre em `CRMLeadEditor.tsx`), então mesmo valores antigos como `google_ads` sempre apareceram sem tradução em `CRMLeadDetail.tsx`.

Adicionado `LEAD_SOURCE_LABELS` (`src/hooks/useCRM.tsx`, ao lado de `LEAD_SOURCES`) com rótulo para todos os valores conhecidos, incluindo `meta_ads_form: 'Meta Ads (Formulário)'`. `CRMLeadDetail.tsx` agora exibe `LEAD_SOURCE_LABELS[lead.lead_source] || lead.lead_source` — qualquer origem digitada livremente que não esteja no mapa continua aparecendo (só sem tradução).

## 4. CPA real / ROAS real (CRM) — sem confundir com o declarado pela Meta

O CPA/ROAS que já existia na tela vem só do que a própria Meta se autodeclara no CSV (`purchases`/`purchase_value`), sem cruzar com vendas de fato aprovadas no CRM.

Duas funções novas (migration `20260927130000_meta_crm_attribution_and_reconciliation.sql`), `SECURITY DEFINER STABLE`, gated por `traffic_has_access()` (mesma matriz de permissão da aba Tráfego — não a do CRM), seguindo o padrão de agregação sem PII já usado em `crm_result_sale_links()`:

- `meta_crm_attribution_daily(p_start, p_end)`: por campanha, conta vendas com `approval_status='aprovada'` e soma `valor_venda` ligadas a `crm_leads.meta_form_lead_id`, filtradas pela **coorte de `lead_generated_at`** (data real de geração do lead, não a data do relatório Meta nem a de fechamento da venda). Sempre recalculada ao vivo a partir de `vendas` — nunca grava snapshot, então cancelamento/estorno reduz o número automaticamente, sem apagar `meta_traffic_daily`.
- `meta_traffic_lead_reconciliation(p_start, p_end)`: contagem de `meta_form_leads` por campanha/período, para comparar lado a lado com `meta_traffic_daily.leads` (CSV agregado) na tabela "Leads: CSV agregado vs. fila de formulários".

Ambas só fazem sentido — e só são chamadas na UI — quando `level === 'campaign'`, porque `meta_form_leads` não carrega `adset_id`.

A tela rotula com clareza: "CPA/ROAS" (existente) = declarado pela Meta; "CPA real / ROAS real (CRM)" (novo) = vendas aprovadas no CRM. Os dois nunca são somados como se fossem a mesma coisa.

## 5. Exportação CSV

Botões "Exportar CSV" na tabela de Campanhas e na série diária da aba Desempenho, 100% client-side (`downloadCsv` em `Trafego.tsx`, `Blob` + `<a download>`), reaproveitando os mesmos dados já agregados/filtrados (`byCampaign`/`daily`) que os cards mostram — sem nova chamada de rede e sem recalcular nada, garantindo que o export bate exatamente com a tela no mesmo filtro.

## 6. Testes

- `scripts/verify-meta-traffic.mjs` (estendido): casos de `classifyObjective`/`summarizeObjectives`, incluindo objetivo não reconhecido isolado vs. misturado com um reconhecido.
- `scripts/verify-meta-import-roundtrip-real.mjs` (novo): roda contra o projeto Supabase real, cria um `traffic_manager` e linhas `meta_traffic_daily`/`meta_import_batches` descartáveis (prefixo `qa-`), importa uma linha com `present_metrics` completo, reimporta a mesma chave com `present_metrics` parcial (faltando `objective`/`leads`, com valores diferentes no payload para provar que são ignorados) e confirma que o que ficou de fora de `present_metrics` foi preservado e o que ficou dentro (`spend`) foi atualizado. Limpa tudo em `finally`. Executar com:
  ```
  node scripts/verify-meta-import-roundtrip-real.mjs --run-disposable-check
  ```

## Migrations desta entrega (ordem de aplicação)

1. `20260927100000_meta_traffic_objective.sql`
2. `20260927110000_crm_lead_generated_at.sql`
3. `20260927120000_meta_promote_form_lead_generated_at.sql` (depende de 2)
4. `20260927130000_meta_crm_attribution_and_reconciliation.sql` (depende de 2)
