# Leads do site no setor Importações do SDR

Estado: desenho e especificação escrita aprovados pelo usuário nesta conversa em 13/10/2026. Próxima etapa: revisão do plano escrito, preservando a execução nativa escolhida. Complementa o plano de levas já publicado.

## Resultado e origem

Contatos automáticos e planilhas chegam ao setor **Importações** do CRM do SDR. As seções são **Formulários** e **Site / conversão direta**; a forma de entrada, **Automática** ou **Manual**, fica identificada separadamente. Um lead aprovado fica na fila compartilhada, sem contar como abordagem. Todos passam pela conferência das levas de até 20.

O site conhecido é `https://aizyron.com/avaliacao`, no checkout `C:/Users/Me/Downloads/voxen/vide-match`. Seu Supabase é a fonte `mehmqibxzxfqdxqjnjad`; o destino comercial continua sendo `dash`, `mbzwchnxtskysqplqiyy`. Não se muda a conexão do site para o banco comercial.

## Preservação e envio

O servidor do site salva contato, perfil disponível, UTMs e identificadores de clique junto de um evento numa fila durável, na mesma transação. Dados conhecidos apenas no navegador passam a ser incluídos nessa captura; não se promete recuperar campos que nunca foram gravados no passado.

Cada evento tem identificador, lead de origem, versão, geração original e horário de gravação. O evento permanece na origem até o dashboard confirmar recebimento durável. Falha, timeout ou resposta perdida provocam repetição com o mesmo identificador. Um processo periódico drena a fila e retoma tentativas com lease; erro não apaga a entrada. Estados e atraso ficam consultáveis, sem registrar dados pessoais em logs.

O receptor do dashboard aceita somente mensagens autenticadas pelo servidor do site, com assinatura do corpo e proteção contra uso de assinatura antiga. O segredo permanece privado nos dois servidores. O navegador não recebe chave comercial nem segredo da integração.

O dashboard deduplica evento e contato pela identidade da origem. Grava o evento completo antes de confirmar, atribui a origem **Site / conversão direta** e põe o contato pendente nas levas existentes. Recebimento duplicado não cria outro contato, outra leva ou outro CRM. Planilhas têm seleção explícita de origem e seguem a mesma regra de revisão/envio.

## Contexto após a aprovação

O CRM recebe os dados úteis disponíveis e um snapshot completo da captura aprovada. Todas as respostas, campos adicionais e consentimentos disponíveis ficam acessíveis, sem truncamento silencioso. O resumo de contexto pode ser curto, mas a fonte integral permanece consultável na ficha.

Se o perfil do site for completado depois que o contato já foi aprovado, o novo evento continua gravado e aparece no contexto de origem, com seu próprio horário. Atualizações da fonte não substituem silenciosamente correções feitas pelo SDR no cadastro. A ficha distingue cadastro atual, captura aprovada e atualizações posteriores da origem.

Contatos inválidos são preservados para correção; falhas de envio ao CRM ficam visíveis e permitem nova tentativa. Eventos não reconhecidos ou fora de ordem não são descartados: ficam identificados para conferência. Reprocessamento mantém o primeiro recebimento e os vínculos já estabelecidos.

## Prioridade e horários

Conforme a instrução posterior do usuário, a prioridade é pelo **primeiro recebimento mais recente no dashboard**, em ordem decrescente, entre levas e dentro delas. A data de geração continua visível separadamente, com horário incluindo segundos em Brasília. Importação de um contato antigo hoje mostra geração antiga e recebimento atual, sem confundir as duas datas.

Levas iniciadas para revisão ficam fechadas para novas entradas. As decisões enviam o conjunto visto, a versão da leva e a versão de cada membro. Alteração concorrente exige nova conferência.

## Verificação e publicação

Provar: captura e evento atômicos; envio repetido com um único contato; falha e recuperação sem perda; perfil posterior acessível após aprovação; manual e automático nas seções corretas; horários preservados; bloqueio de assinatura inválida; atualização do CRM em duas sessões.

A integração só será chamada de ativa depois da instalação nos dois projetos, da configuração privada e de uma entrega medida. Dados antigos existentes serão reenviados por procedimento idempotente e conferidos por identidade, sem comparar contagem de visitas com contagem de contatos.

Publicação seletiva, primeiro estruturas compatíveis, depois funções e clientes. Não reaplicar migrations gerais. Reversão interrompe o envio e mantém a fila, recibos, contatos, contexto e decisões para retomada.
