# O que você precisa fazer

Pendências da auditoria de 10/09/2026. O código está corrigido e no ar, e a
migração de banco já foi aplicada. Sobraram **duas ações**, ambas de painel.

---

## 1. Ligar a proteção contra senhas vazadas

**Por quê:** hoje está desligada. Com ela, o Supabase recusa senhas que já
apareceram em vazamentos conhecidos, checando contra o HaveIBeenPwned.

**Onde:** painel do Supabase, projeto `dash`, menu Authentication, seção de
proteção contra bots e abuso.

Não existe como fazer por SQL nem por linha de comando. É um botão.

---

## 2. Religar o deploy automático

**Por quê:** o `deploy.bat` promete que o push atualiza o site, mas isso não
acontece. O Vercel não está conectado ao GitHub, e todo deploy hoje é manual.

**Comando, uma vez só:**

```sh
npx vercel git connect
```

Enquanto não fizer isso, cada publicação precisa de `npx vercel --prod`.

---

# Já aplicado no banco

A migração `supabase/migrations/20260910050000_audit_fixes.sql` foi aplicada e
verificada em 10/09/2026. **Não reaplique**, a parte 3 falharia porque a chave
estrangeira já existe.

| Verificação | Antes | Depois |
| --- | --- | --- |
| Linhas órfãs em `user_roles` | 123 | 0 |
| Total de linhas em `user_roles` | 138 | 15 |
| Usuários com papel | 101 | 12 |
| Chave estrangeira para `auth.users` | ausente | criada com `ON DELETE CASCADE` |
| `log_security_event` exposto a usuário comum | sim | não |
| Comissão pendente de R$ 1.000,00 a 20% | R$ 0,00 | R$ 200,00 |
| Saldo sacável de venda pendente | R$ 0,00 | R$ 0,00 |

**1. `get_pending_commission` deixou de retornar sempre zero.** A função somava
`commission_amount` das vendas pendentes, campo que `enforce_pending_sale_insert`
zera na inserção e que `dashboard_guard_sale` impede alterar fora da revisão
executiva. O card "Pendente de aprovação" em Saques nunca mostrava outro valor,
enquanto Minhas Vendas estimava pela taxa e exibia número diferente para a mesma
conta. Agora estima com a mesma taxa, a mesma linha de `user_roles` e o mesmo
arredondamento que `executive_review_sale` usa ao congelar a comissão.
`get_available_balance` não mudou: pendente continua sem gerar saldo sacável, e
o teste garante isso.

**2. `log_security_event` deixou de ser chamável por usuário comum.** Qualquer
conta logada podia inserir linhas livres em `security_audit_log` via
`/rest/v1/rpc/log_security_event`. Nenhuma função do banco e nenhuma tela
chamam essa função, o que foi verificado antes de revogar.

**3. `user_roles` ganhou a chave estrangeira que faltava.** Era a única tabela
com `user_id` sem chave estrangeira para `auth.users`. As irmãs `profiles`,
`abordagens` e `vendas` têm, todas com `ON DELETE CASCADE`. Por isso só ela
acumulou papéis de contas removidas. Era a origem do card "Total de Vendedores"
mostrar 90 onde existem 12.

O backup das 123 linhas removidas, com todas as dez colunas, está em
`.verification.local/backup-user_roles-orfaos-2026-09-10.json`, fora do controle
de versão.

---

# Decisões que ficaram com você

Coisas que encontrei mas não mexi, porque mudam comportamento visível ou a
definição de uma métrica. Nenhuma delas quebra nada hoje.

1. **Os gráficos ignoram parcialmente o filtro de período.** Os dados chegam
   filtrados pelo período selecionado, mas são agrupados em seis meses ou sete
   dias. Com "hoje" selecionado, cinco dos seis meses são sempre zero, embora o
   subtítulo diga "no período".

2. **Nomes abordados aparecem como se fossem uma contagem.** O formulário grava
   texto livre e a Central executiva exibe esse texto seguido de "pessoas
   abordadas", virando "João Silva, Maria Santos… pessoas abordadas". A taxa de
   conversão também conta registros de abordagem, não pessoas.

3. **`src/hooks/useRankingData.tsx` é código morto e errado.** Ninguém importa.
   Se alguém importar, traz um ranking com vendas pendentes e rejeitadas.
   Sugiro apagar.

4. **`deleteLead` em `useCRMLeads` também é código morto.** Exportado e nunca
   chamado. É funcionalidade planejada ou resíduo?

5. **Truncamento silencioso.** Os dashboards cortam em 1000 registros e Minhas
   Vendas em 200, sem aviso. Inofensivo com o volume atual de 85 vendas e 319
   abordagens, mas as métricas ficarão erradas sem sinal quando passar do teto.

6. **`supabase/tests/sdr_closer_crm.sql` não tem executor** e parece substituído
   pelo teste do CRM compartilhado, que passa. Apagar ou dar um executor.

7. **As Edge Functions aceitam origem `localhost` em produção** e requisições
   sem cabeçalho de origem. Não é brecha, porque a autenticação é por token e
   não por cookie, mas dá para restringir.

---

# Como conferir que está tudo de pé

```sh
npx tsc -b --pretty false
npm run build
node scripts/verify-crm-unit.mjs
node scripts/check-executive-db.mjs --deployed
node scripts/check-crm-db.mjs --deployed
node scripts/check-products-db.mjs --deployed
npm run security:check
```

O teste de controles executivos agora inclui a asserção da comissão pendente, e
falha se alguém reverter esse comportamento.

---

# Um aviso, para não seguir o linter às cegas

O linter do Supabase aponta 29 funções `SECURITY DEFINER` expostas a usuários
logados. **Isso é esperado neste desenho e não deve ser "corrigido".** Cada uma
delas começa com a própria verificação de autorização, e 44 políticas de RLS
chamam `is_executive`. Revogar o `EXECUTE` dessas funções quebraria o acesso ao
banco inteiro.
