# Integração dos leads do site com Importações do SDR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O usuário já escolheu execução nativa; não reabrir a escolha do método.

**Goal:** Entregar os contatos do site, com perfil, atribuição e contexto completos, às mesmas levas de revisão e ao setor Site / conversão direta do SDR, com recebimento confirmado e repetição segura.

**Architecture:** O banco do site grava cada alteração relevante numa outbox imutável, na mesma transação do contato. Um worker com lease envia eventos assinados ao dashboard; o receptor só confirma após gravar o evento completo e a projeção pendente. Eventos posteriores ficam disponíveis na ficha sem substituir a captura aprovada ou as correções do SDR.

**Tech Stack:** Supabase/PostgreSQL, Edge Functions/Deno, Web Crypto HMAC-SHA256, React/TypeScript, TanStack Query, Node e ensaios SQL/Chromium existentes. Nenhuma dependência de produto nova.

**Spec:** [2026-10-13-site-lead-import-design.md](../specs/2026-10-13-site-lead-import-design.md), aprovada pelo usuário em 13/10/2026. Execução nativa já escolhida; este plano aguarda revisão antes de implementar.

## Global Constraints

- Fonte: `mehmqibxzxfqdxqjnjad`, site `https://aizyron.com/avaliacao`, repositório `C:/Users/Me/Downloads/voxen/vide-match`.
- Destino comercial: `dash`, `mbzwchnxtskysqplqiyy`, dashboard `https://www.wsltda.com`. Não mudar a conexão do site para o banco comercial.
- Todos os contatos passam pelas levas existentes de até20 e por aprovação humana. Nenhuma aprovação comercial faz parte do rollout.
- Prioridade pelo primeiro recebimento durável no dashboard, decrescente; geração original e chegada ao CRM ficam distintas, com segundos em Brasília.
- Não apagar eventos, recibos, contatos, decisões ou contexto em falha, reprocessamento ou reversão.
- Preservar respostas, perfil, relatório e atribuição integrais; não inventar campos históricos que não foram gravados.
- Fonte posterior não substitui silenciosamente correções do SDR nem a captura aprovada. Rejeitados não são reabertos automaticamente.
- Segredos somente nos servidores/Vault; nenhum segredo comercial no navegador, Git ou logs. Logs operacionais contêm IDs, estados e contagens.
- Publicação seletiva e compatível: estruturas, funções, clientes e ativação por último. Não reaplicar migrations gerais.

## Evidência e compatibilidade

Consulta somente leitura de13/10: a fonte contém316contatos; `profile` e `report` já são JSONB no remoto (4perfis e1relatório preenchidos), embora ausentes nas migrations locais. A RPC atual `capture_funnel_lead` possui11argumentos, valida contato, limita IP e salva UTMs. Preservar essa assinatura para clientes antigos.

Os triggers remotos `zyron_sync_lead_ins` e `zyron_sync_lead_upd` chamam `zyron_trg_lead()` → `zyron_sync_lead(uuid)`, alimentando tabelas internas `zyron_members`/`zyron_member_skips`. Não enviam ao dashboard e não serão substituídos. A fonte possui Vault/pgcrypto, mas ainda não possui pg_cron/pg_net ou outbox; conferir novamente antes da instalação.

O cliente chama `syncFunnelLead` na etapa de contato. No final, só tenta novamente quando um booleano indica falha anterior; portanto perfil completado depois pode não ser enviado. O plano substitui esse controle por confirmação da captura atual.

O destino já possui levas versionadas, `first_received_at`, origem Site/manual, snapshot integral no CRM e atualização entre sessões, instalados pela migration `20261013165410`. Reutilizar esses contratos; manter o fluxo Meta intacto.

## Review Focus

1. Resposta perdida depois de gravar: repetir o mesmo evento não duplica contato, CRM ou leva; chave com corpo diferente é recusada. Tarefas1/3/6.
2. Perfil posterior, inclusive depois de aprovação/rejeição: preservar eventos completos, cadastro atual e decisão humana; versão antiga fora de ordem não regride dados. Tarefas1/5.
3. Contato manual e automático com mesmo ID de origem: um vínculo; sem ID confiável, apenas sinalizar possível coincidência, nunca fundir por nome/telefone. Tarefas1/6.
4. Foto/relatório grande, dado inválido ou versão de protocolo desconhecida: preservar e mostrar pendência, sem descarte ou confirmação falsa de completude. Tarefas1/2/3/5.
5. Fonte ou navegador offline, worker interrompido e duas sessões SDR: retomar captura/envio, respeitar lease e mostrar atraso; nenhum recebimento deve depender de manter uma aba aberta. Tarefas2/3/4/6.

## Arquivos e responsabilidades

Os caminhos seguintes são relativos ao repositório indicado. Criar migrations com `supabase migration new <nome>` e registrar no ledger o caminho retornado pela CLI; a versão temporal é atribuída na execução.

| Repositório | Arquivo | Responsabilidade |
| --- | --- | --- |
| Dashboard | migration CLI `site_lead_import_receipts` | Inbox durável, projeção nas levas, RLS e sinais |
| Dashboard | `supabase/functions/_shared/site-bridge-protocol.ts` | Validação do envelope, assinatura e confirmação |
| Dashboard | `supabase/functions/site-lead-receiver/index.ts` | Fronteira HTTP assinada e gravação antes do ACK |
| Dashboard | `src/components/crm/CRMSiteSourceUpdates.tsx` | Eventos completos da origem, posteriores à captura aprovada |
| Dashboard | `src/components/traffic/SiteBridgeStatus.tsx` | Último sinal, pendências, quarentena e atraso |
| Dashboard | `src/components/crm/CRMImportDetails.tsx`, `src/components/traffic/MetaLeadWaves.tsx`, `src/components/traffic/MetaTrafficConnection.tsx` | Composição da origem Site e estados operacionais |
| Dashboard | `scripts/verify-site-receiver.mjs`, `verify-site-import-db.sql`, `verify-site-bridge-integrated.mjs`, `verify-site-import-browser.mjs` | Protocolo, banco real, entrega e duas sessões |
| Site | migration CLI `funnel_lead_outbox` | Histórico atômico, captura v2, claims e ACKs |
| Site | migration CLI `funnel_lead_delivery_cron` | pg_net/pg_cron, Vault e agendamento desativado até a ativação |
| Site | `supabase/functions/_shared/funnel-lead-delivery.ts`, `supabase/functions/funnel-lead-delivery/index.ts` | Worker autenticado, assinatura, repetição e heartbeat |
| Site | `src/lib/funnel-capture-queue.ts`, `src/lib/funnel.ts` | Capturas locais pendentes, confirmação e envio do perfil inteiro |
| Site | `src/pages/funnel/FunnelProfile.tsx`, `src/pages/jogador/JogadorProfile.tsx` | Captura na etapa de contato e confirmação da versão final |
| Site | `src/pages/funnel/FunnelResult.tsx`, `src/pages/jogador/JogadorResult.tsx` | Captura do relatório já produzido, com sua procedência identificada |
| Site | `scripts/verify-funnel-outbox-db.sql`, `verify-funnel-delivery.mjs`, `verify-funnel-capture.mjs` | Atomicidade, lease, recuperação e captura do cliente |
| Ambos | `supabase/config.toml` | Novas funções com autenticação própria explícita |

## Contrato de entrega

`SiteLeadEventV1 = { schema_version:1, event_id:UUID, source_project:'mehmqibxzxfqdxqjnjad', source_lead_id:UUID, source_revision:integer, generated_at:ISO, source_updated_at:ISO, payload:object }`. `payload` é a captura completa do registro de origem, incluindo contato, `profile`, `report`, UTMs e click IDs. A identidade no destino é `site:zyron:<source_lead_id>`; nunca usar e-mail ou telefone como chave de mesclagem entre origens.

Headers: `x-site-timestamp` (segundos Unix), `x-site-signature: sha256=<hex>`; assinatura HMAC-SHA256 de `timestamp + '.' + corpoUTF8exato`, com `SITE_BRIDGE_SHARED_SECRET`. Tolerância de300segundos. Comparar em tempo constante e validar antes de usar o JSON. Corpo limitado a16MiB; payload excedente fica na fila com erro explícito e não é apagado. O contato inicial menor continua entregável independentemente de uma foto/relatório posterior muito grande.

`SiteReceipt = { event_id, source_lead_id, source_revision, receipt_id, status:'pending_review'|'context_only'|'superseded'|'quarantined' }`. HTTP200 só depois do commit durável. O worker confere todos os IDs antes de marcar recebido. Falha de banco →503; assinatura inválida →403; conflito entre mesmo ID e corpo diferente →409. Envelope desconhecido com identidade válida fica em quarentena durável, visível para Tráfego, com ACK correspondente; não desaparece por não ser projetável.

Heartbeat assinado: `{ schema_version:1, kind:'heartbeat', source_project, observed_at, pending_count, quarantined_count, oldest_pending_at }`. Sem dados pessoais. O painel distingue horário desse sinal da última entrega de contato; ausência por mais de2minutos aparece como informação desatualizada.

### Task 1: Recebimento durável e projeção segura no dashboard

**Files:** migration `site_lead_import_receipts`; protocolo, receptor e testes `verify-site-receiver.mjs`, `verify-site-import-db.sql`; configuração da nova função.

**Interfaces:**
- `site_import_receive(p_event jsonb,p_body_sha256 text) → SiteReceipt`, somente service_role; segredo é validado pelo receptor, nunca pelo cliente.
- `site_import_events`: UUID do evento, origem/versão únicos, hash e payload integrais, recebimento, vínculo `meta_form_lead_id`, estado e erro sem credenciais. RLS permite Tráfego ou usuários com acesso ao CRM vinculado; SDR não lê eventos de contatos pendentes.
- `site_bridge_heartbeat_receive(p_status jsonb) → void`, somente service_role: grava o sinal mais recente e ignora regressão de horário; o estado do painel combina esse sinal com a quarentena real da inbox.
- Novos contatos usam o agrupamento existente. Atualizar projeção somente enquanto pendente e somente com revisão de origem maior; incrementar `updated_at` invalida conferência aberta. Aprovados/rejeitados recebem histórico, sem alterar o cadastro/decisão.

- [ ] Escrever teste HTTP com corpo Unicode assinado, timestamp vencido, JSON inválido, DB indisponível e commit seguido de resposta perdida: `assert.equal(replay.receipt_id,first.receipt_id)`; corpo divergente com mesmo ID deve retornar409.
- [ ] Executar `node --experimental-vm-modules --experimental-strip-types --test scripts/verify-site-receiver.mjs`. Expected: FAIL pelo receptor/contrato ausente.
- [ ] Escrever SQL revertido: um ID Site produz um pendente e uma leva; repetir preserva ambos e o primeiro recebimento; revisão3 seguida de2 preserva3 e guarda2; update após aprovação não modifica captura/cadastro; falta de contato utilizável fica preservada e corrigível. Executar no banco descartável. Expected: FAIL por `site_import_receive` ausente.
- [ ] Implementar inbox/projeção/receptor. Reutilizar trava das levas; raw payload fica no evento e em `source_snapshot`, sem caber à força nos limites do resumo ou `field_data`. Respostas escalares alimentam a conferência; foto/relatório e demais dados ficam no registro integral. Aceitar ID manual canônico existente e preservar captura manual/decisão; apenas ligar os novos eventos à mesma identidade.
- [ ] Reexecutar HTTP+SQL e regressões de levas/CRM. Expected: PASS, máximo20, uma identidade, zero CRM antes de aprovação, versões e permissões corretas.
- [ ] Commit: `feat(traffic): receive durable signed site lead events`.

### Task 2: Outbox atômica e compatibilidade na origem

**Files:** migration `funnel_lead_outbox`; `scripts/verify-funnel-outbox-db.sql` no site.

**Interfaces:**
- `capture_funnel_lead_v2(p_contact jsonb,p_profile jsonb,p_attribution jsonb,p_report jsonb DEFAULT NULL) → {lead_id,source_revision}` para anon/authenticated, com validação e limites da captura existente. Captura perfil integral e `capture_attribution` JSONB sem os cortes das colunas legadas; relatório ausente não apaga um relatório existente.
- `funnel_lead_outbox`: evento imutável e versão única por contato; estado pending/processing/delivered, lease, claim UUID, tentativas, próxima tentativa, recibo e erro sanitizado. Sem grants anon/authenticated. Não usar FK com exclusão em cascata: uma exclusão explícita na origem não pode apagar eventos/recibos históricos.
- `funnel_outbox_claim(p_limit integer DEFAULT20,p_lease_seconds integer DEFAULT60) → claimed events`, `funnel_outbox_ack(p_event uuid,p_claim uuid,p_receipt jsonb)`, `funnel_outbox_fail(p_event uuid,p_claim uuid,p_code text,p_retry_at timestamptz)`: somente service_role; claims expirados podem ser retomados, ACK antigo é recusado.
- `funnel_outbox_backfill(p_after uuid,p_limit integer DEFAULT200) → {last_id,enqueued,done}`: somente serviço; idempotente por identidade/versão, não modifica os contatos históricos.

- [ ] Escrever SQL: falhar deliberadamente a inclusão na outbox reverte contato/perfil; INSERT e UPDATE relevante geram eventos; mudança só de `updated_at` não gera outra versão; RPC antiga continua válida; dois workers não recebem o mesmo claim; recomeçar backfill não duplica. Executar no banco descartável da fonte. Expected: FAIL por outbox/RPCs ausentes.
- [ ] Implementar evolução aditiva com guards para `profile`/`report` JSONB existentes. Preservar triggers `zyron_*`, validação, limitação por IP e a RPC de11argumentos. A nova RPC reutiliza validação e grava perfil na mesma transação; trigger registra snapshots de alterações relevantes. Nenhum envio HTTP bloqueia a captura.
- [ ] Reexecutar SQL com fixtures de perfil e relatório existentes e backfill paginado. Expected: PASS; contatos originais, contextos e sincronização interna preservados; nenhuma linha descartada.
- [ ] Commit: `feat(funnel): persist transactional lead delivery outbox`.

### Task 3: Worker, repetição, sinal de saúde e agendamento

**Files:** worker e teste `verify-funnel-delivery.mjs`; migration `funnel_lead_delivery_cron` e config do site; recepção de heartbeat no dashboard.

**Interfaces:** `deliverFunnelEvents(admin,options:{receiverUrl,sharedSecret,deadlineMs}) → {claimed,delivered,retryable,blocked}`. Apenas o endpoint fixo do dashboard é permitido. Invocação do worker exige `SITE_BRIDGE_CRON_SECRET`; função com gateway JWT desativado e validação própria. Execução até45segundos, fetch até5segundos; retentativa sem limite de descarte, atraso exponencial limitado a1hora. Erro de configuração/oversize fica explícito e retomável.

- [ ] Escrever testes reais do worker com fronteiras HTTP/DB substituídas:503, timeout, resposta perdida, ACK divergente, interrupção e lease vencido, assinatura Unicode, corpo grande e segredo ausente. Assertions: `ackedEvents.length===0` em ACK inválido; evento recebido duas vezes mantém identidade; erro nunca remove evento. Executar `node --experimental-vm-modules --experimental-strip-types --test scripts/verify-funnel-delivery.mjs`. Expected: FAIL por worker ausente.
- [ ] Implementar worker e heartbeat. Guardar recibo completo antes de finalizar claim; tentativas não alteram payload nem ID. Sem logs com contato, corpo, assinatura ou segredo.
- [ ] Preparar pg_net/pg_cron na fonte com job `funnel-lead-delivery` a cada minuto e nudge após commit de nova entrada. Invocações leem segredo do Vault; job permanece inativo até a tarefa6. Se faltar configuração, manter outbox e estado pendente, sem descartar contato.
- [ ] Reexecutar testes, SQL de claims e `deno check` das funções novas. Expected: PASS, retomada sem duplicação e nenhuma configuração privada no bundle/Git.
- [ ] Commit: `feat(funnel): retry signed lead delivery with durable acknowledgements`.

### Task 4: Capturar o perfil completo e recuperar falhas do navegador

**Files:** `src/lib/funnel-capture-queue.ts`, `src/lib/funnel.ts`, os dois `FunnelProfile.tsx`/`JogadorProfile.tsx`, `FunnelResult.tsx`/`JogadorResult.tsx`, `scripts/verify-funnel-capture.mjs` no site.

**Interfaces:** `queueFunnelCapture(input)`, `flushFunnelCaptures()`, `syncFunnelLead(PlayerData,report?:{overall:number,stats:StatResult[],method:'deterministic-profile-v1'})` conservando retorno do ID do contato. Fila IndexedDB local guarda a captura antes do envio e remove somente a versão confirmada. Retoma na abertura do funil e evento online. Falha de armazenamento deixa aviso; confirmação exige ACK da RPC. O relatório é o já produzido pelo site, identificado como cálculo determinístico do navegador, sem inventar avaliação ou tratá-lo como métrica de campanha.

- [ ] Escrever regressão: contato confirmado na etapa2, completar nacionalidade/posição/localização/foto depois e avançar ao upload deve enviar a nova captura; abrir resultado registra o relatório existente; reabrir resultado idêntico não cria versões artificiais. Resultado de uma chamada antiga não apaga versão local mais recente. Todas as chaves de `PlayerData` e oito campos de atribuição permanecem no payload; campos vazios não inventam dados. Queda de rede conserva pendência e online retoma com identidade estável.
- [ ] Executar `node --experimental-vm-modules --experimental-strip-types --test scripts/verify-funnel-capture.mjs`. Expected: FAIL porque o booleano atual impede a captura final e não há fila persistente.
- [ ] Implementar envio à RPCv2 e fila local. Capturar contato imediatamente; sempre confirmar a captura atual no final. Conservar `playerData` e pendência em falha, com erro/repetição visíveis. Preservar a experiência de `/avaliacao` e `/jogador`; não enviar segredos ou chamar o worker pelo navegador.
- [ ] Reexecutar testes, TypeScript e lint dos arquivos alterados. Conferir no Chromium os dois funis, offline/online e avançar/voltar. Expected: PASS, contato inicial preservado e perfil final efetivamente capturado.
- [ ] Commit: `feat(funnel): synchronize complete profile captures and recover offline submissions`.

### Task 5: Contexto posterior no SDR e operação visível

**Files:** `CRMSiteSourceUpdates.tsx`, `SiteBridgeStatus.tsx`, composição de CRM/levas/Conexão, contratos em `src/lib/arena-api.ts` e testes de interface no dashboard.

**Interfaces:** consultas por usuário/contato, eventos paginados20por página em recebimento decrescente, payload integral carregado ao abrir um evento. `site_bridge_operation() → {last_heartbeat,last_received_at,pending_count,quarantined_count,oldest_pending_at}` autorizado somente a Tráfego. Inserções/atualizações em eventos emitem os sinais `crm`/`arena` existentes.

- [ ] Escrever teste: aprovar um contato, editar WhatsApp no SDR, receber novo perfil e depois uma revisão antiga; ficha mantém WhatsApp e snapshot aprovados, mostra os dois eventos e datas ao segundo, com texto HTML escapado e sem truncamento do original. SDR não lê eventos pendentes de outro contato. Heartbeat antigo não diz que fila está atualizada.
- [ ] Executar testes Node/UI antes dos componentes. Expected: FAIL por histórico Site/estado operacional ausentes.
- [ ] Implementar histórico separado do cadastro e da captura aprovada; mostrar fonte/versão/horários/contexto completos, erro visível e nova tentativa. Conexão mostra quarentena, atraso e ausência de sinal; não confundir volume de visitas, contatos e métricas da Meta. Preservar filtros e ordenação por primeiro recebimento já publicados.
- [ ] Reexecutar UI e navegador com duas sessões SDR, inclusive fallback sem Realtime. Expected: PASS, eventos aparecem sem sobrescrever trabalho do SDR e sem baixar todo o histórico na lista.
- [ ] Commit: `feat(crm): show complete site source updates and bridge health`.

### Task 6: Ensaio integrado, publicação e recuperação dos existentes

**Files:** `scripts/verify-site-bridge-integrated.mjs`, `verify-site-import-browser.mjs`, relatório `docs/TRAFEGO_SITE_VALIDACAO_2026-10-13.md` no dashboard.

- [ ] Ensaiar dois bancos locais descartáveis com as funções reais e handlers de produção: captura → outbox → assinatura → inbox → leva → aprovação sintética → CRM → perfil posterior. Injetar falhas e perda de ACK. Expected: um contato/CRM por identidade, todas as versões preservadas, nenhuma decisão comercial e histórico do SDR intacto.
- [ ] Ensaiar um ID do site importado manualmente antes da entrega automática: manter vínculo; ID desconhecido com contato parecido fica sinalizado, sem fusão automática. Conferir recuperação de316contatos históricos por conjuntos de IDs, recalculando a quantidade na ativação. Expected: conjuntos reconciliados; nenhum campo histórico inventado e nenhum lead aprovado automaticamente.
- [ ] Rodar as regressões de tráfego/importações, seis ensaios novos, TypeScript/lint/build nos dois repositórios, `deno check`, varredura de segredos e Advisor. Fazer uma revisão independente do conjunto, conforme execução nativa; corrigir achados importantes com RED→GREEN. Expected: gates verdes ou limitação preexistente identificada com evidência, sem ocultar falhas.
- [ ] Conferir novamente refs, histórico remoto, funções e triggers dos dois projetos. Instalar somente migrations novas; configurar segredo privado igual nos dois servidores e cron secret separado; publicar receptor, worker e clientes. Ativar job/nudge por último, após verificar receptor e preservação de dados. Expected: destino comercial permanece `dash`; nenhum segredo público e nenhuma alteração de aprovação.
- [ ] Rodar backfill idempotente em páginas de200, registrar recibos e reconciliar IDs originais da fonte com outbox/inbox/projeção. Confirmar uma captura sintética medida até a leva e uma atualização posterior; não aprovar um lead real para testar. Expected: fila recuperada, estados conferidos e atraso medido, sem chamar a integração de ativa antes dessa prova.
- [ ] Registrar release, versões, contagens, falhas recuperáveis e limites de prova. Reversão: desativar job/nudge e emissão, mantendo eventos e filas; cliente anterior pode usar RPC antiga. Commit: `docs(traffic): record verified site lead delivery and recovery`.

## Autorrevisão e método

Cobertura: origem/contexto →1/2/4/5; entrega/ACK/repetição →1/2/3/6; captura posterior →2/4/5; horários/levas/revisão →1/5/6; históricos →2/6; segurança/ativação/reversão →1/3/6. Os cinco focos possuem casos explícitos. Contrato de evento, identidade canônica, estados do recibo e nomes das RPCs são únicos ao longo do plano.

O plano respeita o estado remoto extra da fonte e conserva os triggers internos. Limite de transporte não apaga payload: um evento grande fica identificado para recuperação, com o contato inicial já disponível. O método nativo está preservado. Próxima etapa: usuário revisar este plano escrito; depois, execução contínua, com uma revisão independente ao final.
