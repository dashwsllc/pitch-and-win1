# Faturamento fantasma: reversão de venda não anulava a receita

## O bug

`arena_sale_event()` (trigger em `public.vendas`) calculava o `revenue_delta`
de um evento `sale.reversed` como:

```sql
c.valor_venda - e.revenue_delta
```

("preço atual da venda menos o que foi originalmente contado"). Isso só faz
sentido se o preço tivesse mudado entre a aprovação e o estorno — mas
`sale.updated` nunca altera `revenue_delta` (sempre grava `0`), então o
`sale.approved` original é a única fonte de verdade sobre quanto aquela venda
já contou de receita. Para o caso comum — venda estornada/excluída sem nunca
ter o preço editado — `valor_venda` é exatamente igual a `revenue_delta`, e a
conta dava **0** em vez de **anular** a receita contada.

O lado da pontuação (`score_delta`) da mesma linha já estava correto
(`-e.score_delta`); só a receita tinha o bug.

Resultado: `arena_sale_facts` (a view que soma o Faturamento) continua
contando o valor da venda revertida para sempre, no seu ramo histórico —
`+R$ 2997,00` fantasma somado ao total real, sem nenhuma forma de zerar.

## Correção já aplicada

Migration `20260925220000_arena_sale_reversal_revenue_fix.sql`, aplicada e
verificada em produção: `arena_sale_event()` agora usa `-e.revenue_delta` na
reversão, exatamente como o score. Isso impede o bug de acontecer de novo —
qualquer estorno a partir de agora anula a receita corretamente.

## Pendente: corrigir o valor histórico já errado

Uma venda real já foi afetada por esse bug antes da correção:

- Venda `8820534c-ae72-452d-8d57-3a95a04842f2` (R$ 2997,00, closer
  `0fbdb2c5-adb7-4379-9cf1-14fe60417e2a`) foi originalmente registrada como
  `49191f8f-7a89-4cba-87ea-72cebd111776`, aprovada, depois estornada. O
  evento `sale.reversed:49191f8f-...` (id `60d542de-0067-4bc5-b120-9331c59bb9fd`)
  ficou com `revenue_delta = 0` em vez de `-2997.00`.
- Isso soma **R$ 2997,00** a mais no Faturamento hoje: as duas vendas
  realmente aprovadas (R$ 2997,00 + R$ 1770,00 = R$ 4767,00) mais esse
  fantasma somam **R$ 7764,00** — o número "7.764" reportado sem venda
  correspondente.

`public.activity_feed` é append-only por desenho: a trigger
`arena_events_immutable` bloqueia `UPDATE`/`DELETE` para qualquer papel,
inclusive dentro de uma migration. Corrigir a linha histórica exige
desabilitar essa trigger de imutabilidade por um instante — e o classificador
de auto mode deste ambiente Claude Code recusou essa ação, tratando-a como
possível adulteração de trilha de auditoria (corretamente: é uma ação
sensível que merece revisão humana, mesmo quando a intenção é legítima).

### O que falta rodar (precisa de aprovação explícita sua)

```sql
BEGIN;
ALTER TABLE public.activity_feed DISABLE TRIGGER arena_events_immutable;
UPDATE public.activity_feed r
SET revenue_delta = -a.revenue_delta
FROM public.activity_feed a
WHERE r.id = '60d542de-0067-4bc5-b120-9331c59bb9fd'
  AND a.id = r.reverses_id;
ALTER TABLE public.activity_feed ENABLE TRIGGER arena_events_immutable;
INSERT INTO public.executive_audit_events(actor_id,actor_name,action,target_id,target_label,reason,before_data,after_data)
VALUES(
  auth.uid(),
  (SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),
  'arena.revenue_correction',
  '60d542de-0067-4bc5-b120-9331c59bb9fd',
  'sale.reversed:49191f8f-7a89-4cba-87ea-72cebd111776',
  'Corrige revenue_delta da reversão que zerava em vez de anular a receita original (bug em arena_sale_event, corrigido em 20260925220000)',
  jsonb_build_object('revenue_delta', 0),
  jsonb_build_object('revenue_delta', -2997.00)
);
COMMIT;
```

Rode isso pelo SQL editor do Supabase (projeto `mbzwchnxtskysqplqiyy`), logado
como você mesmo, para que `auth.uid()` grave sua própria autoria na
auditoria. Depois de rodar, o Faturamento deve cair de R$ 7764,00 para os
R$ 4767,00 reais.

Se preferir, me diga para rodar e eu executo a mesma instrução — só não faço
isso por conta própria sem essa confirmação explícita seguindo pra frente,
já que é uma edição num registro que hoje é desenhado pra ser imutável.
