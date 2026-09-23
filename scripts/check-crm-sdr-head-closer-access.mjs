import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const version = '20260923190000'
const name = 'crm_sdr_head_closer_access'
const apply = process.argv.includes('--apply')
const deployed = process.argv.includes('--deployed')
if (apply && deployed) throw new Error('Choose --apply or --deployed')

const source = readFileSync(resolve('supabase/migrations', `${version}_${name}.sql`), 'utf8')
const body = source.replace(/^BEGIN;\s*/m, '').replace(/^COMMIT;\s*$/m, '')
const tag = `$crm_access_${version}$`
if (source.includes(tag)) throw new Error('SQL quoting delimiter conflict')

const verification = `DO $verify_sdr_head$
DECLARE v_user uuid;
BEGIN
  SELECT id INTO STRICT v_user FROM auth.users
  WHERE lower(email)='pedro10@gmail.com' AND deleted_at IS NULL;
  IF (SELECT count(*) FROM public.user_roles WHERE user_id=v_user AND role::text='sdr' AND crm_closer_access) <> 1
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user AND role::text='closer')
    OR NOT public.crm_user_can(v_user,'sdr')
    OR NOT public.crm_user_can(v_user,'closer')
    OR public.crm_user_can(v_user,'admin')
    OR public.crm_user_can(v_user,'executive') THEN
    RAISE EXCEPTION 'Permissão CRM do Head de SDR incorreta';
  END IF;
END;
$verify_sdr_head$;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', (SELECT id FROM auth.users WHERE lower(email)='pedro10@gmail.com' AND deleted_at IS NULL),
  'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;
DO $verify_authenticated$
BEGIN
  IF NOT public.crm_can('closer')
    OR NOT EXISTS (SELECT 1 FROM public.user_roles
      WHERE user_id=auth.uid() AND role::text='sdr' AND crm_closer_access)
    OR NOT EXISTS (SELECT 1 FROM public.crm_call_assignees()
      WHERE user_id=auth.uid() AND role='closer') THEN
    RAISE EXCEPTION 'CRM Closer indisponível na sessão autenticada do Head de SDR';
  END IF;
END;
$verify_authenticated$;
RESET ROLE;`

const guard = `DO $$ BEGIN IF EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}'
) THEN RAISE EXCEPTION 'Migration already installed'; END IF; END $$;`
const record = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES('${version}','${name}',ARRAY[${tag}${source}${tag}]);`
const installedGuard = `DO $$ BEGIN IF NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}'
) THEN RAISE EXCEPTION 'Migration missing from history'; END IF; END $$;`
const query = `BEGIN;\n${deployed ? `${installedGuard}\n` : `${guard}\n${body}\n`}${verification}\n${apply ? `${record}\nCOMMIT;` : 'ROLLBACK;'}\nSELECT '${apply ? 'applied' : 'verified'}' AS result;\n`

mkdirSync('.verification.local', { recursive: true })
writeFileSync(resolve('.verification.local/crm-sdr-head-closer-access.sql'), query)
const cli = process.env.SUPABASE_CLI || 'npx'
const args = process.env.SUPABASE_CLI ? [] : ['--yes', 'supabase']
args.push('db', 'query', '--linked', '--project-ref', 'mbzwchnxtskysqplqiyy',
  '--file', '.verification.local/crm-sdr-head-closer-access.sql', '--output', 'json')
const result = spawnSync(cli, args, {
  shell: process.platform === 'win32', encoding: 'utf8', stdio: 'inherit',
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
