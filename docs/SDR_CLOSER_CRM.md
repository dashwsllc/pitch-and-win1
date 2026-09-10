# SDR e Closer no CRM

Implementação revisada sobre `9f04794` (`feat: give executives control of products and tickets`). O material recebido continha a especificação e um relato de entrega, mas não o arquivo `sdr-closer-crm.patch`. As mudanças deste repositório foram implementadas e verificadas aqui; a contagem de oito arquivos e os testes citados naquela entrega não descrevem esta versão.

## Comportamento

- **Leads:** cadastro do responsável (nome, WhatsApp e e-mail obrigatórios; cidade/UF opcional) e do atleta (nome, nascimento e posição obrigatórios; altura e peso opcionais). Cadastro e edição usam os mesmos campos e validações. Empresa, Cargo, LinkedIn e idade antiga deixam de aparecer no formulário/ficha; as colunas e os dados anteriores permanecem no banco. Dados de atletas existentes não são inventados. Registros anteriores podem continuar recebendo notas, temperatura e calls; ao editar os dados cadastrais, a ficha pede o preenchimento dos campos obrigatórios.
- **SDR:** temperatura editável, próxima call, qualificação e agendamento de fechamento com um Closer habilitado. Qualificação aceita Avançou ou Lead perdido. Repasses ficam em acompanhamento, fora da fila de qualificação. Reagendamento atualiza a mesma atividade.
- **Closer's:** calls de fechamento por data/hora, identificação do responsável pela call, destaque para hoje e atraso, contexto e relatório quando houver link informado. O resultado é Venda concluída, Venda perdida ou Devolvido ao SDR. A devolução encerra a call e retorna o lead à qualificação, mantendo o histórico.
- **Contexto de vida:** entradas com autor e data/hora; novas notas são imutáveis pela API de usuários. Observações e atividades anteriores continuam disponíveis na ficha. Calls/notas protegidas impedem excluir um lead com esse histórico pela interface.
- **Vendas:** o fechamento mostra a mensagem e o botão para Nova Venda. O formulário carrega responsável/contatos a partir do `lead` da URL e grava `vendas.crm_lead_id` somente no envio manual. Produto, ticket, preço, aprovação e comissões continuam no fluxo existente. O vínculo não é alterável depois do registro. Nenhuma venda é criada automaticamente pelo CRM. Um lead pode ter mais de uma compra manual; o vínculo não impõe unicidade financeira.

O relatório de performance usa um link HTTPS opcional. Não foi encontrada uma integração de produção/relatórios neste repositório; o indicador significa que o link foi informado, sem afirmar que outro sistema gerou ou validou um relatório. Clube atual e pé dominante eram sugestões adicionais, e não foram incluídos.

## Permissões e consistência

`crm_access` continua necessário, exceto para executive/super_admin. A antiga exceção visual de BDR sem `crm_access` foi removida para corresponder à RLS. A aba SDR exige função SDR ou executive; a aba Closer's exige Closer ou executive. Contas suspensas são bloqueadas pelo banco.

O banco verifica acesso, função e responsável, além da visibilidade das abas. Somente o responsável pela call, com a função correspondente, ou um executive pode concluí-la. SDR/executive pode agendar e reagendar. O seletor lista usuários ativos com função e acesso compatíveis; nenhuma permissão é concedida automaticamente pelo agendamento.

As operações de call e pipeline são atômicas, bloqueiam o lead durante a transação e exigem a revisão carregada para concluir/reagendar. Há no máximo uma call pendente por lead. Uma segunda tentativa com revisão antiga, um segundo resultado ou novo agendamento com call ainda pendente retorna conflito. Alterações diretas das calls e do pipeline pela API de usuários são bloqueadas.

Os códigos existentes `fechado_ganho` e `fechado_perdido` são preservados. Foram adicionados `em_qualificacao`, `repassado_closer` e `lead_perdido`, sem reclassificar históricos. Realtime invalida as consultas de leads/atividades; atualização no foco e a cada 15 segundos cobre desconexões. As consultas carregam páginas sucessivas, sem omitir silenciosamente os registros além do limite anterior de 500 leads/100 atividades.

## Banco e publicação

A migração desta entrega é `supabase/migrations/20260909200000_sdr_closer_crm.sql`. Ela foi aplicada em 09/09/2026 ao projeto de produção `mbzwchnxtskysqplqiyy` e validada em seguida com a bateria completa dentro de uma transação encerrada com `ROLLBACK`.

Não usar `supabase db push` geral: o histórico remoto diverge do local, conforme `PRODUCTS_CATALOG.md`. Para conferir ou repetir a publicação em outro ambiente:

1. Conferir se esta migração específica ainda não foi aplicada naquele ambiente. Ela é para execução única, com `BEGIN`/`COMMIT`, e não deve ser repetida sobre uma versão já instalada.
2. Executar seu conteúdo inteiro no SQL Editor do projeto, preservando a transação. Se falhar, corrigir a causa antes de repetir; não executar fragmentos isolados.
3. Confirmar colunas, constraints, políticas e funções — a presença de duas funções sozinha não valida a migração. A interface usa `schedule_closer_call`, `resolve_closer_call`, `reschedule_crm_call` e `crm_call_assignees`.
4. Executar `node scripts/check-crm-db.mjs --deployed` para testar a estrutura instalada com fixtures isoladas e `ROLLBACK`.
5. Publicar o frontend e validar com sessões reais de SDR e Closer: cadastro, qualificação, repasse, sincronização entre sessões e registro manual da venda.

Os nomes históricos `schedule_closer_call` e `resolve_closer_call` também atendem a qualificação, com validação específica para cada tipo. Não há necessidade de criar outra tabela de calls.

Nenhuma conta de Ismael ou David foi alterada nesta entrega. Um executive deve conferir as contas corretas, suas funções e `crm_access` no gerenciamento existente antes da utilização. Não inferir identidade apenas pelo primeiro nome.

## Verificação desta versão

Executados em 09/09/2026:

```sh
npx tsc -b --pretty false
npx eslint src/pages/CRM.tsx src/pages/RegistrarVenda.tsx src/hooks/useCRM.tsx src/hooks/useRoles.tsx src/components/crm/CRMCalls.tsx src/components/crm/CRMContactFields.tsx src/components/crm/CRMLeadDetail.tsx src/lib/crm.ts scripts/check-crm-db.mjs scripts/verify-crm-ui.mjs
npm run build
npm run security:secrets
node scripts/check-crm-db.mjs
node scripts/verify-crm-ui.mjs
```

O teste SQL usa o schema real e os papéis `authenticated`/`anon` no Supabase, com claims simuladas por `set_config`, fixtures isoladas e `ROLLBACK`. Verifica campos obrigatórios, métricas opcionais, valores inválidos, autoria, notas imutáveis, qualificação, repasse, reagendamento sem duplicação, conflitos, separação SDR/Closer, responsável pela call, devolução, ganho/perda, suspensão, ausência de acesso/autenticação, vínculo manual com Vendas e preservação do catálogo. Ele não autentica JWT assinado nem passa pelo PostgREST.

O teste de navegador usa Playwright e respostas de API interceptadas, sem acesso de escrita remoto. Verifica abas por função, cadastro, contexto, qualificação, repasse, reagendamento, fechamento e preenchimento/registro manual da venda; captura telas em 1440 px e 390 px e verifica ausência de overflow horizontal. Ele não prova Realtime ou integração ponta a ponta com a API real.

Para repetir o teste de navegador, use o runner já previsto no repositório:

```sh
npm install --no-save --package-lock=false --prefix .verification.local @playwright/test
node .verification.local/node_modules/playwright/cli.js install chromium
npm run dev -- --host 127.0.0.1 --port 5198 --strictPort
# Em outro terminal:
node scripts/verify-crm-ui.mjs
```

O teste SQL exige a CLI Supabase autenticada. Capturas e SQL de verificação ficam em `.verification.local`, ignorado pelo Git. Não publicar este frontend antes da migração: as consultas de atividades e as operações de call dependem das novas colunas/funções.
