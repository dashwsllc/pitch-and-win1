# Tráfego: edição de dados com auditoria

## Operação

Em **Tráfego → Dados e edições**, Gestor, Executive e Super Admin ativos podem editar os dados de negócio dos leads em qualquer situação, linhas de importação e métricas publicadas. O motivo é obrigatório (3 a 500 caracteres).

O editor oferece contato, atleta, observações, data de geração, campanha, anúncio, formulário e respostas. Nas métricas, oferece data, conta, campanha, conjunto, anúncio, nível, moeda, atribuição, objetivo e todos os indicadores importados. IDs internos, vínculo CRM, decisão de aprovação e atribuição ao SDR continuam sob os fluxos próprios do sistema.

- **Lead pendente:** a correção será usada na aprovação; editar não aprova nem encaminha ao CRM automaticamente.
- **Lead vinculado:** o editor carrega os contatos e as observações atuais do CRM. Os campos alterados são sincronizados; uma alteração concorrente do SDR exige reabrir o editor. Editar campanha ou respostas não altera a versão do contato no CRM.
- **Observações:** o campo inclui as observações atuais completas do CRM. Uma edição explícita substitui esse conteúdo, com antes/depois na auditoria. Editar outro campo preserva as observações.
- **Respostas:** podem ser adicionadas, removidas ou corrigidas. Para corrigir o contato usado no CRM, editar também os campos de contato apresentados acima das respostas.
- **Importação pendente:** corrigir a linha antes de aprovar. O sistema recalcula a indicação de cadastro completo.
- **Importação aprovada:** a edição da linha corrige o histórico, sem republicar dados. Para atualizar o CRM ou os indicadores, editar o lead ou a métrica publicada nas seções acima.
- **Métrica publicada:** a correção atualiza os indicadores após salvar. Uma importação futura só pode substituí-la após aprovação manual; essa atualização também gera auditoria.

Em **Tráfego → Auditoria**, cada edição mostra autor, papéis, horário, motivo, campo e valores antes/depois. Publicações e atualizações de métricas também registram os valores. Uma falha na auditoria reverte a alteração na mesma transação. SDR e visitantes não podem executar as funções de edição nem modificar a auditoria diretamente.

A primeira fonte de cada registro é preservada. Recapturas da Meta não substituem um formulário pendente corrigido manualmente. Linhas de métricas pendentes corrigidas preservam também sua identidade original, evitando duplicação na captura seguinte.

## Implantação

Migração: `supabase/migrations/20261009180000_meta_traffic_audited_edits.sql`.

1. Salvar somente definições do banco em `.verification.local/meta-edit-before.json`, sem exportar contatos. Pré-verificação: versão ausente; 2 funções, 42 constraints, 3 políticas e 16 triggers registrados.
2. Aplicar exclusivamente a versão `20261009180000` e registrar seu histórico na mesma transação. O histórico remoto contém versões fora do checkout; não executar `db push`. Lock timeout de 5 segundos e statement timeout de 90 segundos.
3. Executar conjuntamente os testes de aprovação, importação manual e edição, com rollback completo.
4. Fazer commit/push para `main` e conferir a publicação de produção no Vercel.
5. Verificar `/trafego`, `/leads` e os hashes dos arquivos servidos em relação ao build local.

## Recuperação

Se a migração falhar, a transação reverte integralmente. Conferir o histórico antes de repetir. Se a interface falhar, restaurar a publicação anterior e conservar as colunas, correções e auditoria. A interface anterior permanece compatível com o banco.

Falhas no processamento devem ser corrigidas por migração adicional. Preservar registros e eventos; não remover as colunas de origem ou restabelecer processamento que apague correções manuais. As definições anteriores estão no arquivo local ignorado para análise.

## Validação

- 22 testes JavaScript da edição, importação manual e integração Meta passaram.
- As três suítes SQL passaram contra a migração candidata e novamente contra o banco de produção instalado, com rollback. Cobrem contato aprovado, observações, histórico, conflitos no CRM, versões desatualizadas, autorização, métricas publicadas, recaptura e atomicidade da auditoria.
- TypeScript (`tsconfig.app.json`), lint dos oito arquivos TypeScript alterados, build de produção e verificação de segredos passaram.
- Regressões unitárias de sincronização do dashboard e visibilidade de vendas passaram.
- A verificação estrutural antiga `verify-dashboard-refresh.mjs` falha por um timer já existente em `GoalHistory.tsx`, confirmado também em `HEAD`; esse arquivo não foi alterado.
- O teste adicional `verify-sales-management-ui.mjs` não iniciou porque o Chromium esperado pelo Playwright não está instalado. Navegação interativa autenticada não foi validada nesta sessão.
- Dependências não foram alteradas. Os alertas já registrados no plano anterior permanecem fora desta alteração; o gate de dependências não foi apresentado como aprovado.

A versão `20261009180000` foi aplicada ao projeto `mbzwchnxtskysqplqiyy`, com registro do histórico na mesma transação. Após o push, conferir o estado Ready do Vercel e os arquivos servidos em produção; guardar a evidência HTTP em `.verification.local/`.
