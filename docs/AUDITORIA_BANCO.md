# O que você precisa fazer

Pendências da auditoria de 10/09/2026. O código já está corrigido, commitado e
no ar. O que sobrou depende de você, e são três ações.

---

## 1. Aplicar a migração no banco

**Por quê:** corrige a comissão pendente que sempre aparece como R$ 0,00, fecha
uma função de log aberta a qualquer usuário logado e conserta a origem do card
"Total de Vendedores" que mostrava 90 onde existem 12.

**Antes:** a migração apaga 123 linhas órfãs de `user_roles`. O backup completo,
com todas as dez colunas, já está salvo em
`.verification.local/backup-user_roles-orfaos-2026-09-10.json`.

**Comando:**

```sh
cd "C:\Users\Me\Documents\ChatGPT\Dashboard - WS\pitch-and-win1"
npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file supabase/migrations/20260910050000_audit_fixes.sql
```

**Não use `supabase db push`.** O histórico remoto diverge do local e um push
geral quebra o ambiente.

**Conferir depois:** rode as consultas comentadas no fim do arquivo da migração.
Os três valores têm que ser zero.

O SQL já foi validado contra o banco real numa transação com `ROLLBACK` e
passou. Falta só executar para valer.

---

## 2. Ligar a proteção contra senhas vazadas

**Por quê:** hoje está desligada. Com ela, o Supabase recusa senhas que já
apareceram em vazamentos conhecidos, checando contra o HaveIBeenPwned.

**Onde:** painel do Supabase, projeto `dash`, menu Authentication, seção de
proteção contra abuso. É um botão.

Não dá para fazer por SQL nem por linha de comando.

---

## 3. Religar o deploy automático (opcional)

**Por quê:** o `deploy.bat` promete que o push atualiza o site, mas isso não
acontece. O Vercel não está conectado ao GitHub, e todo deploy hoje é manual.

**Comando, uma vez só:**

```sh
npx vercel git connect
```

Enquanto não fizer isso, cada publicação precisa de:

```sh
npx vercel --prod
```

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

# O que a migração faz, em detalhe

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
segurança. Verifiquei antes de revogar: nenhuma função do banco e nenhuma tela
chamam essa função.

**3. `user_roles` ganha a chave estrangeira que faltava.** É a única tabela com
`user_id` sem chave estrangeira para `auth.users`. As irmãs `profiles`,
`abordagens` e `vendas` têm, todas com `ON DELETE CASCADE`. Por isso só ela
acumulou papéis de contas removidas: 123 linhas órfãs para 13 contas reais. A
exclusão alcança apenas linhas cujo `user_id` não existe em `auth.users`.

---

# Depois de aplicar

Rode a bateria completa. Tudo tem que continuar passando.

```sh
npx tsc -b --pretty false
npm run build
node scripts/check-executive-db.mjs --deployed
node scripts/check-crm-db.mjs --deployed
node scripts/check-products-db.mjs --deployed
npm run security:check
```

---

# Um aviso, para não seguir o linter às cegas

O linter do Supabase aponta 29 funções `SECURITY DEFINER` expostas a usuários
logados. **Isso é esperado neste desenho e não deve ser "corrigido".** Cada uma
dessas funções começa com a própria verificação de autorização, e 44 políticas
de RLS chamam `is_executive`. Revogar o `EXECUTE` delas quebraria o acesso ao
banco inteiro.
