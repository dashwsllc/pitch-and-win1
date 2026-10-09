# Importação e aprovação de leads da Meta

Data: 09/10/2026.

## Enviar uma planilha

1. Acesse /trafego → **Importar leads** e selecione CSV, XLS ou XLSX.
2. Confira o mapeamento e a prévia. Colunas de contato ausentes não impedem o envio.
3. Envie até 2.000 linhas. O lote fica **Pendente**, inclusive quando enviado por Executive ou Super Admin.
4. Em **Aprovações**, confira as linhas e respostas originais antes de clicar em **Aprovar**. A rejeição exige um motivo.
5. Confira o resultado: cadastros no CRM, cadastros para completar, duplicatas e linhas com falha. As explicações indicam a linha do arquivo.

Gestor de tráfego (traffic_manager), Executive e Super Admin podem aprovar ou rejeitar, desde que o acesso esteja aprovado e a conta esteja ativa. Enviar o arquivo e aprovar o lote são ações separadas. O servidor aplica essas permissões.

## Receber automaticamente

Leads capturados por webhook ou reconciliação ficam em **Tráfego → Aprovações → Leads automáticos**. Confira contato, campanha, respostas e consentimentos. Aprovar ou rejeitar registra responsável e horário.

SDRs não visualizam nem encaminham leads pendentes. Uma nova entrega do mesmo ID não modifica as respostas depois da aprovação ou rejeição.

## Encaminhar aos SDRs

Após a aprovação:

| Cadastro | Destino |
|---|---|
| Responsável, WhatsApp, e-mail, nome do atleta, nascimento e posição válidos | CRM, etapa **Novo**, fila compartilhada sem SDR atribuído |
| Campos obrigatórios incompletos ou inválidos | /leads, fila **Recebidos**, para **Completar cadastro** |

O SDR assume o atendimento pelo fluxo existente do CRM. Ao completar um cadastro em Leads, o sistema mantém o vínculo com o formulário e preserva as respostas originais e consentimentos. Uma segunda tentativa de encaminhamento retorna o mesmo cadastro, sem duplicá-lo.

## Reimportar

O ID real da Meta é usado quando existe; o prefixo l: é normalizado. Sem ID, o sistema gera um identificador pelo conteúdo das respostas. Renomear o arquivo ou mudar a ordem das linhas mantém esse identificador. Alterar respostas ou cabeçalhos pode gerar um novo identificador; nesse caso, a deduplicação por conteúdo não identifica necessariamente a mesma pessoa.

Se uma planilha contiver o ID de um lead automático ainda pendente, essa linha é informada como falha com a orientação para revisar o registro em **Leads automáticos**. Ela permanece pendente até essa revisão. Registros já revisados são contabilizados como duplicatas, sem sobrescrever o original.

## Auditoria

Em **Tráfego → Auditoria**, confira recebimentos, decisões e sincronizações, com origem, responsável, papéis no momento da ação, horário de Brasília e resultado por linha. Rejeições registram o motivo. A auditoria começa na ativação desse fluxo; não inventa decisões anteriores.

Métricas capturadas pela API também ficam pendentes em **Aprovações** antes de entrar em Desempenho. Recapturas atualizam o lote pendente por conta e nível; se os dados mudarem durante a revisão, é preciso recarregar a prévia.

## Verificação técnica

~~~powershell
node --experimental-vm-modules --test scripts/verify-meta-lead-import-regressions.mjs scripts/verify-meta-sync-regressions.mjs
npx.cmd tsc --noEmit -p tsconfig.app.json
npm.cmd run build
~~~

scripts/verify-meta-approval-db.sql e scripts/verify-meta-lead-import-db.sql verificam permissões, isolamento dos SDRs, aprovação explícita, rejeição, sincronização, preservação das respostas, duplicatas, origem das métricas e auditoria em transações com rollback. Requerem o schema atualizado e usuários ativos existentes; não mantêm fixtures.

Consulte [implantação e recuperação](META_APROVACAO_IMPLANTACAO_2026-10-09.md) e [configuração da API](META_ADS_OFFICIAL_API_SETUP_2026-09-27.md).
