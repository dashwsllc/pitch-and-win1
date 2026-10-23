import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Troca de ERRCODE 40001 por PT409 nas funcoes vivas: migration 20261023020000_postgrest_no_retry_errcode (so reescreve corpos; grants e dono ficam).
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-postgrest-no-retry-errcode-migration.mjs preflight   ensaio: guarda owner/grants/SECURITY DEFINER/config das funcoes com 40001, instala a migration e termina SEMPRE em
//                                                                           excecao (nada e gravado). Mostra quantas e quais funcoes foram reescritas e se algo mudou alem do corpo.
//   node scripts/apply-postgrest-no-retry-errcode-migration.mjs apply       gera a instalacao + registro em schema_migrations
// Ordem de publicacao: app (as telas aceitam PT409 e 40001) -> esta migration. Nao usa `db push`, reset nem reaplicacao geral.
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261023020000', name: 'postgrest_no_retry_errcode' }
if (!['preflight', 'apply'].includes(mode)) { console.error('Use: preflight | apply'); process.exit(2) }
const source = readFileSync(resolve(root, `supabase/migrations/${migration.version}_${migration.name}.sql`), 'utf8')
const bodyOf = text => text.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const notInstalled = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration ${migration.version} ja instalada'; END IF; END; $$;`
// alvo e "metadados" (tudo que NAO pode mudar) das funcoes que hoje levantam 40001
const targets = `SELECT p.oid, p.oid::regprocedure::text AS sig, coalesce(p.proacl::text,'') AS acl, p.prosecdef AS sec, coalesce(p.proconfig::text,'') AS cfg, p.proowner::regrole::text AS owner
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname IN ('public','calendar_private') AND p.prokind IN ('f','p') AND p.prosrc ~* '(errcode\\s*=\\s*|sqlstate\\s+)''40001'''`
let query
if (mode === 'apply') {
  query = ['BEGIN;', notInstalled, bodyOf(source),
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}',ARRAY[$migration$${source}$migration$]);`,
    'COMMIT;', `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`].join('\n')
} else {
  const before = `
    DO $before$
    BEGIN
      CREATE TEMP TABLE pf_targets ON COMMIT DROP AS ${targets};
      PERFORM set_config('pf.n_before',(SELECT count(*) FROM pf_targets)::text,true);
    END $before$;`
  const compare = `
    DO $pf$
    DECLARE r jsonb:='{}'::jsonb; changed text; still integer; renamed text;
    BEGIN
      SELECT string_agg(t.sig,', ') INTO changed FROM pf_targets t JOIN pg_proc p ON p.oid=t.oid
       WHERE (coalesce(p.proacl::text,''),p.prosecdef,coalesce(p.proconfig::text,''),p.proowner::regrole::text) IS DISTINCT FROM (t.acl,t.sec,t.cfg,t.owner);
      SELECT count(*) INTO still FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname IN ('public','calendar_private') AND p.prosrc ~ '40001';
      SELECT string_agg(t.sig,', ' ORDER BY t.sig) INTO renamed FROM pf_targets t JOIN pg_proc p ON p.oid=t.oid WHERE p.prosrc ~ 'PT409';
      r:=jsonb_build_object('funcoes_com_40001_antes',current_setting('pf.n_before')::int,'funcoes_com_PT409_agora',(SELECT count(*) FROM pf_targets t JOIN pg_proc p ON p.oid=t.oid WHERE p.prosrc ~ 'PT409'),
        'funcoes_que_ainda_citam_40001',still,'owner_grants_security_config_mudaram',changed,'funcoes',renamed);
      RAISE EXCEPTION 'PREFLIGHT_PT409_OK %',r::text USING ERRCODE='P0001';
    END $pf$;`
  query = ['BEGIN;', notInstalled, before, bodyOf(source), compare].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/postgrest-no-retry-errcode-${mode}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) console.log(out)
else console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/postgrest-no-retry-errcode-${mode}.sql --output json\n${out}`)
