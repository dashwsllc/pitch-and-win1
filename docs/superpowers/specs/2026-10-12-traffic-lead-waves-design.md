# Levas de leads e chegada ao CRM do SDR

Data: 12/10/2026. Base examinada: `pitch-and-win1`, commit `8cebb5d`. Destino comercial: Supabase `dash`, `mbzwchnxtskysqplqiyy`.

Estado: desenho e especificação escrita aprovados pelo usuário nesta conversa em 12/10/2026. O plano de implementação será revisado antes da execução. Este documento não registra aprovação de leads reais nem autorização para publicar métricas automaticamente.

## 1. Resultado esperado

O gestor precisa revisar leads de formulário em levas de até 20, localizar primeiro os mais recentes e encaminhar os aprovados à fila compartilhada do SDR. O SDR precisa ver quando cada pessoa enviou o formulário e há quanto tempo aguarda atendimento. Data de geração, chegada ao sistema e entrada no CRM têm significados diferentes e precisam permanecer identificadas.

A leva incompleta fica disponível imediatamente. Nenhum lead aguarda a chegada de outras 19 pessoas para poder ser revisado. Aprovação e rejeição continuam decisões humanas, com registro de quem decidiu e quando.

## 2. Evidência e escopo

Na consulta de produção de 12/10 havia 148 leads de formulário pendentes, nenhum vinculado ao CRM. Destes, 146 tinham nome e telefone com pelo menos oito dígitos; nenhum tinha e-mail ou nome do atleta reconhecido pelo conversor atual. O conversor exige esses dados, nascimento e posição. Apenas agrupar a tela existente manteria o bloqueio de encaminhamento.

A tela atual lista os 50 mais antigos, sem paginação. `lead_generated_at` já existe no CRM, mas o cartão e a ficha não o apresentam. A ordem atual considera a criação do registro no CRM, que pode ocorrer muito depois do formulário.

Esta especificação cobre agrupamento, revisão, envio ao CRM, horários, prioridade e atualização entre sessões. Captura e publicação de métricas, recuperação histórica pela API e campanhas para o site continuam na auditoria de tráfego e recebem implementação própria. Contagens de Insights não serão tratadas automaticamente como uma lista comprovada de contatos ausentes.

O documento local `docs/TRAFEGO_LEVAS_AUDITORIA_E_PLANO_2026-10-12.md` foi preservado. Ele registra propostas adicionais e decisões de outro fluxo; esta especificação torna explícito o contrato das levas para revisão nesta conversa.

## 3. Experiência na dashboard

Em Tráfego → Aprovações haverá uma lista paginada de levas, ordenada pela data de geração do lead mais recente de cada leva, em ordem decrescente. Empates usam o número da leva. O indicador da aba distinguirá leads aguardando revisão de revisões de métricas.

Cada cartão mostra número, quantidade, estado da revisão, data e hora do primeiro e do último formulário, chegada mais recente ao sistema e resumo de envio ao CRM. Levas com 20 ficam fechadas para novas entradas. A última leva parcial aparece assim que recebe o primeiro lead.

Ao abrir uma leva para revisão, seu conjunto de membros fica fechado. Uma nova entrada vai para a próxima leva. O detalhe mostra todos os membros, mais recentes primeiro, com nome, WhatsApp, campanha, formulário, respostas e os seguintes horários:

- **Formulário enviado em:** `created_time`, informado pela Meta.
- **Recebido no sistema em:** primeiro recebimento durável conhecido.
- **Disponível no CRM em:** horário de criação ou vinculação efetiva ao CRM, quando existir.

Aprovar a leva aprova os membros pendentes exibidos. O gestor pode rejeitar membros individualmente com motivo e aprovar os restantes. Rejeitar a leva inteira também exige motivo. Decisões individuais já existentes são preservadas e não são repetidas pela aprovação coletiva.

A tela informa o resultado exato: quantidade aprovada, rejeitada, enviada ao CRM e com falha de envio. Uma leva revisada com falhas continua visível e oferece nova tentativa somente para leads aprovados que ainda não chegaram ao CRM.

## 4. Agrupamento persistente

Uma tabela `meta_lead_waves` guarda identificador, número sequencial, versão, estado de abertura, datas, responsável e horário da revisão. Cada lead de formulário capturado automaticamente recebe um `wave_id` persistente. Importações por planilha mantêm seu fluxo de aprovação de lote.

As invariantes são:

1. Cada lead pertence a, no máximo, uma leva; todos os novos leads automáticos pendentes recebem uma leva.
2. Nenhuma leva contém mais de 20 membros, inclusive sob recebimentos simultâneos.
3. Existe, no máximo, uma leva aberta para entrada automática no dashboard.
4. Completar 20 membros ou iniciar a revisão fecha a entrada nessa leva. A próxima é criada quando chega outro lead.
5. Novas entradas, reprocessamento e rejeição não deslocam os membros das levas existentes. Não há reagrupamento automático de levas revisadas.
6. Exclusões comerciais ficam registradas como rejeição; o vínculo histórico com a leva permanece.

Um procedimento transacional, com trava de distribuição e bloqueio das linhas envolvidas, atribui membros e incrementa a versão. A função de iniciar revisão fecha uma leva parcial de forma idempotente antes de devolver os membros. A consulta de lista continua somente leitura.

Na instalação, os leads automáticos ainda pendentes são agrupados por data de geração crescente, com desempate pelo primeiro recebimento e pelo identificador. Com os 148 encontrados, isso produz sete levas de 20 e uma de oito, exibindo a mais recente primeiro. O agrupamento inicial é fechado ao terminar; entradas posteriores não se misturam ao histórico migrado. Se a quantidade mudar antes da instalação, o mesmo algoritmo se aplica à quantidade real.

Leads antigos recuperados depois recebem levas históricas próprias, sem mover membros existentes. Sua posição na lista depende da geração do formulário, não da data da recuperação.

## 5. Revisão, concorrência e permissões

As funções de lista e detalhe respeitam `traffic_has_access()`. Iniciar revisão, decidir e repetir envio exigem a mesma autorização de tráfego hoje aplicada à aprovação individual. A interface não decide permissões comerciais.

A decisão envia o identificador e a versão da leva, os identificadores exibidos e as versões dos leads. O servidor valida o conjunto completo antes de registrar decisões. Qualquer edição ou decisão concorrente invalida a tentativa: a tela precisa recarregar e apresentar a alteração. Nenhum lead que não foi visto será aprovado por efeito de uma nova entrada.

Repetir a mesma decisão concluída devolve o resultado registrado, sem duplicar CRM ou contexto. Uma solicitação diferente para uma revisão concluída é recusada e não altera o histórico. Rejeições exigem motivo entre três e 500 caracteres.

A revisão coletiva é transacional. Os erros esperados de cadastro ou envio são tratados por lead, com resultado persistente: uma falha não oculta o sucesso dos demais. Falhas de autorização, versão ou integridade da decisão cancelam a decisão inteira.

Os sinais de mudança de tráfego e CRM existentes serão reaproveitados. Lista e detalhe invalidam seus dados após decisões, recebimentos e novas tentativas, inclusive em outra sessão. A auditoria registra a leva, os membros, o ator e o resultado sem expor respostas pessoais em sinais públicos.

## 6. Entrada útil no CRM

Para cumprir o encaminhamento rápido, propõe-se que um lead Meta aprovado entre com nome e WhatsApp utilizáveis, origem e respostas do formulário. E-mail, nome do atleta, nascimento e posição ausentes continuam vazios. O SDR completa esses dados no atendimento; valores não serão inventados para vencer a validação.

O limite de entrada é nome com pelo menos dois caracteres e telefone normalizado com pelo menos oito dígitos, mantendo a verificação de telefone existente. Essa regra mínima se aplica somente à entrada de formulário aprovado. Qualificação, transferência ao closer e avanço no funil continuam exigindo os dados correspondentes.

O lead entra sem SDR atribuído, na fila compartilhada, e não cria uma abordagem no ranking. O servidor preserva as regras existentes de autoria e aprovação. Nome e telefone inválidos ficam como falha de envio, com motivo visível, edição e nova tentativa; continuam acessíveis para correção.

O vínculo único por `meta_form_lead_id` impede duplicação. Um registro de contexto guarda todas as respostas originais, campanha e formulário, com origem identificada; repetição de envio não cria outro contexto. Correções são registradas separadamente do conteúdo original. O SDR pode consultar o contexto na ficha do CRM.

Os caminhos de aprovação individual e envio de lote que já usam o conversor de formulário passam a compartilhar a mesma operação de envio, evitando regras divergentes. A implantação precisa examinar todos os gatilhos de CRM que hoje exigem cadastro completo; alterar só o conversor não é suficiente.

## 7. Horários, prioridade e urgência

Todos os instantes são guardados como `timestamptz`. A interface apresenta `America/Sao_Paulo` explicitamente, com data completa e hora incluindo segundos no detalhe. O fuso do computador não muda o horário mostrado.

`lead_generated_at` recebe o `created_time` original. Um campo próprio de chegada recebe o primeiro recibo durável conhecido do lead, obtido dos recibos de captura e do recebimento já registrado. Reprocessar, aprovar ou repetir envio não atualiza esses dois instantes. Registros antigos sem prova de um horário mostram indisponibilidade, sem estimar ou usar a aprovação como chegada.

No cartão e na ficha, o CRM mostra “Formulário enviado em …” e o tempo decorrido. “Recebido no sistema” e “Disponível no CRM” ficam acessíveis no detalhe. A lista de importados prioriza geração decrescente; o restante do CRM mantém sua ordenação atual. Leads históricos recuperados não aparentam ter enviado o formulário agora.

O tempo decorrido se atualiza a cada minuto. Leads ainda sem primeiro atendimento têm indicação de urgência a partir da geração; a marca de primeiro contato permanece distinta da criação ou aprovação. Não será criado um SLA contratado nem prometida uma latência sem medição.

## 8. Contratos e compatibilidade

As operações previstas são lista paginada de metadados, início de revisão com retorno de membros, decisão versionada e repetição de envios falhos. Os nomes finais das funções seguem os padrões `meta_wave_*`. O detalhe carrega no máximo 20 membros; a lista não consulta respostas de todos os leads.

A migration adiciona estruturas e horários sem apagar recibos, leads, correções ou decisões. Funções existentes mantêm contratos compatíveis durante a publicação. As permissões, gatilhos de revisão, sinalização e tipos do frontend fazem parte da alteração, com revisão do histórico remoto antes de qualquer aplicação seletiva. Não haverá reaplicação geral de migrations.

Levas aprovadas, parcialmente rejeitadas ou com falha de envio precisam ter estado derivado coerente. O cartão apresenta os contadores individuais; uma leva com 19 aprovados e um rejeitado não aparece como 20 enviados.

## 9. Provas de aceitação

- Distribuir 0, 1, 19, 20, 21 e 148 leads, incluindo entradas simultâneas, sem duplicação nem excesso de 20.
- Abrir uma leva parcial e receber outro lead: o detalhe mantém os membros vistos e o novo lead aparece em outra leva.
- Conferir geração, primeiro recebimento e CRM ao segundo; repetir processamento e aprovação sem mudar os horários.
- Aprovar, rejeitar e excluir individualmente com motivo; recusar versão antiga e ação sem permissão.
- Repetir decisão e envio sem duplicar lead, contexto ou abordagem; falha de telefone em um membro não oculta os demais resultados.
- Corrigir o contato falho e repetir somente seu envio, preservando revisão e auditoria.
- Confirmar prioridade dos recentes na lista, no detalhe e na aba Importados do CRM, inclusive com leads antigos recuperados hoje.
- Verificar horários no mesmo instante com navegadores em fusos diferentes e tempo decorrido atualizado.
- Abrir duas sessões e provar atualização de contagens, revisão e CRM após a mesma alteração.
- Executar regressões relevantes, verificações de tipos, lint dos arquivos alterados e build. Os 78 testes de tráfego já executados nesta auditoria passaram; eles não comprovam o recurso novo.

Decisões sobre leads comerciais continuam na tela de revisão. A validação de envio usa dados sintéticos em transação revertida ou ambiente de ensaio identificado. Uma aprovação real depende da decisão expressa do usuário.

## 10. Publicação e reversão

A implementação terá plano próprio depois da revisão desta especificação. A ordem prevista é estrutura compatível e testes, funções, frontend, agrupamento histórico idempotente e verificação do estado publicado. Um bloqueio de ferramenta ou permissão será informado com a ação e sua causa; não se pressupõe a existência da trava de outro assistente.

Para reversão, interrompe-se a entrada nas novas levas e retorna-se a interface compatível com os dados atuais. Levas, membros, horários, auditoria e vínculos com CRM permanecem preservados. O fluxo anterior de aprovação individual continua disponível durante a transição e usa a mesma regra de envio.
