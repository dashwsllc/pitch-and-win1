import { writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Saúde dos DADOS do CRM em produção, só leitura (a transação é READ ONLY: nada é gravado). Roda quando quiser:
//   node scripts/check-crm-health-db.mjs
// Duas gravidades:
//   ERRO     tem de ser sempre 0: é estado impossível pelas regras do CRM (etapa sem data de fechamento, call pendente em lead
//            encerrado, lead aberto sem dono ativo...). Qualquer ERRO > 0 faz o script sair com código 1.
//   ATENÇÃO  é trabalho para a equipe, não defeito do sistema: calls vencidas sem resultado, leads duplicados, venda ganha
//            sem venda cadastrada. O script lista, não corrige: mexer nesses dados muda pontos da Arena e relatórios.
const root = resolve(import.meta.dirname, '..')
const closed = "('fechado_ganho','fechado_perdido','lead_perdido')"
const openCall = "a.call_type IS NOT NULL AND NOT a.is_completed AND a.cancelled_at IS NULL"
const checks = [
  // ---- ERRO: nunca pode acontecer
  ['ERRO', 'etapa encerrada sem closed_at', `SELECT count(*) FROM crm_leads WHERE pipeline_stage IN ${closed} AND closed_at IS NULL`],
  ['ERRO', 'venda concluída sem resultado "venda_concluida"', `SELECT count(*) FROM crm_leads WHERE pipeline_stage='fechado_ganho' AND last_result_outcome IS DISTINCT FROM 'venda_concluida'`],
  ['ERRO', 'venda recusada sem resultado "venda_perdida"', `SELECT count(*) FROM crm_leads WHERE pipeline_stage='fechado_perdido' AND last_result_outcome IS DISTINCT FROM 'venda_perdida'`],
  ['ERRO', 'lead perdido sem resultado "lead_perdido"', `SELECT count(*) FROM crm_leads WHERE pipeline_stage='lead_perdido' AND last_result_outcome IS DISTINCT FROM 'lead_perdido'`],
  ['ERRO', 'perdido ou recusado sem motivo (negative_reason)', `SELECT count(*) FROM crm_leads WHERE pipeline_stage IN ('fechado_perdido','lead_perdido') AND coalesce(btrim(negative_reason),'')=''`],
  ['ERRO', 'lead em qualificação já com Closer', `SELECT count(*) FROM crm_leads WHERE pipeline_stage='em_qualificacao' AND closer_id IS NOT NULL`],
  ['ERRO', 'lead sem SDR', `SELECT count(*) FROM crm_leads WHERE sdr_id IS NULL`],
  ['ERRO', 'abordado marcado e etapa de abordagem divergentes', `SELECT count(*) FROM crm_leads WHERE (approached AND approach_stage='nao_abordado') OR (NOT approached AND approach_stage IN ('abordado','reabordado'))`],
  ['ERRO', 'lead encerrado com retorno agendado fora do remarketing', `SELECT count(*) FROM crm_leads WHERE pipeline_stage IN ${closed} AND next_followup_at IS NOT NULL AND coalesce(remarketing_status,'') NOT IN ('scheduled','pending','contacted')`],
  ['ERRO', 'call pendente em lead encerrado', `SELECT count(*) FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${openCall} AND l.pipeline_stage IN ${closed}`],
  ['ERRO', 'call de fechamento pendente em lead que ainda não foi repassado', `SELECT count(*) FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${openCall} AND a.call_type='fechamento_closer' AND l.pipeline_stage='em_qualificacao'`],
  ['ERRO', 'call de fechamento pendente com responsável diferente do Closer do lead', `SELECT count(*) FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${openCall} AND a.call_type='fechamento_closer' AND l.closer_id IS DISTINCT FROM a.assigned_to`],
  ['ERRO', 'mais de uma call pendente do mesmo tipo no mesmo lead', `SELECT count(*) FROM (SELECT lead_id, call_type FROM crm_activities a WHERE ${openCall} GROUP BY 1,2 HAVING count(*)>1) x`],
  ['ERRO', 'lead aberto sem nenhum dono ativo (SDR nem Closer)', `SELECT count(*) FROM crm_leads l WHERE l.pipeline_stage NOT IN ${closed} AND NOT EXISTS (SELECT 1 FROM auth.users u JOIN profiles p ON p.user_id=u.id WHERE u.deleted_at IS NULL AND NOT p.suspended AND u.id IN (l.sdr_id, l.closer_id))`],
  ['ERRO', 'call pendente com responsável suspenso ou excluído', `SELECT count(*) FROM crm_activities a JOIN auth.users u ON u.id=a.assigned_to LEFT JOIN profiles p ON p.user_id=u.id WHERE ${openCall} AND (u.deleted_at IS NOT NULL OR coalesce(p.suspended,false))`],
  ['ERRO', 'atividade fora dos limites de texto (constraint crm_activities_input_secure, ainda NOT VALID)', `SELECT count(*) FROM crm_activities WHERE NOT (char_length(btrim(title)) BETWEEN 1 AND 200 AND char_length(coalesce(description,''))<=10000 AND char_length(coalesce(outcome,''))<=5000)`],
  ['ERRO', 'gatilho de sincronização do CRM desligado', `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O' AND tgrelid::regclass::text IN ('crm_leads','crm_activities','crm_lead_contexts','crm_lead_payment_status')`],
  ['ERRO', 'tabela do CRM fora da publicação Realtime', `SELECT 4 - count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename IN ('crm_leads','crm_activities','crm_lead_contexts','crm_lead_payment_status')`],
  // ---- ATENÇÃO: trabalho da equipe
  ['ATENÇÃO', 'calls pendentes vencidas há mais de 1 dia, sem resultado nem cancelamento', `SELECT count(*) FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${openCall} AND a.scheduled_at < now() - interval '1 day' AND l.pipeline_stage NOT IN ${closed}`],
  ['ATENÇÃO', 'lead "pronto para Closer" com call de qualificação ainda pendente (falta repassar ou encerrar a call)', `SELECT count(*) FROM crm_activities a JOIN crm_leads l ON l.id=a.lead_id WHERE ${openCall} AND a.call_type='qualificacao' AND l.pipeline_stage IN ('pronto_closer','repassado_closer')`],
  ['ATENÇÃO', 'retorno do lead (next_followup_at) diferente da próxima call pendente', `SELECT count(*) FROM crm_leads l WHERE l.pipeline_stage NOT IN ${closed} AND l.next_followup_at IS DISTINCT FROM (SELECT min(a.scheduled_at) FROM crm_activities a WHERE a.lead_id=l.id AND ${openCall}) AND l.next_followup_at IS NOT NULL`],
  ['ATENÇÃO', 'leads repetidos pelo WhatsApp (grupos de telefone igual)', `SELECT count(*) FROM (SELECT regexp_replace(phone,'\\D','','g') p FROM crm_leads WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\\D','','g'))>=8 GROUP BY 1 HAVING count(*)>1) x`],
  ['ATENÇÃO', 'venda concluída no CRM sem venda cadastrada e vinculada ao lead', `SELECT count(*) FROM crm_leads l WHERE l.pipeline_stage='fechado_ganho' AND NOT EXISTS (SELECT 1 FROM vendas v WHERE v.crm_lead_id=l.id)`],
  ['ATENÇÃO', 'leads repassados ao Closer sem responsável há mais de 3 dias', `SELECT count(*) FROM crm_leads WHERE pipeline_stage='repassado_closer' AND closer_id IS NULL AND handed_off_at < now() - interval '3 days'`],
]
const query = [
  'BEGIN READ ONLY;',
  "SET LOCAL statement_timeout='30s';",
  checks.map(([gravidade, nome, sql]) => `SELECT '${gravidade}' AS gravidade, '${nome.replace(/'/g, "''")}' AS verificacao, (${sql})::int AS n`).join('\nUNION ALL\n') + ';',
  'ROLLBACK;',
].join('\n')
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
writeFileSync(resolve(root, '.verification.local/crm-health.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', '.verification.local/crm-health.sql', '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exit(result.status ?? 1)
}
const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))
const rows = json.rows
const pad = (t, n) => String(t).padEnd(n)
for (const gravidade of ['ERRO', 'ATENÇÃO']) {
  console.log(`\n${gravidade === 'ERRO' ? 'ERROS (têm de ser 0)' : 'ATENÇÃO (trabalho da equipe, nada é corrigido automaticamente)'}`)
  for (const row of rows.filter((r) => r.gravidade === gravidade)) console.log(`  ${pad(row.n === 0 ? 'ok' : gravidade === 'ERRO' ? 'ERRO' : 'aviso', 6)} ${pad(row.n, 4)} ${row.verificacao}`)
}
const erros = rows.filter((r) => r.gravidade === 'ERRO' && r.n > 0)
console.log(erros.length ? `\nFALHOU: ${erros.length} verificação(ões) de ERRO com linhas fora do esperado.` : '\nPASS: nenhum estado impossível no CRM. (Os avisos acima são fila de trabalho, não defeitos.)')
process.exit(erros.length ? 1 : 0)
