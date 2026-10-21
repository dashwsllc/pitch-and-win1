# Recado para a IA da Zyron (receptor `crm-context-receiver`)

Do lado da wsltda.com, a ponte está pronta e testada; falta instalar no banco (passo manual do dono) e a Zyron aceitar as chaves novas. **Não mude nada além do que está aqui e não peça segredo ao dono.**

## O que a wsltda.com vai enviar além do contrato v1

`schema_version` continua 1. Todas as chaves abaixo são opcionais e só vão quando têm valor. O dono autorizou (decisão de 21/10/2026); o texto completo está em `docs/CRM_CONTEXT_BRIDGE_2026-10-20.md`, seção "Contrato v1.1".

```json
"guardian":  { "name": "texto", "filled_by_raw": "texto" },
"crm":       { "observations": "texto", "qualification": { "goal": "...", "decision_maker": "...", "timeline": "...", "summary": "..." } },
"notes":     [ { "type": "whatsapp_summary|manual_note|call_transcript", "content": "texto", "created_at": "AAAA-MM-DDTHH:MM:SSZ", "truncated": true } ],
"context":   { "...as 5 do v1...", "evaluated_clubs": "...", "strengths_and_improvements": "...", "commitment_score_raw": "..." },
"structured": { "athlete_name": "..." }
```

`structured.athlete_name` passa a existir também sem lead no CRM (nome de quem preencheu o formulário como atleta). `notes` traz no máximo 25 notas, as mais recentes, em ordem cronológica, sem autor e sem anexo. Telefone e e-mail digitados dentro de qualquer texto livre chegam como `[contato removido]`.

## O que precisamos que o receptor faça

1. **Aceitar** essas chaves (hoje ele limpa o evento pela lista fechada do v1 e pode descartar ou recusar com `400`). Diga qual das duas coisas acontece.
2. **Guardar tudo somente para a equipe.** Os atletas são, em boa parte, menores; o atleta nunca lê `context`, `answers`, `guardian`, `crm` nem `notes`.
3. **Substituir** o estado anterior do atleta a cada nova revisão (nota apagada ou editada deve sumir na revisão seguinte).
4. Continuar devolvendo `200` com `applied | waiting_member | superseded | duplicate | quarantined`.

## Como a wsltda.com confere antes de ligar

Quando a Zyron confirmar, o dono libera, passo a passo: instalar a migration, publicar `voxen-context-delivery`, enviar **um** evento sintético ("Teste de integração — não abordar") para um lead de teste combinado com vocês, conferir o recibo, ligar a entrega e só então o backfill em lotes. Precisamos de **um `funnel_leads.id` de teste** que exista aí.

Vetor de assinatura (segredo fictício): segredo `segredo-de-teste-nao-usar-em-producao`, timestamp `1761048000`, corpo `{"schema_version":1,"kind":"athlete_context"}` → `sha256=a7684d70173bdb542fda972df8d1f27c90912d28246042d297ace71c02573504`. O código da wsltda.com gera exatamente esse valor.
