# Aprovação de Tráfego: implantação e recuperação

## Migração

Arquivo: `supabase/migrations/20261009160000_meta_traffic_manual_approval.sql`.

A migração adiciona decisões aos formulários, origem das capturas de métricas e uma auditoria por eventos. Mantém as assinaturas das funções existentes. Novos recebimentos e importações ficam pendentes, inclusive os enviados por Executive ou Super Admin. A interface anterior também fica sujeita às permissões e à aprovação aplicadas no banco.

Vínculos existentes com o CRM e decisões de lotes anteriores são preservados. Registros antigos já importados são reconhecidos como aprovados, sem inventar um responsável ou eventos de auditoria. Formulários antigos ainda não tratados passam pela aprovação. Métricas já publicadas permanecem; novas capturas exigem revisão.

## Ordem de implantação

1. Salvar as definições anteriores de funções, políticas, constraints e triggers em um arquivo local ignorado pelo Git, sem exportar contatos.
2. Executar a migração e registrar a versão `20261009160000` no histórico na mesma transação. Lock timeout de 5 segundos e statement timeout de 90 segundos evitam espera indefinida; uma falha reverte toda a transação.
3. Executar `scripts/verify-meta-approval-db.sql` e `scripts/verify-meta-lead-import-db.sql`. Ambos terminam com rollback, sem manter fixtures ou decisões de teste.
4. Publicar a interface após os testes do banco, tipos, lint e build passarem.
5. Conferir `/trafego`, `/leads` e os arquivos da publicação em produção. Os testes de banco verificam as permissões autenticadas; a conferência HTTP não substitui uma sessão interativa de usuário.

O histórico remoto contém migrações fora deste checkout. Nesta implantação, executar somente o SQL desta versão; não usar `db push` para reconciliar o histórico inteiro.

## Recuperação

Se a aplicação da migração falhar, o PostgreSQL faz rollback. Conferir o erro e o histórico antes de tentar novamente; a migração não deve ser reaplicada se a versão já estiver registrada.

Se ocorrer um problema na interface, restaurar a publicação anterior no Vercel e manter as restrições do banco. A interface anterior não mostra as novas filas de aprovação; leads pendentes continuarão protegidos até uma publicação corrigida.

Se ocorrer um problema no processamento, interromper a captura afetada e corrigir por uma nova migração transacional. Preservar os lotes, formulários, vínculos e eventos existentes. Não remover as novas colunas nem restaurar funções que encaminhem registros pendentes ao CRM ou publiquem métricas sem decisão. Rejeitar um lote não apaga o original.

## Limitação externa da Meta

O último teste da reconciliação de leads encontrou falta da permissão `pages_manage_ads`. A captura automática depende da autorização da Página e do acesso aos leads na Meta, com token adequado configurado diretamente nos secrets do Supabase. A importação manual funciona independentemente dessa liberação. Não enviar tokens pelo chat nem registrá-los em documentos.

## Evidências

- 17 testes de regressão da integração Meta passaram.
- TypeScript com `tsconfig.app.json` e lint dos arquivos alterados passaram.
- Os cenários SQL da migração candidata passaram em transação com rollback.
- O build de produção, a verificação de segredos e as regressões de vendas/sincronização do dashboard passaram.
- `npm audit --audit-level=high` apontou 17 alertas nas dependências atuais (13 altos e 4 moderados). Esta alteração não modifica `package.json` nem o lockfile; o gate de dependências do CI permanece com falha e não deve ser apresentado como aprovado.
- As definições anteriores de 11 funções, 4 políticas, 49 constraints e 12 triggers do CRM foram salvas em `.verification.local/meta-approval-before.json`, sem contatos.
- Após o bloqueio inicial da revisão automática, o usuário autorizou explicitamente esta nova publicação completa.
- A migração `20261009160000` foi aplicada ao projeto `mbzwchnxtskysqplqiyy` e registrada no histórico na mesma transação.
- Os dois testes SQL passaram também no banco instalado, na mesma transação com rollback. Foram verificados os três papéis de aprovação, conta suspensa, isolamento de SDR, rejeição, versões desatualizadas, vínculos genéricos com o CRM, preservação de respostas e origem das métricas.
- A interface do commit `3a2bf9c` está publicada em produção em [www.wsltda.com](https://www.wsltda.com), no deploy `dpl_4bLtTrsGrgDqovARdVuumm55vNDS`, com status `Ready`. O deploy foi criado em 09/10/2026 às 16h23 de Brasília.
- Às 16h26 de Brasília, `/trafego` e `/leads` responderam HTTP 200. Os arquivos `index-B1eiTMIF.js`, `Trafego-DNict9ZJ.js` e `Leads-CyEgls0t.js` também responderam HTTP 200 e seus hashes SHA-256 coincidiram com o build local aprovado. Evidência em `.verification.local/meta-approval-production-http.json`.
- A tentativa adicional de deploy pelo CLI retornou `Not authorized`; a publicação de produção foi confirmada pelo comando `vercel inspect` e pela comparação dos arquivos efetivamente servidos. Não foi realizada navegação interativa autenticada nesta sessão.

Operação: [importação e aprovação](META_IMPORTACAO_MANUAL_2026-10-09.md).
