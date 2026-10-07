# Prompt de manutenção: sync Meta Ads ↔ dashboard (pitch-and-win1)

Cole o bloco abaixo numa sessão do Claude Code (nesta pasta do projeto) sempre que quiser checar
ou consertar a sincronização automática de métricas/leads do Meta Ads com o dashboard.
Atualize as seções "Estado conhecido" e "Bloqueios conhecidos" no fim conforme a situação mudar,
pra o prompt continuar valendo no futuro.

---

## PROMPT (copiar a partir daqui)

Verifique e, quando possível, conserte a sincronização automática de métricas de campanha e leads
do Meta Ads com o dashboard, no projeto `pitch-and-win1` (Supabase, projeto `mbzwchnxtskysqplqiyy`).

**Onde estão as coisas:**
- Guia de setup manual (passo a passo Meta App / System User / secrets):
  `pitch-and-win1/docs/META_ADS_OFFICIAL_API_SETUP_2026-09-27.md`
- Mapeamento de `action_type` da Meta (leads/compras/mensagens):
  `supabase/functions/_shared/meta-graph.ts` (`LEAD_ACTION_TYPES`, `PURCHASE_ACTION_TYPES`,
  `MESSAGING_ACTION_TYPES`) — documentação pública da Meta, nunca validado 100% contra a conta real.
- Edge Functions: `meta-insights-sync` (verify_jwt=true), `meta-lead-webhook` (verify_jwt=false),
  `meta-leads-reconciliation` (verify_jwt=true).
- Cron jobs: `meta-insights-sync-frequent`, `meta-insights-sync-deep` (roda com `days:8` fixo),
  `meta-leads-reconciliation-hourly`.
- Tabela de auditoria de execução: `meta_sync_runs` (status, contagem de linhas, `error_message`).
- UI de conexão da conta: `/trafego` → aba **Conexão** (papéis Executive/Super Admin conectam/desconectam;
  `traffic_manager` só vê status).

**IDs conhecidos (Business Manager "BM 01 - Ismael"):**
- Business ID: `1035964610396894`
- App "sinc dados - voxen/zyron": App ID `4518834395063659`
- Usuário de Sistema "sinc dados zyron/voxen - dash": ID `61594997935696`, Acesso de Admin,
  ativos atribuídos: Página "Zyron" (acesso total) + Conta de anúncios "CA 2 - MILHAO"
  (ID `1615235116333866`, acesso total).

**Passo 1 — Diagnóstico primeiro, sem assumir nada:**
1. Consultar a tabela `meta_sync_runs` no Supabase (via MCP Supabase — `execute_sql` ou tool
   equivalente) pra ver as execuções mais recentes: sucesso, erro, `error_message`, contagem de linhas.
2. Conferir se os secrets abaixo existem em Project Settings → Edge Functions → Secrets (não é
   possível ler o valor, só confirmar presença/uso nos logs de erro):
   `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_SYNC_CRON_SECRET`,
   `META_PAGE_IDS`, `META_GRAPH_API_VERSION`, `META_SYNC_LOOKBACK_DAYS`,
   `META_RECONCILIATION_LOOKBACK_HOURS`.
3. Se algo estiver falhando, ler os logs da Edge Function relevante (`query_logs` via MCP Supabase)
   pra achar a causa exata antes de propor qualquer mudança.

**Passo 2 — Bloqueios conhecidos (checar se já foram resolvidos antes de tentar de novo):**
- App "sinc dados - voxen/zyron" estava em **modo Desenvolvimento**, com **Nível de acesso da API de
  Marketing: Limited** (Configurações do app → API de Marketing → Configurações). Motivos: app em
  dev mode + não aprovado pro "Marketing API Access Tier". Isso fazia o gerador de token do Usuário
  de Sistema mostrar "nenhuma permissão disponível".
- Pra sair do modo Desenvolvimento, faltavam em Configurações do app → Básico: **Categoria** (vazia),
  **URL da Política de Privacidade** (vazia), **Ícone do app** (vazio).
- **Verificação da Empresa** (BM 01 - Ismael) estava "Não verificado" — pré-requisito pro acesso
  avançado da Marketing API (`ads_read`, `leads_retrieval`). Processo formal da Meta, análise de até
  5 dias, exige documentos do negócio — só o usuário consegue iniciar/fornecer isso.
- Conta de anúncios "CA 2 - MILHAO" (`1615235116333866`) estava **desabilitada por falha na forma de
  pagamento** — checar se já foi reativada; sem isso o sync pode não achar dados recentes mesmo com
  token válido.

**Passo 3 — Se o token/permissão ainda estiver bloqueado:**
Não insista tentando gerar token pela UI de novo sem checar antes se os itens do Passo 2 mudaram de
estado. Se ainda estiverem pendentes, isso é decisão/ação do usuário (documentos de verificação,
ícone, política de privacidade, regularizar pagamento) — reporte o que está pendente e pare aí,
não tente contornar.

**Passo 4 — Validação de dados (só depois que o sync estiver rodando sem erro):**
Comparar a aba Desempenho do dashboard (Origem=API) com o Gerenciador de Anúncios real, mesmo
período. Se os números não baterem, o mapeamento de `action_type` em
`supabase/functions/_shared/meta-graph.ts` provavelmente precisa de ajuste pra essa conta — não
mude isso sem essa comparação primeiro.

**Como reportar:**
Resposta curta e direta: o que está funcionando, o que está quebrado (com a causa exata encontrada
nos logs, não suposição), e o que só o usuário pode resolver. Não sugerir soluções genéricas antes
de ler os logs reais.

---

## Estado conhecido (última atualização: 2026-09-29)
- Código do sync: implantado e ativo, nunca validado contra a conta real (item 4 do checklist do
  guia de setup nunca foi rodado).
- Token do Usuário de Sistema: nunca gerado com sucesso (bloqueado pelos itens do Passo 2).
- Conta de anúncios CA 2 - MILHAO: desabilitada por pagamento em 2026-09-29.
- `supabase/functions/_shared/meta-lead-ingest.ts` agora usa Jev (TypeSafe) pra extrair
  nome/telefone/email do `field_data` do lead, em vez de casamento exato de rótulo — ver
  `meta-lead-extract.ts`. Precisa do secret `TYPESAFE_API_KEY` em Edge Functions → Secrets pra
  ativar; sem ele (ou se a API falhar), cai sozinho pro casamento exato de sempre, sem quebrar o
  ingest de leads.
