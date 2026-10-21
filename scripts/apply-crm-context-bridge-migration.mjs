import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Ponte de saida dash -> VOXEN (contexto do atleta): migration 20261020120000_crm_context_bridge.
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono, por passo:
//   node scripts/apply-crm-context-bridge-migration.mjs preflight   gera o ensaio: instala tudo e termina SEMPRE em excecao (nada e gravado)
//   node scripts/apply-crm-context-bridge-migration.mjs apply       gera a instalacao + registro em schema_migrations (nasce desligada: enabled=false, job pausado)
// Nao usa `db push`, reset nem reaplicacao geral (o historico remoto de migrations diverge do checkout).
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261020120000', name: 'crm_context_bridge' }
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
  // Conta, sem enfileirar nada (modo so contagem), e desfaz tudo.
  const report = `
    DO $preflight$
    DECLARE r jsonb; v_after uuid; v_would integer:=0; v_linked integer; v_align jsonb;
    BEGIN
      LOOP
        r:=public.crm_context_backfill(v_after,200,true);
        v_would:=v_would+(r->>'would_enqueue')::integer; v_after:=(r->>'last_id')::uuid;
        EXIT WHEN (r->>'done')::boolean;
      END LOOP;
      SELECT count(*) INTO v_linked FROM public.meta_form_leads WHERE entry_channel='website' AND answers_form_lead_id IS NOT NULL;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      v_align:=public.crm_context_alignment();
      RAISE EXCEPTION 'PREFLIGHT_OK locais_com_formulario=% eventos_a_enfileirar=% job_cron_ativo=% enabled=% | alinhamento: %',v_linked,v_would,
        (SELECT coalesce(bool_or(active),false) FROM cron.job WHERE jobname IN('crm-context-delivery','crm-context-reconcile'))::text,
        (SELECT enabled FROM public.crm_context_delivery_control WHERE singleton)::text,v_align::text USING ERRCODE='P0001';
    END $preflight$;`
  query = ['BEGIN;', notInstalled, bodyOf(source), report, 'ROLLBACK;'].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const file = `.verification.local/crm-context-bridge-${mode}.sql`
writeFileSync(resolve(root, file), query)
console.error(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file ${file} --output json`)
console.log(file)
