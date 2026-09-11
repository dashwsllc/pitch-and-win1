# Produtos e tickets

## Uso

- **Executive → Produtos e tickets** (`/executive?tab=products`): criar produto com primeiro ticket, editar nome/descrição, adicionar tickets e definir seus preços em reais. Produtos e tickets podem ser desativados e reativados.
- **Vendas → Produtos e tickets**: atalho para o catálogo, disponível somente para executivos. Sellers selecionam um produto ativo e um dos tickets ativos associados no registro da venda.
- O catálogo é compartilhado com todos os sellers. Alterações chegam por Realtime; consultas também são revalidadas no foco da janela e a cada 50 segundos como proteção contra desconexão.
- Produtos desativados e produtos sem tickets ativos ficam indisponíveis para novas vendas. Desativar não apaga históricos.
- O banco valida a relação produto/ticket e o preço. Um valor diferente do catálogo é rejeitado. Se o preço mudar no formulário aberto, a interface mostra o novo valor e um aviso. Se mudar durante o envio, a operação falha e o seller precisa conferir o valor e enviar novamente.
- Nome do produto, nome do ticket e preço são preservados na venda. Edições posteriores no catálogo não alteram vendas pendentes/aprovadas, comissões ou saldos anteriores. O nome do ticket aparece em Minhas Vendas e no quadro de vendas.
- Criar um produto e seu primeiro ticket é uma operação atômica. Edições exigem a revisão carregada no formulário; um conflito retorna HTTP 409 e exige reabrir a edição com os dados atuais.
- Apenas EXECUTIVE/SUPER ADMIN não suspensos podem gravar via RPC. Sellers não podem criar produtos, editar preços ou adulterar valores de vendas pela API. Auditoria registra autor, horário e valores anteriores/novos.

## Banco

As migrações do catálogo são sequenciais:

1. `20260908123000_products_catalog.sql`: estrutura inicial anteriormente aplicada ao projeto.
2. `20260908190000_complete_products_catalog.sql`: cadastro atômico, preservação das vendas, bloqueios de concorrência, leitura para sellers e os dois produtos/oito valores anteriormente presentes na interface.
3. `20260908193000_catalog_conflict_responses.sql`: conflitos comerciais retornam HTTP 409, evitando que sejam tratados como falhas transitórias do banco.

Aplicadas ao projeto Supabase `mbzwchnxtskysqplqiyy`. Não reaplicar migrações já registradas. O histórico remoto antigo difere do local; não usar `db push` geral sem reconciliar os históricos.

## Verificação

```sh
npx tsc -b --pretty false
npm run build
node scripts/check-products-db.mjs --deployed
npm run security:secrets
```

O teste SQL utiliza papéis reais `authenticated`/`anon`, fixtures isoladas e `ROLLBACK`. Verifica criação atômica, preços inválidos, duplicidade, permissões, suspensão, referências cruzadas, adulteração por INSERT/UPDATE, conflitos de edição, desativação, auditoria, sinal de sincronização, aprovação e comissões preservadas.

Para o teste de navegador/API, instale o runner no diretório ignorado e inicie o app:

```sh
npm install --no-save --package-lock=false --prefix .verification.local @playwright/test
node .verification.local/node_modules/playwright/cli.js install chromium
npm run dev -- --host 127.0.0.1 --port 5197 --strictPort
node scripts/verify-products-ui.mjs --run-disposable-check
```

O script exige a CLI Supabase autenticada. Cria contas temporárias sem enviar e-mails, abre sessões isoladas de executivo/seller e valida UI + API + Realtime. Remove somente seus produtos, tickets, vendas, auditoria e contas em `finally`. Não interromper sua limpeza. `CATALOG_TEST_ORIGIN` permite testar a versão publicada. Capturas ficam em `.verification.local`.

Durante a verificação de compilação foram corrigidas consultas antigas de metas/saques e a tipagem do campo de senha atual, preservando o comportamento de autenticação existente.

Validado em 08/09/2026 no ambiente local e no domínio de produção `https://wsltda.site`: fluxo completo em sessões separadas de executivo/seller, recebimento do evento Realtime, edição de preços, desativação/reativação, proteção de rotas e layout em 1440 px e 390 px. TypeScript, build, lint dos arquivos alterados, teste SQL, 16 casos de conversão monetária, varredura de segredos e auditoria de dependências passaram. Fixtures foram removidas.

A hospedagem utiliza `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PROJECT_ID` configuradas no ambiente Production da Vercel. O build da Vercel rejeita conexão ausente/inválida antes da publicação. `.vercelignore` exclui `.env`, capturas, testes locais gerados e dependências do envio. Nunca configurar uma chave `service_role` como variável `VITE_*`.
