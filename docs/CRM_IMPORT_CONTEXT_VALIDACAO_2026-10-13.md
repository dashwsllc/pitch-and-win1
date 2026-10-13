# Contexto de formulários e site no CRM

## Falha e diagnóstico

A ficha exibia respostas de formulário como uma lista sem categorias. No site, exibia apenas a projeção de campos escalares, com limites de tamanho; perfil integral, relatório e atribuição estavam no registro técnico. O resumo textual legado também abrevia respostas em 1.500 caracteres e não representa o registro completo.

A consulta somente de leitura encontrou 91 contatos no CRM, 22 vinculados a importações do site, zero snapshots ausentes e zero divergências entre respostas da captura e snapshot aprovado. As perguntas Meta estavam preservadas nas levas. Não havia formulário já aprovado no CRM nessa conferência. Nenhum lead da planilha fornecida foi importado, aprovado ou alterado pela execução.

Dos 22 contatos do site, 21 não tinham perfil gravado na captura aprovada. O sistema indica dados não enviados pela origem, preservando essa distinção. Atualizações posteriores aparecem separadas da captura aprovada e das correções do SDR.

## Correção

- Perguntas e respostas em Contato e identificação, Perfil do atleta, Histórico no futebol, Objetivos e dificuldades, Comprometimento, Relatório do site, Origem da campanha e Outras respostas.
- As 11 perguntas de qualificação da campanha mantêm a pergunta completa e a resposta integral. Campos novos continuam visíveis em Outras respostas.
- Colunas manuais preservadas suplementam respostas que faltam na projeção, evitando duplicar colunas idênticas. Campos vazios são indicados, sem inventar respostas.
- O site usa contato, perfil, relatório e atribuição integrais. A ficha consulta a revisão válida de maior número; falha de leitura fica explícita e oferece nova tentativa. Histórico antigo continua disponível por páginas.
- A mesma ficha atende SDR e closer. Geração, primeiro recebimento e entrada no CRM continuam separados, com segundos e fuso Brasília. Nenhum cadastro, decisão, prioridade ou snapshot é regravado por esta correção.
- O resumo legado permanece consultável, identificado como possivelmente abreviado. O registro técnico integral também permanece disponível.
- Contato e perfil do atleta têm identificação própria, mesmo quando os nomes coincidem. Valores divergentes do registro original e respostas revisadas por Tráfego aparecem com procedência explícita. Seções futuras do site continuam legíveis, sem depender do JSON.
- E-mails, UTMs e identificadores mantêm seus caracteres originais; a apresentação de opções do Meta não os transforma.

## Evidência de validação

Quatro regressões de renderização falharam antes da correção: categorias, colunas manuais ausentes da projeção, contexto completo do site e valores múltiplos/vazios. Passaram após a correção. O teste Chromium do contexto mais recente também falhou antes da implementação e passou depois.

Chromium verificou as 11 perguntas e duas colunas adicionais em sessões SDR e closer, sem mutações/importações. Duas sessões SDR com Realtime indisponível receberam contexto posterior automaticamente, preservando o telefone corrigido e a captura aprovada. A verificação existente de importações conferiu prioridade, horários, filtros e carregamento integral.

Passaram 125 regressões Node de tráfego, importações e recepção do site, mais as verificações de visibilidade de vendas e invalidação do CRM. TypeScript, lint dos arquivos alterados, build e varredura de segredos passaram. Não há mudança de dependências, schema ou permissões de banco.

A revisão independente apontou três falhas importantes: perda da procedência entre contato/perfil, omissão de seções futuras/valores originais divergentes e substituição de respostas originais por revisões. As três foram confirmadas por testes RED e corrigidas em uma passagem; os testes GREEN e a suíte de 125 regressões passaram. A formatação de identificadores recebeu outro teste RED→GREEN. Os três ensaios Chromium foram repetidos com o resultado final.

Às 19:15 de Brasília, a conferência remota somente de leitura manteve 743 leads, 426 formulários originais com o mesmo fingerprint de IDs, 319 eventos do site, zero órfãos e zero snapshots ausentes. O heartbeat indicava zero pendências e zero bloqueios. Contagens são uma fotografia da conferência, sujeita ao uso humano posterior.

Ruling: tratar como correção delimitada do contrato de contexto completo já aprovado. Reutilizar o checkout isolado existente e a execução nativa autorizada; não abrir outra rodada de desenho/plano nem importar o arquivo de referência.
