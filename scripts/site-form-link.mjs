import { writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Operacao do vinculo site <-> formulario Meta (depois de instalar a migration 20261015021500).
//   status           numeros atuais (leads do site, vinculados, no CRM sem respostas, formularios antes de 07/10)
//   preview          o que seria vinculado, SEM gravar nada (revise a lista, principalmente "revisar (ambiguo)")
//   apply            vincula os pares inequivocos e leva as respostas ao Contexto dos leads que ja estao no CRM
//   twins            leads criados a mao no CRM com formulario do mesmo WhatsApp e primeiro nome (so aviso)
//   backfill [data]  busca na Meta os formularios anteriores a 07/10 (data inicial, padrao 2026-09-01)
//   backfill-status  acompanha a busca
//   temperature      confere a classificacao frio/morno/quente (contagem e 3 exemplos de cada, sem nomes)
const root = resolve(import.meta.dirname, '..')
const [command, arg] = process.argv.slice(2)
const PAGE = '1161109683744531'
function run(sql) {
  mkdirSync(resolve(root, '.verification.local'), { recursive: true })
  const file = '.verification.local/site-form-link-query.sql'
  writeFileSync(resolve(root, file), sql)
  const cli = process.env.SUPABASE_CLI || 'npx', args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
  args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', file, '--output', 'json')
  const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) { console.error((result.stderr || result.stdout || result.error?.message || '').trim()); process.exit(result.status ?? 1) }
  try { const parsed = JSON.parse(result.stdout); return Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.result ?? [parsed] }
  catch { console.log(result.stdout); return null }
}
const show = rows => { if (rows) rows.length ? console.table(rows) : console.log('(nenhuma linha)') }

if (command === 'status') show(run(`SELECT
  (SELECT count(*) FROM public.meta_form_leads WHERE entry_channel='form') AS formularios_meta,
  (SELECT count(*) FROM public.meta_form_leads WHERE entry_channel='form' AND created_time < '2026-10-07') AS formularios_antes_de_07_10,
  (SELECT count(*) FROM public.meta_form_leads WHERE entry_channel='website') AS leads_do_site,
  (SELECT count(*) FROM public.meta_form_leads WHERE answers_form_lead_id IS NOT NULL) AS site_ligados_a_formulario,
  (SELECT count(*) FROM public.crm_leads c WHERE c.import_channel='website') AS leads_do_site_no_crm,
  (SELECT count(*) FROM public.crm_leads c WHERE c.import_channel='website' AND EXISTS(SELECT 1 FROM public.crm_lead_contexts x WHERE x.lead_id=c.id AND x.context_type='meta_form')) AS leads_do_site_com_respostas,
  (SELECT count(*) FROM public.meta_site_form_pairs() WHERE ambiguous) AS pares_para_revisar;`))
else if (command === 'preview') show(run(`SELECT situacao, rule AS regra, delta_seconds AS segundos_depois_do_formulario, nome_site, nome_formulario, crm_lead_id IS NOT NULL AS site_ja_no_crm
  FROM public.meta_link_site_answers(false) ORDER BY ambiguous DESC, rule, delta_seconds;`))
else if (command === 'apply') {
  const rows = run(`SELECT situacao, rule AS regra, delta_seconds AS segundos_depois_do_formulario, nome_site, nome_formulario, crm_lead_id IS NOT NULL AS site_ja_no_crm
    FROM public.meta_link_site_answers(true) ORDER BY ambiguous DESC, rule, delta_seconds;`)
  show(rows)
  if (rows) console.log('\nPor situacao:', Object.entries(rows.reduce((acc, r) => (acc[r.situacao] = (acc[r.situacao] ?? 0) + 1, acc), {})).map(([k, v]) => `${k}=${v}`).join(' | '))
}
else if (command === 'temperature') {
  show(run(`SELECT temperature AS aquecimento, count(*) AS formularios FROM public.meta_temperature_preview() GROUP BY 1 ORDER BY 1;`))
  show(run(`SELECT temperature AS aquecimento, reasons AS motivos FROM (SELECT temperature, reasons, row_number() OVER (PARTITION BY temperature ORDER BY random()) AS n FROM public.meta_temperature_preview()) x WHERE n <= 3 ORDER BY 1, n;`))
}
else if (command === 'hints') show(run(`SELECT h.temperature AS aquecimento, h.applied AS marcado_no_lead, count(*) AS leads FROM public.crm_lead_temperature_hints h GROUP BY 1,2 ORDER BY 1,2;`))
else if (command === 'twins') show(run(`SELECT nome_crm, nome_formulario, form_approval AS aprovacao_do_formulario, crm_lead_id, form_id FROM public.meta_manual_crm_twins();`))
else if (command === 'backfill') {
  const since = arg || '2026-09-01'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.error('Use uma data AAAA-MM-DD'); process.exit(2) }
  console.log(`Recuando a janela de busca da Meta para ${since} (a Meta guarda os leads por ~90 dias). Os formularios ja recebidos nao sao duplicados.`)
  show(run(`UPDATE public.meta_lead_discovery_state SET last_completed_until='${since} 00:00:00+00'::timestamptz, version=version+1
    WHERE page_id='${PAGE}' AND forms_next IS NULL AND form_id IS NULL AND form_queue='[]'::jsonb AND claim_token IS NULL
      AND (lease_until IS NULL OR lease_until < now()) AND last_completed_until > '${since} 00:00:00+00'::timestamptz
    RETURNING page_id, last_completed_until AS busca_recomeca_em;`))
  console.log('Se nao apareceu nenhuma linha, a busca estava em andamento (ou ja recuada): rode backfill-status e tente de novo em 1 minuto.')
}
else if (command === 'backfill-status') show(run(`SELECT
  (SELECT last_completed_until FROM public.meta_lead_discovery_state WHERE page_id='${PAGE}') AS busca_concluida_ate,
  (SELECT window_since FROM public.meta_lead_discovery_state WHERE page_id='${PAGE}') AS janela_desde,
  (SELECT forms_next IS NOT NULL OR form_id IS NOT NULL OR form_queue<>'[]'::jsonb FROM public.meta_lead_discovery_state WHERE page_id='${PAGE}') AS buscando_agora,
  (SELECT last_error FROM public.meta_lead_discovery_state WHERE page_id='${PAGE}') AS ultimo_erro,
  (SELECT count(*) FROM public.meta_webhook_events WHERE status NOT IN ('processed','ignored')) AS eventos_na_fila,
  (SELECT count(*) FROM public.meta_form_leads WHERE entry_channel='form' AND created_time < '2026-10-07') AS formularios_antes_de_07_10,
  (SELECT count(*) FROM public.meta_form_leads WHERE entry_channel='form') AS formularios_total;`))
else { console.error('Use: status | preview | apply | twins | temperature | hints | backfill [AAAA-MM-DD] | backfill-status'); process.exit(2) }
