# Google Agenda compartilhada dos closers

## Destino e funcionamento

Destino comercial: agenda existente **“agenda - closers”**, administrada por **admvoxenai@gmail.com**. A conta deve ter permissão `writer` ou `owner`. Compartilhe a agenda com os closers pelo Google Agenda; a integração não altera compartilhamentos.

O administrador conecta o Google em **Configurações → Google Agenda dos closers** e seleciona explicitamente o **ID da agenda**. Nomes iguais aparecem com IDs diferentes. Não use o email como substituto do ID e não selecione a agenda principal por suposição.

- O CRM é a fonte de verdade. Alterações no Google não são importadas.
- Calls de fechamento pendentes, encaminhadas para Closer, com responsável e horário, entram na sincronização. Qualificação e leads apenas prontos para encaminhar não entram.
- Duração: **30 minutos**. Fuso apresentado: **America/Sao_Paulo**. O início conserva o instante de `scheduled_at`.
- Remarcar ou trocar o closer atualiza o evento existente. Uma nova call recebe outra identidade.
- Concluir preserva o histórico e o resultado. Cancelar, excluir ou devolver ao SDR remove o evento da call vinculada.
- A ativação captura uma lista durável das calls futuras elegíveis. Conclusão, cancelamento ou exclusão antes do processamento são tratados pelo estado final dessa call.
- Cada call mantém seu ID persistente. Repetições após timeout ou falha local recuperam esse ID; lease, revisão e ETag protegem atualizações concorrentes e eventos de terceiros.
- Entrega: cron a cada minuto. Reconciliação de calls pendentes: a cada 15 minutos. Eventos concluídos e confirmados não são consultados periodicamente.
- Não são criados convites, Google Meet ou recorrências. Campos externos não controlados pelo CRM são preservados.

## Estado da entrega

Código e guia preparados em `codex/closer-calendar-sync`. Validação: **33 testes Node/VM**, fixtures e concorrência real entre sessões PostgreSQL, TypeScript e build aprovados. No projeto Supabase de destino, um ensaio transacional com rollback validou as migrations, criptografia nativa do Vault, permissões, RLS, os dois agendamentos cron e a assinatura pg_net, sem enviar HTTP ou criar fixtures comerciais.

As quatro migrations e as três Edge Functions foram instaladas no projeto **dash**, ref **mbzwchnxtskysqplqiyy**, confirmado novamente pelo usuário. O callback e a origem do dashboard estão presentes nos Secrets das Edge Functions, e os dois nomes de segredos do cron estão presentes no Vault. A conferência de 11/10/2026 encontrou ausentes `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e `GOOGLE_CALENDAR_CRON_SECRET` nos Secrets das Edge Functions; ainda é necessário instalar esses três valores privados. O teste HTTP anterior confirmou bloqueio de acesso sem autenticação e execução de entrega/reconciliação com `processed=0`, sem eventos Google. Histórico SQL, permissões e RLS foram conferidos após a instalação. Uma correção adicional tornou as atualizações compatíveis com o `safeupdate` do PostgREST; os testes SQL e de concorrência passaram novamente.

**A integração permanece não conectada e não ativada.** Faltam publicar/validar o frontend, instalar as duas credenciais OAuth e o segredo do cron nas Edge Functions, e realizar o ensaio Google em projeto e agenda exclusivos de teste antes da ativação comercial. Os testes locais usam uma implementação de teste do Vault; a criptografia real foi validada separadamente no Supabase, com um valor fictício descartado por rollback.

## 1. Google Cloud / OAuth

1. Use um projeto Google Cloud para a aplicação comercial. Crie outro projeto/cliente OAuth para o ensaio isolado.
2. Ative **Google Calendar API**.
3. Configure a tela de consentimento OAuth e as permissões:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
4. Crie credenciais OAuth do tipo **Aplicativo da Web**.
5. Registre exatamente a URI de redirecionamento comercial:
   `https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/google-calendar-oauth-callback`
6. Configure a publicação/verificação exigida pelo Google para o público da aplicação. Em aplicativos externos no modo **Testing**, autorizações com esses scopes têm refresh token com validade de sete dias; esse modo não serve para a operação permanente.

A origem do dashboard comercial é `https://www.wsltda.com`. O login apresenta `admvoxenai@gmail.com` como sugestão; confira a conta na autorização e a agenda no seletor. Essa sugestão não impede que o Google use outra conta logada.

Referências: [OAuth do Google](https://developers.google.com/identity/protocols/oauth2), [política de produção OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [CalendarList.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get).

## 2. Configuração privada do servidor

Instale estas variáveis em **Supabase → Edge Functions → Secrets**, sem colocá-las no frontend, no Git ou na conversa:

Na conferência de 11/10/2026, o administrador precisa adicionar `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e `GOOGLE_CALENDAR_CRON_SECRET` em [Secrets do projeto dash](https://supabase.com/dashboard/project/mbzwchnxtskysqplqiyy/functions/secrets). As duas URLs estão presentes. Os nomes dos dois segredos do Vault foram conferidos; o valor de `GOOGLE_CALENDAR_CRON_SECRET` deve coincidir com `google_calendar_cron_secret` do Vault desse mesmo projeto. A conferência não exibiu valores privados.

| Variável | Valor |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | Client ID do OAuth Web |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Client secret do mesmo cliente |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Callback exato acima |
| `GOOGLE_CALENDAR_DASHBOARD_ORIGIN` | `https://www.wsltda.com` |
| `GOOGLE_CALENDAR_CRON_SECRET` | Segredo aleatório exclusivo, gerado e guardado em canal privado |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são usados apenas pelas funções. Tokens Google ficam no Vault, com leases e revisão; respostas públicas não contêm credenciais.

No **Vault** do mesmo projeto, crie os dois segredos do cron usando a interface privada:

| Nome no Vault | Conteúdo |
| --- | --- |
| `google_calendar_cron_anon_key` | Chave pública **anon JWT legada** do projeto |
| `google_calendar_cron_secret` | O mesmo valor de `GOOGLE_CALENDAR_CRON_SECRET` |

O cron envia o JWT em `Authorization: Bearer` e o segredo exclusivo em `x-cron-secret`. Não use `sb_publishable_*` nesse header e não use a chave `service_role` como segredo do cron. Não copie valores para logs, arquivos versionados ou mensagens.

Referências: [Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets), [Vault](https://supabase.com/docs/guides/database/vault), [agendamento de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

## 3. Instalação restrita ao recurso

Alvo identificado pelo arquivo de vínculo local: projeto **dash**, ref **mbzwchnxtskysqplqiyy**. Confira o alvo e seu histórico remoto antes de executar SQL. O histórico remoto diverge do checkout: **não execute `supabase db push`, reset ou reaplicação geral das migrations antigas**.

Aplique somente estas migrations, nesta ordem, verificando se a versão já existe em `supabase_migrations.schema_migrations`:

1. `20261011100000_google_calendar_storage.sql`
2. `20261011103000_google_calendar_queue.sql`
3. `20261011110000_google_calendar_cron.sql`
4. `20261011180000_google_calendar_safeupdate.sql`

Storage e queue possuem transações próprias. Cron possui **duas transações**: instalação das extensões, depois os dois agendamentos. Preserve essa separação; não envolva todo o cron em uma transação externa. Registre cada versão no histórico somente ao aplicar seu conteúdo com sucesso. Se alguma versão já existir, compare o conteúdo e interrompa uma tentativa de reaplicação divergente.

A quarta migration preserva assinaturas, permissões e dados; limita as atualizações à configuração única e aos dois modos de varredura conhecidos. Ela é necessária porque o PostgREST rejeita atualizações sem `WHERE`, inclusive dentro de RPCs. As quatro versões já estão registradas no projeto comercial: não reaplique-as. `supabase/tests/google_calendar_safeupdate.sql` pode ser executado dentro de uma transação com rollback para auditar essas instruções; confirme também o worker por HTTP.

Confira os pré-requisitos do schema existente: `crm_leads`, `crm_activities`, `profiles`, `registration_requests`, `crm_user_can`, `crm_has_access`, `registration_has_access` e as regras comerciais já instaladas. As fixtures de bootstrap são **exclusivamente de teste** e não devem ser aplicadas à produção.

Publique somente as três funções abaixo, usando o `supabase/config.toml` deste checkout:

```powershell
supabase functions deploy google-calendar-manage --project-ref mbzwchnxtskysqplqiyy
supabase functions deploy google-calendar-oauth-callback --project-ref mbzwchnxtskysqplqiyy
supabase functions deploy google-calendar-sync --project-ref mbzwchnxtskysqplqiyy
```

O callback usa estado OAuth persistido de uso único e dispensa JWT. Manage exige JWT e administrador executivo aprovado. Sync exige JWT no gateway e valida o segredo exclusivo antes de acessar o banco. Publique também o frontend, com as variáveis públicas Supabase habituais do ambiente.

Os jobs ficam inertes sem os dois segredos do Vault ou sem conexão ativada. Instalar código não significa autorizar o Google nem começar a criar eventos.

## 4. Validação antes da ativação comercial

Use **um projeto Supabase separado**, um cliente OAuth de teste e uma agenda de teste. Substitua o ref, callback e origem pelos desse ambiente, incluindo as duas URLs na migration de cron. Não ative a agenda de teste no projeto comercial: o destino fica fixado quando houver vínculos ou a lista inicial de backfill.

Validação local do checkout:

```powershell
node --experimental-vm-modules --test scripts/verify-google-calendar-sync.mjs scripts/verify-google-calendar-ui.mjs
node scripts/check-google-calendar-db.mjs --local
npx.cmd tsc --noEmit -p tsconfig.app.json
npm.cmd run build
```

O teste SQL nativo requer Supabase local disponível. Quando o PostgreSQL nativo não estiver disponível, o runner `verify-google-calendar-sql.mjs` aceita o caminho de uma instalação temporária PGlite, sem adicioná-la às dependências do projeto. Esse runner não substitui a validação nativa das extensões nem o ensaio entre sessões concorrentes.

No ambiente isolado, valide:

1. Login executivo, consentimento recusado, conexão aceita, lista de agendas com seleção explícita e erro de permissão.
2. Encaminhe uma call de teste para Closer. Execute a entrega repetidamente; deve haver **um evento ativo**, com os 30 minutos e o mesmo ID persistente.
3. Remarque e troque o closer; confira título, início/fim e preservação do ID.
4. Conclua a call e avance o lead; confira histórico preservado. Crie outra call e confira identidade diferente.
5. Cancele, devolva ao SDR e exclua calls de teste; confira remoções.
6. Simule timeout depois do insert, edição do CRM durante HTTP, ACK antigo, lease perdido e 412. A revisão atual não pode ser confirmada por uma resposta antiga.
7. Edite manualmente um evento pendente: a reconciliação repõe os campos do CRM. Apague-o: o worker restaura ou cria uma identidade sucessora persistida, conservando somente um evento ativo.
8. Revogue o acesso à agenda: não deve haver falsa confirmação de remoção ou alteração de eventos de terceiros.
9. Desconecte e reconecte ao mesmo destino: eventos existentes e fila devem ser preservados, sem duplicar.
10. Abra o link do evento sem login; depois de autenticar, abra apenas o lead autorizado. Teste logout, troca de usuário e usuário sem acesso.

Para a instalação nativa, valide em duas sessões que o mesmo job e a mesma credencial não podem ser reivindicados simultaneamente e que a revogação/alteração de revisão invalida o ACK anterior. Confira Vault criptografado e as duas chamadas cron autenticadas no ambiente isolado.

## 5. Ativação da agenda da empresa

Depois de aprovar o ensaio:

1. Entre no dashboard comercial com um executivo aprovado.
2. Em Configurações, clique em **Conectar Google** e autorize **admvoxenai@gmail.com**.
3. Selecione **“agenda - closers”** conferindo seu ID canônico e permissão de edição. Clique em ativar.
4. Aguarde o backfill e o primeiro ciclo de entrega; confira agenda, contagem de pendências/erros, horário da última execução e as calls reais autorizadas.
5. Verifique um evento e seu link para o CRM. Confira também o acesso dos closers à agenda compartilhada.

## Operação e recuperação

| Status da call | O que significa |
| --- | --- |
| `disabled` | A call não possui vínculo com a integração |
| `awaiting_connection` | Aguarda conexão/autorização disponível |
| `pending` | A revisão atual aguarda entrega |
| `syncing` | Worker está processando |
| `synced` | Revisão desejada confirmada no Google |
| `removal_pending` | Remoção ainda não confirmada |
| `removed` | Remoção confirmada |
| `error` | Requer retry ou correção indicada |

Uma revisão diferente da confirmada nunca aparece como sincronizada. Falha de consulta ou carregamento também não comprova sincronização. Refresh token revogado exige **Reconectar Google**; perda de permissão exige revisar acesso à agenda e reconectar. Erros temporários usam novas tentativas com atraso e podem ser reprocessados por **Tentar novamente**. Dados incompletos exigem correção da call no CRM.

Após a criação de vínculos, o destino é fixado. Desconectar pausa a entrega, limpa credenciais e tenta revogar a autorização; preserva eventos, IDs e trabalhos. Reconectar requer acesso ao mesmo destino. Uma migração para outra agenda precisa de procedimento próprio, fora deste recurso.

## Rollback operacional

1. Desconecte pela configuração administrativa para pausar novas entregas.
2. Desative somente os dois jobs desta integração:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname in ('google-calendar-deliver', 'google-calendar-reconcile');
```

3. Se necessário, reverta o deploy da interface/funções. Conserve tabelas, vínculos, IDs, status e fila; **não apague eventos externos nem execute DROP/reset**. Uma retomada restaura os dois agendamentos e reconecta ao mesmo destino.

Referência de operação: [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart).
