# Sincronização automática Meta Ads → Tráfego e Leads

## Estado publicado

- **Tráfego / Importar:** CSV diário da Meta, em BRL, com mapeamento de colunas e atualização por data + IDs. CPL, CPA de compras reportadas, CTR de link, CPC de link e custo por conversa iniciada são derivados de somas, nunca de médias de taxas.
- Registros importados antes desta atualização precisam de um novo CSV com a coluna **conversas por mensagem iniciadas** para preencher essa métrica histórica.
- **Leads:** fila privada de formulários Meta, com filtros por situação, campanha e formulário, respostas originais, triagem do SDR e importação individual e atômica para o CRM. A página antiga de assinaturas foi preservada em **Assinaturas**.
- **Ainda não conectado:** não existe credencial Meta, webhook ou agendador ativo neste projeto. CSV de métricas não contém respostas pessoais de formulários. A fila receberá dados quando o conector abaixo for configurado.

### CSV manual de desempenho

No Gerenciador de Anúncios, escolha o período, **distribuição diária** e o nível campanha (ou conjunto/anúncio, mas um nível por arquivo). Adicione data do relatório, IDs e nomes de conta/campanha, gasto, leads, compras, impressões, cliques no link e conversas por mensagem iniciadas; inclua valor de compras para ROAS. Exporte CSV na moeda BRL. Em **Tráfego → Importar**, selecione o arquivo, confira o mapeamento sugerido e a janela de atribuição, confirme a moeda e importe. A tela abre automaticamente o nível e o período importados.

## Dados e acessos que o responsável precisa fornecer

1. Acesso administrativo ao **Meta Business Portfolio**, ao **app Meta for Developers**, às contas de anúncios e às Páginas vinculadas aos formulários.
2. IDs das contas de anúncios (`act_...`), Páginas e formulários que devem ser sincronizados; confirmar que a moeda da conta é BRL e quais campanhas/formulários entram na fila.
3. App ID, App Secret e uma credencial de servidor autorizada para ler Insights e Lead Ads, provisionados como **segredos do backend**. Nunca colocar token no Vite, navegador, CSV, Git ou mensagem de chat.
4. Aprovação das permissões que a configuração atual da Meta pedir para ler anúncios, recuperar leads e assinar webhooks da Página. Em especial, validar `ads_read`, `leads_retrieval` e permissões de Página na revisão do app; a lista exata depende dos recursos e da modalidade de acesso concedida pela Meta.
5. Permissão do usuário de sistema/app na conta de anúncios e **Lead Access** da Página. Confirmar com um lead de teste que a API devolve `field_data`.

## Implantação recomendada

### 1. Métricas de campanha

Criar uma Edge Function de servidor `meta-insights-sync`, autenticada por segredo interno e agendada. Consultar a Insights API por conta com `time_increment=1`, IDs e nomes da conta/campanha/conjunto/anúncio, `spend`, `impressions`, `inline_link_clicks`, `actions` e `action_values`. Registrar o nível consultado e a configuração de atribuição. Mapear os tipos reais de ação devolvidos pela conta para leads, compras, valor de compras e conversas por mensagem iniciadas; conferir esse mapa com um relatório do Ads Manager antes de ativar. Gravar no mesmo contrato de `meta_traffic_daily` usado pelo CSV, com upsert por data + conta + campanha + conjunto + anúncio.

Executar periodicamente, relendo uma janela recente para incorporar atribuições tardias. Guardar o último sucesso por conta e o último erro. Nunca somar simultaneamente os níveis campanha, conjunto e anúncio. Tratar `CTR` como cliques no link ÷ impressões e `CPC` como gasto ÷ cliques no link.

### 2. Leads de formulário

Criar endpoint HTTPS público `meta-lead-webhook` no backend. O GET responde ao desafio `hub.challenge` após comparar `hub.verify_token`. No POST, validar **HMAC-SHA256 sobre o corpo bruto** usando `X-Hub-Signature-256` e App Secret. Assinar o campo `leadgen` das Páginas autorizadas. O evento entrega `leadgen_id`, `page_id` e `form_id`; **não contém todas as respostas**. Após registrar o evento, responder rapidamente 200 e processar em fila.

O trabalhador recupera `/{leadgen_id}` pela Graph API com campos como `id,created_time,form_id,ad_id,campaign_id,campaign_name,field_data,custom_disclaimer_responses`. Validar que Página/formulário estão na lista permitida. Preservar o vetor `field_data` completo, inclusive perguntas personalizadas e múltiplos valores, e gravar por `meta_ingest_form_lead` com a credencial de servidor. O `meta_lead_id` único torna reentregas e reprocessamentos idempotentes. A fila **Leads** mostra o registro; o SDR filtra, revisa e transfere um por vez para o CRM.

### 3. Confiabilidade e verificação

- Armazenar eventos recebidos antes de processar, com estado pendente/processado/erro, tentativas e próxima execução. Repetir falhas transitórias com espera progressiva; colocar falhas permanentes em fila de revisão.
- Reconciliar periodicamente os leads de cada formulário via Graph API, comparando IDs com `meta_form_leads`, para recuperar notificações perdidas. O webhook fornece velocidade; a reconciliação fornece cobertura.
- Monitorar por conta/Página: último Insights bem-sucedido, último webhook, quantidade de leads recebidos, pendentes, importados, erros e atraso. Alertar quando passar do limite operacional definido, e não apenas quando o processo cair.
- Fazer testes com lead de teste da Meta: assinatura válida e inválida, entrega duplicada, recuperação de `field_data`, campanha/formulário correto, preservação das respostas e importação de um lead incompleto pelo SDR.
- Reconciliar amostras de gasto/resultados contra o Ads Manager na mesma moeda, fuso, nível e janela de atribuição. Só ativar a sincronização automática depois dessa conferência.

## Referências da Meta

- [Coleção oficial da Marketing API: Insights](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)
- [SDK oficial: campos de Lead, incluindo field_data e campanha](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/lead.py)
- [Exemplo oficial de webhook Lead Ads e recuperação por leadgen_id](https://github.com/fbsamples/lead-ads-webhook-sample)
- [Documentação oficial de Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
