# Validação da confiabilidade de Tráfego — 11/10/2026

## Escopo e ambiente

Branch `codex/traffic-reliability`, base `4d720775fc278522d18038a4f439f91a43acd305`, worktree `.worktrees/traffic-reliability`. Implementação das 12 tarefas do plano aprovado, com revisão independente do conjunto antes da entrega. Não houve implantação remota nem aprovação comercial.

PostgreSQL 17.6 descartável em loopback, dois bancos com baseline real (schema sem dados comerciais), sete migrations novas e aplicação independente em um terceiro banco vazio. Funções de aplicação, constraints, RLS, grants, triggers e transações reais. Somente transportes Realtime/cron/pg_net/Vault e Graph são controlados. As fixtures usam `example.invalid`; cada verificação SQL desfaz seus dados. O teste integrado cria e remove apenas seu banco local temporário.

Navegador Chromium executa o front React real; HTTP Supabase é substituído na fronteira por dados sintéticos, com dois contextos isolados e WebSocket desabilitado para exercitar a recuperação por contadores. Permissões reais de banco são testadas separadamente sob `SET LOCAL ROLE authenticated`.

## Verificações executadas

| Verificação | Evidência |
| --- | --- |
| Regressões Node de identidade/Graph/captura/worker/webhook/importação/edição/view/interface + integração | 70/70 passaram; zero falhas |
| Extração determinística e contrato TypeSafe | 8/8 passaram, incluindo opções/confiança inválidas e preservação de dados |
| SQL | 11 arquivos em dois bancos: 22/22 passaram com rollback |
| Migrations | Todas as sete aplicadas em sequência sobre reconstrução vazia do baseline real |
| Integração SQL + handlers reais | 2.001 linhas, cinco páginas, três retomadas, claimant vencido, nenhuma publicação antes da aprovação, decisão concorrente `40001` inteira |
| Webhook + CRM | HMAC real, replay deduplicado, recibo durável, worker real, original preservado, aprovação explícita, um vínculo CRM |
| Cron/preflight | Cinco jobs únicos e pausados; modos executados sobre transporte sintético; ausência de secret não envia; grant/trigger/objeto/histórico incorretos detectados |
| Concorrência da fila | Duas conexões reais não recebem o mesmo claim; dono vencido não finaliza novo claim |
| Navegador de Tráfego | Detalhes lazy, parte de 500, remoção reconhecida, versão stale, quatro escolhas de conflito; aprovação/edição/rejeição atualizam outra sessão; SDR e suspenso sem tela |
| Consistência dos níveis | Renderização real e CSV em campanha/conjunto/anúncio; valores fora do recorte excluídos; tabela de 50 não limita totais/exportação |
| Regressão global | Invalidação/broadcast sem loop e quatro cenários reais de navegador de aprovação de vendas |
| Tipos | TypeScript da aplicação e Deno das quatro funções Edge: exit 0 |
| Estática/build | ESLint dos arquivos de Tráfego/shared/Edge: zero erros/avisos; Vite production build: exit 0 |

Não existe `npm test` neste repositório. Foram executadas as suites pertinentes do diretório `scripts`, mais regressões globais de sincronização/aprovação, sem executar utilitários comerciais destrutivos ou testes antigos que exigiam usuários reais.

## Comandos reproduzíveis

- `node --experimental-vm-modules --test scripts/verify-meta-identity-regressions.mjs scripts/verify-meta-graph-regressions.mjs scripts/verify-meta-capture-regressions.mjs scripts/verify-meta-sync-regressions.mjs scripts/verify-meta-webhook-regressions.mjs scripts/verify-meta-lead-worker-regressions.mjs scripts/verify-meta-lead-import-regressions.mjs scripts/verify-meta-edit-regressions.mjs scripts/verify-meta-view-regressions.mjs scripts/verify-meta-performance-ui.mjs scripts/verify-meta-review-ui.mjs scripts/verify-meta-operation-ui.mjs`
- `node scripts/verify-meta-traffic.mjs` e `node scripts/verify-meta-lead-import.mjs`.
- `deno test --no-lock supabase/functions/_shared/meta-lead-extract.test.ts`.
- `deno check --no-lock supabase/functions/meta-insights-sync/index.ts supabase/functions/meta-lead-webhook/index.ts supabase/functions/meta-leads-reconciliation/index.ts supabase/functions/meta-lead-worker/index.ts`.
- `node scripts/verify-meta-review-browser.mjs` com Vite local em 5199; `TRAFFIC_TEST_ORIGIN` permite outro endereço local.
- `node scripts/verify-dashboard-sync-unit.mjs`; `node scripts/verify-approval-sync-ui.mjs --dist <build-sintetico>`.
- `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.app.json`; `node node_modules/vite/bin/vite.js build`.

Integração: `node --experimental-vm-modules --test scripts/verify-meta-reliability-integrated.mjs`, com `TRAFFIC_TEST_DATABASE_URL` apontando exclusivamente para o template descartável `traffic_migration_check` em `127.0.0.1:55432`, sem fixtures persistidas, e `TRAFFIC_PG_MODULE` para o módulo `pg` da ferramenta local de teste. Esse teste recusa outro destino. O template precisa do baseline, sete migrations registradas e transportes sintéticos de cron/net/Vault. Não apontar os testes a produção.

SQL: `verify-meta-validation-db.sql`, `verify-meta-capture-db.sql`, `verify-meta-lead-queue-db.sql`, `verify-meta-cohort-db.sql`, `verify-meta-review-list-db.sql`, `verify-meta-signals-db.sql`, `verify-meta-approval-db.sql`, `verify-meta-edit-db.sql`, `verify-meta-lead-import-db.sql`, `verify-meta-form-inbox.sql`, `verify-meta-traffic-suggestions.sql`. Incluir `scripts/helpers/meta-db-fixtures.sql` depois de `BEGIN`; os três testes legados de aprovação/edição/importação precisam de atores sintéticos executivo e seller antes de executar o bloco. Os outros criam seus atores. O preflight `verify-meta-reliability-schema.sql` é somente leitura e tem uso operacional separado.

## Provas RED → GREEN

Os testes foram escritos e observados falhando antes das mudanças: identidade/soma de ações/paginação; aprovação atômica e validação; recuperação da fila; webhook antes do ACK; extração/timeout; coorte; recorte/CSV; detalhe/versionamento/upload; sinais transacionais e auditoria. Na integração final: worker sem rotação deixava a segunda página pendente; auditoria não nomeava as novas decisões nem mostrava snapshots; preflight de RPC ausente lançava `42883`. Cada caso passou após a alteração correspondente.

O erro de versão do lead no teste integrado foi isolado no parser do driver de teste, que descartava microssegundos. O adaptador agora mantém o timestamp PostgreSQL original; a regra de concorrência do produto foi preservada.

## Limites explícitos

- Meta real e confronto com Ads Manager não executados nesta entrega; `pages_manage_ads` era a pendência do último diagnóstico real de 09/10.
- Cron, pg_net, Vault e entrega Realtime reais não demonstrados pelo ambiente local; exigir smoke test após implantação.
- Navegador valida comportamento do front contra HTTP sintético; não simula o servidor PostgREST, cuja fronteira SQL foi verificada diretamente.
- Histórico legado e fontes incompletas continuam visíveis com aviso e taxas indisponíveis quando não há prova de comparabilidade.
- `get_daily_call_ranking` está ausente no baseline real e permanece uma pendência independente, com contrato legado conservado.

Roteiro de implantação/rollback: [operação](TRAFEGO_CONFIABILIDADE_OPERACAO_2026-10-11.md). Decisões de implementação e resultado da revisão final serão registrados abaixo antes do encerramento.
