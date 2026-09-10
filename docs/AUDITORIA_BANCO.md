# Correções de banco pendentes — auditoria de 10/09/2026

A migração `supabase/migrations/20260910050000_audit_fixes.sql` **ainda não foi
aplicada** ao projeto `mbzwchnxtskysqplqiyy`. O SQL foi validado contra o schema
real numa transação com `ROLLBACK` e passou, mas a aplicação definitiva ficou
pendente de execução manual.

## O que a migração faz

**1. `get_pending_commission` deixa de retornar sempre zero.** A função somava
`commission_amount` das vendas pendentes, campo que `enforce_pending_sale_insert`
zera na inserção e que `dashboard_guard_sale` impede alterar fora da revisão
executiva. O card "Pendente de aprovação" em Saques nunca mostrava outro valor,
enquanto Minhas Vendas estimava pela taxa e exibia um número diferente para a
mesma conta. A função passa a estimar com a mesma taxa, a mesma linha de
`user_roles` e o mesmo arredondamento que `executive_review_sale` usa ao
congelar a comissão. `get_available_balance` não muda: pendente continua sem
gerar saldo sacável.

**2. `log_security_event` deixa de ser chamável por usuário comum.** Qualquer
conta logada podia inserir linhas livres em `security_audit_log` via
`/rest/v1/rpc/log_security_event`. O `user_id` é forçado para `auth.uid()`,
então não havia como se passar por outro usuário, mas dava para poluir o log de
segurança. Nenhuma função do banco e nenhuma tela chamam essa função.

**3. `user_roles` ganha a chave estrangeira que faltava, e os órfãos saem.**
É a única tabela com `user_id` sem chave estrangeira para `auth.users`.
`profiles`, `abordagens` e `vendas` têm, todas com `ON DELETE CASCADE`. Por isso
só ela acumulou papéis de contas removidas: 123 linhas órfãs para 13 contas
reais. Era a origem do card "Total de Vendedores" mostrar 90 onde existem 12.

## Antes de aplicar

A parte 3 apaga dados. O backup completo das 123 linhas, com todas as colunas,
está em:

```
.verification.local/backup-user_roles-orfaos-2026-09-10.json
```

A exclusão é restrita a linhas cujo `user_id` não existe em `auth.users`.

## Como aplicar

Não use `supabase db push` geral: o histórico remoto diverge do local.

```sh
npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy \
  --file supabase/migrations/20260910050000_audit_fixes.sql
```

Depois, para conferir, rode as consultas comentadas no fim do arquivo. Todos os
valores devem ser zero.

Para repetir a validação sem aplicar nada, gere e rode a versão com `ROLLBACK`
como foi feito na auditoria.

## Depois de aplicar

Rode a bateria completa, que continua tendo que passar:

```sh
npx tsc -b --pretty false
npm run build
node scripts/check-executive-db.mjs --deployed
node scripts/check-crm-db.mjs --deployed
node scripts/check-products-db.mjs --deployed
npm run security:check
```

## Fora desta migração

**Proteção contra senhas vazadas está desligada** no Supabase Auth. É um botão
no painel, em Authentication, e valida a senha contra o HaveIBeenPwned. Não dá
para ligar por SQL.

**O aviso do linter sobre 29 funções `SECURITY DEFINER` expostas é esperado** e
não deve ser seguido literalmente. Toda uma delas começa com a própria
verificação de autorização, e 44 políticas de RLS chamam `is_executive`.
Revogar o `EXECUTE` dessas funções quebraria o acesso ao banco inteiro.

**O Vercel não está conectado ao GitHub.** O push não publica sozinho, apesar do
que o `deploy.bat` promete. Cada deploy exige `vercel --prod`, ou rode
`vercel git connect` uma vez para religar a publicação automática.
