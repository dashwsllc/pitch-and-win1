# Importação manual de leads da Meta

Data: 09/10/2026.

## Usar a planilha

1. Acesse `/trafego` → **Importar leads** e selecione CSV, XLS ou XLSX.
2. Confira o mapeamento e a prévia. Colunas de contato ausentes não impedem o envio da planilha.
3. Envie o arquivo, com até 2.000 linhas.
4. Confira o resultado informado pelo servidor: cadastros no CRM, recebidos para completar, duplicatas e linhas com falha. As explicações apontam a linha do arquivo.

| Quem envia | Publicação |
|---|---|
| Executive ou Super Admin | Imediata |
| Outro usuário autorizado ao Tráfego | Após aprovação de Executive ou Super Admin |

O servidor aplica as permissões. Um colaborador não pode aprovar seu próprio lote.

## Completar um lead

Leads com responsável, WhatsApp, e-mail e dados obrigatórios do atleta válidos entram no CRM. Os demais aparecem em `/leads`, na fila **Recebidos**, para o SDR completar.

O diálogo inicia com os campos mapeados da planilha. Todas as colunas preenchidas ficam nas respostas originais, inclusive as usadas no mapeamento. A promoção para o CRM preserva as observações. Se a atualização da tela falhar depois de salvar, o aviso informa que o lead foi salvo.

## Reimportar

O ID real da Meta é usado quando existe; o prefixo `l:` é normalizado. Sem ID, o sistema gera um identificador pelo conteúdo das respostas. Renomear o arquivo ou mudar a ordem das linhas mantém esse identificador. Alterar respostas ou cabeçalhos pode gerar um novo identificador; nesse caso, a deduplicação por conteúdo não equivale à identificação da mesma pessoa.

As respostas de um registro de planilha não são sobrescritas pela entrega automática posterior do mesmo ID.

## Verificação técnica

Regressões do parser e das funções:

```powershell
node --experimental-vm-modules --test scripts/verify-meta-lead-import-regressions.mjs scripts/verify-meta-sync-regressions.mjs
npx.cmd tsc --noEmit -p tsconfig.app.json
deno check supabase/functions/meta-insights-sync/index.ts supabase/functions/meta-leads-reconciliation/index.ts supabase/functions/meta-lead-webhook/index.ts
npm.cmd run build
```

`scripts/verify-meta-lead-import-db.sql` verifica publicação imediata, aprovação, contagens, preservação e duplicatas em uma transação com rollback. Ele requer o schema atualizado e usuários existentes nos papéis usados pelos testes; não mantém registros de teste.

A migration bloqueia aplicação em projetos com antigos IDs `csv:<arquivo>:<linha>` até que seja feito um backfill de compatibilidade. O projeto vinculado foi consultado antes da aplicação e não continha lotes nem leads recebidos nesse formato.
