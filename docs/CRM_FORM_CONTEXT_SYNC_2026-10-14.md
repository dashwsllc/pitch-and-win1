# Respostas de formulários e indicador de contexto

## Diagnóstico verificado

Os 426 contatos Meta estavam preservados, todos com 15 campos: 11 respostas de qualificação e quatro campos de identificação. Uma leva Meta foi aberta no navegador autenticado e exibiu as respostas reais. As levas mais recentes eram recuperações do site; a tela também as chamava de “Respostas do formulário”, embora muitos registros históricos contivessem apenas contato. O CRM mostrava o material importado fora de Contexto para o contato e calculava o amarelo apenas pelas anotações em `crm_lead_contexts`.

A planilha foi usada somente como referência, sem importação. Foram encontrados 168 contatos correspondentes por telefone único e comparadas 1.820 respostas não vazias de qualificação, sem divergências após normalizar espaços, maiúsculas e identificadores de opções. Os IDs de exportação diferem dos IDs recebidos pela API; essa comparação não cria vínculos, não funde identidades e não autoriza deduplicar por telefone.

## Correção delimitada

- Respostas categorizadas ficam dentro de Contexto para o contato, compartilhado por SDR e closer. Dados operacionais, IDs de operadores e JSON bruto saem dessa apresentação; permanecem preservados no banco e na auditoria.
- O site possui sua seção própria e informa quando a origem só enviou contato. A mensagem vazia não afirma que o usuário deixou de responder.
- `crm_context_summary` considera respostas no snapshot aprovado, originais preservados, colunas manuais e contexto posterior do site, além de anotações do atendimento. Retorna somente IDs visíveis pelas permissões existentes, em páginas de até 500. Campos vazios e registros técnicos não acionam o amarelo.
- A captura Meta sem `field_data` permanece em erro transitório e é tentada novamente. Não se confirma processamento de uma resposta vazia.
- As aprovações humanas continuam necessárias para a entrada de formulários no CRM. Os 426 formulários estavam aguardando essa revisão; a correção não decide leads comerciais.

## Segurança e reversão

A migration acrescenta funções de leitura, sem atualizar leads, snapshots, eventos, horários ou anotações. O resumo usa SECURITY INVOKER, RLS existente e execução restrita a authenticated; anon não executa. A instalação ocorre antes do cliente novo. O cliente anterior continua compatível. Reverter o cliente mantém as respostas e todas as funções; não apagar dados ou filas.

## Verificação

Testes RED→GREEN reproduziram JSON/metadata na ficha, ausência do resumo de respostas e confirmação de captura vazia. SQL PostgreSQL via PGlite verificou RLS entre usuários, bloqueio de anon, respostas originais/manuais, perfil posterior, paginação, vazio e valores false/zero. Os ensaios Chromium verificaram SDR, closer, amarelo, respostas completas, ausência de JSON e sincronização em duas sessões sem Realtime. TypeScript, lint, build, Deno e varredura de segredos integram o gate.

A revisão independente encontrou uma divergência no indicador do site: IDs técnicos e espaços podiam ativá-lo, enquanto observações do registro original não eram contadas. Os três cenários foram reproduzidos em SQL (RED) e corrigidos em uma passagem (GREEN); passaram novamente os testes de permissões e as 127 regressões. A primeira tentativa de revisão estava indisponível por limite de uso, sem avaliar o código; um revisor disponível concluiu a revisão. Não houve achado crítico ou minor pendente.

As aprovações comerciais, importação do arquivo e fusão de identidades ficaram fora da revisão porque não foram autorizadas; permaneceram intactas. A revisão do diff não certifica o deploy: instalação, preservação e confirmação no domínio são verificadas separadamente.

Ruling: reparo delimitado do contrato de contexto completo já aprovado, com execução nativa no checkout isolado existente. Não iniciar outro desenho nem importar o arquivo de referência. Testes de permissões e preservação antecedem a instalação seletiva; não usar db push ou reaplicar migrations anteriores.
