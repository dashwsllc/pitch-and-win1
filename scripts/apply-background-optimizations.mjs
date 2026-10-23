import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Otimizacoes do trabalho de fundo no plano gratuito (23/10), aplicadas JUNTAS numa unica transacao (ou entram as duas, ou nenhuma):
//   20261023200000_background_signals_only_on_change  sinal do dashboard so quando algo muda (teste: scripts/verify-background-signals-db.mjs)
//   20261023210000_background_skip_idle_work           robo de leads/entrega da agenda so com fila; reconciliacao da agenda so de call recente; jobs fora do :00
//                                                       (teste: scripts/verify-background-idle-db.mjs)
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar):
//   node scripts/apply-background-optimizations.mjs preflight   ensaio: aplica e termina SEMPRE em excecao, desfazendo tudo; mostra o que mudaria
//   node scripts/apply-background-optimizations.mjs apply       instalacao + registro em schema_migrations
// Reversao: docs/RUNBOOK_BANCO_FORA_DO_AR.md (secao Reversoes). Nao usa `db push`, reset nem reaplicacao geral.
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migrations = [
  { version: '20261023200000', name: 'background_signals_only_on_change' },
  { version: '20261023210000', name: 'background_skip_idle_work' },
]
if (!['preflight', 'apply'].includes(mode)) { console.error('Use: preflight | apply'); process.exit(2) }
const sourceOf = m => readFileSync(resolve(root, `supabase/migrations/${m.version}_${m.name}.sql`), 'utf8').replace(/\r\n/g, '\n')
const bodyOf = text => text.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
const notInstalled = m => `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${m.version}') THEN RAISE EXCEPTION 'Migration ${m.version} ja instalada'; END IF; END $$;`
const parts = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", ...migrations.flatMap(m => [notInstalled(m), bodyOf(sourceOf(m))])]
let query
if (mode === 'apply') {
  query = [...parts,
    ...migrations.map(m => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${m.version}','${m.name}',ARRAY[$migration$${sourceOf(m)}$migration$]);`),
    'COMMIT;',
    `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN (${migrations.map(m => `'${m.version}'`).join(',')}) ORDER BY version;`].join('\n')
} else {
  query = [...parts, `
DO $pf$ DECLARE r jsonb; BEGIN
  SELECT jsonb_build_object(
    'gatilhos_sinal', (SELECT jsonb_agg(tgname ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.meta_sync_runs'::regclass, 'public.meta_webhook_events'::regclass)),
    'agenda_reconcilia_antes', (SELECT count(*) FROM calendar_private.bindings WHERE NOT completed AND NOT removed),
    'agenda_reconcilia_depois', (SELECT count(*) FROM calendar_private.bindings b LEFT JOIN public.crm_activities a ON a.id=b.call_id WHERE NOT b.completed AND NOT b.removed
        AND (a.scheduled_at IS NULL OR a.scheduled_at+make_interval(mins=>coalesce(a.duration_minutes,60))>clock_timestamp()-interval '1 day')),
    'robo_leads_so_com_fila', position('public.meta_webhook_events' in (SELECT command FROM cron.job WHERE jobname='meta-lead-worker'))>0,
    'entrega_agenda_so_com_fila', position('calendar_private.outbox' in (SELECT command FROM cron.job WHERE jobname='google-calendar-deliver'))>0,
    'guarda_de_pressao_no_fim', (SELECT bool_and(command LIKE '%AND NOT public.db_under_pressure();') FROM cron.job WHERE jobname IN ('meta-lead-worker','google-calendar-deliver')),
    'horarios', (SELECT jsonb_object_agg(jobname, schedule) FROM cron.job WHERE jobname LIKE 'meta-insights-sync-%')) INTO r;
  RAISE EXCEPTION 'PREFLIGHT_BACKGROUND_OK %', r::text USING ERRCODE = 'P0001';
END $pf$;`].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/background-optimizations-${mode}.sql`)
writeFileSync(out, query)
console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/background-optimizations-${mode}.sql --output json\n${out}`)
