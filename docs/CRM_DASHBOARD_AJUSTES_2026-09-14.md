# Ajustes de CRM, Home e Vendas

O CRM apresenta o atleta como nome principal e o responsável como informação secundária. O formulário compartilhado de criação/edição mantém a idade no campo `crm_leads.athlete_age`. Quando existe data de nascimento válida, o CRM calcula a idade a partir dela e avisa sobre divergências com o valor manual.

A Home segue a ordem Dados ao vivo → Indicadores comerciais → Metas em andamento → Evolução comercial → Produtos. As seções de últimas vendas e acompanhamento do time aparecem depois. Aprovadas vêm antes de pendentes; rejeitadas são acessíveis somente na área administrativa. O banco também restringe a leitura das rejeitadas a administradores. O CRM conserva o vínculo da venda rejeitada para impedir um cadastro duplicado, sem oferecer a abertura dessa venda fora da administração.

## Gerenciamento de vendas

`/vendas` inclui uma lista própria de últimas vendas, com busca, filtros, paginação, edição e exclusão com confirmação. `/minhas-vendas` reutiliza o mesmo gerenciamento e mantém os indicadores de receita, comissão e saldo.

- Vendedores com acesso a Vendas editam e excluem suas vendas pendentes. Produto e valor seguem o ticket ativo.
- Administradores gerenciam as vendas da operação, incluindo aprovadas, e podem corrigir o valor efetivamente vendido. Rejeitadas permanecem na Central de vendas administrativa.
- Produto, ticket, valor, comprador e observações são alterados pela RPC `manage_sale`. O vínculo do lead, vendedor e data original são preservados.
- A revisão `updated_at` impede sobrescrever ou excluir uma venda alterada depois da abertura do formulário.
- Comissões, saldo, auditoria e sinais de atualização são gravados na mesma transação. As aprovações novas preservam a taxa em `commission_rate_applied`. Para aprovações antigas, sem taxa gravada, a primeira edição conserva a taxa efetiva da comissão existente. Edições seguintes reutilizam essa taxa para evitar arredondamento acumulado.
- Alterações financeiras e exclusões respeitam as reservas de saques existentes.
- Após uma gravação confirmada, `refreshSalesData` atualiza as consultas em cache e os componentes da Dashboard. Outros acessos mantêm a atualização automática existente de 50 segundos.
- Metas comerciais, receita, quantidade, evolução e produtos consultam as vendas aprovadas existentes. O checklist de tarefas diárias é independente das vendas.

## Exclusão de conta

O ícone de lixeira ao lado de Editar conta abre a confirmação com motivo. O diálogo fecha após uma resposta de sucesso e a lista é atualizada. A função de borda `executive-delete-account` valida o administrador e chama a RPC protegida. As proteções existentes impedem autoexclusão, exclusão de super admin por executivo comum e remoção de contas com histórico comercial/financeiro. Nesses casos, a mensagem orienta a suspensão da conta.

## Banco e publicação

A consulta de 14/09/2026 confirmou `athlete_age`, `executive_delete_account` e `manage_sale` no banco conectado. A migração `20260914120000_sales_management.sql` foi aplicada e registrada no histórico remoto. Ela inclui o acesso restrito às rejeitadas, a revisão de vendas, a taxa de comissão e a RPC de gerenciamento.

Em ambientes novos, aplicar também as migrações anteriores de idade e exclusão de conta e publicar a função de borda correspondente. As verificações SQL usam transações finalizadas com `ROLLBACK`; as verificações de interface usam uma API simulada sem gravações em produção.

## Verificação

Com o frontend local em `http://127.0.0.1:5198`:

```text
node scripts/check-sales-management-db.mjs
node scripts/verify-sales-management-ui.mjs
node scripts/verify-crm-unit.mjs
node scripts/verify-dashboard-refresh.mjs
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

O teste SQL aplica a migração provisoriamente e cobre permissões, conflitos, auditoria, vendas aprovadas/pendentes, comissões, reservas de saque, rejeitadas, CRM e exclusão de contas. Após a migração em um ambiente, usar `--deployed` para testar o esquema instalado sem reaplicá-la.

O teste de interface cobre a ordem da Home, edição e exclusão com navegação para conferir os indicadores, conflitos, cancelamento, cadastro e edição da idade, hierarquia do atleta, exclusão de conta e largura de 390 px.
