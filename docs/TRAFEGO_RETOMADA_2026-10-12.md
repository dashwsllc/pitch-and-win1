# Tráfego: recuperação do token de Página — 12/10/2026

## Falha reproduzida

Os ciclos automáticos de métricas continuaram concluindo em campanha, conjunto e anúncio, mas a descoberta de formulários falhou a partir de 11/10 às 16h15 de Brasília. A Meta confirmou expiração do token de Página às 16h. Os 148 recibos já processados e os respectivos leads pendentes permaneceram preservados. `cron.job_run_details` registrava envio bem-sucedido; esse resultado sozinho não comprovava sucesso da função Edge ou da Meta.

Um diagnóstico temporário, protegido por JWT e segredo cron, usou o usuário de sistema existente para consultar apenas a Página autorizada com `fields=id,access_token`. O token retornado permitiu consultar formulários com HTTP 200. Nenhuma credencial ou resposta de lead foi retornada pelo diagnóstico.

## Correção

O worker resolve o token somente quando precisa consultar Graph. Um token de Página válido mantém prioridade após conferir sua identidade via `/me`. Quando ausente, expirado ou de outra identidade, o usuário de sistema obtém o token da Página autorizada. O resultado precisa conter o ID esperado e um token não vazio. Erros de permissão ou transporte não são ocultados pela recuperação. A resolução é compartilhada em memória entre descoberta e ingestão, por Página e requisição; uma fila vazia não consulta a Meta.

Não foram alterados secrets, permissões, schema, checkpoints ou regras comerciais. A descoberta continua com sua janela congelada, e os recibos continuam deduplicados. Falhas de autorização preservam o backoff de configuração de 60 minutos. O token de sistema continua sendo usado diretamente apenas para métricas e obtenção do token da Página.

A consulta de token por Página segue a [coleção oficial da Meta](https://www.postman.com/meta/facebook/request/tass6hw/get-specific-page-access-token). A recuperação exige que o usuário de sistema mantenha os ativos e permissões da Página; não amplia esse acesso nem substitui uma credencial de sistema revogada.

## Verificação

- O teste da expiração retornou HTTP 502 antes da correção e HTTP 200 depois, com descoberta completa e ingestão dos dois leads sintéticos.
- 63 testes de regressão Meta e três testes de modos/alternância dos jobs passaram. Deno e ESLint dos arquivos alterados passaram.
- A revisão independente confirmou identidade, allowlist e ausência de persistência de tokens. Encontrou uma perda da classificação OAuth no cenário sem token de sistema; um teste reproduziu o backoff incorreto, e a correção preservou o código 190 e o backoff original.
- A interface autenticada real carregou Desempenho, Conexão e Aprovações. A fila mostrou 148 pendentes, com os 50 mais antigos visíveis e sem erros de consulta ou console. Nenhum contato foi aprovado ou editado.
- Depois de publicar `meta-leads-reconciliation` e `meta-lead-worker`, a descoberta real retomou a janela bloqueada e retornou HTTP 200, `ok=true`, sem falhas ou timeout. O checkpoint completou a janela e liberou o lease. A interface autenticada atualizou o modo de descoberta para “Concluída”, sem recarregar a página; o histórico legado continua identificado separadamente.

O reteste real após publicação e a revisão implantada ficam registrados no relatório operacional local. Comparação com Ads Manager e um novo webhook externo continuam separados dessa prova; consultar métricas capturadas não aprova suas revisões.
