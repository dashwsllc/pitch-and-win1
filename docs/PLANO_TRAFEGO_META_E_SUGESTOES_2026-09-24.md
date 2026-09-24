# Plano de implementação: Tráfego Meta e Sugestões

Data: 24/09/2026. Escopo: ampliar a dashboard React/Vite + Supabase existente, preservando a navegação, os componentes e a identidade visual atuais.

## 1. Estado atual e decisões de produto

- A rota `/trafego`, a entrada lateral e a função `canAccessTraffic` já existem. Elas admitem `traffic_manager`, `executive` e `super_admin`.
- A tela atual permite lançar manualmente data, plataforma, campanha, investimento e leads; lista 30 registros por página e mostra apenas CPL por linha. O seletor ainda aceita Google, TikTok, YouTube e outras fontes. O novo módulo será exclusivamente Meta Ads (Facebook e Instagram).
- `traffic_metrics` já tem `impressions`, `clicks`, `cpc`, `ctr`, `cpl`, `ad_set_name` e `notes`, mas o formulário atual não os popula. O modelo não tem IDs estáveis de conta/campanha/conjunto/anúncio, importação, aquisição atribuída nem trilha de sugestões.
- O banco tem uma política restritiva em `traffic_metrics`: o gestor só lê seus próprios registros; Executive e Super Admin podem ler todos. A visão compartilhada dos três perfis exige política de leitura própria, sem abrir a escrita a outros cargos.
- Aproveitar `DashboardLayout`, `surface-panel`, `Button`, `Input`, `Tabs`, `Dialog`, `Badge`, `Recharts`, estados de loading/erro/vazio, tipografia e cores já usados. Manter a página responsiva; tabelas densas devem ter rolagem horizontal e cabeçalhos legíveis.

## 2. Permissões

| Ação | Executive | Super Admin | Gestor de Tráfego | Outros cargos |
| --- | --- | --- | --- | --- |
| Ver Tráfego e Sugestões | Sim | Sim | Sim | Não |
| Conectar/desconectar conta Meta e alterar metas de referência | Sim | Sim | Propor alteração | Não |
| Importar CSV e sincronizar dados Meta | Sim | Sim | Sim | Não |
| Corrigir mapeamento, descartar lote, reprocessar | Sim | Sim | Sim, com auditoria | Não |
| Criar e responder sugestões | Sim | Sim | Sim | Não |
| Arquivar/excluir sugestões | Sim | Sim | Arquivar as próprias | Não |

Aplicar a matriz em quatro camadas: item da sidebar, guarda da rota, RLS e funções/Edge Functions. RLS deve usar identidade e cargos do banco, checar conta não suspensa e impedir acesso direto por URL ou REST. Não colocar token Meta no navegador. Dados de conta de anúncios e sugestões não devem aparecer nos RPCs gerais da Arena para cargos comerciais.

## 3. Página `/trafego`

Criar duas abas internas: **Desempenho Meta** e **Sugestões**. A primeira abre por padrão. Preservar a rota atual e migrar os dados manuais Meta existentes sem perdê-los; retirar plataformas não Meta do novo formulário. Registros históricos de outras plataformas devem ficar fora dos cálculos e disponíveis apenas em auditoria administrativa.

### Filtros e visualização

Filtros persistidos na URL: hoje, 7 dias, 30 dias, mês, personalizado; conta de anúncios; campanha; conjunto; anúncio; posicionamento; origem do dado (API, CSV, manual legado). Períodos de calendário em `America/Sao_Paulo`; registrar o fuso da conta Meta e avisar quando divergir. Cards mostram valor atual, período anterior equivalente, variação, definição e hora da última sincronização. Séries por dia e tabela hierárquica conta → campanha → conjunto → anúncio, com busca, ordenação, CSV de saída e drilldown. Evitar somar alcance único entre campanhas ou dias como se fossem pessoas distintas.

### Dicionário de métricas

| Métrica | Regra no painel |
| --- | --- |
| Investimento | Soma de `spend` da Meta, convertida apenas se a conta não estiver em BRL; exibir moeda original e taxa usada quando houver conversão. |
| Leads Meta | Ação de lead explicitamente escolhida no mapeamento da conta. Separar formulário instantâneo, site e mensagens; não somar tipos sobrepostos. |
| CPL | Investimento ÷ leads Meta. Sem leads: `—`, nunca zero artificial. |
| Leads qualificados | Quantidade de leads da campanha que atingiram o estágio de qualificação definido no CRM. |
| CPQL | Investimento ÷ leads qualificados. |
| Aquisições | Vendas aprovadas e ainda ativas no CRM, atribuídas à Meta por ID/UTM verificável. Mostrar separadamente as aquisições reportadas pela Meta. |
| CPA | Investimento ÷ aquisições atribuídas. Se não houver ligação confiável, `—` com indicação “atribuição incompleta”. |
| Receita atribuída / ROAS | Soma das vendas ativas vinculadas ÷ investimento; cancelamento/estorno reduz a receita atribuída e a aquisição ativa. Exibir ROAS da Meta em coluna distinta, quando disponível. |
| Funil | Clique no link → lead → qualificado → call agendada → call realizada → venda; taxas entre etapas com denominadores explícitos. |
| Diagnóstico de entrega | Impressões, alcance, frequência, CPM, cliques no link, CTR do link e CPC do link. Não misturar `clicks` gerais com cliques no link. |
| Criativo | Resultado por anúncio e posicionamento, quando disponível, com gasto, CPL, CPQL e CPA. |

Valores agregados devem vir de somas de numeradores e denominadores, nunca da média simples dos CPLs ou CPAs das linhas. Para alcance/frequência agregados, consultar a Meta no nível selecionado ou indicar que a medida não é agregável. Guardar janela de atribuição, `action_report_time`, moeda, definição da ação e momento da extração junto ao lote; mudanças nesses parâmetros não podem parecer ganho de desempenho.

### Benchmark útil ao gestor

Usar comparação **interna** por objetivo, tipo de lead, campanha e janela: mediana dos últimos 30/90 dias, melhor quartil com volume mínimo e período anterior equivalente. Metas editáveis para CPL, CPQL, CPA, taxa de qualificação e ROAS; cores e alertas apenas quando a amostra mínima configurada for atingida. Apresentar diagnóstico causal simples: “CPL subiu por CPM”, “CTR caiu”, “lead cresceu mas qualificação caiu”, “CPA alto por conversão após lead”. Não fixar um CPL/CPA universal em reais sem conhecer produto, ticket e margem.

Como referência externa de **método**, a Meta relata redução média de aproximadamente 15% no custo por lead de qualidade em um material de treinamento sobre Conversions API para CRM; isso sustenta acompanhar CPQL e eventos posteriores ao lead, mas não vira meta automática desta operação. A Meta também descreve testes de criativos em Reels com menor custo por resultado, o que justifica comparar formatos e posicionamentos com A/B tests. Fontes: [Meta Blueprint: qualidade de leads e CAPI para CRM](https://www.facebookblueprint.com/student/activity/585568-improve-lead-quality-with-conversions-api-for-crm), [Meta for Business: anúncios em Reels](https://www.facebook.com/business/ads/facebook-instagram-reels-ads).

## 4. Importação Meta

1. **CSV do Gerenciador de Anúncios**: aceitar `.csv` exportado pela Meta; assistente de mapeamento de colunas PT-BR/EN, prévia de linhas, validação de moeda/data/IDs/ações, resumo de novos/atualizados/rejeitados e confirmação do lote. Exigir IDs de conta, campanha, conjunto e anúncio para granularidade de anúncio; arquivo sem IDs só pode entrar como agregado de campanha, sinalizado. Dedupe por conta + data + nível + ID + janela de atribuição; reimportação corrige a linha existente. Guardar hash, usuário, hora, nome, erros e versão da importação.
2. **Conexão oficial Meta**: fluxo OAuth/Business Login com permissões de leitura da conta de anúncios, token criptografado em segredo do servidor e revogação. Edge Function consulta Insights por conta e dia, com paginação, limites, retries e cursor. Sincronização agendada e botão manual; reprocessar janela recente porque conversões atribuídas podem chegar depois. A UI mostra última execução, próxima tentativa, falhas e contas autorizadas. Nunca pedir token colado em campo público.
3. **Reconciliação**: API é fonte principal da mesma chave; CSV serve como entrada inicial e contingência. Não somar API e CSV sobre a mesma campanha/dia. Mostrar diferenças antes de substituir. A Meta expõe campos como `spend`, `impressions`, `reach`, `clicks`, `actions`, `cpc`, `cpm`, `ctr` e dimensões por campanha/conjunto/anúncio em seus exemplos oficiais: [coleção oficial Meta Marketing API](https://www.postman.com/meta/facebook-marketing-api/request/7mjf11e/getinsightforadsgroup), [Insights de conta](https://www.postman.com/meta/facebook-marketing-api/request/u38qbri/get-insight-details-from-an-adaccount-l4).

## 5. Banco e integração com CRM

Criar tabelas `meta_ad_accounts` (IDs, nome, moeda, fuso, estado), `meta_insight_daily` (chave única por conta/data/nível/ID/janela, medidas brutas e ações JSON), `meta_import_batches`, `meta_metric_settings` (ação de lead, objetivo, metas, amostra mínima) e `meta_crm_attribution` (lead/venda, campanha, evidência e data). Índices por data, conta, campanha e IDs externos. Manter `traffic_metrics` como legado ou migrá-la com `source='manual_legacy'`; não sobrescrever dados antigos sem rastreio.

Capturar `utm_source`, `utm_campaign`, `utm_content`, IDs Meta e `leadgen_id` quando disponíveis no ingresso do lead; preservar o vínculo no CRM até a venda. Matching por ID exato tem prioridade; UTM é evidência secundária; sem evidência fica “não atribuído”. Deduplicar lead e venda, preservar relação mesmo se o responsável comercial mudar e recalcular aquisição/receita quando a venda é cancelada. Dados pessoais do CRM não vão para a tabela de Insights. Caso futuro de CAPI para CRM exige desenho específico de consentimento e eventos; não faz parte da primeira entrega de leitura.

## 6. Aba Sugestões

Uma lista privada de conversas com assunto, texto, autor, data, campanha opcional, prioridade, status (`nova`, `em análise`, `planejada`, `aplicada`, `descartada`) e comentários em ordem cronológica. Executive, Super Admin e Gestor podem iniciar e responder. A sugestão pode apontar para campanha/conjunto/anúncio e para um intervalo de dados; o vínculo continua legível se a campanha sair do período filtrado. Mudança de status registra autor, hora e motivo; menções/novas respostas geram indicador visual dentro da aba, sem som. Busca, filtros por status/autor e contador de pendências. RLS explícita nas tabelas `traffic_suggestions`, `traffic_suggestion_comments` e `traffic_suggestion_events`; RPC para transições de status com auditoria. Evitar reaproveitar `team_messages`, que tem escopo diferente.

## 7. Sequência de entrega e critérios de aceite

1. **Base segura**: migrations, RLS, tipos Supabase e verificações de acesso por cada cargo. `/trafego` e respostas de API devem negar outros perfis, inclusive acesso direto.
2. **Métricas e UI**: reconstruir a aba atual com filtros, cards, séries e tabela Meta; fórmulas centralizadas em SQL/funções puras e teste de divisão por zero, moeda, fuso e agregação ponderada.
3. **CSV**: importar arquivo real anonimizado da conta, repetir o mesmo lote sem duplicar, corrigir um dia e verificar que os cards e a Arena sincronizam uma vez.
4. **Atribuição**: ligar leads e vendas reais por IDs/UTM; cancelar uma venda em teste e confirmar queda de CPA, aquisições, receita atribuída e ROAS sem apagar auditoria.
5. **Sugestões**: validar três perfis permitidos, bloqueio dos demais, respostas, status, indicação de não lidas e uso em celular.
6. **API Meta**: conectar conta de teste, verificar OAuth, sincronização, reprocessamento tardio, token vencido, rate limit, importação concorrente e desconexão. Comparar um mesmo período contra o Ads Manager sob a mesma janela de atribuição.
7. **Publicação**: migration antes do front, verificação de RLS e métricas em transação revertida, build/lint e observação da sincronização após publicação. Plano de retorno: desabilitar importação automática e restaurar a UI anterior mantendo os dados novos intactos.

Dependências externas para a etapa API: acesso administrativo à conta Meta, aplicativo Meta com permissões adequadas, IDs das contas autorizadas e decisão sobre a ação que representa “lead” e “aquisição” no negócio. A entrega CSV e a aba Sugestões não dependem da conexão API.
