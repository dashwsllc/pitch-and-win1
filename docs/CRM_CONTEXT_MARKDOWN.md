# Arquivos de contexto do CRM

A área de importação de contexto aceita exclusivamente `.txt` (até 256 KB e
50.000 caracteres). O cliente rejeita extensões diferentes, MIME de imagem/vídeo,
dados binários e codificação ilegível, inclusive em arraste. A instrução sobre
hospedar vídeos no Google Drive e colar o link fica logo abaixo do campo.

O documento é convertido para Markdown UTF-8 antes de salvar: nenhuma marcação,
resumo ou cabeçalho é acrescentado. Acentos, emojis, timestamps, espaços, BOM e
quebras de linha do texto são preservados. UTF-16 com BOM também é lido; arquivos
ilegíveis são recusados, sem substituir silenciosamente caracteres. Mudar de
TXT para MD padroniza o formato, não comprime o conteúdo.

`crm_import_txt_context` grava contexto, nome `.md`, MIME `text/markdown` e texto
do documento numa única transação da tabela `crm_lead_contexts`. Não há upload
separado para Storage, nem janela para arquivos órfãos. O `.md` é persistido como
documento textual no banco, disponível por download e pela mesma consulta
autorizada dos contextos. Edições posteriores mudam o contexto, preservando o
arquivo importado original. Nenhum consumidor de IA novo foi introduzido.

Notas coladas manualmente e todos os outros uploads do dashboard continuam com
o comportamento anterior. O ícone de ficha foi renomeado para **Contexto**;
o segundo ícone que também abria a ficha foi removido.

## Verificação

```sh
node scripts/verify-crm-context-file.mjs
node scripts/check-crm-context-file-db.mjs --deployed
node scripts/verify-context-daily-ui.mjs --context-only
npx tsc -b --pretty false
npm run lint
npm run build
```

O teste SQL usa fixtures descartadas por rollback. Antes da instalação, execute
o mesmo script sem `--deployed`, depois `--apply` para aplicar somente a migration
`20260912220000_crm_context_markdown.sql`. O teste visual usa Playwright local e
API em memória; pode apontar para outra origem por `CRM_TEST_ORIGIN`.

Cobertura: formatos recusados, binários, limites, preservação UTF-8/UTF-16,
seleção/arraste, arquivo `.md` baixado byte a byte, persistência após reload,
original preservado após edição, bloqueio de escrita direta e conta pendente,
autoria, funcionamento SDR/Closer, navegação única e largura de 390 px.
