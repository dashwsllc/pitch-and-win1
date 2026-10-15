import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Instala (ou ensaia) as migrations que levam as respostas do formulario Meta ao Contexto do SDR:
//   20261015021500_site_form_answers_link   liga formulario <-> registro do site, copia as respostas, evita lead duplicado
//   20261015030000_form_temperature         sugere/marca frio, morno ou quente pelo DDD e pelas respostas
//   20261015031000_site_form_pairs_name_compat  exige nomes compativeis nos vinculos por primeiro nome
//   20261015032000_whatsapp_answer_links  regra 4 (mesmo WhatsApp + mesmo anuncio, nome diferente) e leads criados a mao com formulario do mesmo WhatsApp
//   node scripts/apply-site-form-answers-link-migration.mjs preflight        ensaio das TRES num banco novo/real, numa transacao que sempre volta atras (nada e gravado)
//   node scripts/apply-site-form-answers-link-migration.mjs apply            instala as tres e registra em schema_migrations
//   node scripts/apply-site-form-answers-link-migration.mjs fix-preflight    ensaio so da terceira (quando as duas primeiras ja estao instaladas)
//   node scripts/apply-site-form-answers-link-migration.mjs fix              instala so a terceira
//   node scripts/apply-site-form-answers-link-migration.mjs whatsapp-preflight  ensaio so da quarta (as tres primeiras ja instaladas)
//   node scripts/apply-site-form-answers-link-migration.mjs whatsapp         instala so a quarta
//   node scripts/apply-site-form-answers-link-migration.mjs cron-preflight   ensaio do agendamento automatico
//   node scripts/apply-site-form-answers-link-migration.mjs cron             liga o vinculo automatico a cada 5 min (so depois de conferir a simulacao)
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const link = { version: '20261015021500', name: 'site_form_answers_link' }
const temperature = { version: '20261015030000', name: 'form_temperature' }
const namefix = { version: '20261015031000', name: 'site_form_pairs_name_compat' }
const whatsapp = { version: '20261015032000', name: 'whatsapp_answer_links' }
const cron = { version: '20261015021600', name: 'site_form_answers_link_cron' }
const modes = {
  preflight: { chain: [link, temperature, namefix], install: false },
  apply: { chain: [link, temperature, namefix], install: true },
  'fix-preflight': { chain: [namefix], install: false },
  fix: { chain: [namefix], install: true },
  'whatsapp-preflight': { chain: [whatsapp], install: false },
  whatsapp: { chain: [whatsapp], install: true },
  'cron-preflight': { chain: [cron], install: false },
  cron: { chain: [cron], install: true },
}
const job = modes[mode]
if (!job) { console.error('Use: preflight | apply | fix-preflight | fix | whatsapp-preflight | whatsapp | cron-preflight | cron'); process.exit(2) }
const { chain, install } = job
const sources = chain.map(m => ({ ...m, source: readFileSync(resolve(root, `supabase/migrations/${m.version}_${m.name}.sql`), 'utf8') }))
const bodyOf = source => source.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const notInstalled = ({ version }) => `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN RAISE EXCEPTION 'Migration ${version} ja instalada'; END IF; END; $$;`
let query
if (install) {
  query = ['BEGIN;', ...sources.map(notInstalled), ...sources.map(m => bodyOf(m.source)),
    ...sources.map(m => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${m.version}','${m.name}',ARRAY[$migration$${m.source}$migration$]);`),
    'COMMIT;', `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN (${chain.map(m => `'${m.version}'`).join(',')}) ORDER BY version;`].join('\n')
} else {
  // Ensaio: roda tudo no banco real e termina SEMPRE com uma excecao, o que desfaz tudo.
  const pairsOnly = `
    DO $preflight$
    DECLARE pares int; ambiguos int; no_crm int;
    BEGIN
      SELECT count(*) FILTER (WHERE NOT ambiguous),count(*) FILTER (WHERE ambiguous),count(*) FILTER (WHERE NOT ambiguous AND crm_lead_id IS NOT NULL)
        INTO pares,ambiguos,no_crm FROM public.meta_link_site_answers(false);
      RAISE EXCEPTION 'PREFLIGHT_OK pares_inequivocos=% para_revisar=% leads_do_crm_que_ganham_contexto=%',pares,ambiguos,no_crm USING ERRCODE='P0001';
    END $preflight$;`
  const whatsappReport = `
    DO $preflight$
    DECLARE pares int; regra4 int; ambiguos int; no_crm int; man_ok int; man_amb int;
    BEGIN
      SELECT count(*) FILTER (WHERE NOT ambiguous),count(*) FILTER (WHERE NOT ambiguous AND rule=4),count(*) FILTER (WHERE ambiguous),count(*) FILTER (WHERE NOT ambiguous AND crm_lead_id IS NOT NULL)
        INTO pares,regra4,ambiguos,no_crm FROM public.meta_link_site_answers(false);
      SELECT count(*) FILTER (WHERE NOT ambiguous),count(*) FILTER (WHERE ambiguous) INTO man_ok,man_amb FROM public.meta_link_manual_answers(false);
      RAISE EXCEPTION 'PREFLIGHT_OK site_x_formulario: inequivocos=% (pela regra do WhatsApp=%) para_revisar=% leads_do_crm_que_ganham_contexto=% | leads_manuais_x_formulario: inequivocos=% para_revisar=%',pares,regra4,ambiguos,no_crm,man_ok,man_amb USING ERRCODE='P0001';
    END $preflight$;`
  const report = chain[0].version === whatsapp.version ? whatsappReport : chain[0].version === namefix.version ? pairsOnly : chain[0].version === link.version ? `
    DO $preflight$
    DECLARE pares int; ambiguos int; no_crm int; gemeos int; quente int; morno int; frio int; sem int;
    BEGIN
      SELECT count(*) FILTER (WHERE NOT ambiguous),count(*) FILTER (WHERE ambiguous),count(*) FILTER (WHERE NOT ambiguous AND crm_lead_id IS NOT NULL)
        INTO pares,ambiguos,no_crm FROM public.meta_link_site_answers(false);
      SELECT count(*) INTO gemeos FROM public.meta_manual_crm_twins();
      SELECT count(*) FILTER (WHERE temperature='quente'),count(*) FILTER (WHERE temperature='morno'),count(*) FILTER (WHERE temperature='frio') INTO quente,morno,frio FROM public.meta_temperature_preview();
      SELECT count(*) INTO sem FROM public.meta_form_leads f WHERE f.entry_channel='form' AND NOT EXISTS(SELECT 1 FROM public.meta_temperature_preview() p WHERE p.form_id=f.id);
      RAISE EXCEPTION 'PREFLIGHT_OK pares_inequivocos=% ambiguos=% leads_do_crm_que_ganham_contexto=% leads_manuais_com_formulario_do_mesmo_whatsapp=% | aquecimento nos formularios: quente=% morno=% frio=% sem_classificacao=%',pares,ambiguos,no_crm,gemeos,quente,morno,frio,sem USING ERRCODE='P0001';
    END $preflight$;` : `
    DO $preflight$ BEGIN RAISE EXCEPTION 'PREFLIGHT_OK agendamento valido: % job(s) com este nome apos o ensaio',(SELECT count(*) FROM cron.job WHERE jobname='meta-site-form-link') USING ERRCODE='P0001'; END $preflight$;`
  query = ['BEGIN;', ...sources.map(notInstalled), ...sources.map(m => bodyOf(m.source)), report, 'ROLLBACK;'].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const file = `.verification.local/site-form-answers-link-${mode}.sql`
writeFileSync(resolve(root, file), query)
if (process.argv.includes('--print')) { console.log(file); process.exit(0) } // so gera o SQL (usado pelos testes)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy', '--file', file, '--output', 'json')
const result = spawnSync(cli, args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const output = `${result.stdout || ''}\n${result.stderr || ''}`
if (!install) {
  const ok = output.match(/PREFLIGHT_OK[^"\n]*/)
  if (ok) { console.log(`ENSAIO CONCLUIDO (nada foi gravado): ${ok[0]}`); process.exit(0) }
  console.error(output.trim() || result.error?.message); process.exit(1)
}
if (result.status !== 0) { console.error(output.trim() || result.error?.message); process.exit(result.status ?? 1) }
console.log(result.stdout)
