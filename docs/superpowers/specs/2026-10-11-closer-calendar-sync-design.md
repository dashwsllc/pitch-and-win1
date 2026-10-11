# Integração das calls do Closer com o Google Agenda

Data: 2026-10-11

Estado: desenho conversacional e especificação escrita aprovados pelo usuário em 2026-10-11; plano escrito aguardando revisão e escolha do modo de execução.

Projeto: `pitch-and-win1`.

## 1. Objetivo e decisões aprovadas

Sincronizar as calls encaminhadas à fila Closer do CRM com **uma única agenda Google compartilhada por todos os closers**. O usuário já possui essa agenda, criada pela conta administradora da empresa; ela será selecionada como destino da integração. O CRM controla o horário, o responsável e o ciclo de vida da call. O usuário aprovou a sincronização CRM → Google, atualização das remarcações, remoção dos cancelamentos e devoluções ao SDR, preservação das calls concluídas e inclusão das calls futuras existentes.

A duração padrão aprovada é 30 minutos, com fuso `America/Sao_Paulo`. A configuração conecta a conta Google administradora da empresa e permite escolher a agenda de closers existente. O usuário confirmou que essa agenda ainda não contém calls; os compromissos passarão a ser publicados pela integração quando ela for ativada. Não é necessário importar ou vincular calls cadastradas manualmente no Google nesta entrega. O usuário pediu atenção especial à ausência de duplicidades e à correção permanente da sincronização.

O desenho usa entrega em segundo plano, identidade persistente por call, controle de concorrência, novas tentativas e reconciliação. Supabase e Google não participam de uma mesma transação: durante uma indisponibilidade pode existir atraso, que deve aparecer como pendência ou erro. O sistema só apresenta uma call como sincronizada quando a revisão vigente do CRM tiver sido confirmada no Google. Não promete atualização instantânea durante falhas externas.

### Alternativas consideradas

- **Escolhida: CRM → Google.** Os usuários operam o CRM existente; a integração publica a mesma informação na agenda compartilhada.
- **Sincronização nos dois sentidos.** Permitiria editar horários e responsáveis pelo Google, mas precisaria de regras de conflito e validação do fluxo comercial. Não integra esta entrega.

## 2. Base existente e limites da mudança

O projeto usa React/TypeScript, Supabase/Postgres e Edge Functions. A fonte das calls é `crm_activities`; a fila comercial é `crm_leads.pipeline_stage = 'repassado_closer'`.

Reutilizar:

- `handoff_and_schedule_closer_call`: transação que encaminha o lead e cria a call.
- `schedule_closer_call`, `update_crm_call`, `arena_cancel_call` e as transições de resultado/devolução existentes.
- As permissões `crm_user_can`, incluindo a capacidade administrativa para executive e super_admin.
- As conversões de horário de `src/lib/brasilia-time.ts`.
- O padrão de Edge Functions autenticadas, cron e segredos no servidor já usado pelas integrações Meta.

Adicionar a integração por triggers e funções específicas, sem substituir as regras comerciais desses RPCs. Não modificar pontuações, vendas, métricas, auditoria comercial ou acesso dos closers aos leads.

Sem novos provedores, agenda por Closer, convites aos clientes, geração de Google Meet, reservas de disponibilidade ou campos de duração por call nesta entrega. O compartilhamento da agenda com a equipe continua sendo uma configuração do Google Agenda; conectar uma conta ao dashboard não concede acesso Google a outros usuários.

## 3. Regras de seleção e ciclo de vida

Uma call entra na sincronização quando:

1. `call_type = 'fechamento_closer'`.
2. O lead está em `repassado_closer`.
3. A call possui `scheduled_at` finito e `assigned_to` preenchido.
4. A call está pendente, sem cancelamento.

Qualificação SDR e alterações isoladas de `next_followup_at` não criam eventos: é necessário um registro de call. Filtros da interface, como “minhas”, “hoje” e “atrasadas”, não alteram a sincronização.

### Estado desejado, em ordem de prioridade

| Situação no CRM | Resultado na agenda |
| --- | --- |
| Call ou lead removido | Remover os eventos gerenciados correspondentes, usando registro persistente de remoção. |
| `cancelled_at` preenchido | Remover o evento; cancelamento prevalece sobre `is_completed`. |
| Call encerrada com devolução ao SDR (`devolvido_sdr` ou `followup_sdr`) | Remover o evento dessa call. |
| Call concluída com outro resultado | Preservar o evento e registrar “Concluída” e o resultado comercial. |
| Call pendente cujo lead saiu da fila Closer | Remover o evento pendente. |
| Call pendente elegível | Criar ou atualizar um único evento confirmado. |
| Call pendente com dados insuficientes | Não publicar dados incompletos; indicar pendência de correção. |

A conclusão tem precedência sobre a etapa atual do lead, após as regras de remoção: devolver um lead posteriormente não apaga uma call anterior efetivamente concluída. Uma devolução que encerra a própria call com resultado de devolução remove essa call.

Remarcar ou trocar o Closer altera o mesmo evento. Uma nova call com outro `crm_activities.id` é outro compromisso, mesmo que use o mesmo lead. Reabertura ou novo encaminhamento aproveita o novo registro de call produzido pelo fluxo existente; não reutiliza a identidade de uma call cancelada.

Ao ativar a integração pela primeira vez, incluir apenas calls pendentes elegíveis com `scheduled_at >= instante da ativação`. Não importar calls antigas ou concluídas anteriores à ativação. Depois que uma call foi registrada para sincronização, o relógio não a elimina: calls atrasadas continuam visíveis e uma indisponibilidade não descarta compromissos que ficaram no passado enquanto aguardavam entrega. Se uma call registrada concluir antes da primeira entrega, seu estado final também deve ser preservado; cancelamentos e devoluções continuam impedindo sua publicação.

## 4. Conteúdo e horário do evento

- Título: `Call de fechamento — {nome do lead} | {nome do Closer}`.
- Descrição: identificação do lead, Closer responsável, estado da call e link autenticado para o lead no CRM.
- Início: o instante de `crm_activities.scheduled_at`, sem reinterpretá-lo pelo fuso do navegador ou servidor.
- Fim: início + 30 minutos.
- `start.timeZone` e `end.timeZone`: `America/Sao_Paulo`.
- Evento único, sem recorrência; lembretes padrão da agenda.
- Propriedades privadas de integração: identificador do projeto, call, vínculo e revisão desejada.
- Campos comerciais completos, notas internas, tokens e telefones não são copiados automaticamente para a descrição.

Adicionar suporte a `/crm?tab=closer&lead=<uuid>` para abrir o lead após autenticação, respeitando o acesso atual. O CRM hoje lê o parâmetro `tab`, mas não possui abertura direta por `lead`; este pequeno ajuste é necessário para o link funcionar. UUID inválido, lead removido ou inacessível devem apresentar uma mensagem adequada, sem ampliar permissões.

Atualizações enviam apenas os campos que a integração controla. Não apagar convidados, lembretes ou outros campos acrescentados no Google. Alterações manuais no Google não modificam o CRM; campos controlados pela integração serão novamente alinhados ao CRM na reconciliação.

## 5. Configuração e autorização Google

### Experiência nas configurações

Adicionar um cartão “Google Agenda dos closers”, acessível para configurar somente por usuários com capacidade administrativa do CRM:

1. “Conectar Google Agenda” inicia OAuth com a conta administradora da empresa, que criou a agenda compartilhada existente.
2. Após o retorno, listar todas as páginas de agendas com permissão `writer` ou `owner`; permitir selecionar uma agenda existente.
3. Validar a agenda de closers existente e o acesso no servidor antes de ativar a configuração. Não criar outra agenda nem selecionar automaticamente a agenda principal da conta.
4. Mostrar agenda selecionada, conexão, última execução, quantidade de pendências e erros.
5. Permitir reconectar a mesma agenda, solicitar nova tentativa e desconectar.

A primeira entrega fixa o destino depois que houver vínculos de calls com a agenda. Reconectar não troca o destino nem apaga os vínculos. Alterar a agenda após esse ponto exige uma migração explícita de destino, fora desta entrega; desconectar não contorna essa restrição. Isso evita deixar eventos ativos em duas agendas por uma troca acidental.

Desconectar interrompe novas escritas, revoga a credencial quando possível e mantém os vínculos necessários para uma reconexão correta. Não apaga automaticamente eventos existentes. O cartão informa esse comportamento. As alterações do CRM continuam sendo registradas para entrega posterior à reconexão.

### OAuth e segredos

- Cliente OAuth do tipo aplicação web, com callback HTTPS registrado exatamente no Google Cloud.
- Scopes: `https://www.googleapis.com/auth/calendar.events` e `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. O primeiro atende agendas compartilhadas com edição; o segundo permite escolher a agenda.
- Acesso offline para renovação no servidor.
- `state` aleatório de uso único, armazenado como hash, vinculado ao administrador e à origem permitida, com validade de 10 minutos. Consumir atomicamente; rejeitar repetição e expiração. Revalidar a capacidade administrativa antes de salvar a conexão.
- Callback público de OAuth separado dos endpoints administrativos autenticados. Não depender de JWT na navegação de retorno do Google; autenticar a transação pelo estado persistido.
- Não aceitar URL de redirecionamento arbitrária. Retornar somente à origem do dashboard configurada no servidor.
- Client secret, access token e refresh token ficam exclusivamente no servidor. Tokens persistentes ficam criptografados no Vault, com referências em schema privado. Não incluir credenciais em campos públicos, Realtime, mensagens de erro ou logs.
- Renovação da credencial deve ser serializada para evitar sobrescrever um refresh token mais recente. Reconexão preserva o refresh token anterior somente quando for comprovadamente a mesma conta e o Google não devolver outro; outra conta exige uma nova credencial válida e acesso ao destino fixado.

Pré-requisitos operacionais: habilitar Calendar API, configurar o consentimento e cliente OAuth, registrar o callback e instalar os segredos nas Edge Functions. A agenda específica será escolhida na interface após conectar a conta; não é necessário pedir senha ou token ao usuário na conversa. O modo/publicação do consentimento deve ser adequado ao uso contínuo em produção e às exigências de verificação do Google aplicáveis ao projeto.

## 6. Componentes e persistência

### Dados privados

- **Conexão única:** identidade Google, referências dos segredos, scopes concedidos, situação da conexão e revisão da credencial.
- **Transações OAuth:** estado com hash, administrador, expiração e consumo.
- **Vínculos de eventos:** call e lead, agenda fixa, UUID do vínculo, ID Google persistente, geração, última revisão/hash confirmado, ETag, link Google e confirmação de remoção.
- **Fila durável:** chave do vínculo, revisão desejada, estado, tentativas, próxima tentativa, lease e token da execução, último erro sanitizado.

Vínculos e registros de remoção sobrevivem à exclusão do registro comercial. Não usar `ON DELETE CASCADE` para perder o ID Google antes de remover o evento externo. Manter cópia mínima dos identificadores, sem duplicar o conteúdo completo do lead em histórico de fila.

### Dados expostos ao produto

Expor somente projeções seguras da configuração e do status por call, com acesso administrativo para configuração e as mesmas permissões do CRM para leitura do status da call. Usuários comuns não podem editar a fila, a agenda, as revisões ou os IDs Google.

Funções de banco que leem segredos ou adquirem/confirmam trabalhos são exclusivas do worker/service role. Revogar execução para PUBLIC, anon e authenticated, fixar `search_path` e qualificar referências. Funções administrativas exigem autorização no banco e na Edge Function. Não confiar apenas na ocultação de botões.

### Backend

- Edge Function de gerenciamento: iniciar OAuth, listar/selecionar agenda, consultar situação segura, reconectar, desconectar e solicitar novas tentativas.
- Edge Function de callback OAuth: validar e consumir estado, trocar código e persistir a credencial.
- Edge Function de sincronização: entregar a fila e executar reconciliação com limites de tempo e lote.
- Módulo isolado de projeção: traduzir os dados atuais do CRM para a intenção `upsert`, `completed` ou `remove` e para os campos Google.
- Cliente Google isolado: renovação, paginação, criação/leitura/atualização/remoção e classificação de erros.

Não ampliar `arena-api.ts` com toda a integração. UI, contrato de configuração, projeção e acesso Google devem permanecer em módulos focados.

## 7. Fluxo durável e prevenção de duplicidades

### Registro transacional

Triggers leves registram a intenção na mesma transação de alteração do CRM. Cobrir inserção, edição, conclusão, cancelamento e exclusão de calls; etapa e campos do lead usados no evento; e alterações no nome do Closer. Não fazer chamadas HTTP ao Google dentro da transação.

Usar uma revisão monotônica própria por vínculo: horário `updated_at` sozinho não é suficiente para ordenar alterações de múltiplas tabelas. Alterações relevantes incrementam a revisão e sinalizam trabalho; alterações sem efeito na projeção não exigem escrita no Google.

A aquisição de trabalhos usa operação atômica com locks/`SKIP LOCKED`, lease e token exclusivo. Duas invocações não processam o mesmo vínculo simultaneamente. A confirmação exige o mesmo token e a revisão entregue; se outra edição ocorreu, a revisão nova continua pendente. Coalescer estados antigos, sem reproduzir cada alteração intermediária.

### Identidade Google

Gerar um UUID de vínculo e persistir seu ID Google compatível com base32hex **antes** de qualquer criação. Usar, por exemplo, o UUID sem hífens; incluir a identidade do projeto e da call em `extendedProperties.private`.

Manter unicidade local para o vínculo de uma call no destino e para o ID Google. A mesma tentativa, reconexão, execução manual, backfill ou reconciliação reutiliza o ID persistido.

Ao criar:

1. Recarregar a revisão e projeção atuais do CRM.
2. Consultar o ID persistido quando houver resultado anterior incerto.
3. Se o evento já existe e pertence ao vínculo, atualizar o evento existente.
4. Se não existe, criar com o ID persistido.
5. Se `insert` retornar 409, ler e verificar a propriedade de vínculo; reconciliar o existente. Não gerar outro ID por causa de timeout, 409 ou erro temporário.
6. Se um ID estiver ocupado por um evento que não corresponde ao vínculo, interromper e informar conflito; não sobrescrever evento alheio.

Usar ETag/`If-Match` nas atualizações e remoções. Em 412, reler o evento e o estado vigente do CRM antes de recalcular a operação. Verificar que o lease ainda pertence ao worker antes de cada escrita externa. Um resultado de execução antiga nunca confirma a revisão nova como sincronizada.

Para remoção repetida, 410 de evento já removido é sucesso. Um 404 não prova sozinho que o evento foi removido: verificar acesso à agenda para distinguir evento ausente de destino inacessível.

Se alguém apagar no Google uma call pendente e ainda válida no CRM, a reconciliação deve restaurar o compromisso. Reutilizar o ID quando o recurso puder ser restaurado. Somente após confirmar a remoção definitiva do ID anterior e o acesso à agenda, persistir atomicamente uma nova geração/ID antes da recriação. Não fazer essa rotação por resposta desconhecida. Esta exceção mantém um único evento ativo mesmo quando o Google conservar um registro de evento apagado que não possa ser reutilizado.

### Concorrência entre CRM e Google

Cada chamada externa possui timeout menor que o lease. O worker renova o lease antes de novas escritas; perda do lease encerra a execução. Uma resposta desconhecida é reconciliada pela identidade persistente antes de repetir a operação.

Como não existe transação distribuída, uma mudança do CRM durante uma requisição ao Google pode deixar temporariamente o estado anterior. A comparação de revisão impede confirmar esse estado como atual; a fila entrega a revisão nova. A reconciliação também corrige qualquer diferença restante. Este é o contrato de correção, sem ocultar atrasos como sucesso.

## 8. Entrega, reconciliação e erros

- Worker a cada minuto via cron, com lote limitado e orçamento de execução. Objetivo operacional: entrega no próximo ciclo em condições normais, sujeito à disponibilidade e cota do Google.
- Reconciliação a cada 15 minutos, paginada e com cursor persistente, para conferir todos os vínculos de calls pendentes e as remoções ainda não confirmadas, sem limitar silenciosamente à primeira página/lote. Não repetir escritas cujo conteúdo já coincide.
- Calls concluídas deixam de ser reconciliadas periodicamente após confirmação final, preservando histórico. Alterações relevantes explícitas no CRM ainda geram trabalho para o vínculo.
- Backfill de ativação é paginado, retomável e idempotente. Reexecutá-lo não duplica eventos.
- Cron autentica com segredo específico no servidor; endpoints administrativos exigem JWT válido e capacidade administrativa. A fila não é executável por uma chamada anônima comum.
- Status por call: desativada, aguardando conexão, pendente, sincronizando, sincronizada, remoção pendente, removida ou erro. Mostrar estado atual, não apenas o resultado da última tentativa.
- Exibir erro sanitizado e ação útil: “Reconectar Google”, “Revisar acesso à agenda” ou “Tentar novamente”. O usuário nunca recebe resposta OAuth bruta ou credenciais.

### Tratamento de falhas

| Falha | Comportamento |
| --- | --- |
| Timeout/rede/5xx/429 ou 403 com motivo de limite | Backoff exponencial com jitter, respeitando `Retry-After` quando presente; próxima tentativa persistida. |
| Access token expirado/401 | Renovar uma vez; se continuar, exigir reconexão sem perder a fila. |
| Refresh token revogado/`invalid_grant` | Marcar conexão como requerendo reconexão; suspender chamadas inúteis e preservar vínculos. |
| Agenda sem acesso de edição | Mostrar erro de acesso e suspender escritas até correção. Não transformar em “evento removido”. |
| 409 em criação | Ler identidade já existente e reconciliar o mesmo evento. |
| 412 em atualização/remoção | Reler estado e ETag, recalcular e repetir com limite. |
| Payload inválido/400 | Erro acionável por vínculo; evitar repetição automática infinita do mesmo payload. Nova revisão ou ação administrativa pode liberar. |
| Falha após sucesso Google e antes da confirmação local | Próxima execução recupera o evento pelo ID persistido e confirma ou atualiza a revisão vigente. |

Erros transitórios não têm um limite que descarte definitivamente uma call. Depois de sucessivas falhas, o intervalo pode aumentar e a interface deve evidenciar o problema. Corrigir a conexão ou os dados reativa a entrega. O agendamento comercial continua funcionando mesmo com Google indisponível; a transação do CRM só registra a intenção local.

## 9. Testes e critérios de aceitação

Implementar com TDD nos limites que possuem risco: projeção, idempotência, concorrência, autorização e ciclo de vida. Usar Google simulado nos testes automatizados; validar uma agenda exclusiva de teste para a integração real.

### Critérios obrigatórios

1. Encaminhar uma call elegível cria exatamente um evento na agenda escolhida.
2. Qualificação e lead apenas “pronto para Closer” não publicam eventos.
3. Remarcar várias vezes ou trocar o Closer mantém a identidade do evento e o horário/responsável mais recente.
4. Repetir worker, backfill, retry ou reconexão não cria segundo evento ativo.
5. Criação confirmada pelo Google com timeout ou falha de gravação local é recuperada sem duplicar.
6. Duas invocações concorrentes e alteração durante entrega não marcam revisão antiga como atual; a última revisão converge.
7. Cancelamento, devolução ao SDR, exclusão e conclusão seguem a tabela de prioridade, inclusive operações que alteram várias tabelas na mesma transação.
8. Encerrar uma call e abrir outra para o mesmo lead preserva o compromisso concluído e cria apenas o compromisso novo correspondente.
9. Calls futuras existentes são incluídas uma vez; calls históricas anteriores à ativação são excluídas do backfill; atraso de entrega não descarta uma call registrada.
10. Horário correto em navegadores/servidores com fusos diferentes e em remarcação atravessando meia-noite; fim exatamente 30 minutos após o início.
11. Paginação de agendas, backfill e reconciliação não omite registros.
12. Evento manualmente editado/apagado no Google é reconciliado segundo a fonte CRM; evento alheio não é sobrescrito.
13. Lead removido mantém informação mínima suficiente para limpar o evento externo, sem credenciais ou conteúdo comercial completo na fila.
14. Erro 404 por falta de acesso não é confundido com exclusão; 410 de remoção repetida conclui o trabalho; 412 exige releitura.
15. OAuth negado, estado expirado/reutilizado, callback falsificado, usuário sem permissão e tentativa de cron sem segredo são rejeitados.
16. Usuários comuns não acessam tokens, fila interna, funções do worker ou configuração administrativa. Leitura do status respeita o acesso à call.
17. Desconectar/reconectar preserva as identidades; selecionar outro destino é bloqueado quando já há vínculos.
18. Link do evento abre o lead autorizado após login; lead inválido/inacessível não amplia acesso.
19. Build TypeScript/Vite, validação dos arquivos alterados e testes de integração SQL passam; falhas pré-existentes são documentadas separadamente com evidência.
20. Ensaio real: criar, remarcar, trocar responsável, concluir/cancelar e repetir sincronização na agenda de teste; conferir evento e estado local em cada etapa.

Não usar a agenda comercial para ensaios destrutivos. Migração e implantação devem seguir o histórico remoto real do projeto, aplicando somente a migração desta integração; não executar um `db push` genérico sobre migrations locais divergentes.

## 10. Ativação e operação

A entrega inclui migration reversível na estrutura, Edge Functions, UI, testes e guia operacional. Instalar schema/funções primeiro, depois worker/cron e UI; ativar a conexão após configurar OAuth e validar em agenda de teste. O cartão deve apresentar “Não conectado” até concluir as etapas externas, sem simular integração ativa.

O guia deve explicar acesso de edição da conta conectada, compartilhamento com os closers, criação do cliente OAuth, callback, segredos, seleção da agenda, estado das calls, retry, reconexão e limites de sincronização CRM → Google. Segredos reais não entram no repositório.

Usar a agenda comercial já criada pela conta administradora na ativação final. Os eventos anteriores sem vínculo comprovado com a integração não serão alterados ou removidos. Não associar uma call a um evento anterior apenas pela semelhança de nome ou horário.

Rollback desativa cron e conexão para interromper escritas, mantendo vínculos para recuperação; não remove dados da agenda automaticamente. Remoção física de tabelas/segredos exige confirmar que não há trabalhos ou eventos pendentes de limpeza.

## 11. Referências oficiais consultadas

As decisões de produto acima são propostas deste projeto. Os contratos da API usados no desenho foram conferidos nas fontes oficiais:

- [Criar eventos: destino específico e ID fornecido pelo cliente](https://developers.google.com/workspace/calendar/api/guides/create-events).
- [Events.insert: formato do ID e propriedades privadas](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
- [Versões de recursos: ETag, If-Match e resposta 412](https://developers.google.com/workspace/calendar/api/guides/version-resources).
- [Tratamento de erros: duplicidade, recurso removido e limites](https://developers.google.com/workspace/calendar/api/guides/errors).
- [Scopes de autorização do Google Calendar](https://developers.google.com/workspace/calendar/api/auth).
- [OAuth para aplicações web: estado e acesso offline](https://developers.google.com/identity/protocols/oauth2/web-server).
- [Events.update: eventos cancelados e campos restauráveis](https://developers.google.com/workspace/calendar/api/v3/reference/events/update).

## 12. Próxima etapa do workflow

O usuário aprovou o fluxo apresentado em conversa e esta especificação escrita em 2026-10-11, solicitando avançar o mais rápido possível. O [plano de implementação](../plans/2026-10-11-closer-calendar-sync.md) foi escrito e revisado com `writing-plans`. Conforme o AGENTS.md do workspace e essa skill, a implementação de produto começa após a revisão do plano escrito pelo usuário e seleção do modo de execução.
