# Respostas do formulário Meta no Contexto do SDR

## Problema

O atleta preenche o formulário da Meta com 11 perguntas. Mesmo assim, o lead que chega ao CRM mostra só nome, WhatsApp, e-mail e dados da campanha. O Contexto do SDR não traz as respostas.

## Raiz (verificada no banco de produção, só leitura)

1. **Cada atleta vira dois registros que ninguém ligava.** Depois do formulário, o atleta cai no site Zyron, que cria um segundo registro (`entry_channel='website'`, id `site:zyron:…`) só com contato, de 1 a 9 minutos depois. As respostas ficam no registro do formulário (`entry_channel='form'`). O lead do CRM era criado a partir do registro do site, por isso sem respostas.
2. **O telefone não serve de chave.** Caso real (João Pedro): formulário às 13:09:32, site às 13:10:33, mesmo anúncio, mesmo nome, mas o telefone difere em um dígito (`…94 8173104` × `…91 8173104`). O que identifica a pessoa é anúncio + horário + nome.
3. **A captura por API só enxerga leads a partir de 07/10.** A primeira busca olhou 48 horas para trás. Dos 419 atletas das exportações da Meta, 184 são anteriores a 07/10 e nenhum tem respostas no banco.
4. **Aprovar criava lead duplicado.** Não há trava de telefone repetido em `crm_leads`: aprovar o formulário de quem já está no CRM (vindo do site) criava um segundo lead.

Números no momento da auditoria: 140 leads do site desde 07/10; 82 pares inequívocos formulário↔site e 2 ambíguos; 12 leads do site que já estão no CRM ganham as respostas; maior intervalo entre formulário e site: 9 min. Leads criados à mão pelo SDR com o mesmo WhatsApp e primeiro nome de um formulário: 3 (só aviso).

## O que foi construído

| Peça | Arquivo | O que faz |
|---|---|---|
| Migration | `supabase/migrations/20261015021500_site_form_answers_link.sql` | Liga site↔formulário (`answers_form_lead_id`). Copia **todas** as perguntas e respostas exatas para o Contexto do lead do CRM. Na aprovação reaproveita o lead do par, sem duplicar. O indicador de contexto passa a contar essas respostas. Só substitui as duas funções se forem idênticas às auditadas (guarda md5). |
| Aquecimento | `supabase/migrations/20261015030000_form_temperature.sql` | Sugere e marca **frio / morno / quente** pelo DDD (Norte e Nordeste = frio) e pelas respostas, com o motivo em palavras (ver "Aquecimento pelas respostas"). |
| Agendamento | `supabase/migrations/20261015021600_site_form_answers_link_cron.sql` | A cada 5 min vincula leads futuros. Separado, para ligar depois de conferir a simulação. |
| Tela | `src/components/crm/CRMContextPanel.tsx` | "Respostas do formulário Meta" aparece aberta, antes dos dados do site, nas fichas de leads do site e criados à mão (SDR e Closer). |
| Aplicar | `scripts/apply-site-form-answers-link-migration.mjs` | `preflight` (ensaio no banco real, desfaz tudo), `apply`, `cron-preflight`, `cron`. |
| Operar | `scripts/site-form-link.mjs` | `status`, `preview`, `apply`, `twins`, `backfill`, `backfill-status`. |

Regras de vínculo (vale a mais forte; empate = ambíguo, fica para revisão humana e **não** é ligado):

1. Mesmo anúncio, site até 10 min depois do formulário, nome completo igual.
2. Mesmo anúncio, site até 15 min depois, primeiro nome igual.
3. Mesmo WhatsApp (8 últimos dígitos), até 72 h depois, primeiro nome igual.

Um formulário só liga a um registro do site e vice-versa (índice único). Só formulários com respostas de qualificação entram.

## Passo a passo

Rode na pasta `pitch-and-win1`, no seu terminal (já autenticado no Supabase).

1. **Ensaio no banco real das duas migrations (nada é gravado):**
   `node scripts/apply-site-form-answers-link-migration.mjs preflight`
   Resultado obtido em 15/10 (muda conforme chegam leads): `ENSAIO CONCLUIDO … pares_inequivocos=82 ambiguos=2 leads_do_crm_que_ganham_contexto=12 leads_manuais_com_formulario_do_mesmo_whatsapp=3 | aquecimento nos formularios: quente=85 morno=162 frio=178 sem_classificacao=1`. Se aparecer "mudou desde a auditoria", pare e me chame.
2. **Instalar as duas:** `node scripts/apply-site-form-answers-link-migration.mjs apply`
3. **Ver o que será ligado:** `node scripts/site-form-link.mjs preview` (confira os `revisar (ambíguo)`).
4. **Ligar:** `node scripts/site-form-link.mjs apply`
5. **Publicar a tela** (commit + push de `CRMContextPanel.tsx`). A migration é compatível com a tela antiga, então a ordem não quebra ninguém.
6. **Conferir no CRM:** abra o lead João Pedro de Andrade Santana (Importações). O Contexto deve mostrar as 11 perguntas e respostas, e o telefone digitado no formulário.
7. **Trazer os anteriores a 07/10:** `node scripts/site-form-link.mjs backfill 2026-09-01`, depois `backfill-status` até `buscando_agora=false` e `eventos_na_fila=0`. Rode `node scripts/site-form-link.mjs apply` de novo. Os formulários novos entram nas levas como pendentes e os que têm par do site já ficam ligados.
8. **Automatizar:** `node scripts/apply-site-form-answers-link-migration.mjs cron-preflight` e depois `cron`.

Ao aprovar uma leva: se o par já está no CRM, o sistema reaproveita esse lead e anexa as respostas (sem duplicar). Se o par ainda não está, o lead nasce já com as respostas.

## Aquecimento pelas respostas (frio / morno / quente)

É um **ponto de partida para o SDR escolher quem abordar**; o SDR continua dono do campo e pode mudar a qualquer momento. Nada aprova, repassa ou abre lead. "Quente + abordado" continua sendo o que sinaliza pronto para o Closer.

**Primeiro vem o DDD** do telefone informado no formulário (a distância do local de atendimento):

| DDD | Resultado |
|---|---|
| **Norte** (63, 68, 69, 91 a 97) ou **Nordeste** (71, 73 a 77, 79, 81 a 89, 98, 99) | **sempre Frio**, qualquer que seja o resto. O motivo mostra o que as respostas indicariam ("pelas respostas seria Quente") para o SDR decidir se vale exceção |
| **Demais regiões** (Sudeste, Sul, Centro-Oeste) | **Quente ou Morno** conforme as respostas; o mínimo é Morno |
| **Não identificado** (telefone sem DDD ou estrangeiro) | vale só o que as respostas dizem (Frio, Morno ou Quente) |

O DDD é lido em "+5511…", "5581…", "(71) 98356-5093", "11999998888", com zero na frente, e também no número brasileiro escrito "+62983319848" (sem o 55; é Goiás, não estrangeiro).

| Pelas respostas | Critério |
|---|---|
| **Quente** | compromisso ≥ 9 · objetivo ligado a clube/carreira (jogador profissional, oportunidade em clube, clube de maior nível, visibilidade, direcionamento) · impedimento que a oferta resolve (falta de oportunidades ou de visibilidade, dificuldade de chegar aos clubes, já tentei, direcionamento, acompanhamento, não sei o caminho) · **pelo menos 2 sinais de movimento**: já fez avaliações/peneiras, já recebeu convite/proposta/contrato, respostas detalhadas (clubes, resultado de avaliação, características) |
| **Morno** | compromisso ≥ 7 e objetivo **ou** impedimento alinhado |
| **Frio** | o resto: compromisso baixo, ou objetivo e impedimento sem ligação com entrar em clube (por exemplo, só quer evoluir fisicamente) |

Fora do Norte e do Nordeste, quem as respostas deixariam frio vira Morno (regra do piso), e o motivo avisa isso. Resultado previsto em 15/10 nos 426 formulários: **85 quentes, 162 mornos, 178 frios** (172 por DDD do Norte/Nordeste e 6 de DDD desconhecido com respostas fracas).

Como cada resposta é entendida: a nota de compromisso é lida mesmo dentro do texto ("8/10", "Acho que us 8/10", "Sim 8", "9. estou focado"); sem número, "muito/total/sempre" vale 8 e "pouco/nada" vale 4; nota ilegível ("19", "ANDREY") vale 7 e **nunca chega a quente sozinha**. As opções de múltipla escolha são comparadas pelo sentido, com ou sem sublinhado, acento ou maiúscula, então formulários importados de planilha funcionam igual. O lead de teste da Meta e formulários sem as perguntas conhecidas **não são classificados**.

Quando é marcado: o lead **novo** nasce já com o aquecimento (e, se veio do site, usa as respostas do formulário ligado). O lead que **já estava** no CRM só é marcado **uma vez** e **só se ninguém mexeu nele** (aquecimento padrão, não abordado, sem Closer); se o SDR já trabalhou o lead, ele recebe apenas a sugestão com o motivo, sem alteração. Depois disso nada refaz a escolha do SDR. A alteração em lead antigo aparece no histórico como "Lead atualizado", atribuída a quem aprovou o lead (os gatilhos do CRM exigem um usuário).

O SDR vê no Contexto: "Aquecimento sugerido pelo formulário: Quente · já marcado no lead; o SDR pode alterar", com o motivo, por exemplo: *Quente: DDD 11 (fora do Norte e do Nordeste); compromisso 10/10; objetivo: "Tornar-se jogador profissional"; impedimento: "Falta de oportunidades"; sinais de movimento: já participou de avaliações ou peneiras, já recebeu convite ou proposta.*

Conferir antes de confiar: `node scripts/site-form-link.mjs temperature` (contagem e 3 exemplos de cada, sem nomes). Depois de instalar: `node scripts/site-form-link.mjs hints`. Se a distribuição não servir ao time, ajuste os critérios em `meta_form_temperature` e `meta_ddd_info` (duas funções) e reinstale-a; nada fica gravado além da sugestão e do campo do lead.

## Quarta migration: WhatsApp igual e leads criados à mão (`20261015032000_whatsapp_answer_links`)

Depois do `backfill` (de 426 para 729 formulários) apareceram dois buracos reais, verificados no banco:

1. **Nome diferente, mesma pessoa.** 49 registros do site tinham o **mesmo WhatsApp**, o **mesmo anúncio** e chegaram de 1 a 7 minutos depois do formulário, mas o nome do perfil da Meta era outro ("Silvazs", "jonaslevyr_", "P10", letras estilizadas, nome de um parente). As regras 1 a 3 exigem nome parecido e os deixavam sem respostas. **Regra 4:** mesmo WhatsApp (8 últimos dígitos) + mesmo anúncio (ou site sem anúncio identificado), site de 2 min antes a 15 min depois do formulário, qualquer nome. Anúncios diferentes dos dois lados **não** ligam. Mais de um candidato = "revisar (ambíguo)". Ensaio no banco real: 57 pares inequívocos (56 pela regra 4) e 6 para revisar.
2. **Leads criados à mão (72 no CRM).** 36 deles têm exatamente **um** formulário com o mesmo WhatsApp (2 ficam para revisão por terem dois leads ou dois formulários para o mesmo número) e continuavam sem contexto. A migration anexa as respostas ao Contexto desse lead (o ícone laranja acende), guarda o vínculo em `crm_form_answer_links` e, **na aprovação, o formulário reaproveita o lead que já existe em vez de criar outro** (sem isso, aprovar as levas duplicaria esses 36). Lead que ninguém abordou também recebe o aquecimento; o já trabalhado recebe só a sugestão. O vínculo é permanente: se o SDR apagar o contexto, ele não volta sozinho.

Instalar (na pasta `pitch-and-win1`):

1. Ensaio, nada é gravado: `node scripts/apply-site-form-answers-link-migration.mjs whatsapp-preflight` → deve terminar em `ENSAIO CONCLUIDO … site_x_formulario: inequivocos=57 … | leads_manuais_x_formulario: inequivocos=36 para_revisar=2`. Se aparecer "mudou desde a auditoria", pare.
2. Instalar: `node scripts/apply-site-form-answers-link-migration.mjs whatsapp`
3. Em até 5 minutos o agendamento liga tudo; para ver na hora: `node scripts/site-form-link.mjs apply` (mostra primeiro os leads manuais, depois site x formulário). Antes de instalar, `node scripts/site-form-link.mjs manual` mostra quem seria ligado (só a partir da instalação).

Reversão: `DROP TABLE public.crm_form_answer_links;` (as respostas já anexadas ficam) e reinstalar `meta_site_form_pairs` / `meta_link_site_answers` do arquivo `20261015031000…`/`20261015021500…` e `meta_sync_form_lead_to_crm` do arquivo `20261015021500…`.

## O que já existia (não foi recriado)

A aba **Importações** do CRM já tem as seções de origem (Todas / Formulários / Site), os filtros Automáticas e Manuais e as visões Lista, Aquecimento, Abordagem e **Esteira do LEAD**, com a mesma lógica da aba Leads. O ícone do livro fica **laranja** quando o lead tem contexto de verdade: respostas do formulário (próprias ou ligadas) ou anotações do atendimento; só contato e dados técnicos não acendem.

## Segurança e reversão

- Nada é apagado nem editado nos registros originais, nos snapshots ou nas respostas. O único `DELETE` é na mescla do contexto `meta_form` que o próprio site já tinha: o texto antigo é preservado dentro do novo.
- As funções novas só rodam como dono do banco (revogadas de `anon`, `authenticated` e `service_role`).
- Reverter o agendamento: `SELECT cron.unschedule('meta-site-form-link');`
- Desfazer vínculos (as respostas já copiadas ficam): `UPDATE public.meta_form_leads SET answers_form_lead_id=NULL, answers_link_basis=NULL, answers_linked_at=NULL;`
- Parar de classificar leads novos (as sugestões já gravadas ficam): `DROP TRIGGER zz_crm_form_temperature_before ON public.crm_leads; DROP TRIGGER zz_crm_form_temperature_after ON public.crm_leads;`
- Reverter a tela: reverter o commit de `CRMContextPanel.tsx`, `useCRM.tsx` e `arena-api.ts`.
- Restaurar a aprovação anterior: reinstalar a definição de `meta_sync_form_lead_to_crm` do arquivo `20261012150000_meta_lead_waves_crm_sync_auto_publish.sql` (linhas 276–338).

## Limites conhecidos

- **Leads criados à mão pelo SDR** com o WhatsApp de um formulário: até a quarta migration eram só aviso (`twins`) e aprovar o formulário criava um lead novo. Depois dela, o caso sem ambiguidade é ligado e reaproveitado; com dois leads ou dois formulários para o mesmo número fica para decisão humana. Se o lead manual foi criado para **outro** atleta que usa o mesmo número (pai com dois filhos), confira o nome do formulário no Contexto.
- **Registros do site sem formulário na Meta:** 42 são anteriores a 17/09 (o formulário mais antigo da Meta é dessa data) e os demais não têm nenhum formulário com o mesmo WhatsApp nos minutos anteriores (pode ser conversão direta no site, ou número digitado diferente no formulário). Seguem sem respostas: não há resposta autêntica para mostrar.
- **Pares ambíguos** ficam sem vínculo até alguém decidir.
- **Atletas sem registro do site e fora do sistema** (133 anteriores a 07/10) só aparecem depois do `backfill`.
- O texto das respostas troca `_` por espaço e põe maiúscula só nas opções de múltipla escolha que a Meta entrega como identificador (`sou_o_atleta` → `Sou o atleta`). Respostas digitadas pelo atleta ficam exatamente como vieram.
- A aprovação das levas continua sendo decisão sua; nada aqui aprova leva.

## Verificação feita

- `scripts/verify-site-form-link-db.mjs`: banco descartável com as funções reais do projeto. Cobre o caso João Pedro (telefone com um dígito trocado), as três regras, ambiguidade, idempotência, aprovação sem duplicar nos dois sentidos, mescla de contexto, falha visível sem autor, indicador de contexto, permissões, ensaio sem resíduo, instalação com registro e agendamento. Cobre também a classificação de aquecimento (casos de borda, lead novo, lead antigo só se intocado, escolha do SDR preservada, falha da classificação sem bloquear a criação do lead), rodando com a trava real de autenticação do CRM. Uma checagem de mutação confirmou que o teste falha se a regra de reaproveitar o lead for removida.
- `scripts/verify-crm-site-form-answers-browser.mjs`: Chromium como SDR e Closer, lead do site e lead criado à mão: perguntas e respostas visíveis, sem corte, antes dos dados do site, sem escrita. O teste anterior (`verify-crm-source-context-browser.mjs`) continua passando; ESLint e TypeScript sem erros.
- O texto que o SDR verá para o João Pedro foi gerado por consulta de leitura nos dados reais e confere com o formulário.
