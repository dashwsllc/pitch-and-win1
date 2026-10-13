# Levas de leads e chegada ao CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar levas estáveis de até 20 leads, revisão com prioridade aos recentes e envio útil ao CRM do SDR com os horários originais preservados.

**Architecture:** O PostgreSQL mantém membros, decisões, horários e idempotência. RPCs autorizadas devolvem metadados paginados e um detalhe de no máximo 20 membros; React apresenta os resultados e usa os sinais de mudança já existentes. A entrada mínima no CRM fica restrita aos formulários aprovados, mantendo as exigências posteriores de qualificação.

**Tech Stack:** React 18, TypeScript, TanStack Query, Supabase/PostgreSQL, scripts Node de regressão e ensaios SQL transacionais existentes. Nenhuma dependência de produto nova.

**Spec:** [2026-10-12-traffic-lead-waves-design.md](../specs/2026-10-12-traffic-lead-waves-design.md), aprovada pelo usuário nesta conversa em 12/10/2026.

## Global Constraints

- Destino comercial: Supabase `dash`, `mbzwchnxtskysqplqiyy`.
- Nenhuma leva contém mais de 20 membros, inclusive sob recebimentos simultâneos.
- Existe, no máximo, uma leva aberta para entrada automática no dashboard.
- Novas entradas, reprocessamento e rejeição não deslocam os membros das levas existentes.
- Aprovação e rejeição continuam decisões humanas, com registro de quem decidiu e quando.
- Rejeições exigem motivo entre três e 500 caracteres.
- A interface apresenta `America/Sao_Paulo` explicitamente.
- O lead entra sem SDR atribuído, na fila compartilhada, e não cria uma abordagem no ranking.
- E-mail, nome do atleta, nascimento e posição ausentes continuam vazios.
- Não haverá reaplicação geral de migrations.

## Review Focus

1. Lead antigo recuperado hoje: deve aparecer com sua geração antiga, mantendo os membros das levas anteriores. Teste na tarefa 1.
2. Duas revisões da mesma leva e resposta perdida: nenhuma decisão silenciosa sobre versão diferente ou duplicação de CRM. Testes nas tarefas 1 e 3.
3. Um membro sem telefone utilizável: sua falha precisa ficar visível sem esconder o envio dos demais. Teste na tarefa 2.
4. Respostas com texto longo ou conteúdo HTML: origem completa preservada e apresentação como texto; não truncar silenciosamente o registro original. Testes nas tarefas 2 e 4.
5. Computador em outro fuso e formulário recuperado com atraso: a interface mantém Brasília e não trata o recebimento como geração recente. Teste na tarefa 5.

## Situação do checkout e execução

Durante a preparação apareceu, fora do Git, `supabase/migrations/20261012150000_meta_lead_waves_crm_sync_auto_publish.sql`, além de `docs/TRAFEGO_LEVAS_AUDITORIA_E_PLANO_2026-10-12.md`. São trabalhos de outro fluxo e serão preservados. A migration observada agrega levas, CRM, métricas, cron e recuperação histórica; ainda não é prova de implantação ou de testes.

Executar em worktree isolado a partir da base registrada. Reaproveitar o código do outro fluxo por comparação, depois que seu estado estiver estável, sem sobrescrever arquivos em edição no checkout compartilhado. Antes de integrar, comparar o Git e o esquema remoto atuais. Alterações de métricas, cron e recuperação histórica não serão publicadas por este plano de levas.

A migration final deste recurso será `supabase/migrations/20261012160000_meta_lead_waves.sql`. Se o outro fluxo já tiver publicado a estrutura das levas, ela será uma evolução compatível dessa estrutura, com verificação explícita do esquema. Se não tiver publicado, conterá a criação. O executor decide esse ramo pela consulta do histórico e das colunas, nunca pela existência de um arquivo local. A mesma versão não pode representar conteúdos diferentes no histórico remoto.

## Arquivos e responsabilidades

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261012160000_meta_lead_waves.sql` | Estrutura, horários, agrupamento, revisão, envio, RLS, auditoria e sinais |
| `scripts/verify-meta-waves-db.sql` | Invariantes e decisões em transação revertida |
| `scripts/verify-meta-waves-concurrency.mjs` | Recebimentos e decisões simultâneos em banco local descartável |
| `scripts/verify-meta-wave-crm-db.sql` | Entrada mínima, contexto, falhas, repetição e ranking |
| `src/lib/meta-lead-waves.ts` | Tipos, consultas e decisões das levas |
| `src/lib/meta-lead-time.ts` | Formatação e idade dos instantes, sem depender de React |
| `src/components/traffic/MetaLeadWaves.tsx` | Lista paginada e estados de carregamento/erro |
| `src/components/traffic/MetaLeadWaveDetail.tsx` | Conferência dos membros, decisões e resultados |
| `src/components/crm/CRMLeadArrival.tsx` | Horários e tempo decorrido do formulário |
| `src/pages/Trafego.tsx` | Composição e contagem das pendências |
| `src/pages/CRM.tsx`, `src/lib/crm-order.ts` | Prioridade por geração na aba Importados |
| `src/hooks/useCRM.tsx`, `src/integrations/supabase/types.ts` | Contratos de CRM e esquema atualizado |
| `src/components/crm/CRMLeadCard.tsx`, `CRMLeadDetail.tsx`, `CRMContextPanel.tsx` | Horários e contexto na ficha do SDR |
| `src/lib/meta-leads.ts`, `src/lib/sync.ts` | Campos novos e atualização entre sessões |

### Task 1: Agrupamento estável e revisão versionada no banco

**Files:** Create a migration final e os dois testes `verify-meta-waves-db.sql` e `verify-meta-waves-concurrency.mjs` da tabela acima. Consultar as funções atuais de aprovação em `20261009160000_meta_traffic_manual_approval.sql` e os sinais em `20261011161000_meta_traffic_signals.sql`.

**Interfaces:**
- `meta_wave_list(p_status text, p_limit integer, p_offset integer) → jsonb`: `{rows: WaveSummary[], count: number, pending_leads: number}`; limite máximo 50, padrão 20.
- `meta_wave_begin_review(p_wave uuid) → jsonb`: `{wave: WaveSummary, leads: WaveLead[]}`; fecha a entrada uma vez, antes de retornar os membros.
- `meta_wave_decide_versioned(p_wave uuid, p_expected_version bigint, p_members jsonb, p_action text, p_excluded jsonb, p_note text, p_request_id uuid) → jsonb`: `WaveDecisionResult` definido na tarefa 3.
- `p_members` é a lista completa de `{id, updated_at}` exibida; `p_excluded` contém `{id, reason}`. Uma chave de solicitação repetida só retorna o resultado anterior se ator e conteúdo forem os mesmos.

- [ ] Escrever testes SQL para 0, 1, 19, 20, 21 e 148 membros; assertivas: máximo 20, uma leva aberta, ausência de membros duplicados, oito levas para 148. Abrir a parcial e receber outro lead deve manter seus membros. Recuperar um lead antigo depois não pode mover nenhum vínculo existente.

Asserções do caso `distribute_148_without_moving_existing_members`, após criar as fixtures identificadas pelo prefixo do ensaio:

```sql
IF fixture_wave_count <> 8 OR fixture_lead_count <> 148 THEN
  RAISE EXCEPTION 'FAIL: distribuição de 148 deve produzir oito levas';
END IF;
IF fixture_max_members > 20 OR fixture_changed_members <> 0 THEN
  RAISE EXCEPTION 'FAIL: capacidade ou estabilidade de membros';
END IF;
```
- [ ] Executar o teste antes da implementação no banco de ensaio: deve falhar pela ausência do contrato de levas. Registrar a falha e não aplicá-lo primeiro em produção.
- [ ] Implementar tabela, vínculo, distribuição transacional e bootstrap idempotente. Usar trava de distribuição comum aos recebimentos e ao início de revisão. Proteger vínculo, capacidade e decisões também no servidor. Reaproveitar RLS, auditoria e sinais; remover qualquer reagrupamento recorrente da implementação adotada.
- [ ] Implementar decisão com conjunto e versões completos. Validar antes de alterar; rejeitar divergência com `40001`, ausência de autorização com `42501`. Guardar solicitação e resultado da decisão para repetição segura. Rejeição de um membro mantém o vínculo histórico.
- [ ] Executar novamente o SQL e o teste concorrente com `node --test scripts/verify-meta-waves-concurrency.mjs`, usando o mesmo isolamento local de `verify-meta-lead-queue-concurrency.mjs`. Provar que dois recebimentos na fronteira 19/20 não excedem a capacidade e que apenas uma de duas decisões diferentes se aplica.
- [ ] Commitar somente a tarefa: `feat(traffic): persist stable lead waves and versioned reviews`.

### Task 2: Envio mínimo ao CRM, contexto e horários preservados

**Files:** Modify a migration final. Create `scripts/verify-meta-wave-crm-db.sql`. Adjust os testes existentes `scripts/verify-meta-approval-db.sql` e `scripts/verify-meta-lead-import-db.sql` apenas onde o comportamento aprovado mudou.

**Interfaces:**
- `meta_sync_form_lead_to_crm(p_lead uuid, p_actor uuid) → jsonb`: `{ok: boolean, crm_lead_id: string|null, already: boolean, error: string|null}`; função interna sem execução pública.
- `meta_wave_retry(p_wave uuid, p_lead uuid|null) → jsonb`: resumo e resultados dos aprovados sem vínculo; não altera decisões.
- `meta_form_leads`: `first_received_at timestamptz`, estado de envio, erro, tentativas e última tentativa.
- `crm_leads`: `lead_received_at timestamptz`; `lead_generated_at` continua sendo a geração original. A disponibilização no CRM usa o vínculo e horário efetivos, nunca uma tentativa falha.
- Contexto `meta_form`, único por CRM, com origem do formulário identificada e conteúdo somente leitura; respostas brutas permanecem completas em `meta_form_leads.field_data`.

- [ ] Escrever regressões: entrada com nome e WhatsApp sem perfil do atleta; telefone curto falha; 19 válidos e um inválido têm 19 vínculos e uma falha; repetir decisão e envio mantém um CRM e um contexto por origem, SDR nulo e zero abordagens. Assertivas incluem igualdade de horários ao segundo e sua imutabilidade na repetição.

Asserções de `approve_19_valid_and_one_invalid_without_duplicate_crm`:

```sql
IF (result->>'sent')::integer <> 19 OR (result->>'failed')::integer <> 1 THEN
  RAISE EXCEPTION 'FAIL: envio parcial não foi registrado por membro';
END IF;
IF fixture_crm_count <> 19 OR fixture_context_count <> 19 OR fixture_approach_count <> 0 THEN
  RAISE EXCEPTION 'FAIL: duplicação, contexto ou abordagem indevida';
END IF;
```
- [ ] Executar os testes e comprovar falha pelas exigências atuais de cadastro e falta de campos de chegada.
- [ ] Implementar envio por lead em subtransação. Validar nome e telefone normalizado, preservar campos adicionais válidos e deixar ausentes vazios. Adequar `public.crm_guard_workflow` e `public.meta_crm_approval_guard` somente para entrada Meta aprovada; preservar qualificação e avanço do funil. Integrar conversor, aprovação individual e importação ao mesmo envio.
- [ ] Derivar o primeiro recebimento do menor recibo durável correspondente e do horário já registrado, preservando sua procedência. Criar contexto uma única vez, sem truncar silenciosamente respostas. Conteúdo além do limite de exibição deve continuar acessível no registro original.
- [ ] Executar SQL de falha, correção e nova tentativa; provar que um SDR não aprova leads privados e que Gestor de Tráfego, Executive e Super Admin aprovam com autoria correta. Repetir as verificações de aprovação/importação existentes, preservando a aprovação manual de planilhas.
- [ ] Commitar: `feat(crm): accept approved form contacts and preserve arrival`.

### Task 3: Contrato TypeScript e consultas das levas

**Files:** Create `src/lib/meta-lead-waves.ts`, `scripts/verify-meta-wave-queries.mjs`. Modify `src/lib/meta-leads.ts`, `src/integrations/supabase/types.ts` e `src/lib/sync.ts`.

**Interfaces:**
- `WaveSummary`: `id`, `number`, `version`, `status`, `is_open`, `lead_count`, `first_lead_at`, `last_lead_at`, `last_received_at`, `approved`, `rejected`, `pending`, `sent`, `failed`, `reviewed_at`, `reviewed_by_name`.
- `WaveLead = MetaFormLead` com `wave_id`, `first_received_at` e campos de envio.
- `WaveDecisionResult`: `{wave: WaveSummary, approved: number, rejected: number, sent: number, failed: number, results: {lead_id: string, crm_lead_id: string|null, error: string|null}[]}`.
- `fetchLeadWaves({status, limit, offset})`, `beginLeadWaveReview(id)`, `decideLeadWave({snapshot, action, excluded, note, requestId})`, `retryLeadWave(id, leadId?)`: wrappers das RPCs da tarefa 1/2.

- [ ] Escrever testes com o harness existente: listagem envia limite e offset sem respostas; abrir devolve o conjunto fechado; decisão envia versão e `updated_at` de todos os membros. Uma repetição após resposta perdida mantém a mesma `requestId`; uma ação nova gera outra chave. Falha ao atualizar a interface depois do sucesso não vira “aprovação falhou”.

No caso `decision_preserves_displayed_versions_and_request_id`, o stub de RPC grava os argumentos e retorna um `WaveDecisionResult`:

```js
assert.equal(calls.at(-1).args.p_expected_version, snapshot.wave.version)
assert.deepEqual(calls.at(-1).args.p_members,
  snapshot.leads.map(lead => ({ id: lead.id, updated_at: lead.updated_at })))
assert.equal(calls.at(-1).args.p_request_id, requestId)
```
- [ ] Executar `node --experimental-vm-modules --experimental-strip-types --test scripts/verify-meta-wave-queries.mjs`; observar os casos falharem antes dos wrappers.
- [ ] Implementar wrappers e chaves de consulta por usuário, leva e versão. Regenerar tipos a partir do ambiente identificado e revisar o diff para preservar as extensões de aplicação. Fazer os sinais existentes invalidarem lista, detalhe e CRM, sem transportar respostas pessoais.
- [ ] Reexecutar o teste e `npx tsc --noEmit`; erros `40001` devem produzir recarregamento e mensagem de alteração, sem aprovação automática de uma versão nova.
- [ ] Commitar: `feat(traffic): add typed wave queries and safe decision retries`.

### Task 4: Levas na tela de Aprovações

**Files:** Create `MetaLeadWaves.tsx`, `MetaLeadWaveDetail.tsx` nos caminhos da tabela; create `scripts/verify-meta-wave-ui.mjs`. Modify `src/pages/Trafego.tsx`; preservar `MetaLeadApprovals.tsx` como fallback durante a transição e reutilizar `FormAnswers`.

**Interfaces:** `MetaLeadWaves({canReview: boolean, onReviewed: () => Promise<unknown>})`; detalhe recebe o snapshot devolvido por `beginLeadWaveReview` e usa somente a API da tarefa 3.

- [ ] Escrever testes de tela: lista ordenada, parcial imediata, detalhe com todos os 20 e horários, 19 aprovados/um rejeitado mostrado corretamente, motivo obrigatório e botão desabilitado enquanto registra. Respostas HTML devem ser renderizadas como texto. Leads e revisões de métricas têm contagens identificadas separadamente.

No caso `detail_displays_twenty_members_as_text`, renderizar o detalhe com 20 fixtures e resposta `<script>alert(1)</script>`:

```js
assert.equal((html.match(/data-wave-member=/g) ?? []).length, 20)
assert.match(html, /&lt;script&gt;/)
assert.doesNotMatch(html, /<script>/)
assert.match(resultHtml, /19 enviados/)
assert.match(resultHtml, /1 rejeitado/)
```
- [ ] Executar `node --experimental-vm-modules --experimental-strip-types --test scripts/verify-meta-wave-ui.mjs` e registrar as falhas dos comportamentos ausentes.
- [ ] Implementar lista paginada, início de revisão ao abrir, conferência de respostas, exclusões com motivo, decisão coletiva e resultados por membro. Oferecer edição do contato falho e repetição de envio. Mostrar versão alterada como estado de revisão que exige nova conferência.
- [ ] Reexecutar regressão e conferir no navegador em ambiente de desenvolvimento: teclado, abertura, todos os membros, avanço de página e falhas de carregamento/decisão. O mecanismo de fallback só é ativado para contrato indisponível; falha de permissão não troca para uma operação menos protegida.
- [ ] Commitar: `feat(traffic): review recent form leads in waves`.

### Task 5: Horários e prioridade no CRM do SDR

**Files:** Create `src/lib/meta-lead-time.ts`, `src/components/crm/CRMLeadArrival.tsx`, `scripts/verify-meta-lead-time.mjs`. Modify os componentes CRM, `src/lib/crm-order.ts` e `src/pages/CRM.tsx` da tabela.

**Interfaces:**
- `formatMetaLeadTime(value: string|null|undefined, seconds?: boolean) → string`: instante em `pt-BR` e `America/Sao_Paulo`; ausente ou inválido retorna “Não informado”.
- `metaLeadElapsed(value: string|null|undefined, now: number) → string`: idade calculada da geração, sem usar recebimento como substituto.
- `compareImportedLeadRecency(a, b) → number`: geração decrescente, depois criação e identificador; aplicar apenas na aba Importados.
- `CRMLeadArrival({lead, detail?: boolean})`: geração e tempo decorrido no cartão; três instantes no detalhe; atualização a cada minuto.

- [ ] Escrever teste com geração `2026-10-12T14:32:15Z`: detalhe deve mostrar `12/10/2026 11:32:15` em Brasília em execução com `TZ=UTC` e `TZ=America/Los_Angeles`. Campo inválido não produz “Invalid Date”. Lead de ontem recuperado hoje deve vir depois do formulário de hoje, mesmo que tenha sido aprovado depois.

No caso `form_time_uses_brasilia_and_preserves_original_priority`:

```js
assert.match(formatMetaLeadTime('2026-10-12T14:32:15Z', true), /12\/10\/2026.*11:32:15/)
assert.equal(formatMetaLeadTime('invalid', true), 'Não informado')
assert.deepEqual([oldRecovered, fresh].sort(compareImportedLeadRecency).map(x => x.id),
  [fresh.id, oldRecovered.id])
```
- [ ] Executar `node --experimental-strip-types --test scripts/verify-meta-lead-time.mjs` e comprovar os comportamentos ausentes.
- [ ] Implementar os helpers e componente. Exibir origem e contexto `meta_form` com autor de Tráfego identificado; esconder edição do contexto original sem alterar a escrita dos outros tipos. Aplicar ordenação por geração apenas na aba Importados e preservar as demais listas.
- [ ] Reexecutar os testes nos dois fusos, tipo e lint dos arquivos alterados. Conferir cartão, ficha, contexto e cadastro incompleto no navegador; o SDR deve conseguir atender e completar o cadastro sem confundir aprovação com primeiro contato.
- [ ] Commitar: `feat(crm): show form arrival and prioritize recent imports`.

### Task 6: Integração, publicação seletiva e prova final

**Files:** Create `docs/TRAFEGO_LEVAS_VALIDACAO_2026-10-12.md`. Atualizar a especificação e este plano com resultados, versões e limitações verificadas.

**Interfaces:** Consome o schema, RPCs e UI das tarefas 1–5; produz relatório reproduzível do estado publicado, com diferenças do checkout concorrente reconciliadas.

- [ ] Usar `verification-before-completion` e revisão independente conforme o método de execução escolhido. Comparar o estado atual do outro fluxo e revisar o diff completo; não publicar duas migrations que criem a mesma estrutura nem substituir conteúdo já registrado no remoto.
- [ ] Executar as regressões relevantes de tráfego e CRM, os novos testes, SQL transacional de levas/CRM, concorrência local, `npx tsc --noEmit`, ESLint dos arquivos alterados e `npm run build`. Documentar saída e limitações de qualquer ensaio indisponível.
- [ ] Confirmar os três destinos locais, histórico remoto e contratos atuais. Publicar seletivamente estrutura compatível antes do frontend. Não alterar publicação de métricas, cron, assinatura Meta ou janela de recuperação por efeito desta migration.
- [ ] Executar consultas de conferência: todos os pendentes automáticos em leva, capacidade ≤20, um vínculo por lead, datas fiéis e nenhuma abordagem criada pelo envio. Para o estado inicial observado, esperar oito levas; recalcular se houve novas entradas.
- [ ] Provar em duas sessões a atualização de lista e CRM usando fixture de ensaio. Conferir a interface de produção em leitura. Aprovação de uma leva comercial depende da decisão explícita do usuário na tela.
- [ ] Registrar o que foi publicado, o que foi comprovado e o que ainda depende da Meta ou de decisão comercial. Commitar: `docs(traffic): record lead wave validation and rollout`.

## Revisão deste plano

O plano cobre as dez seções da especificação. O envio e os horários foram incluídos porque agrupar os 148 leads sem mudar o bloqueio de cadastro não atenderia à chegada útil ao SDR. A auditoria de gastos, métricas e campanhas para o site permanece ativa em uma frente própria; este plano não afirma que ela esteja concluída.

Método escolhido pelo usuário em 12/10/2026: **execução nativa**, com implementação nesta conversa em checkout isolado e uma revisão independente do conjunto ao final. As tarefas compartilham contratos de banco e CRM, e há um rascunho concorrente que precisa ser reconciliado antes da integração. Plano aprovado para execução nesta conversa.
