# CRM compartilhado: SDR → Closer → Vendas

Correção sobre `ff874e3`. Produção: https://wsltda.site. Supabase: `mbzwchnxtskysqplqiyy`.

## Cadastro e operação

Somente nome do responsável, nome do atleta e WhatsApp são obrigatórios. O formulário identifica o campo como **E-mail (opcional)**; nascimento, posição, cidade/UF, métricas, relatório, origem, valor, prioridade e observações também são opcionais. Valores vazios são enviados como `null`; dados opcionais preenchidos continuam sujeitos à validação de formato. Cadastros históricos incompletos permanecem visíveis com indicador, sem dados pessoais inventados.

O livro abre cadastro e timeline em leitura. O lápis abre edição com os valores atuais. Aquecimento (`frio`, `morno`, `quente`) e abordagem (`nao_abordado`, `em_abordagem`, `abordado`, `reabordado`) são independentes e aparecem em cada card. Busca, filtros combináveis, ordenação, agrupamentos de aquecimento/abordagem/esteira e atraso estão disponíveis em Leads e SDR.

1. O cadastro inicia em `novo`. Iniciar abordagem leva à qualificação.
2. Quente + abordado/reabordado sinaliza `pronto_closer`; nunca repassa automaticamente.
3. **Enviar para Closer** atualiza o mesmo `crm_leads.id`, com responsável escolhido ou fila compartilhada. Não exige call nem duplica lead.
4. A fila Closer mostra `repassado_closer`, com filtros de não assumidos, meus leads, calls por prazo e fechamentos. **Assumir lead** atribui ao operador logado.
5. O responsável agenda/reagenda e registra resultado: venda concluída, venda perdida, follow-up com próxima data obrigatória ou devolução ao SDR. Calls pendentes, pipeline, autor, horário e histórico são atualizados na mesma transação.
6. Venda concluída não gera faturamento. O card continua mostrando **Venda pendente de cadastro**, inclusive após reload, até o envio manual em `/vendas?lead=<id>`.
7. Vendas preenche comprador/WhatsApp e e-mail quando existe; permite informar o e-mail ausente. Produto/ticket do catálogo continuam obrigatórios. A venda grava `crm_lead_id` e pertence ao usuário logado. O card passa a **Venda cadastrada**, com acesso ao registro sujeito à RLS existente.

Mudanças de aquecimento/abordagem preservam repasse e fechamento. Devolver ao SDR retorna para `em_qualificacao`, libera o responsável Closer e preserva o histórico. A prontidão pode voltar a ser calculada numa classificação posterior.

## Capacidades

`crm_user_can` no banco e `crmCapabilities` no frontend usam a mesma matriz:

| Papéis ativos | Leads | SDR | Closer | Registrar venda | Administração |
| --- | --- | --- | --- | --- | --- |
| executive / super_admin | Sim | Sim | Sim | Sim | Sim |
| sdr (inclusive seller + sdr) | Sim | Sim | Não | Não | Não |
| closer (inclusive seller + closer) | Sim | Não | Sim | Sim | Não |
| seller sem sdr/closer | Sim | Sim | Sim | Sim | Não |
| Cargo externo + crm_access | Sim | Não | Não | Não | Não |
| Suspenso ou sem acesso | Não | Não | Não | Não | Não |

A capacidade de registrar venda acompanha Closer para completar o fluxo solicitado. Quem tiver ambos os papéis específicos acessa ambas as áreas. `crm_access` não bloqueia papéis comerciais. Contas suspensas ficam bloqueadas. Gerenciamento usa a central executiva existente, com revisão de conta, funções e auditoria; o relatório apresenta capacidades efetivas. Nenhuma conta pessoal foi reclassificada.

## Banco, concorrência e sincronização

Migration forward-only **`20260910010000_crm_shared_workflow.sql`**, aplicada em produção em 10/09/2026 UTC (09/09 no horário de Brasília). A anterior `20260909200000_sdr_closer_crm.sql` foi preservada. Sua instalação antiga não consta no histórico remoto; essa divergência não foi reparada nem usada para replay.

- `approach_stage`, `sdr_id`, `closer_id`, `handed_off_at`, `closed_at`, `closed_by` e `version` no lead. Estado compartilhado/não assumido é derivado da etapa e da atribuição, sem estado duplicado.
- Backfill usa o booleano e contagem anteriores para abordagem e apenas referências/timestamps de registros existentes para responsabilidade/repasse/fechamento. Etapas e dados pessoais históricos permanecem.
- `crm_transition` centraliza edição, classificação, abordagem, contatos, retornos, repasse, atribuição, assumir, resultado e devolução. Usa `FOR UPDATE` no lead e exige versão atual. Cliques duplicados ou revisão antiga retornam HTTP 409.
- RPCs antigas de agendamento/reagendamento/resultado continuam protegidas, com a nova matriz de capacidades; agendar fechamento exige repasse explícito.
- Trigger impede updates diretos do workflow e preserva autoria/histórico. A timeline registra autor, horário e estados anteriores/novos da classificação, abordagem, pipeline, atribuição e retorno.
- `crm_sale_links` compartilha apenas o status de venda; ID/acesso ao registro só é retornado a quem pode ler a venda. A RLS financeira não foi ampliada. Nova segunda venda para o mesmo fechamento é bloqueada; vendas históricas não são removidas.
- Realtime de leads, atividades/calls, vendas e sinal administrativo invalida as consultas. Há fallback a cada 15 segundos e no foco, com indicador quando a conexão Realtime falha. Paginação percorre todas as páginas de leads, atividades, responsáveis e vínculos; não há corte silencioso de registros.

## Verificação

```powershell
npx tsc -b --pretty false
npx eslint src/pages/CRM.tsx src/pages/RegistrarVenda.tsx src/pages/MinhasVendas.tsx src/hooks/useCRM.tsx src/hooks/useRoles.tsx src/components/crm src/components/ProtectedRoute.tsx src/components/layout/ExecutiveAppSidebar.tsx src/components/executive/ExecutiveUserManagement.tsx src/lib/crm.ts src/lib/crm-capabilities.ts src/App.tsx
npm run build
npm run security:secrets
node scripts/verify-crm-unit.mjs
node scripts/check-crm-db.mjs --deployed
node scripts/verify-crm-ui.mjs
```

O teste SQL usa fixtures isoladas e `ROLLBACK`; valida campos, matriz completa, RLS, autoria, histórico imutável, prontidão, repasse sem call, agendas, conflitos, retorno, follow-up, ganho/perda e vínculo manual. Sem `--deployed`, aplica a migration dentro da transação para pré-validação **somente antes de ela estar instalada**.

O navegador usa Auth, JWT assinado, PostgREST e Realtime reais. Contas temporárias são criadas sem envio de e-mail; catálogo, leads, atividades, vendas e contas são removidos em `finally`. A segunda sessão tem apenas os intervalos de polling desativados para comprovar Realtime sem reload. Verifica desktop 1440 px, celular 390 px, ciclo completo até venda, CTA persistente, seleção do catálogo, corrida de revisões, áreas executivas e ausência de erros inesperados HTTP/console.

O teste com fixtures reais é permitido somente em um projeto Supabase de staging separado. Defina `CRM_TEST_PROJECT_REF`, salve as chaves desse projeto em `.verification.local/api-keys.json` e execute a interface apenas em `localhost`. O gerador recusa explicitamente o projeto de produção `mbzwchnxtskysqplqiyy`, e o teste de interface recusa domínios públicos. Produção deve receber apenas verificações sem escrita.

## Publicação

Não executar `supabase db push`. `scripts/apply-crm-migration.mjs` executa somente a migration acima, em transação com registro na tabela de histórico, recusando reaplicação. O teste `--deployed` deve passar antes do frontend.

Projeto Vercel confirmado pelo alias: `pitch-and-win1`, time `ls-projects-d9965387`, projeto `prj_m8Z9WxSHwBsOZEs5LInysrd5DE1w`. A publicação manual deve usar essa vinculação. `.verification.local`, `.env` e arquivos de credenciais ficam fora do Git e do deploy. Confirmar o alias e o bundle servido pelo domínio após publicar.
