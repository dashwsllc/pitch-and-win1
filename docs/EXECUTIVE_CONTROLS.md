# Controles executivos — setembro de 2026

## Comportamento

- **Vendas do time** (`/vendas-time`): fila compartilhada com nome do vendedor, produto, valor e status. Dados de compradores e comissão não são retornados ao vendedor pelo feed.
- **Central executiva → Vendas**: aprovar, rejeitar ou excluir, inclusive após aprovação. Motivo obrigatório para rejeição/exclusão, verificação de estado para decisões concorrentes e auditoria com cópia anterior da venda.
- **Saques em revisão**: rejeitar solicitações não pagas com justificativa. Exclusão de venda não pode invalidar comissões comprometidas com saques. Pagamentos concluídos não são revertidos por esse painel.
- **Contas**: nome, e-mail, telefone internacional, imagem, senha, papéis, comissão, acesso a CRM/vendas e suspensão. UUID, criação e histórico de login são somente leitura. Autenticação, perfil, papéis e auditoria são alterados atomicamente pelo serviço de autenticação. Senhas nunca entram no histórico.
- **Último login**: valor original de `auth.users.last_sign_in_at`. Exibição com segundos em `America/Sao_Paulo`, original UTC disponível no detalhe. Não representa presença on-line ou abertura da página. Consulta a cada 15 segundos, no foco e por eventos; indisponibilidade é indicada explicitamente.
- **Competição**: ranking real, sem vendedores ou valores fictícios; apenas vendas aprovadas. Carrossel limitado às 10 aprovações mais recentes, com pausa manual, por interação, fora da tela e para preferência de movimento reduzido.
- **Sincronização**: `dashboard_events` envia somente tópico/revisão/horário. O socket é autenticado antes da assinatura; consultas revalidadas por evento e periodicamente como proteção contra desconexão.
- **Comissões**: aprovação congela a taxa aplicada no valor da venda, incluindo taxa zero. Pendentes não geram saldo. Reservas e pagamentos são descontados do saldo disponível.

## Instalação e manutenção

A migração `20260907180000_executive_sales_control.sql` foi aplicada ao projeto Supabase existente em uma transação. As funções `executive-update-account` e `reset-user-password` também foram publicadas. O histórico remoto anterior não é idêntico ao histórico local; reconciliar antes de um `db push` geral. Não reaplicar essa migração sobre suas próprias tabelas.

Os papéis administrativos, o último administrador ativo e o próprio acesso são protegidos no servidor. A redefinição de senha antiga encaminha a operação ao mesmo serviço auditado; contas com configurações divergentes por papel devem ser revisadas na aba Contas.

## Verificações reproduzíveis

```sh
npx tsc -b --pretty false
npm run build
node scripts/check-executive-db.mjs --deployed
node scripts/verify-executive-api.mjs --run-disposable-check
```

O teste SQL usa papéis reais `authenticated`, fixtures isoladas e `ROLLBACK`. O teste de API exige opção explícita: cria contas/venda temporárias, verifica Auth, RPC, Edge Functions, Realtime e exclusão, e remove seus próprios dados em `finally`. Requer a CLI Supabase autenticada; nenhuma chave deve ser gravada ou publicada. Não interromper a limpeza do teste de API.

Validado: privacidade do feed, permissões negativas de vendedor, suspensão, aprovação dupla, comissão zero, reserva de saque, regularização, exclusão com auditoria, conta atômica, edição desatualizada, precisão do timestamp de login, redefinição de senha, entrega de eventos e atualização do ranking. TypeScript, build e lint dos arquivos frontend alterados passaram. Isso não equivale a uma garantia universal de ausência de falhas em todos os módulos legados; não foi realizado teste visual completo em navegador nesta entrega.
