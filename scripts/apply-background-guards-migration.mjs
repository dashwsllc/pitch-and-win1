import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Trabalho de fundo que nao derruba o dashboard: migration 20261023150000_background_load_guards (db_under_pressure(), guardas e horarios dos jobs do pg_cron, teto de transacao
// pendurada da API). Nao altera tabela nem dado.
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-background-guards-migration.mjs preflight   ensaio: roda a migration e termina SEMPRE em excecao, desfazendo tudo. Mostra horario e guarda de cada job.
//   node scripts/apply-background-guards-migration.mjs apply       gera a instalacao + registro em schema_migrations
// Reversao (se um dia precisar): .verification.local/background-guards-ROLLBACK.sql, gerado por `node scripts/apply-background-guards-migration.mjs rollback` a partir do
// estado ATUAL do banco (o script precisa ser executado antes do apply, com o resultado salvo): ver docs/RUNBOOK_BANCO_FORA_DO_AR.md.
// Nao usa `db push`, reset nem reaplicacao geral.
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261023150000', name: 'background_load_guards' }
if (!['preflight', 'apply', 'rollback'].includes(mode)) { console.error('Use: preflight | apply | rollback'); process.exit(2) }
const dir = process.env.GUARDS_MIGRATIONS_DIR ?? resolve(root, 'supabase/migrations')   // so a checagem de mutacao troca a pasta
const source = readFileSync(resolve(dir, `${migration.version}_${migration.name}.sql`), 'utf8')
const bodyOf = text => text.replace(/^BEGIN[^;]*;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const notInstalled = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration ${migration.version} ja instalada'; END IF; END; $$;`
const JOBS = ['arena-cycle-deadlines', 'crm-context-reconcile', 'meta-form-context-refresh', 'meta-site-form-link', 'google-calendar-reconcile', 'google-calendar-deliver', 'meta-lead-worker', 'meta-insights-resume', 'meta-leads-reconciliation-hourly', 'meta-insights-sync-frequent']
let query
if (mode === 'apply') {
  query = ['BEGIN;', notInstalled, bodyOf(source),
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}',ARRAY[$migration$${source}$migration$]);`,
    'COMMIT;', `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`].join('\n')
} else if (mode === 'preflight') {
  const report = `
    DO $pf$
    DECLARE r jsonb;
    BEGIN
      SELECT coalesce(jsonb_object_agg(left(jobname, 24), jsonb_build_array(schedule, command LIKE '%db_under_pressure%')), '{}'::jsonb) INTO r
        FROM cron.job WHERE jobname IN (${JOBS.map(j => `'${j}'`).join(',')});
      r := r || jsonb_build_object('sob_pressao', public.db_under_pressure(), 'auth_cfg', (SELECT rolconfig::text FROM pg_roles WHERE rolname = 'authenticator'));
      RAISE EXCEPTION 'PREFLIGHT_GUARDS_OK %', r::text USING ERRCODE = 'P0001';
    END $pf$;`
  query = ['BEGIN;', notInstalled, bodyOf(source), report].join('\n')
} else {
  // Gera os comandos de reversao a partir do estado ATUAL do banco (rodar ANTES do apply e guardar o resultado). So SELECT.
  query = `SELECT string_agg(format('SELECT cron.alter_job(job_id := %s, schedule := %L, command := %L);', jobid, schedule, command), E'\\n' ORDER BY jobname) AS comandos
  FROM cron.job WHERE jobname IN (${JOBS.map(j => `'${j}'`).join(',')});`
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/background-guards-${mode}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) console.log(out)
else console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/background-guards-${mode}.sql --output json\n${out}`)
