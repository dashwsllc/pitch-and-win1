# Autenticação e aprovação de colaboradores

O cadastro público aceita apenas Seller. Uma sessão de autenticação permite ao
colaborador acompanhar sua solicitação em `/auth`, mas o dashboard só recebe um
usuário autorizado depois que `get_my_registration_status` confirma `approved`.
Nenhuma rota foi criada ou alterada.

## Persistência e aprovação

- A migration `20260912090000_registration_approval.sql` cria uma solicitação
  `pending` por usuário, com chave primária/FK em `auth.users.id`.
- O trigger roda na mesma transação de criação da conta. Se a solicitação falhar,
  a conta e o perfil também são desfeitos; não há envio separado pelo navegador.
- A instalação bloqueia brevemente inserções em `auth.users` para fechar a janela
  entre a carga inicial e a criação do trigger. Contas anteriores à implantação
  recebem `approved`, preservando seus acessos e permissões existentes.
- `executive_list_registration_requests` retorna todas as solicitações pendentes
  em uma resposta JSON, sem truncamento pelo limite padrão de linhas da API.
- O bloco **Cadastros pendentes**, na Central executiva, oferece Aprovar/Rejeitar.
  `executive_review_registration` exige um Executive ativo e aprovado, trava a
  solicitação e registra a decisão na auditoria. Uma segunda decisão recebe 409.
- O sinal existente `dashboard_events/users` atualiza o painel. O colaborador
  acompanha apenas sua própria solicitação via Realtime. Consultas a cada cinco
  segundos, reconexão e retorno à tela recuperam eventos perdidos. Uma conexão
  indisponível pode impedir a exibição imediata, mas não apaga a solicitação.
- Políticas RLS restritivas impedem contas pendentes/rejeitadas de acessar tabelas
  comerciais, Realtime e Storage. O hook PostgREST `check_registration_access`
  também bloqueia RPCs, exceto a consulta do próprio status. A chave de serviço
  continua restrita ao servidor; nunca deve ser usada no frontend.

O status permanece consultável após rejeição e após recarregar a página. Não há
envio de email de aprovação implementado; a mensagem de sucesso não promete email.

## Visual e acessibilidade

`Auth.css` é limitado ao seletor `.auth-page`: campos escuros/recuados, autofill
escuro, foco laranja, movimento reduzido, labels e botões de senha acessíveis.
Textos secundários foram levemente clareados e o texto do botão laranja é escuro
para garantir contraste AA sem trocar as cores do gradiente de marca.

## Verificação

As verificações de navegador usam a instalação de Playwright já disponível em
`.verification.local/node_modules/@playwright/test`. Inicie o Vite na porta 5198
ou forneça `AUTH_TEST_ORIGIN`.

```sh
node scripts/verify-auth-ui.mjs
node scripts/check-registration-db.mjs --deployed
node scripts/verify-signup-flow.mjs --run-disposable-check
npx tsc -b --pretty false
npm run build
npm run lint
npm run security:secrets
```

O teste visual isola a rede e verifica responsividade, contraste, autofill real
do Chromium, teclado, Seller fixo, validação, spinner e cadastro sem sessão.
O teste SQL usa rollback e inclui falha simulada da fila, privacidade, bloqueio de
acesso, aprovação/rejeição e conflito de decisões. O teste real cria três contas
temporárias, exercita formulário e painel no navegador, verifica API e Realtime,
e remove suas contas e registros de auditoria no encerramento.

Para uma instalação nova, execute primeiro `node scripts/check-registration-db.mjs`
(simulação com rollback) e depois `node scripts/check-registration-db.mjs --apply`.
Não reaplique a migration instalada nem use `supabase db push` indiscriminadamente.
