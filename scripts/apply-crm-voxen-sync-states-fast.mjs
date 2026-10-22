import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Estado dos leads no envio para a VOXEN sem uma consulta por lead: migration 20261022174000_crm_voxen_sync_states_fast.
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-crm-voxen-sync-states-fast.mjs preflight   ensaio: instala a migration e termina SEMPRE em excecao (nada e gravado, nenhum aviso ao PostgREST). Guarda as funcoes REAIS de
//                                                                  producao como "legado" e prova, com os dados reais, que a lista de cadastrados, os estados e os candidatos
//                                                                  saem IGUAIS; mede o tempo das duas versoes. So contagens e tempos, nunca conteudo.
//   node scripts/apply-crm-voxen-sync-states-fast.mjs apply       gera a instalacao + registro em schema_migrations (nao envia nem enfileira nada)
// Nao usa `db push`, reset nem reaplicacao geral (o historico remoto de migrations diverge do checkout).
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261022174000', name: 'crm_voxen_sync_states_fast' }
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
  // 1) guarda as funcoes REAIS de producao como "legado"; 2) instala a migration; 3) compara e mede; 4) desfaz tudo (RAISE EXCEPTION no fim).
  const legacy = `
    DO $legacy$
    DECLARE d text;
    BEGIN
      FOR d IN SELECT pg_get_functiondef(p) FROM unnest(ARRAY['public.crm_voxen_sync_states()'::regprocedure,'public.crm_context_prospect_candidates()'::regprocedure]) p LOOP
        IF position('FUNCTION public.crm_voxen_sync_states(' in d)>0 THEN EXECUTE replace(d,'FUNCTION public.crm_voxen_sync_states(','FUNCTION public.crm_voxen_sync_states_legacy(');
        ELSIF position('FUNCTION public.crm_context_prospect_candidates(' in d)>0 THEN EXECUTE replace(d,'FUNCTION public.crm_context_prospect_candidates(','FUNCTION public.crm_context_prospect_candidates_legacy(');
        ELSE RAISE EXCEPTION 'definicao inesperada'; END IF;
      END LOOP;
    END $legacy$;`
  const compare = `
    DO $pf$
    DECLARE r jsonb:='{}'::jsonb; uid uuid; t0 timestamptz; v_new jsonb; v_old jsonb; a uuid[]; b uuid[]; n_new integer; n_old integer; ms_new numeric; ms_old numeric; ms_new2 numeric;
    BEGIN
      SET LOCAL statement_timeout='120s';
      -- lista dos ja cadastrados na VOXEN: a nova (uma consulta) contra a regra por lead que esta em producao
      SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO a FROM public.crm_context_registered_leads() x;
      SELECT coalesce(array_agg(c.id ORDER BY c.id),'{}') INTO b FROM public.crm_leads c WHERE public.crm_context_lead_has_voxen(c.id);
      r:=r||jsonb_build_object('cadastrados_novo',coalesce(array_length(a,1),0),'cadastrados_regra_por_lead',coalesce(array_length(b,1),0),'cadastrados_iguais',a IS NOT DISTINCT FROM b);
      -- candidatos a envio
      SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO a FROM public.crm_context_prospect_candidates() x;
      SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO b FROM public.crm_context_prospect_candidates_legacy() x;
      r:=r||jsonb_build_object('candidatos_novo',coalesce(array_length(a,1),0),'candidatos_legado',coalesce(array_length(b,1),0),'candidatos_iguais',a IS NOT DISTINCT FROM b);
      -- estados como um usuario real do CRM (papel authenticated nao e necessario: as duas funcoes sao SECURITY DEFINER; so precisam de auth.uid() com acesso)
      SELECT ur.user_id INTO uid FROM public.user_roles ur JOIN public.profiles p ON p.user_id=ur.user_id AND NOT p.suspended
       WHERE ur.role::text IN('sdr','closer') ORDER BY public.crm_user_can(ur.user_id,'executive'), ur.user_id LIMIT 1;
      IF uid IS NULL THEN RAISE EXCEPTION 'PREFLIGHT_ABORTADO: nenhum SDR/closer ativo para simular'; END IF;
      PERFORM set_config('request.jwt.claim.sub',uid::text,true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
      t0:=clock_timestamp(); v_new:=public.crm_voxen_sync_states(); ms_new:=round(extract(epoch FROM clock_timestamp()-t0)*1000);
      t0:=clock_timestamp(); v_old:=public.crm_voxen_sync_states_legacy(); ms_old:=round(extract(epoch FROM clock_timestamp()-t0)*1000);
      t0:=clock_timestamp(); PERFORM public.crm_voxen_sync_states(); ms_new2:=round(extract(epoch FROM clock_timestamp()-t0)*1000);
      n_new:=jsonb_array_length(v_new->'rows'); n_old:=jsonb_array_length(v_old->'rows');
      r:=r||jsonb_build_object('estados_iguais',v_new IS NOT DISTINCT FROM v_old,'linhas_novo',n_new,'linhas_legado',n_old,'ms_novo_1',ms_new,'ms_legado',ms_old,'ms_novo_2',ms_new2,
        'permissoes_app',jsonb_build_object('estados',has_function_privilege('authenticated','public.crm_voxen_sync_states()','EXECUTE'),'lista_cadastrados',has_function_privilege('authenticated','public.crm_context_registered_leads()','EXECUTE'),
          'lista_anon',has_function_privilege('anon','public.crm_context_registered_leads()','EXECUTE'),'lista_service',has_function_privilege('service_role','public.crm_context_registered_leads()','EXECUTE')));
      RAISE EXCEPTION 'PREFLIGHT_FAST_OK %',r::text USING ERRCODE='P0001';
    END $pf$;`
  query = ['BEGIN;', legacy, bodyOf(source), compare].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/crm-voxen-sync-states-fast-${mode}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) console.log(out)
else console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/crm-voxen-sync-states-fast-${mode}.sql --output json\n${out}`)
