# Integração do site com Tráfego e Importações do SDR

Publicado e ativado em 13/10/2026. Fonte: `mehmqibxzxfqdxqjnjad`, [site](https://aizyron.com/avaliacao). Destino comercial: `mbzwchnxtskysqplqiyy`, [Tráfego](https://www.wsltda.com/trafego). Todos os horários apresentados na interface usam Brasília, incluindo segundos.

## Resultado verificado

Os **316 contatos históricos** foram recuperados por páginas de **200 + 116**, conferidos individualmente por UUID, data de geração, identidade do evento e recibo. Repetir a primeira página enfileirou zero eventos novos. Nenhum desses registros foi descartado ou aprovado pela execução.

Às 18:48:49 de Brasília, a origem tinha **317 contatos e 319 eventos entregues**, incluindo uma captura sintética identificada como **Teste de integração — não abordar**. A fila estava zerada, sem lease expirado, falha pendente ou quarentena. Todos os **319 hashes do conteúdo integral** dos eventos coincidiram entre origem e destino, com comparação UTF8.

Os **426 leads anteriores da dashboard** mantiveram os mesmos IDs e continuaram pendentes. Após a recuperação, duas aprovações ocorreram no uso normal da dashboard; a conferência encontrou ambos no CRM com origem Site, método automático, geração, primeiro recebimento e snapshot integral corretos. A execução não chamou uma aprovação ou rejeição comercial. A captura sintética continua pendente, sem CRM, para que o operador identifique o ensaio.

O conjunto chegou a **743 leads**, com levas de até **20** e **zero órfãos**. As quantidades pendentes podem mudar conforme a revisão humana. As consultas não compararam visitas com contatos e não alteraram gastos ou métricas Meta.

## Entrega medida

| Ensaio sintético em produção | Evidência |
| --- | --- |
| Captura inicial, 18:47:25 | Um contato, dois eventos, mesma identidade de origem |
| Primeiro recebimento na leva | 18:47:26; **1.317 ms** desde o início da requisição do cliente |
| Perfil inicial integral recebido | 18:47:26; respostas disponíveis para revisão |
| Atualização posterior, 18:48:01 | Terceiro evento recebido às 18:48:02; **1.724 ms** desde o início da requisição |
| Prioridade e vínculo | Mesmo contato, mesma leva e mesmo primeiro recebimento; geração original preservada |
| Decisão | Pendente, sem aprovação automática ou cadastro CRM sintético |

Esses tempos são uma medição do ensaio, não uma garantia de latência em toda conexão. O nudge tenta entregar após o commit e o job a cada minuto recupera pendências. Uma tentativa transitória falhou durante o backfill; o mesmo evento foi reenviado e confirmado posteriormente, sem duplicação.

## Captura, contexto e recuperação

O servidor grava contato e evento na mesma transação. A RPC antiga continua compatível. A nova captura inclui todas as chaves do perfil, os oito campos de atribuição e o relatório já calculado pelo navegador. A VOXEN mantém o mapa de notas existente; `stat_details` preserva os detalhes originais. As funções e os triggers internos `zyron_*` permaneceram intactos e habilitados; os hashes dos dados históricos também coincidiram antes e depois da evolução de schema.

O worker usa claims com lease e retenta com o mesmo ID/payload, sem limite de descarte. O receptor autentica o corpo UTF8 assinado, verifica o horário e confirma somente após gravar. Versões antigas permanecem no histórico; aprovados/rejeitados e contatos corrigidos por Tráfego recebem contexto separado, preservando a decisão e o cadastro.

As telas de `/avaliacao` e `/jogador` enviam o contato na etapa inicial e confirmam novamente o perfil atual antes de avançar. IndexedDB guarda capturas antes da rede; abertura do site e reconexão retomam a fila. Recibos persistidos junto da conclusão permitem que uma aba entregue a captura da outra sem deixar a tela esperando indefinidamente. Falha de armazenamento ou envio é informada, com nova tentativa, sem confirmação falsa.

O SDR encontra os dados em **Importações → Site / conversão direta**, separado de **Formulários**, mantendo a identificação **Automático/Manual**. Eventos completos ficam disponíveis na ficha e na revisão de Tráfego; listas carregam só metadados, 20 por página, e o payload é consultado ao abrir. Um ID manual canônico já existente mantém o vínculo e a captura manual. Contatos semelhantes sem identidade confiável recebem aviso, sem fusão automática.

## Limites e controles

- Transporte limitado a **16 MiB por evento**: evento maior permanece na origem, com erro visível e retomável. A captura inicial menor do contato tem entrega independente do perfil posterior com mídia. O resumo tem limites próprios; o evento integral não sofre truncamento silencioso.
- Formato desconhecido é preservado em quarentena durável e consultável por Tráfego, sem aprovação automática. Corrigir a origem gera nova revisão, mantendo o evento original.
- Campos que nunca foram gravados no passado não foram inventados. A origem tinha cinco perfis e dois relatórios preenchidos na conferência imediatamente anterior à instalação.
- Segredos HMAC e cron existem apenas nos servidores/Vault. As tabelas de outbox não concedem leitura aos clientes; execução da entrega e da inbox é restrita ao serviço. SDR só consulta eventos de contatos que pode ver no CRM.
- A prioridade continua pelo **primeiro recebimento mais recente na dashboard**; geração original, recebimento e chegada ao CRM são datas distintas. Reenvios e contexto posterior não alteram essa prioridade.

## Validação e publicação

Passaram **114 regressões Node da dashboard**, **17 do site**, TypeScript, builds de produção e lint dos arquivos alterados. O lint da dashboard registra uma advertência de Fast Refresh para o helper exportado, sem erro. Deno conferiu os handlers. SQL real verificou atomicidade com falha deliberada, claims, ACK vencido, replay, versões fora de ordem, permissões, backfill e levas/CRM.

O ensaio integrado usou dois bancos PostgreSQL reais e os handlers de produção, substituindo apenas as fronteiras externas. Chromium validou os dois funis, captura inicial/final, offline/online e entrega entre abas; duas sessões SDR verificaram o histórico e a sincronização com Realtime indisponível. Aprovação sintética e preservação de correções do SDR foram ensaiadas exclusivamente nos bancos locais.

Uma revisão independente encontrou uma falha importante entre abas e uma contagem dupla de quarentena. Ambas foram reproduzidas com testes que falharam e corrigidas em uma passagem, com os testes passando depois. Não houve achado crítico.

Migrations instaladas seletivamente, junto de seu histórico, sem `db push` ou reaplicação geral:

| Projeto | Migration |
| --- | --- |
| Dashboard | `20261013183108_site_lead_import_receipts.sql` |
| Site | `20261013183641_funnel_lead_outbox.sql` |
| Site | `20261013183939_funnel_lead_delivery_cron.sql` |

O agendamento e nudge nasceram desativados e foram ativados somente após funções, configuração privada, clientes e conferência de preservação. O job `funnel-lead-delivery` está ativo a cada minuto.

| Publicação | Versão e evidência |
| --- | --- |
| [Dashboard PR 2](https://github.com/dashwsllc/pitch-and-win1/pull/2) | Merge `a7b560c3028b9dc880d72fe5b587285939f6300d`; deployment `dpl_JDZkceaCiKuibR1rPNP2fB4XMxfA`, READY nos domínios oficiais |
| [Site PR 15](https://github.com/bkrsinclairrr/vide-match/pull/15) | Merge `7b0b551f414b9491bc35bd95c50287907664f73d`; deployment `dpl_73a6vr4UcT9DuE3GjvNtztiEnW9V`, READY em `aizyron.com` e `www.aizyron.com` |

Os dois domínios responderam 200 e seus assets servidos contêm os novos contratos. Receiver e worker recusaram requisições sem assinatura/segredo com 403. Arquivos publicados vieram de código rastreado, sem banco de ensaio, configuração privada ou segredo de servidor.

A tentativa direta pela CLI foi bloqueada pela validação de autor da Vercel. A publicação ocorreu pelo fluxo normal do GitHub conectado, sem trocar autor ou contornar autorização. A prévia da dashboard carece de variáveis públicas específicas de preview; produção compilou com a configuração própria. O CI de vendas passou. O CI de dependências ainda informa as **18 vulnerabilidades preexistentes** (5 moderadas/13 altas); nenhuma dependência de produto foi alterada por esta integração e nenhum check foi desativado. A varredura da dashboard passou; a do site identifica apenas o JWT `anon` público preexistente no cliente.

O Advisor acrescentou avisos esperados de execução das RPCs de captura pública e de operação autenticada, que têm validação/limitação e autorização próprias. Não surgiu novo erro de segurança; inbox e funções de entrega permanecem restritas ao serviço.

## Retomada e reversão

Para interromper a ponte, executar como serviço na origem `funnel_delivery_set_enabled(false)`. Isso desativa job/nudge e conserva contatos, eventos e recibos. Clientes antigos podem usar a RPC anterior. Para retomar, conferir receptor/configuração privada e reativar; claims expirados e eventos pendentes continuam disponíveis. Não apagar filas ou histórico como forma de reverter.

Os scripts de ensaio foram versionados nos dois repositórios. O integrado exige `SITE_TEST_SOURCE_ROOT`, `SITE_TEST_PG_MODULE` e `SITE_TEST_DATABASE_PASSWORD`, com bancos locais descartáveis `site_bridge_source`/`site_bridge_dash` em `127.0.0.1:55812`; nunca aponta para produção. O navegador do site exige `SITE_TEST_ORIGIN` local e `PLAYWRIGHT_MODULE`; o da dashboard usa `TRAFFIC_TEST_ORIGIN` local.

Os diretórios temporários locais foram preservados após bloqueio automático de limpeza, permanecem ignorados pelo Git e não foram enviados aos deployments. Nenhum arquivo de outro plano foi removido.
