# Conexão oficial com a API da Meta — guia de configuração

Criado em 27/09/2026; revisado em 09/10/2026. Guia de configuração da sincronização automática de métricas e leads de formulário. O resultado de cada execução deve ser conferido na aba Conexão: uma resposta HTTP 200 antiga não comprova que os dados foram sincronizados.

Sem os passos 1–9 abaixo, o sistema continua funcionando exatamente como antes (CSV manual + fila de leads manual). Nada quebra por essas funções existirem sem estar configuradas.

## 1. Criar o Meta App

1. Acesse [developers.facebook.com](https://developers.facebook.com/apps) → **Criar app**.
2. Tipo de app: **Negócios** (Business).
3. Adicione os produtos: **Marketing API** e **Webhooks**.

## 2. Criar o Usuário de Sistema (System User)

1. No **Business Settings** (Configurações do Business Manager) → **Usuários** → **Usuários do sistema** → **Adicionar**.
2. Dê um nome (ex.: "Sync Dashboard Tráfego") e papel **Admin** do sistema.
3. Em **Atribuir ativos**, adicione:
   - A(s) **conta(s) de anúncios** que vão ser sincronizadas.
   - A(s) **Página(s)** do Facebook usadas nos formulários de lead (Lead Ads).

## 3. Gerar o token de acesso

1. No mesmo Usuário de Sistema → **Gerar novo token**.
2. Selecione o App criado no passo 1.
3. Marque as permissões: `ads_read`, `leads_retrieval`, `pages_read_engagement` e `pages_manage_ads`. Em 09/10/2026, a consulta de formulários da página deste projeto retornou `(#200) Requires pages_manage_ads permission to manage the object`.
4. Copie o token — **ele só aparece uma vez**.

## 4. Pegar o App Secret

App Dashboard → **Configurações** → **Básico** → campo "Chave Secreta do Aplicativo" → **Mostrar**.

## 5. Configurar os segredos no Supabase Dashboard

Project Settings → **Edge Functions** → **Secrets**. Adicione exatamente estes nomes:

| Nome | Valor | Obrigatório |
|---|---|---|
| `META_SYSTEM_USER_TOKEN` | Token gerado no passo 3 | Sim |
| `META_APP_SECRET` | Chave do passo 4 | Sim (webhook) |
| `META_WEBHOOK_VERIFY_TOKEN` | Qualquer valor forte que você inventar | Sim (webhook) |
| `META_SYNC_CRON_SECRET` | Outro valor forte, diferente do anterior | Sim (cron) |
| `META_PAGE_IDS` | IDs de Página separados por vírgula (ex.: `123456,789012`) | Sim (leads) |
| `META_GRAPH_API_VERSION` | Versão atual da Graph API (ex.: `v23.0`) — **confirme a versão vigente na documentação da Meta antes de configurar** | Recomendado |
| `META_SYNC_LOOKBACK_DAYS` | `3` (padrão se omitido) | Opcional |
| `META_SYNC_DEEP_LOOKBACK_DAYS` | não usado diretamente — a varredura diária já manda `days:8` fixo | — |
| `META_RECONCILIATION_LOOKBACK_HOURS` | `48` (padrão se omitido) | Opcional |
| `META_PAGE_ACCESS_TOKEN` | Token da página com acesso aos formulários e leads; quando configurado, é usado na listagem de formulários, na listagem de leads e na leitura das respostas | Opcional |

## 6. Segredos do cron (rodar uma única vez, direto no SQL Editor do Supabase — nunca commitar isso)

```sql
select vault.create_secret('<sua anon key do projeto>', 'meta_cron_anon_key');
select vault.create_secret('<mesmo valor que você colocou em META_SYNC_CRON_SECRET>', 'meta_sync_cron_secret');
```

A anon key fica em Project Settings → API. Até esses dois segredos existirem no Vault, os jobs agendados (`meta-insights-sync-frequent`, `meta-insights-sync-deep`, `meta-leads-reconciliation-hourly`) disparam a cada ciclo e falham de forma inofensiva (POST com header nulo) — nenhum dado é corrompido, só não sincroniza nada até aqui ser resolvido.

## 7. Migrations e Edge Functions

Já aplicadas/publicadas nesta sessão — nenhuma ação necessária:
- `meta_ad_accounts_and_sync_runs`, `meta_traffic_source_and_system_import`, `meta_webhook_events`, `meta_sync_cron_jobs` (Supabase, projeto `mbzwchnxtskysqplqiyy`).
- Edge Functions `meta-insights-sync` (`verify_jwt=true`), `meta-lead-webhook` (`verify_jwt=false`), `meta-leads-reconciliation` (`verify_jwt=true`) — todas `ACTIVE`.

## 8. Configurar o Webhook no painel da Meta

App Dashboard → **Webhooks** → **Page** → **Assinar este objeto**:
- **Callback URL**: `https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/meta-lead-webhook`
- **Verify Token**: o mesmo valor que você colocou em `META_WEBHOOK_VERIFY_TOKEN` (passo 5).
- Campo a assinar: **leadgen**.
- Selecione a(s) Página(s) para assinar o webhook.

## 9. Conectar a conta pela UI

Como Executive ou Super Admin: `/trafego` → aba **Conexão** → preencher ID da conta (`act_...`, sem o prefixo `act_` no campo — o sistema adiciona automaticamente ao chamar a API) e nome → **Conectar**.

## 10. Checklist de validação manual

Rode nesta ordem, sempre conferindo o resultado antes de seguir para o próximo item:

1. **Webhook GET**: `curl "https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/meta-lead-webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123"` → deve devolver `123` (200). Com token errado, deve devolver 403.
2. **Lead Ads Testing Tool** (dentro do App Dashboard → Marketing API → Lead Ads Testing Tool): envie um lead de teste → confira que aparece em `/leads` com status "Novo" e que "Diagnóstico do webhook" não mostra erro crescente.
3. **Sincronizar agora** (aba Conexão): clique e confira que uma nova linha aparece em `meta_sync_runs` (visível na própria UI) com status Sucesso e a contagem de linhas.
4. **Comparação com o Ads Manager**: filtre a aba Desempenho por Origem=API e compare investimento/leads/CPL com o Gerenciador de Anúncios no mesmo período — **faça isso antes de tomar qualquer decisão de investimento com base nesses números**. Se os valores não baterem, o mapeamento de `action_type` em `supabase/functions/_shared/meta-graph.ts` provavelmente precisa de ajuste para esta conta.
5. **Erro tratado**: se ocorrer uma falha de permissão ou de persistência, confira o motivo em `meta_sync_runs.error_message`. As funções corrigidas respondem HTTP 502 e `ok=false` quando alguma execução falha. Não altere permissões de produção apenas para provocar um erro.
6. **Desconexão**: desconecte a conta pela UI e confirme que o próximo ciclo de sync a ignora (nenhuma linha nova de `source='api'` aparece).
7. **Permissões por papel**: logando como `traffic_manager`, confirme que a aba Conexão mostra status mas não os campos de conectar/desconectar — só o botão "Propor alteração".

## O que ainda não está e não pode estar validado

O mapeamento de `action_type` da Meta para leads/compras/mensagens (`LEAD_ACTION_TYPES`, `PURCHASE_ACTION_TYPES`, `MESSAGING_ACTION_TYPES` em `supabase/functions/_shared/meta-graph.ts`) foi executado com os dados desta conta, mas ainda não foi comparado com o Ads Manager no mesmo período. O item 4 do checklist acima resolve essa validação.

## Correções de 09/10/2026

- A Graph API usada pelo projeto rejeitou a consulta raiz `ids` para buscar objetivos das campanhas. A sincronização agora lê `/<campaign_id>?fields=objective`, com até três consultas simultâneas. O campo consta no [SDK oficial da Meta](https://github.com/facebook/facebook-nodejs-business-sdk).
- A reconciliação diferencia leads encontrados, processados, ignorados e com falha. A contagem sincronizada exige persistência bem-sucedida.
- Erros na finalização do registro de execução não são apresentados como sucesso.
- Um lead recebido por planilha mantém suas respostas originais quando o mesmo ID chega posteriormente pela integração automática.
- A importação manual pode ser usada enquanto o acesso automático aos formulários é regularizado: veja [o fluxo de importação](META_IMPORTACAO_MANUAL_2026-10-09.md).

Para corrigir o erro de permissão acima, o administrador da Meta deve conferir o acesso do usuário de sistema à página, conceder `pages_manage_ads` ao app/token adequado e atualizar o segredo correspondente no Supabase. Tokens devem ser inseridos diretamente em Edge Functions → Secrets, sem enviá-los por conversa.

## Verificação da publicação em 09/10/2026

- Migration `20261009140000_meta_lead_import_reliable` aplicada e registrada no histórico do projeto vinculado.
- As três Edge Functions Meta foram publicadas. O teste SQL passou no schema publicado e desfez todas as fixtures por rollback.
- Às 14h28 de Brasília, a sincronização real de métricas respondeu HTTP 200 e `ok=true`: 11 registros em campanha, 11 em conjunto e 11 em anúncio. As três execuções ficaram com status `success` no banco.
- A reconciliação de leads respondeu HTTP 502 e `ok=false`, com status `error` no banco: a Meta continua exigindo `pages_manage_ads`. Nenhum lead foi capturado nessa execução. A regularização do acesso da página permanece pendente.
- Os 16 testes de regressão, TypeScript, Deno, ESLint dos arquivos alterados e build passaram. O fluxo autenticado da interface não foi testado em navegador nesta sessão.
