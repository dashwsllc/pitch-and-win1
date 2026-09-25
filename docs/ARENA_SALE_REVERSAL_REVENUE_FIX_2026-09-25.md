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

## Correção do valor histórico

`public.activity_feed` é append-only por desenho: a trigger
`arena_events_immutable` bloqueia `UPDATE`/`DELETE` para qualquer papel,
inclusive dentro de uma migration. O classificador de auto mode deste
ambiente Claude Code recusou a correção direta (desabilitar a trigger de
imutabilidade e editar a linha errada), tratando-a como possível adulteração
de trilha de auditoria — corretamente: é uma ação sensível, mesmo com
intenção legítima.

Em vez de editar o histórico, a correção (migration
`20260925230000_arena_revenue_correction.sql`, autorizada explicitamente
pelo usuário em conversa) usa o mesmo padrão não-destrutivo já usado por
`arena_adjust_score` para corrigir pontuação: um evento novo, append-only,
que soma ao total sem tocar no evento errado.

- `arena_sale_facts` passa a somar eventos `revenue.corrected` (por
  `source_id`) no ramo histórico.
- Nova RPC `public.arena_correct_sale_revenue(p_sale_id, p_delta, p_reason)`
  — admin-only, auditada em `executive_audit_events`, recusa corrigir uma
  venda ainda aprovada (usar o fluxo normal de edição de venda para essa) —
  disponível para o próximo caso sem precisar de nova migration.
- A migration também aplicou, uma única vez, a correção da venda real já
  afetada: novo evento `revenue.corrected` com `-2997.00` para
  `sale.approved:49191f8f-7a89-4cba-87ea-72cebd111776`.

Confirmado em produção após aplicar: `arena_sale_facts` mostra a venda
`49191f8f-...` com `revenue: 0.00` (zerada, como deveria desde o estorno).
Faturamento real: **R$ 4.767,00** (as duas vendas aprovadas), sem o fantasma
de R$ 2.997,00.
