# Integridade das levas e Importações do SDR — 13/10/2026

Destino comercial: `dash`, `mbzwchnxtskysqplqiyy`. Branch `codex/traffic-lead-waves`; implementação isolada sobre a versão já publicada por outro fluxo (`4e4ab88`). A migration anterior permanece imutável.

## Comportamento implementado

- Levas estáveis de até 20. Recebimentos/reprocessamentos automáticos não movem os contatos já agrupados. A parcial pode ser revisada imediatamente.
- Levas, membros e Importações ordenados pelo primeiro recebimento durável. Geração original, recebimento e disponibilização no CRM são identificados separadamente, com data e horário de Brasília ao segundo. Planilha sem horário não ganha uma precisão fictícia.
- A decisão coletiva exige conjunto, versão da leva e versões dos contatos conferidos. Solicitação repetida devolve o resultado gravado; chave reutilizada com outra decisão é recusada. A rota coletiva anterior vira helper interno.
- SDR → Importações tem Formulários e Site / conversão direta, com filtros Automáticas/Manuais. Importação manual preserva arquivo e células originais, inclusive vazias e não mapeadas. IDs do site usam namespace próprio.
- Contatos aprovados entram com responsável/WhatsApp, sem SDR atribuído e sem contabilizar abordagem. Uma falha de telefone não impede o envio dos outros membros. O contato com falha continua guardado e pode ser corrigido e reenviado.
- A captura integral aprovada vai ao CRM na mesma transação; não há truncamento desse registro. Respostas, consentimentos, atribuição e dados adicionais ficam acessíveis na ficha. O cadastro atual e o histórico do SDR continuam separados da origem preservada.
- A lista não transfere todas as capturas completas; a ficha as consulta sob demanda, com erro visível e nova tentativa. Duas sessões acompanham novos recebimentos pelo sinal de revisão, inclusive sem Realtime.

## Evidência local

Em 13/10: 111 regressões Node passaram após a revisão, TypeScript sem erros, ESLint dos arquivos TypeScript alterados sem erros, build de produção concluído. Não foi acrescentada dependência de produto.

Revisão independente `gpt-6.1-sol/high` (o modelo inicialmente escolhido não iniciou por limite de uso): nenhum achado crítico, dois importantes, ambos corrigidos em uma passagem TDD. O primeiro era remoção de espaços na leitura real de CSV/XLSX; a leitura de leads agora preserva células e cabeçalhos, normalizando apenas os campos usados no cadastro. O segundo era apresentação de datas/horários artificiais como envio; arquivos sem data mostram indisponibilidade, arquivos somente com data não mostram meio-dia como horário real. Os testes começam em arquivos reais e passam pelo contrato do banco/ficha.

Consulta somente leitura de 13/10 às 14:50 (Brasília): 54 fatos de métricas, todos correspondentes às suas capturas aprovadas, sem divergência em gasto/leads/impressões/cliques, sem chaves duplicadas e sem revisão pendente. Cada nível (campanha/conjunto/anúncio) apresenta R$311,98 e425leads, níveis alternativos e não somáveis. Busca de contatos atualizada e sem erro; assinatura do webhook ainda sem confirmação, portanto a latência ao vivo permanece não comprovada.

PostgreSQL 17.6 descartável, exclusivamente `127.0.0.1:55812/traffic_waves_test`, aplicando a estrutura real e as migrations do fluxo de tráfego:

| Ensaio | Resultado |
| --- | --- |
| `verify-meta-waves-db.sql` | 0/1/19/20/21/148; parcial imediata; estabilidade; versão alterada; repetição; reabertura com histórico |
| `verify-crm-import-integrity-db.sql` | Origem manual/site; contexto extenso integral; horários; ausência de abordagem; idempotência; 19 envios + 1 falha preservada |
| `verify-meta-waves-concurrency.mjs` | Recebimentos simultâneos no limite 19/20; duas decisões concorrentes, segunda recusada |
| `verify-meta-approval-db.sql`, `verify-meta-lead-import-db.sql`, `verify-meta-lead-waves-db.sql`, `verify-meta-edit-db.sql` | Quatro suites legadas passaram com atores sintéticos |
| `verify-meta-lead-waves-browser.mjs` | Chromium real: prioridade, relógios, exclusões, confirmação, revisão alterada, falha/reenvio/reabertura; 450 linhas em blocos 200/200/50 sem perda |
| `verify-crm-imports-browser.mjs` | Chromium real: duas sessões SDR, origem/método, chegada recente de geração antiga, horário ao segundo, contexto integral e atualização entre sessões |

Os navegadores substituem somente a fronteira HTTP por fixtures sintéticas e abortam chamadas externas não previstas. SQL e decisões de ensaio são revertidos. Nenhum lead comercial foi aprovado ou rejeitado nesta execução.

Os novos testes observaram falhas antes das respectivas correções: RPC de revisão ausente, reabertura apagando histórico referenciado, contexto/recebimento ausentes, lista transferindo snapshots integrais, rota legada contornando versões e edição habilitada durante confirmação. Resultados posteriores foram conferidos.

O ensaio antigo `verify-meta-reliability-integrated.mjs` exige outro template local, na porta 55432, já ocupado por processo de outro fluxo. A invocação sem configuração foi recusada pelo seu guard de isolamento; esse template não foi acessado. As três regressões de worker desse arquivo não substituem os ensaios de ondas/banco executados aqui. A interface antiga `verify-crm-importados-ui.mjs` exige a aplicação na porta 5198; foi substituída nesta conferência pelo ensaio atual de duas sessões, na 5207.

Para repetir os navegadores: iniciar Vite no checkout, definir `TRAFFIC_TEST_ORIGIN=http://127.0.0.1:<porta>` e executar os dois arquivos `.mjs`. Para SQL, carregar `scripts/helpers/meta-db-fixtures.sql` na mesma sessão antes dos scripts; os quatro ensaios legados precisam de um actor executive e seller sintéticos no BEGIN externo. Concorrência exige `META_WAVE_TEST_DATABASE_URL` com o endereço local acima e `META_TEST_PG_MODULE` apontando à instalação local de `pg`. Os guards recusam destino comercial.

## Estado de publicação e pendências

A última consulta comercial anterior à publicação encontrou 426 leads, todos pendentes, em 22 levas, sem vínculo CRM. As novas colunas ainda não estavam instaladas. Este documento registra a implementação e a prova local; não confirma implantação desta evolução.

A publicação seletiva requer aplicar somente a nova migration, atualizar o frontend e reconferir recibos, vínculos, limites e grants. Aprovação de contatos reais continua na tela, por decisão comercial.

A fila automática do site ainda não foi implementada: a especificação escrita própria aguarda revisão. A origem manual Site já está coberta. O check-up amplo de gastos, métricas e rastreamento do site também permanece ativo; a correção destas importações não prova que toda a operação de tráfego esteja encerrada.
