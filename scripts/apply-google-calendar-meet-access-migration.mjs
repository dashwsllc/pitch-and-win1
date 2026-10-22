import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Acesso aberto do Meet das calls: migration 20261022190000_google_calendar_meet_access (aditiva: 2 colunas, 1 função, 1 campo a mais no status do admin).
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-google-calendar-meet-access-migration.mjs preflight   ensaio: guarda o status REAL do admin, instala a migration e termina SEMPRE em excecao (nada e gravado).
//                                                                            Prova que o status antigo continua igual (so ganha meetAccess), que a funcao nova so abre para service_role e
//                                                                            que gravar o resultado nao toca na conexao. So contagens e valores fixos, nunca segredos.
//   node scripts/apply-google-calendar-meet-access-migration.mjs apply       gera a instalacao + registro em schema_migrations
// Ordem de publicacao: app (a tela aceita o campo novo) -> Edge Functions -> esta migration. Nao usa `db push`, reset nem reaplicacao geral.
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261022190000', name: 'google_calendar_meet_access' }
if (!['preflight', 'apply'].includes(mode)) { console.error('Use: preflight | apply'); process.exit(2) }
const source = readFileSync(resolve(root, `supabase/migrations/${migration.version}_${migration.name}.sql`), 'utf8')
const bodyOf = text => text.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const notInstalled = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration ${migration.version} ja instalada'; END IF; END; $$;`
let query
if (mode === 'apply') {
  query = ['BEGIN;', notInstalled, bodyOf(source),
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}',ARRAY[$migration$${source}$migration$]);`,
    'COMMIT;', `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`].join('\n')
} else {
  const before = `
    DO $before$
    DECLARE uid uuid;
    BEGIN
      SELECT ur.user_id INTO uid FROM public.user_roles ur JOIN public.registration_requests rr ON rr.user_id=ur.user_id AND rr.status='approved'
       WHERE ur.role::text='executive' AND public.crm_user_can(ur.user_id,'executive') ORDER BY ur.user_id LIMIT 1;
      IF uid IS NULL THEN RAISE EXCEPTION 'PREFLIGHT_ABORTADO: nenhum executivo aprovado para ler o status'; END IF;
      PERFORM set_config('pf.uid',uid::text,true);
      PERFORM set_config('pf.before',public.google_calendar_admin_status(uid)::text,true);
      PERFORM set_config('pf.had_columns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='calendar_private' AND table_name='connection' AND column_name LIKE 'meet_access%')::text,true);
    END $before$;`
  const compare = `
    DO $pf$
    DECLARE r jsonb:='{}'::jsonb; uid uuid:=current_setting('pf.uid')::uuid; v_before jsonb:=current_setting('pf.before')::jsonb; v_after jsonb; c1 calendar_private.connection; c2 calendar_private.connection;
    BEGIN
      v_after:=public.google_calendar_admin_status(uid);
      r:=r||jsonb_build_object('colunas_antes',current_setting('pf.had_columns')::int,
        'colunas_depois',(SELECT count(*) FROM information_schema.columns WHERE table_schema='calendar_private' AND table_name='connection' AND column_name LIKE 'meet_access%'),
        'status_antigo_igual',(v_after-'meetAccess') IS NOT DISTINCT FROM v_before,
        'meet_estado_inicial',v_after->'meetAccess'->>'state','meet_checado_em_nulo',jsonb_typeof(v_after->'meetAccess'->'checkedAt')='null',
        'conexao',v_after->>'connection','sincronizacao_ativa',(v_after->>'activatedAt') IS NOT NULL);
      -- gravar o resultado nao toca na conexao nem nas credenciais (desfeito no fim)
      SELECT * INTO c1 FROM calendar_private.connection;
      PERFORM public.google_calendar_set_meet_access('scope_missing');
      SELECT * INTO c2 FROM calendar_private.connection;
      r:=r||jsonb_build_object('gravou',c2.meet_access_state='scope_missing',
        'conexao_intacta',(c1.connection_status,c1.credential_revision,c1.calendar_id,c1.account_id,c1.error_code,c1.access_secret_id,c1.refresh_secret_id,c1.scopes) IS NOT DISTINCT FROM (c2.connection_status,c2.credential_revision,c2.calendar_id,c2.account_id,c2.error_code,c2.access_secret_id,c2.refresh_secret_id,c2.scopes));
      BEGIN PERFORM public.google_calendar_set_meet_access('abc'); r:=r||jsonb_build_object('estado_invalido','ACEITO'); EXCEPTION WHEN SQLSTATE '22023' THEN r:=r||jsonb_build_object('estado_invalido','recusado'); END;
      r:=r||jsonb_build_object('permissoes',jsonb_build_object(
        'set_service',has_function_privilege('service_role','public.google_calendar_set_meet_access(text)','EXECUTE'),
        'set_authenticated',has_function_privilege('authenticated','public.google_calendar_set_meet_access(text)','EXECUTE'),
        'set_anon',has_function_privilege('anon','public.google_calendar_set_meet_access(text)','EXECUTE'),
        'status_authenticated',has_function_privilege('authenticated','public.google_calendar_admin_status(uuid)','EXECUTE'),
        'status_anon',has_function_privilege('anon','public.google_calendar_admin_status(uuid)','EXECUTE')));
      RAISE EXCEPTION 'PREFLIGHT_MEET_OK %',r::text USING ERRCODE='P0001';
    END $pf$;`
  query = ['BEGIN;', notInstalled, before, bodyOf(source), compare].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/google-calendar-meet-access-${mode}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) console.log(out)
else console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/google-calendar-meet-access-${mode}.sql --output json\n${out}`)
