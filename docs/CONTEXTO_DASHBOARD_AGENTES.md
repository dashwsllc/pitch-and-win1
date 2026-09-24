# Contexto funcional da dashboard WS LTDA para criação de agentes

> Retrato funcional conferido no projeto em 24/09/2026. Este documento descreve o produto e suas regras de negócio para outra IA entender a operação. A interface exibe apenas áreas autorizadas para a conta conectada; um cargo, isoladamente, não deve ser tratado como permissão universal.

## 1. O que é a dashboard

A dashboard reúne prospecção, atendimento comercial, CRM, registro e aprovação de vendas, comissões, metas, rankings, Arena Comercial e métricas de tráfego. Os mesmos fatos de negócio alimentam várias telas. Uma venda, por exemplo, nasce pendente, passa por conferência e só então afeta faturamento aprovado, comissão e pontuação de Closer. Uma call registrada no CRM pode alimentar o desempenho do SDR na Arena. O horário de referência da operação é **Brasília (`America/Sao_Paulo`)**.

### Vocabulário essencial

| Termo | Significado |
| --- | --- |
| Lead | Pessoa/oportunidade acompanhada no CRM, com identidade e histórico próprios. |
| Abordagem | Contato comercial registrado no CRM ou no formulário de abordagens. A origem importa para certas metas. |
| Call Q | Call de qualificação. Pode ser agendada e posteriormente marcada como realizada; agendar não prova realização. |
| Repasse | Encaminhamento explícito de um lead qualificado ao fluxo de Closer, normalmente com call e contexto. |
| Venda cadastrada | Registro financeiro enviado para análise. Inicialmente fica pendente. |
| Venda aprovada | Venda validada pela gestão. Passa a contar nos indicadores financeiros e nas comissões aplicáveis. |
| Ciclo de meta | Intervalo de apuração diário, semanal ou mensal; é diferente do filtro visual de um gráfico. |
| Tarefa individual | Compromisso operacional de **uma pessoa específica**. Não se propaga aos demais membros do cargo. |
| Meta coletiva | Objetivo de equipe/cargo exibido na Arena. Não é uma tarefa individual. |

## 2. Cargos, hierarquia e responsabilidades

A hierarquia da operação é de **gestão e fluxo de trabalho**, não uma escala na qual cada cargo herda automaticamente todos os acessos dos anteriores. Uma conta pode acumular cargos e receber permissões específicas. A aplicação e o banco verificam as capacidades efetivas da conta, seu estado de aprovação e eventual suspensão.

| Papel | Posição na operação | Responsabilidade principal | Ações e limites relevantes |
| --- | --- | --- | --- |
| **Executive** | Gestão da operação | Organiza pessoas, metas, tarefas, catálogo, decisões comerciais e acompanhamento do time. | Define o destinatário e o prazo de tarefas individuais; configura metas coletivas e individuais; acompanha resultados, revisa vendas, contas, solicitações e saques nas áreas administrativas concedidas à conta. Deve manter rastreabilidade das decisões. |
| **Gestor de Tráfego** | Aquisição | Informa a origem paga de demanda. | Registra por dia e campanha a plataforma, o investimento e os leads gerados; acompanha CPL. Não recebe automaticamente capacidade de qualificar leads ou registrar vendas. |
| **BDR** | Prospecção | Atua na geração inicial de oportunidades. | O cargo aparece no cadastro organizacional como Prospecção. A versão atual não possui um módulo exclusivo de BDR; funções adicionais dependem dos cargos e acessos acumulados na conta. |
| **SDR** | Qualificação | Aborda, classifica, acompanha e qualifica leads; agenda calls e faz o repasse para Closer quando cabível. | Opera as áreas SDR do CRM. Sua meta e posição na Arena usam **ciclo diário**. Não recebe, só por ser SDR, as ações de fechamento do Closer. |
| **Closer** | Fechamento | Assume oportunidades repassadas, conduz a call de fechamento, faz follow-up e registra o resultado. | Opera a fila Closer e pode também executar as operações SDR no CRM. Pode registrar a venda comercial. Sua meta e posição semanal na Arena usam **ciclo semanal**, sem reinício diário. |
| **Seller** | Registro comercial | Registra vendas e acompanha seu resultado financeiro. | Pode acessar o cadastro de vendas e o CRM de leads conforme a matriz de acesso. A condição de Seller, por si só, não concede as ações SDR/Closer. |

**Fluxo típico:** Tráfego/BDR geram oportunidades → SDR aborda e qualifica → Closer assume e conduz o fechamento → Closer ou Seller habilitado cadastra a venda → Executive confere a venda → os painéis, a Arena e a comissão refletem a decisão. Esse é um fluxo de trabalho, não uma obrigação de preencher todos os cargos em cada lead. O Executive pode operar etapas comerciais quando suas permissões permitem.

**Acesso combinado:** uma pessoa pode ter mais de um papel. Closer herda as operações SDR do CRM, mas a pontuação da Arena continua vinculada ao evento e ao papel responsável. Uma autorização específica pode dar a um SDR ações de Closer **somente no CRM** sem mudar sua pontuação ou o responsável por vendas. Conceder acesso geral a leads não equivale a conceder ações de SDR, Closer ou Vendas.

## 3. Entrada e segurança da conta

O usuário entra ou solicita cadastro em `/auth`. Um cadastro novo começa aguardando análise; a sessão pode consultar o andamento, mas não abre as áreas comerciais antes da aprovação. O Executive analisa solicitações de cadastro nas áreas de gestão. Uma conta suspensa perde o acesso à operação. Recuperação de senha e confirmação de e-mail têm fluxos próprios. O menu mostra apenas módulos disponíveis para a conta; dados pessoais e financeiros não devem aparecer em quadros coletivos sem necessidade.

## 4. Mapa das áreas da aplicação

| Área | Para que serve | O que o usuário encontra ou faz |
| --- | --- | --- |
| **Dashboard** (`/`) | Visão inicial da operação e do próprio desempenho. | Filtros Hoje, Ontem, 7/14/30 dias, todo o período e intervalo personalizado; receita e quantidade de vendas aprovadas, ticket médio, abordagens, conversão e posição no ranking; metas em andamento, metas de turno, evolução das vendas, produtos em destaque, últimas aprovações, quadro de vendas do time, prévia de ranking e atalhos. |
| **Central Executive** (`/executive`) | Gestão e leitura consolidada. | Solicitações de cadastro; indicadores de Sellers, vendas, faturamento, conversão, abordagens e assinaturas; top Sellers, evolução e atividade recente. Abas de vendas, produtos/tickets, contas/acessos, solicitações de senha, Sellers, metas, saques e auditoria, conforme a permissão administrativa efetiva. |
| **CRM** (`/crm`) | Registro e avanço dos leads. | Abas Leads, SDR, Closer e Resultados conforme capacidade; busca, filtros, classificação, agenda, timeline, repasse, fila, follow-up e resultado. Áreas de gestão de usuários/permissões aparecem apenas quando autorizadas. |
| **Nova abordagem** (`/abordagens`) | Registro manual de contato. | Nomes e dados abordados, tempo médio, indicação se a IA foi apresentada e relato da abordagem. Esse registro é uma possível fonte de contagem para uma meta de turno. |
| **Vendas** (`/vendas`) | Cadastro de venda. | Produto e ticket ativos do catálogo, dados do comprador e informações comerciais. Um lead fechado no CRM pode abrir o formulário já vinculado; a venda enviada fica pendente até revisão. |
| **Minhas Vendas** (`/minhas-vendas`) | Acompanhamento individual. | Vendas e seus estados, receita e comissão aprovadas, comissão pendente, saldo disponível e taxa de comissão exibida para a conta. |
| **Metas** (`/metas`) | Compromissos e resultados comerciais. | Vendas do time e Minhas tarefas para colaboradores; Gestão de metas, Histórico, Auditoria e Configurações para contas Executive habilitadas. |
| **Arena Comercial** (`/arena`) | Painel de desempenho ao vivo, inclusive para monitor/TV. | Barras de metas, ranking SDR e Closer, indicadores do período, gráfico, feed de eventos, progresso individual, ritmo, prazo e contagem regressiva quando configurada. Disponível aos papéis comerciais e Executive autorizados. |
| **Ranking** (`/ranking`) | Comparação de desempenho. | Pódio e tabela de pessoas com vendas aprovadas, abordagens, conversão e outros indicadores; a Arena também mostra rankings operacionais por ciclo. |
| **Tráfego** (`/trafego`) | Acompanhamento da aquisição paga. | Registro/edição de data, plataforma, campanha, investimento e quantidade de leads; CPL = investimento ÷ leads gerados. Acesso para Gestor de Tráfego e Executive autorizado. |
| **Clientes** (`/clientes`) | Gestão de clientes de assinatura mensal. | Cadastro de assinatura com produto, valor e contato do cliente; lista de assinaturas ativas/inativas e mudança de estado. É um módulo distinto do CRM de leads e depende de acesso administrativo específico. |
| **Saques** (`/saques`) | Recebimento de comissões. | Saldo disponível, comissão pendente, total sacado, solicitação por Pix e histórico de solicitações. O painel de gestão revisa saques e pagamentos conforme permissão. |
| **Perfil** (`/perfil`) | Dados pessoais da conta. | Foto, nome de exibição e alteração de senha; e-mail apresentado para consulta. |
| **Configurações** (`/configuracoes`) | Preferências da interface. | Tema, avisos na tela, opções de notificação e saída da conta. |

O antigo caminho `/vendas-time` abre a aba **Vendas do time** em Metas. Um atalho visível na dashboard não altera as permissões da rota de destino.

## 5. Como o CRM funciona

### 5.1 Entrada e qualificação

Um lead novo guarda seu próprio identificador e histórico. No cadastro, nome do responsável, nome do atleta e WhatsApp são obrigatórios; e-mail e demais dados são opcionais, sujeitos à validação quando preenchidos. Há dois eixos distintos: **aquecimento** (`frio`, `morno`, `quente`) e **estado de abordagem** (`não abordado`, `em abordagem`, `abordado`, `reabordado`). A interface também organiza a esteira e permite buscar, filtrar, ordenar e consultar a timeline.

O SDR registra a abordagem, atualiza a classificação e agenda a Call Q quando apropriado. Um lead quente e abordado/reabordado pode aparecer como pronto para Closer, mas **não é repassado automaticamente**. Para encaminhá-lo, o SDR informa responsável, horário e contexto da call e confirma **Agendar call e enviar**. O agendamento e o repasse são uma operação única; o lead não é duplicado.

### 5.2 Closer e desfecho

A aba Closer tem fila de leads enviados, itens não assumidos, meus leads, calls de hoje/futuras/atrasadas e resultados. **Assumir lead** vincula a oportunidade ao usuário que executou a ação. O Closer pode agendar ou reagendar, fazer follow-up com próxima data, registrar venda concluída ou perdida e devolver o lead ao SDR. A linha do tempo registra autor, horários e transições. A devolução preserva o histórico.

Registrar **venda concluída no CRM** é um resultado de atendimento, não um lançamento financeiro. Para entrar no faturamento, alguém com capacidade de Vendas precisa cadastrar a venda em `/vendas`, escolhendo produto e ticket e informando o comprador. A vinculação ao lead é preservada e um mesmo fechamento não deve gerar cadastros duplicados.

### 5.3 Calls e evidência

Call agendada, Call Q realizada, repasse e call de fechamento realizada são fatos diferentes. A Arena só atribui o marco de qualificação realizada quando há confirmação correspondente; encerramentos automáticos não presumem comparecimento. Agendamentos cancelados e eventos revertidos deixam de compor o resultado aberto conforme a regra do ciclo, mas permanecem no histórico de auditoria.

## 6. Vendas, catálogo, comissões e saques

1. O Executive mantém **produtos e tickets** com preços em reais. Só produtos/tickets ativos podem ser escolhidos para novos cadastros. O preço e os nomes escolhidos ficam preservados na venda; mudar o catálogo depois não altera vendas passadas.
2. O usuário autorizado envia a venda com produto, ticket, comprador e demais campos exigidos. Ela entra como **pendente** e aparece no quadro do time e em Minhas Vendas.
3. O Executive confere e **aprova ou rejeita**. A aprovação é o evento que torna a venda elegível para receita aprovada, comissão e pontuação de Closer. Rejeição e exclusão exigem motivo e ficam auditadas.
4. A taxa de comissão aplicável é fixada no momento da aprovação, inclusive quando for 0%. Venda pendente não cria saldo sacável. Reservas de saque e pagamentos reduzem o saldo disponível.
5. Cancelamento ou estorno de venda aprovada corrige os totais ativos e a pontuação do ciclo aberto. O fato original e sua reversão continuam no histórico. Ciclos já encerrados permanecem consolidados. Alterações financeiras que toquem saques comprometidos exigem tratamento administrativo apropriado.
6. A pessoa com saldo disponível solicita saque informando valor e dados Pix. Ela acompanha o estado em **Saques**; o Executive acompanha a fila de gestão e registra as decisões cabíveis.

O quadro **Vendas do time** expõe vendedor, produto, valor, data da compra e status para acompanhamento da operação. Dados privados do comprador e de comissão não são distribuídos no feed coletivo. **Minhas Vendas** concentra o detalhe financeiro da própria pessoa. A data da compra é a referência dos indicadores históricos; a data da aprovação é a decisão, não uma compra nova.

## 7. Metas, tarefas e Arena Comercial

### 7.1 Três coisas diferentes

| Tipo | Quem define | Destinatário | Como acompanha |
| --- | --- | --- | --- |
| **Meta coletiva de Arena** | Executive | Time ou cargo configurado | Progresso e ranking da Arena, calculados a partir dos eventos reais do ciclo. |
| **Meta individual de resultado** | Executive | Uma pessoa escolhida | Visível ao Executive e ao colaborador atribuído; pode substituir o alvo padrão daquela pessoa. |
| **Tarefa operacional individual** | Executive | **Exatamente uma pessoa escolhida** | Checklist/status em Minhas tarefas. Não é automaticamente compartilhada com colegas do mesmo cargo. |
| **Meta de abordagens por turno** | Executive | **Exatamente uma pessoa escolhida** | Quantidade alvo, início e duração do turno; barra de progresso atualizada pelos registros reais da fonte selecionada. |

O Executive informa título, colaborador e data ao criar uma tarefa. Pode revisar/remover tarefas autorizadas e converter uma tarefa pendente em meta de turno. O colaborador acompanha a própria tarefa, atualiza seu estado operacional e registra sua conclusão. A conclusão manual do checklist **não cria** pontos de call ou de venda. Quando uma tarefa é individual, selecioná-la por cargo ou replicá-la para todos é comportamento incorreto; objetivos de equipe pertencem às metas coletivas da Arena.

Na meta de turno, o Executive define **quantas abordagens** devem ocorrer, **quando começa** e **quanto dura** (até 24 horas). Seleciona uma única fonte de contagem: eventos de abordagem no CRM ou registros do formulário Nova abordagem. O sistema não deve somar as duas fontes para a mesma meta. A barra do colaborador mostra realizado/alvo e estado do turno na Dashboard e em Metas, atualizando conforme as abordagens da fonte escolhida são registradas. Uma meta pode estar programada, em andamento, encerrada ou cancelada. Cancelamentos ficam auditados.

### 7.2 Relógios que não podem ser confundidos

- **SDR na Arena:** pontos, ranking e alvo operacionais usam o **dia de Brasília**. O ciclo diário recomeça no dia seguinte.
- **Closer na Arena:** pontos, ranking e alvo operacionais usam a **semana de Brasília**, de **segunda a domingo**. Não há reinício diário da meta semanal.
- **Venda feita no domingo:** para a **pontuação semanal de Closer**, entra no ciclo que começa na **segunda-feira seguinte**. Exemplo: compra em **20/09/2026, domingo**, dá os pontos à semana **21/09 a 27/09/2026**. A data real de compra, receita, gráfico, histórico e ranking mensal continuam em 20/09.
- **Ranking mensal de Closer:** segue o mês civil de Brasília; é separado do ranking semanal operacional.
- **Filtro do painel:** Hoje, 7 dias, 30 dias ou período personalizado alteram indicadores e gráficos de consulta. Não mudam o ciclo diário do SDR nem o semanal do Closer.

### 7.3 Origem de pontos e cálculo de progresso

Os eventos da Arena vêm de ações reais: agendamento de Call Q (**0,2 ponto SDR**), call de fechamento/repasse agendado (**0,4 ponto SDR**, quando aplicável), qualificação realizada que avançou para repasse (**0,5 ponto SDR**, com evidência de realização) e venda aprovada (**10 pontos Closer**). Cancelamentos e reversões geram os ajustes cabíveis. O alvo padrão de pontuação é **100 pontos para 100%**, salvo meta individual vigente que substitua o alvo. **Progresso = realizado ÷ alvo × 100**; o número pode superar 100%.

As metas podem ser diárias, semanais ou mensais; de receita global, pontuação por cargo ou pontuação individual. O Executive configura alvo, vigência, recorrência, visibilidade e contagem regressiva. Alterações criam novas versões e exigem rastreabilidade. Um ciclo aberto pode refletir correções válidas de venda/evento; ao fechar, seu resultado fica preservado. A Arena mostra barras, estado em relação ao ritmo, valor faltante, projeção, rankings SDR/Closer, feed, gráfico e avisos. O percentual coletivo usa a soma do realizado dividida pela soma dos alvos individuais aplicáveis. O som de venda depende de acionamento pelo usuário.

## 8. Consistência, privacidade e comportamento esperado do agente

1. **Fonte do fato:** CRM é a fonte do estado do lead/call; cadastro e revisão de Vendas são a fonte do faturamento/comissão; eventos da Arena derivam dessas ações. Um texto de tarefa não comprova que uma call aconteceu ou que uma venda foi aprovada.
2. **Destinatário explícito:** ao falar de tarefa individual, use o identificador da pessoa escolhida. Nunca transforme um cargo em múltiplos destinatários por inferência. Metas coletivas são outro objeto.
3. **Estado antes de número:** diferencie pendente, aprovada, rejeitada, cancelada e estornada. Só vendas aprovadas ainda válidas compõem os totais ativos. Guarde a decisão e o motivo na auditoria.
4. **Data correta:** diferencie data da compra, data de aprovação, data do evento CRM, data de crédito semanal da Arena e horário de Brasília. Uma venda de domingo não muda sua data real só porque seus pontos semanais entram na próxima segunda-feira.
5. **Dados por escopo:** metas individuais e dados financeiros pessoais aparecem apenas a quem tem acesso; quadros coletivos mostram só as informações necessárias. Uma conta pode acumular cargos; confirme capacidades efetivas em vez de deduzi-las pelo nome do papel.
6. **Sincronização:** operações confirmadas atualizam consultas da Dashboard, CRM, Vendas, Metas, Arena e rankings. O produto usa eventos em tempo real, revisões, reconciliação periódica e atualização entre abas. Caso uma tela esteja desatualizada ou desconectada, o agente deve consultar novamente o dado de origem antes de afirmar um estado.
7. **Conflitos:** edições concorrentes de lead, venda, tarefa, meta ou catálogo verificam a versão/estado atual. Quando houver conflito, recarregue os dados e apresente a diferença; não sobrescreva silenciosamente nem duplique ações.
8. **Rastreabilidade:** repasses, aprovações, cancelamentos, estornos, mudanças de meta e correções deixam autor, horário e motivo quando exigido. Eventos históricos preservam o fato original mesmo quando o total ativo é corrigido.

### Resumo para instruir um agente

> Entenda primeiro **quem é o usuário e o que sua conta pode fazer**, depois **qual entidade está em jogo** (lead, call, venda, tarefa, meta ou saque), **qual é seu estado atual** e **qual relógio rege o resultado** (dia SDR, semana Closer, mês civil, turno ou data de compra). O Executive atribui tarefas a pessoas específicas e administra metas; o colaborador executa e acompanha somente o que lhe foi atribuído. O CRM conduz o lead, Vendas registra e valida o negócio, e a Arena reflete eventos reais sem criar fatos próprios. Sempre confira o dado atualizado antes de responder ou agir e preserve o histórico das decisões.
