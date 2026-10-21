# Prompt para a IA que mantém a wsltda.com

> Cole este arquivo inteiro numa sessão do Claude Code aberta na pasta `pitch-and-win1` do seu projeto da wsltda.com (`Documents\ChatGPT\Dashboard - WS\pitch-and-win1`). Ele é autossuficiente: já traz o contrato.

## Estado em 2026-10-21 (o lado da VOXEN já está pronto)

- **O receptor está no ar**: `POST https://mehmqibxzxfqdxqjnjad.supabase.co/functions/v1/crm-context-receiver`. Ele confere a assinatura, a janela de 300 s e o formato, limpa o evento pela lista fechada (as perguntas proibidas também são descartadas do lado da VOXEN) e aplica.
- **O segredo já está cadastrado nos dois projetos**, com o mesmo valor, como secret das edge functions: `CRM_BRIDGE_SHARED_SECRET` (no dash e na VOXEN). **Não peça o valor ao dono e não o escreva em lugar nenhum.** A função de entrega lê com `Deno.env.get("CRM_BRIDGE_SHARED_SECRET")`. Se o desenho exigir o segredo também no Vault (por exemplo, para o cron), copie de dentro do projeto, sem o valor passar pela conversa.
- **Como conferir a assinatura sem gravar nada na VOXEN**: envie um corpo assinado com `"schema_version": 2`. A resposta certa é `400 {"ok":false,"error":"schema_version precisa ser 1."}`, porque a assinatura passou e o formato foi recusado. `403` quer dizer assinatura ou horário errados.
- **Vetor de teste (segredo fictício, só para os testes automáticos)**: segredo `segredo-de-teste-nao-usar-em-producao`, timestamp `1761048000`, corpo `{"schema_version":1,"kind":"athlete_context"}` → assinatura `sha256=a7684d70173bdb542fda972df8d1f27c90912d28246042d297ace71c02573504`.
- **Contrato v1.1 aceito pela VOXEN (21/10/2026, o dono confirmou).** O receptor aceita `guardian`, `crm.observations`, `crm.qualification` (`goal`, `decision_maker`, `timeline`, `summary`), `notes` (tipos `whatsapp_summary`, `manual_note` e `call_transcript`, no máximo 25, 6000 caracteres cada), `context.evaluated_clubs`, `context.strengths_and_improvements`, `context.commitment_score_raw` e `structured.athlete_name`. Chave que ele não conhece continua sendo descartada em silêncio, sem `400`. Telefone e e-mail digitados em texto livre são trocados por `[contato removido]` também do lado da VOXEN.
- **Respostas da VOXEN**: lead que ainda não é membro na VOXEN volta `waiting_member` e é aplicado sozinho quando virar membro. Lead que a VOXEN não conhece volta `quarantined`. Em ambos os casos é `200`: marque como entregue e não tente de novo.

## Cadeia de ligação (a confirmar na Fase 0)

```
VOXEN funnel_leads.id
  = site_import_events.source_lead_id
  → site_import_events.meta_form_lead_id          (registro do site, entry_channel='website')
  → meta_form_leads.answers_form_lead_id          (registro do formulário, com field_data = respostas)
  → crm_leads.meta_form_lead_id / crm_lead_contexts   (só se o SDR já aprovou o lead)
```

Em resumo: a plataforma wsltda.com precisa passar a **enviar, sozinha e de forma segura, para o painel da Zyron (VOXEN, aizyron.com/voxen)**, o contexto de cada atleta que veio do formulário do Meta (nascimento, posição e categoria, clube atual, histórico). Hoje esse contexto só existe aqui.

## Contrato v1

### A.1 Transporte e autenticação

- `POST https://mehmqibxzxfqdxqjnjad.supabase.co/functions/v1/crm-context-receiver` (função **nova da VOXEN**, `verify_jwt = false`, autenticada só pela assinatura).
- Cabeçalhos: `content-type: application/json`, `x-crm-timestamp` (segundos Unix, 10 a 12 dígitos) e `x-crm-signature: sha256=<hex>`.
- Assinatura: `HMAC-SHA256(segredo, timestamp + "." + corpo_UTF8_exato)`. O receptor recusa se o horário diferir mais de 300 s ou se a comparação (em tempo constante) falhar. O corpo é assinado exatamente como enviado, sem reserializar.
- Segredo: `CRM_BRIDGE_SHARED_SECRET`, **novo**, diferente do `SITE_BRIDGE_SHARED_SECRET`. Existe só em secrets/Vault dos dois projetos; nunca em repositório, `.env` versionado, log ou chat.
- Corpo: até 1 MiB.

### A.2 Evento

```json
{
  "schema_version": 1,
  "kind": "athlete_context",
  "event_id": "<uuid v4, novo a cada revisão>",
  "source_project": "mbzwchnxtskysqplqiyy",
  "source_lead_id": "<funnel_leads.id da VOXEN>",
  "source_revision": 1,
  "generated_at": "<ISO 8601 UTC>",
  "link": { "basis": "<regra do vínculo no dash>", "form_lead_id": "<uuid no dash>", "crm_lead_id": "<uuid ou null>" },
  "profile": {
    "birth_date_raw": "texto exato",
    "state_raw": "texto exato",
    "position_category_raw": "texto exato",
    "current_club_raw": "texto exato",
    "filled_by_raw": "texto exato"
  },
  "context": {
    "past_clubs": "texto exato",
    "trials": "texto exato",
    "opportunities_received": "texto exato",
    "goal": "texto exato",
    "blocker": "texto exato"
  },
  "structured": {
    "athlete_name": "...", "athlete_birth_date": "AAAA-MM-DD", "athlete_position": "...",
    "athlete_height_cm": 0, "athlete_weight_kg": 0, "athlete_age": 0, "city_state": "..."
  },
  "answers": [ { "question": "texto exato da pergunta", "answer": "texto exato da resposta" } ]
}
```

- Só vão chaves com valor. `structured` só existe se o lead já está em `crm_leads` (campos que o SDR corrigiu valem mais que o texto livre).
- Valores `*_raw` e `answers` vão **como o atleta escreveu**. O dash não interpreta nem corrige: a normalização (posição, categoria, data) é da VOXEN, que é dona da taxonomia.
- `source_revision`: número inteiro que cresce a cada mudança relevante daquele lead. Mudanças dentro de 30 a 60 s se juntam numa revisão só.

### A.3 Resposta, erros e idempotência

- `200 { "ok": true, "receipt_id": "...", "event_id": "...", "status": "applied|waiting_member|superseded|duplicate|quarantined" }`: o dash marca como entregue.
- `403` assinatura ou horário; `400` formato; `413` tamanho; `409` mesmo `event_id` com corpo diferente; `429/5xx/rede`: **tentar de novo** com o mesmo `event_id` e o mesmo corpo, com recuo (1 min, 5 min, 30 min, 2 h, 6 h).
- Idempotência: `(source_project, source_lead_id, source_revision)` é único. Revisão mais antiga que a já aplicada volta `superseded`. Lead que ainda não é membro na VOXEN volta `waiting_member` e é aplicado quando virar.
- O dash guarda cada tentativa e resposta (recibo) e mostra a fila e os erros para o Executive.

### A.4 Lista fechada de dados

**Pode sair (somente isto):** as chaves de A.2. A lista de perguntas em `answers` exclui as da lista abaixo.

**Nunca sai** (se houver dúvida, não envia): telefone, e-mail, nome de responsável, nota de compromisso, temperatura/aquecimento e o motivo dele, classificação por DDD/região, anúncio, campanha, plataforma, UTM, consentimentos, `observations`, `qualification_*`, `followup_*`, pagamentos, assinaturas, valores, `crm_lead_contexts` dos tipos `whatsapp_summary` e `manual_note`, `import_snapshot`, qualquer dado de Arena, metas, vendas, comissões e usuários.

Os atletas são, em boa parte, menores de idade. A VOXEN grava o `context` e as `answers` **somente para a equipe**; o atleta nunca lê.

## Tarefa

Você vai construir, no dash (projeto Supabase `mbzwchnxtskysqplqiyy`), uma **ponte de saída** que envia o contexto dos atletas à VOXEN (projeto `mehmqibxzxfqdxqjnjad`). Siga o `AGENTS.md` do repositório (Superpowers, TDD, verificação antes de concluir). Leia primeiro, nesta ordem: `AGENTS.md`, `docs/TRAFEGO_SITE_VALIDACAO_2026-10-13.md`, `docs/CRM_RESPOSTAS_FORMULARIO_VINCULO_2026-10-15.md`, `supabase/functions/site-lead-receiver/index.ts`, `supabase/functions/_shared/site-bridge-protocol.ts` e a migration `20261013183108_site_lead_import_receipts.sql`. O contrato está na seção "Contrato v1" logo acima. **Não mude o contrato sozinho**: se achar um problema, pare e descreva.

Regras: nada de `db push`, reset ou reaplicação geral (o histórico remoto de migrations diverge do checkout). Migrations aditivas e aplicadas pelo mesmo estilo de scripts `preflight`/`apply` do repositório. Nenhum segredo no Git, no frontend, em log ou na conversa. Não altere dados existentes, telas, permissões nem a ponte VOXEN → dash que já funciona. A automação nunca pode impedir o fluxo atual de leads: toda falha dela é capturada e registrada, sem derrubar a transação principal.

**Fase 0, somente leitura (relate no chat antes de escrever código)**
1. Confirme a cadeia de ligação descrita acima, em "Cadeia de ligação" (nomes reais de tabelas e colunas; como o id do lead da VOXEN aparece em `site_import_events` e no registro `meta_form_leads` do site).
2. Conte, **sem exibir nome, telefone ou e-mail**: eventos do site recebidos; quantos têm `answers_form_lead_id`; quantos desses têm `field_data` com as perguntas de posição/categoria, nascimento, clube atual, clubes que representou e avaliações; quantos já estão em `crm_leads`.
3. Liste as perguntas distintas dos formulários (só o texto das perguntas) e proponha o mapeamento para `profile` e `context`. Pergunta que você não consiga classificar com segurança fica só em `answers`.
4. Diga como vai gerar `source_revision` (crescente por lead) e onde vai detectar mudanças (ligação criada, `field_data` atualizado, campos `athlete_*` de `crm_leads` alterados).
5. Proponha o nome das peças novas. Aguarde o ok do dono.

**Fase 1, banco (migration aditiva)**
- Tabela de fila `crm_context_outbox` (id do evento, `source_lead_id`, `source_revision`, `payload jsonb`, estado, tentativas, `lease`, próximo envio, resposta do receptor), única por `(source_lead_id, source_revision)`; tabela de controle `crm_context_delivery_control` com `enabled = false`.
- Funções `enqueue`, `claim`, `ack`, `fail`, `backfill` (com cursor, retomável, com modo só contagem) e `health`, no modelo de `funnel_outbox_*` da VOXEN (`supabase/migrations/20261013183641_funnel_lead_outbox.sql`, no repositório `C:\Users\Me\Downloads\voxen\vide-match`, se tiver acesso).
- Gatilhos que enfileiram **dentro de bloco `EXCEPTION`** (falha vira registro, nunca erro para quem salvou o lead). Junte mudanças em 30 a 60 s numa revisão.
- A montagem do `payload` fica numa função única que **só** conhece as chaves permitidas (lista fechada, A.4).
- RLS: fila e controle sem acesso para `anon`, `authenticated` e `service_role` direto; só funções `SECURITY DEFINER`. O Executive lê a saúde da fila por uma RPC.

**Fase 2, função de entrega**
- Edge function `voxen-context-delivery` no padrão de `funnel-lead-delivery` da VOXEN: autenticada por segredo de cron, `claim`, assinatura HMAC (A.1), `POST`, `ack` ou `fail` com recuo, prazo total de 45 s e tempo limite de 5 s por chamada.

**Fase 3, agendamento**
- `pg_cron` + `pg_net` + Vault, como em `20261011170000_meta_worker_cron.sql`. **Nasce desligado** (`enabled = false`). A ativação é um passo manual separado, depois do ensaio.

**Fase 4, testes (escreva antes de implementar)**
- Banco descartável (padrão `scripts/verify-*-db.mjs`): idempotência, ordem de revisões, junção de mudanças, falha do gatilho sem afetar o lead, `claim` concorrente.
- Teste do `payload`: para cada atleta de ensaio, o JSON **não contém** nenhuma chave nem texto da lista "Nunca sai"; falhe se aparecer.
- Teste da assinatura contra o vetor de teste que o dono fornecer, replay fora da janela, corpo adulterado.
- Modo só contagem do backfill, sem enfileirar nada.

**Fase 5, ensaio e ativação (cada passo só com ok do dono)**
1. Aplicar migration (`preflight`, depois `apply`) e publicar a função. Cron desligado.
2. Enviar **um** evento sintético (identificado como "Teste de integração — não abordar") a um lead de teste combinado com a VOXEN. Conferir o recibo.
3. Ligar o cron. Acompanhar a fila.
4. Backfill em lotes pequenos, com o dono acompanhando as contagens.

**Entrega**: arquivos criados, comandos rodados e resultado de cada um, contagens da Fase 0 (sem dados pessoais), o que não pôde ser verificado, e como reverter (desligar o cron, `DROP` das peças novas). Não faça commit nem deploy sem o dono pedir.
