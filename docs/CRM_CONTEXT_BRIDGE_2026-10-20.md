# Ponte de saída dash → VOXEN (contexto do atleta)

Estado em 21/10/2026 (noite): **migration fechada e consistente, testada em banco descartável e em Postgres real com conexões simultâneas, e ensaiada no banco real; ainda não instalada lá**. Cron desligado, sem commit, sem deploy. O ensaio (`preflight`, desfeito) com a versão final terminou em `PREFLIGHT_OK locais_com_formulario=203 eventos_a_enfileirar=210 job_cron_ativo=false enabled=false` (210 = 203 com formulário + 7 que o CRM conhece pelo site sem formulário). Conferido por leitura: o banco real não tem as tabelas, funções, gatilhos nem os jobs da ponte. A instalação (passo 2 abaixo) foi barrada três vezes pela camada de permissões do Claude Code e fica para o dono rodar. O segredo `CRM_BRIDGE_SHARED_SECRET` já está cadastrado nos dois projetos (confirmado pela Zyron) e o receptor está no ar; o teste de assinatura do nosso lado confere com o vetor do contrato.

**Antes de ligar o cron, a Zyron precisa aceitar as chaves novas** (seção "Contrato v1.1", abaixo): o receptor foi feito para o v1 e descarta ou recusa o que não conhece.

## Contagens da Fase 0 (sem dados pessoais, 20/10/2026)

| | |
|---|---|
| Eventos do site recebidos (`site_import_events`) | 319 |
| Registros do site (`entry_channel='website'`) | 317 |
| Com formulário ligado (`answers_form_lead_id`) | 203 |
| Desses, com as perguntas de posição/categoria, nascimento, clube atual, clubes que já representou e avaliações | 203 (todos) |
| Com lead no CRM | 35: 15 pelo lado do site e 20 pelo lado do formulário, sem sobreposição |
| Com `athlete_*` preenchido no CRM (geram `structured`) | 15 |
| Formulários no total | 729, todos com as mesmas 11 perguntas + 4 campos de contato |

(O relatório da Fase 0 dizia "15 já no CRM": contava só o lado do site. O `payload` procura o lead pelos dois lados.)

## O que faz

Quando um registro do site (`site:zyron:<id da VOXEN>`) está ligado ao seu formulário Meta (`answers_form_lead_id`), a ponte monta o contexto do atleta, enfileira e entrega assinado (HMAC) ao `crm-context-receiver` da VOXEN. Mudanças dentro de 45 s (teto de 5 min) viram uma revisão só.

## Escopo: quais jogadores a ponte cobre (medido no banco real em 21/10, só contagens)

O contexto de um jogador do CRM (ícone laranja, `crm_context_summary`) vem de quatro caminhos. A ponte acha as respostas do formulário por todos eles: lead ligado ao registro do site, lead ligado direto ao formulário (aba Importações), lead criado à mão e ligado por WhatsApp (`crm_form_answer_links`) e registro do site já ligado ao formulário mesmo sem lead no CRM.

| | |
|---|---|
| Leads no CRM (todas as abas) | 176 |
| Com contexto marcado | 143 |
| …com respostas do formulário | 125 |
| ……com ID da VOXEN (**endereçáveis**: viram eventos) | 55 (15 pelo site, 20 pelo formulário ligado ao site, 20 criados à mão) |
| ……**sem ID da VOXEN** | 70 (49 de formulário, 21 criados à mão) |
| …sem respostas (só notas de atendimento) | 18 (17 com nota de WhatsApp, 6 com nota manual) |
| Registros do site ligados a formulário (viram eventos mesmo sem lead no CRM) | 203 |

**Por que 70 ficam de fora:** o contrato identifica o atleta pelo `source_lead_id`, o ID do atleta no funil da VOXEN (`funnel_leads.id`), que o dash só conhece pelo registro do site (`site:zyron:<id>`). Desses 70, 68 não têm nenhum registro do site com o mesmo WhatsApp: nunca passaram pelo funil da VOXEN, então não existe atleta lá para receber o contexto. Só 2 poderiam ser recuperados por casamento de WhatsApp. Quando um deles chegar ao site e o vínculo automático ou a confirmação manual (`site-form-link.mjs confirm-site`) ligar os registros, a ponte envia sozinha.

**Notas de atendimento (18 leads só com isso)** saem **quando o atleta tem registro do site** (decisão do dono em 21/10). Sem registro do site não há `source_lead_id`, então esperam o ID da VOXEN. Saem as 25 notas mais recentes, em ordem cronológica, 6000 caracteres cada.

`crm_context_alignment()` (e `scripts/crm-context-bridge-status.sql`) reporta esses números a qualquer momento, mais as perguntas novas do formulário que a ponte ainda não conhece (`unmapped_questions`: hoje nenhuma; pergunta nova só é enviada depois de mapeada, para não vazar dado por engano).

## Sincronização contínua (alinhamento)

Três camadas, para o que o CRM mostra e o que a VOXEN recebe nunca divergirem:

1. **Gatilhos, na hora:** vínculo site↔formulário criado ou alterado; respostas do formulário editadas; lead aprovado (inserido no CRM); campos `athlete_*` ou `city_state` editados pelo SDR (inclui leads criados à mão e leads ligados por WhatsApp); vínculo manual criado, alterado ou removido (`crm_form_answer_links`). Mudanças em 45 s (teto de 5 min) viram uma revisão só; depois de enviada, qualquer mudança real é a revisão seguinte. Conteúdo igual nunca gera revisão.
2. **Varredura a cada 5 min (`crm_context_reconcile`, job `crm-context-reconcile`):** recalcula o payload de cada atleta ligado, em lotes de 150 com cursor, e enfileira só o que mudou. Pega o que nenhum gatilho enxerga: definição do formulário chegando depois (texto das perguntas e opções), lead apagado, gatilho que falhou. Um erro em um atleta vira contagem e registro, nunca para os outros; duas varreduras não se sobrepõem.
3. **Relatório de alinhamento (`crm_context_alignment`):** `to_enqueue` deve ser 0; qualquer valor maior é a fila desatualizada em relação ao CRM.

## Mudanças em relação ao Contrato v1 (autorizadas pelo dono em 20/10/2026)

O receptor da VOXEN precisa aceitar isto. `schema_version` continua 1; todas as chaves são aditivas e opcionais.

1. **A nota de compromisso (0–10) agora sai.** A.4 a proibia. Vai em `answers` (como as demais respostas) e em `context.commitment_score_raw`.
2. **`context` ganha 3 chaves:** `evaluated_clubs` ("Quais clubes avaliou e qual foi o resultado?"), `strengths_and_improvements` ("3 principais características… e o que precisa melhorar") e `commitment_score_raw`. Essas respostas também continuam em `answers`.
3. **Decisão do dono em 21/10 (ver "Contrato v1.1"):** também saem o nome do responsável, as observações e a qualificação qualitativa do lead, e as notas de atendimento (WhatsApp, manual, transcrição de call). Dado incompleto vai mesmo assim, só com as chaves que têm valor.
4. **Continua proibido (A.4):** telefone, e-mail, UTM/anúncio/campanha, consentimentos, temperatura, follow-up, `qualification_notes`, snapshots, pagamentos, vendas, usuários da equipe, autor das notas e anexos. Perguntas que o sistema não reconhece (fora das 11 conhecidas) ficam de fora. Telefone e e-mail digitados dentro de texto livre (respostas, observações, qualificação e notas) viram `[contato removido]`.

## Contrato v1.1 (o que a Zyron precisa aceitar)

`schema_version` continua 1; as chaves abaixo são **aditivas e opcionais** (só vão com valor):

```json
"guardian":  { "name": "texto", "filled_by_raw": "texto" },
"crm":       { "observations": "texto", "qualification": { "goal": "...", "decision_maker": "...", "timeline": "...", "summary": "..." } },
"notes":     [ { "type": "whatsapp_summary|manual_note|call_transcript", "content": "texto", "created_at": "AAAA-MM-DDTHH:MM:SSZ", "truncated": true } ],
"structured": { "athlete_name": "..." }
```

- `guardian.name`: quem preencheu o formulário como pai, mãe ou responsável; sem formulário, o contato do lead quando for outra pessoa que o atleta. O nome do responsável nunca vira `structured.athlete_name`.
- `structured.athlete_name` agora também existe sem lead no CRM: é o nome de quem preencheu o formulário **como atleta**. Com lead no CRM, vale o que o SDR corrigiu.
- `notes`: no máximo 25, as mais recentes, em ordem cronológica; sem autor, sem anexo. `truncated` só aparece quando o texto passou de 6000 caracteres.
- Ao receber uma nova revisão, o estado anterior daquele atleta deve ser **substituído** (uma nota apagada ou editada some da revisão seguinte).
- Os dados são sensíveis (atletas são em boa parte menores). A VOXEN deve guardar tudo **somente para a equipe**; o atleta nunca lê.
- Se a Zyron preferir recusar alguma chave, o evento volta `400` e fica `blocked` em `crm_context_health()`; o dash não reenvia sozinho.
4. Valores `*_raw` e `answers` vão como o sistema recebeu. Opção de múltipla escolha vai pelo texto da definição do formulário (`meta_form_definitions`) quando existe; sem definição, vai o identificador (`sou_o_atleta`). A VOXEN normaliza.
5. `link.basis`: a regra automática do vínculo vai como está; texto digitado por pessoa (motivo de confirmação manual) nunca sai ("confirmado manualmente").
6. **Contato digitado dentro das respostas é removido** (achado nos dados reais, ver "Verificação"): e-mail e telefone brasileiro dentro de texto livre viram `[contato removido]` (o resto do texto fica como escrito; anos como "2019 2020 2021" não são tocados). `profile.state_raw` só sai quando é texto sem dígito, sem `@`, com até 60 caracteres e sem conter o nome de quem preencheu nem do lead; `profile.birth_date_raw` só sai em `AAAA-MM-DD` ou `D/M/AAAA`. Fora disso a chave é omitida ("se houver dúvida, não envia").

Se o receptor recusar (`400`) as chaves novas, o evento fica `blocked` e aparece em `crm_context_health()`. Para voltar ao v1 puro, apague os 3 `WHEN 9/10/11` do `jsonb_object_agg` de `context` em `crm_context_payload` (as respostas seguem em `answers`) e, se quiser a nota fora também, troque `BETWEEN 1 AND 11` por `BETWEEN 1 AND 10`.

## Peças (migration `20261020120000_crm_context_bridge`)

- Tabelas `crm_context_outbox`, `crm_context_delivery_control` (`enabled=false`), `crm_context_delivery_attempts`. RLS ligado; sem acesso direto para `anon`, `authenticated` e `service_role`.
- Funções: `crm_context_payload` (única que conhece a lista fechada), `crm_context_enqueue`, `_claim`, `_ack`, `_fail`, `_requeue_blocked`, `_backfill` (padrão só contagem, com cursor), `_reconcile` (varredura), `_health` e `_alignment` (Executive e sistema), `_enqueue_synthetic` (evento de ensaio), `_delivery_invoke`, `_delivery_set_enabled`, `_reconcile_set_enabled`.
- Gatilhos `zz_crm_context_form_lead`, `zz_crm_context_crm_lead` (inclui nome, observações e qualificação), `zz_crm_context_crm_lead_delete` (lead apagado), `zz_crm_context_lead_context` (notas de atendimento) e `zz_crm_context_answer_link`: toda falha vira registro em `crm_context_delivery_control` (`trigger_error_count`, `last_trigger_error`); quem salvou o lead nunca recebe erro.
- Edge function `voxen-context-delivery` (`verify_jwt=false`, segredo de cron no cabeçalho `x-crm-cron-secret`), prazo de 45 s, 5 s por chamada, recuo 1 min / 5 min / 30 min / 2 h / 6 h. `400/403/409/413` e recibo inválido bloqueiam; `429/5xx/rede` repetem com o mesmo `event_id` e corpo.
- Jobs do pg_cron, os dois **pausados**: `crm-context-delivery` (a cada minuto) e `crm-context-reconcile` (a cada 5 min). Interruptores separados: `crm_context_delivery_set_enabled(true)` liga só a entrega; `crm_context_reconcile_set_enabled(true)` liga a varredura e só funciona com a entrega ligada. A varredura é o último passo: ligada antes, enfileiraria todos os atletas de uma vez e atropelaria o backfill em lotes. `delivery_set_enabled(false)` desliga os dois.

## Passo a passo (cada passo só com ok do dono; rode em `pitch-and-win1`)

1. **Ensaio:** `node scripts/apply-crm-context-bridge-migration.mjs preflight` gera o SQL; rode `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/crm-context-bridge-preflight.sql --output json`. Deve terminar em `PREFLIGHT_OK locais_com_formulario=… eventos_a_enfileirar=… job_cron_ativo=false enabled=false` (desfaz tudo).
2. **Instalar:** `node scripts/apply-crm-context-bridge-migration.mjs apply` e `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/crm-context-bridge-apply.sql --output json`. Uma transação: instala e registra em `schema_migrations` (reaplicar é barrado). A partir daqui os gatilhos já enfileiram mudanças reais (nada sai: cron desligado). Veja o estado a qualquer momento (somente leitura, o resultado vem no texto do erro): `npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/crm-context-bridge-status.sql --output json`. `trigger_error_count` deve ser 0.
3. **Segredos (valores nunca no Git, log ou chat):** `CRM_BRIDGE_SHARED_SECRET` **já está** nos dois projetos (a Zyron cadastrou no dash e na VOXEN com o mesmo valor); não o repita. Falta só o segredo do cron: `npx supabase secrets set CRM_CONTEXT_CRON_SECRET=<novo, aleatório> --project-ref mbzwchnxtskysqplqiyy`; no SQL, `select vault.create_secret('<mesmo valor de CRM_CONTEXT_CRON_SECRET>','crm_context_delivery_cron_secret');`. Publique: `npx supabase functions deploy voxen-context-delivery --project-ref mbzwchnxtskysqplqiyy`.
4. **Ensaio sintético:** com um lead de teste combinado com a VOXEN, `select public.crm_context_enqueue_synthetic('<source_lead_id de teste>');`, depois chame a função só para esse evento: `POST …/functions/v1/voxen-context-delivery` com o cabeçalho `x-crm-cron-secret` e corpo `{"event_id":"<id devolvido>"}`. Confira o recibo em `crm_context_outbox`.
5. **Ligar a entrega:** `select public.crm_context_delivery_set_enabled(true);` e acompanhe com o `crm-context-bridge-status.sql`.
6. **Backfill em lotes pequenos:** contagem `select public.crm_context_backfill(null,50);`; para enfileirar, `select public.crm_context_backfill(<last_id do lote anterior>,50,false);` até `done=true`. Confira o status a cada lote.
7. **Ligar a varredura contínua (último passo):** `select public.crm_context_reconcile_set_enabled(true);`. Daí em diante gatilhos (na hora) e varredura (a cada 5 min) mantêm tudo alinhado; `to_enqueue` deve ficar em 0.
8. Evento bloqueado depois de corrigir a causa: `select public.crm_context_requeue_blocked('<event_id>');`.

## Reversão

Desligar: `select public.crm_context_delivery_set_enabled(false);`. Remover tudo:

```sql
SELECT cron.unschedule('crm-context-delivery');
SELECT cron.unschedule('crm-context-reconcile');
DROP TRIGGER zz_crm_context_form_lead ON public.meta_form_leads;
DROP TRIGGER zz_crm_context_crm_lead ON public.crm_leads;
DROP TRIGGER zz_crm_context_answer_link ON public.crm_form_answer_links;
DROP TRIGGER zz_crm_context_crm_lead_delete ON public.crm_leads;
DROP TRIGGER zz_crm_context_lead_context ON public.crm_lead_contexts;
DROP TABLE public.crm_context_delivery_attempts, public.crm_context_outbox, public.crm_context_delivery_control;
DROP FUNCTION public.crm_context_scrub(text), public.crm_context_candidate_sites(), public.crm_context_sites_of_lead(uuid),
 public.crm_context_on_crm_lead_delete(), public.crm_context_on_lead_context(), public.crm_context_payload(uuid), public.crm_context_enqueue(uuid,boolean), public.crm_context_log_error(text,text), public.crm_context_touch(uuid),
 public.crm_context_on_form_lead(), public.crm_context_on_crm_lead(), public.crm_context_on_answer_link(), public.crm_context_claim(integer,integer,uuid), public.crm_context_ack(uuid,uuid,jsonb),
 public.crm_context_fail(uuid,uuid,text,timestamptz,boolean), public.crm_context_requeue_blocked(uuid), public.crm_context_enqueue_synthetic(uuid),
 public.crm_context_backfill(uuid,integer,boolean), public.crm_context_reconcile(integer), public.crm_context_health(), public.crm_context_alignment(),
 public.crm_context_delivery_invoke(), public.crm_context_delivery_set_enabled(boolean), public.crm_context_reconcile_set_enabled(boolean);
DELETE FROM supabase_migrations.schema_migrations WHERE version='20261020120000';
```

## Verificação

- `node scripts/verify-crm-context-bridge-db.mjs`: banco descartável (PGlite) com as funções reais `meta_match_name` e `meta_form_field_rank`. Cobre lista fechada do payload (nenhuma chave nem texto de A.4), mapeamento, idempotência, ordem e junção de revisões, falha do gatilho sem afetar o lead, `claim`/`ack`/`fail`, backfill só-contagem e retomável, saúde por papel, agendamento desligado, ensaio sem resíduo e instalação com registro. Checagem de mutação: vazar telefone, tirar a junção, deixar o backfill-contagem gravar e abrir a saúde a qualquer usuário fazem o teste falhar.
- **Dados reais, 20/10 (transação desfeita, só contagens):** os 203 registros do site ligados a formulário geram payload (nenhum nulo); chaves apenas as da lista fechada; as 11 perguntas saem com o texto exato da Meta (169 com as 11; 17 com 10 e 17 com 9, por não terem clubes); maior payload 3 KB (limite 1 MiB); 35 com lead no CRM, 15 com `structured` (os outros 20 não têm `athlete_*` preenchido); zero e-mail, telefone, campanha ou anúncio no payload. **Achado corrigido:** o campo `state` do Meta é texto livre e veio com telefone (16 de 203), e-mail (3) e nome de quem preencheu; agora é omitido nesses casos (`state_raw` sai em 166 de 203). As 11 perguntas e o nascimento (197 `AAAA-MM-DD`, 6 `D/M/AAAA`) estavam limpos. Coincidências que restam e são esperadas: `structured.athlete_name` igual ao nome do formulário (15; o atleta preencheu) e 2 respostas de posição em que o próprio atleta escreveu o nome.
- **Escopo e continuidade (21/10):** o teste de banco cobre lead criado à mão (aparece em `link.crm_lead_id` e `structured`, edição do SDR chega na fila, vínculo removido ou lead apagado o tira do contexto, precedência do lead ligado pelo site), gatilho do vínculo manual, varredura (gatilho desligado de propósito: a varredura recupera; lotes pequenos retomam pelo cursor e cobrem cada atleta uma vez; segunda passada não muda nada; erro não derruba), relatório de alinhamento (via site, manual ligado, só formulário sem ID da VOXEN, só nota; pergunta nova não é enviada e é listada), interruptores separados. Nove mutações a mais (ignorar `crm_form_answer_links`, tirar o gatilho do vínculo, cursor que não guarda, varredura sem trava de sobreposição etc.) são pegas pelos testes; o teste de concorrência real ganhou a sobreposição de duas varreduras.
- **Dados reais, 21/10 (transação desfeita):** o ensaio com a migration nova rodou `crm_context_alignment()` no banco real e confirmou os números da tabela de "Escopo" (203 a enfileirar, 143 com contexto, 125 com respostas, 55 endereçáveis, 70 sem ID da VOXEN, nenhuma pergunta desconhecida).
- `deno test supabase/functions/_shared/crm-context-delivery.test.ts`: 20 testes (vetor HMAC conhecido, replay fora da janela, corpo adulterado, recuo, recibos, prazo, configuração).
- `node scripts/verify-crm-context-bridge-concurrency.mjs <pasta>`: **Postgres de verdade e conexões simultâneas** (PGlite tem uma sessão só). Prepare a pasta uma vez, fora do projeto: `mkdir x && cd x && npm init -y && npm i --ignore-scripts embedded-postgres@17.9.0-beta.17 pg@8`. Cobre: 12 conexões reservando 60 eventos (nenhum evento em dois claims, nenhum perdido); `ack`/`fail` disputando o mesmo evento (só um vence); 8 conexões enfileirando o mesmo lead (uma revisão só, sem buracos); e três entrelaçamentos deterministas (uma transação segura a trava, a outra tenta). Checagem de mutação: sem `SKIP LOCKED`, sem `FOR UPDATE` no claim, sem o lock por lead no `enqueue` e sem `FOR UPDATE` no `ack`, o teste falha. Uma versão só com estresse deixava 3 dessas mutações passarem, por isso os entrelaçamentos deterministas.
- **Não verificado:** execução em produção; o receptor da VOXEN (não existe no repositório); vetor de assinatura do dono (o teste usa um vetor calculado de forma independente com `node:crypto`; troque por o do dono quando houver).
