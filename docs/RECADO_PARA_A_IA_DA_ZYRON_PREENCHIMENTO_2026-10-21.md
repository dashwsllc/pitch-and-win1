# Recado para a IA da Zyron: leads sem cadastro (`prospect_context`) e duas mudanças no conteúdo

**Decisão do dono (22/10/2026):** o time da wsltda.com passa a poder **escolher** quais leads do CRM que ainda não se cadastraram na VOXEN são enviados (botão "Enviar para a VOXEN" no lead, ou seleção de vários numa seção do CRM). Quem for escolhido **fica em sincronia**: cada mudança no lead vira uma versão nova do mesmo registro. Quem não for escolhido nunca sai. Quando o lead se cadastra na VOXEN, o fluxo de sempre (`athlete_context`, pelo `funnel_leads.id`) assume sozinho. A primeira remessa será de cerca de 127 leads (109 com respostas do formulário e 18 só com notas), escolhidos de uma vez pelo dono.

**Não mude nada além do que está aqui e não peça segredo ao dono.** O que existe hoje (v1.1, 211 atletas entregues) continua igual, com as duas mudanças de conteúdo da seção 3.

## 1. Novo tipo de evento: `kind: "prospect_context"` (contrato v1.2, aditivo; `schema_version` continua 1)

Mesmo envelope, mesma assinatura HMAC-SHA256 (`timestamp + "." + corpo`), mesmo endpoint, mesmos blocos opcionais do v1.1. Diferenças para o `athlete_context`:

| Campo | `athlete_context` (hoje) | `prospect_context` (novo) |
|---|---|---|
| `source_lead_id` | `funnel_leads.id` da VOXEN | **`crm_leads.id` do dash. Não existe na VOXEN. Não valide contra `funnel_leads`.** |
| `source_revision` | 1, 2, 3… | 1, 2, 3… **a cada mudança do lead (a revisão nova substitui o estado anterior desse `source_lead_id`)** |
| `link.crm_lead_id` | id do lead do CRM, quando existe | **igual a `source_lead_id`** (é a chave para juntar com o atleta, ver abaixo) |
| `link.basis` | regra do vínculo | `"lead do CRM sem cadastro na VOXEN"` |
| `link.form_lead_id` | id do formulário, ou `null` | id do formulário do lead, ou `null` (lead criado à mão sem formulário) |

Exemplo (valores fictícios; nenhum telefone, e-mail, UTM, campanha nem consentimento vai):

```json
{
  "schema_version": 1,
  "kind": "prospect_context",
  "event_id": "11111111-1111-4111-8111-111111111111",
  "source_project": "mbzwchnxtskysqplqiyy",
  "source_lead_id": "22222222-2222-4222-8222-222222222222",
  "source_revision": 1,
  "generated_at": "2026-10-22T00:10:00.000Z",
  "link": { "basis": "lead do CRM sem cadastro na VOXEN", "form_lead_id": "33333333-3333-4333-8333-333333333333", "crm_lead_id": "22222222-2222-4222-8222-222222222222" },
  "profile": { "position_category_raw": "Meia, sub-17" },
  "context": { "goal": "…" },
  "structured": { "athlete_name": "…" },
  "guardian": { "name": "…" },
  "crm": { "observations": "…" },
  "notes": [ { "type": "whatsapp_summary", "content": "…", "created_at": "2026-10-20T14:00:00Z" } ],
  "answers": [ { "question": "…", "answer": "…" } ]
}
```

Todos os blocos depois de `link` são opcionais e só vão quando têm valor (há leads só com `notes`). A primeira versão de um lead escolhido sai na hora; as seguintes esperam cerca de 45 s (mudanças próximas viram uma versão só). A entrega é de no máximo 20 eventos por minuto.

## 2. O que o receptor precisa fazer

1. **Reconhecer `prospect_context`** e guardar como **pré-cadastro**, chaveado por `source_lead_id`, **somente para a equipe**. Não crie atleta, membro, `funnel_lead`, tarefa de abordagem, notificação, e-mail nem WhatsApp a partir dele. Boa parte são menores e **nunca** viram contato automático.
2. **Substituir** o estado do pré-cadastro a cada `source_revision` maior (uma nota apagada ou editada some da versão seguinte). Responder `200` com `ok:true`, o mesmo `event_id`, um `receipt_id` uuid e `status: "applied"` (ou `waiting_member`). Idempotente por `event_id` (`duplicate`); revisão antiga que chega depois da nova é `superseded`.
3. **Nunca responder `quarantined` para este tipo.** A fila do dash trata `quarantined` como entregue e **não reenvia**, então um `quarantined` seria perda silenciosa de dado. Se ainda não sabe guardar o tipo, devolva `400`: o dash bloqueia o evento e reenvia depois que você avisar.
4. **Juntar ao atleta quando ele se cadastrar:** quando chegar um `athlete_context` com `link.crm_lead_id` igual ao `source_lead_id` de um pré-cadastro, ligue os dois. O evento normal traz o contexto completo e atual e substitui o do pré-cadastro. A partir daí o dash não envia mais versões de pré-cadastro desse lead.
5. **Quando a equipe pára de sincronizar um lead**, o dash simplesmente não envia mais versões. Não existe evento de exclusão: o que já foi enviado fica com a VOXEN, e quem decide o descarte é você.
6. **Dizer onde e como a equipe vê o pré-cadastro** (tabela, tela, se há aviso de que é um registro de CRM e não um atleta).

## 3. Duas mudanças de conteúdo que valem também para o `athlete_context`

- **Observação gerada pelo sistema não sai mais.** Ao criar o lead a partir do formulário da Meta, o CRM grava sozinho em `observations` três linhas ("Formulário Meta <id> · campanha <nome da campanha>", "Meta lead ID: <id>", "Respostas do formulário no painel Contexto deste lead."). Isso carrega o nome da campanha e IDs da Meta, que o contrato A.4 não deixa sair. Agora `crm.observations` leva só o texto que uma pessoa digitou (muitos leads ficam sem `crm.observations`). **Cerca de 53 atletas já entregues receberão uma revisão nova sem essas linhas**; pela regra de substituição, o conteúdo antigo deles na VOXEN é trocado.
- **Pergunta nova de formulário vai sozinha.** Hoje só as 11 perguntas conhecidas vão em `answers`. Daqui para frente toda pergunta de um formulário novo ou alterado também vai em `answers` (`question` = texto da pergunta, `answer` = resposta), **sem filtro de assunto**, sempre depois das 11 conhecidas e na ordem do formulário. Continuam fora: nome, e-mail e telefone/WhatsApp (campos de contato), e telefone ou e-mail digitados dentro de qualquer texto livre continuam virando `[contato removido]`. Respostas com mais de 4000 caracteres são cortadas.

## 4. Como a wsltda.com confere antes de enviar

O dash **só libera o envio** depois que **um evento de ensaio** receber recibo `applied` ou `waiting_member`. O ensaio tem o mesmo `kind: "prospect_context"`, `link.basis: "teste de integração"`, um `source_lead_id` aleatório que não existe no CRM e o texto "Teste de integração — não abordar". Pode descartá-lo depois. Com `quarantined`, `duplicate` ou erro, o botão de envio fica desativado. Depois do ensaio aceito, o dono escolhe os leads pelo CRM.

Responda: (a) aceita o tipo e guarda como descrito (inclusive substituir por revisão)? (b) qual status devolve? (c) onde a equipe vê? (d) alguma chave do exemplo você prefere de outro jeito? Avise quando o receptor estiver pronto.
