// Disposable PostgreSQL fixture target ONLY. Does not connect to Supabase or production.
// Supabase auth/storage APIs are represented by SQL fixtures. Vault uses a test interface
// stand-in; its native encryption extension still needs the Supabase deployment check.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const address = process.env.GOOGLE_CALENDAR_TEST_DATABASE_URL
if (!address || !['127.0.0.1','localhost'].includes(new URL(address).hostname) || !new URL(address).pathname.endsWith('/calendar_qa')) throw Error('Use the disposable local calendar_qa database')
const scratch = resolve(root,'.verification.local'); mkdirSync(scratch,{recursive:true})
function run(sql,label) {
  const file = resolve(scratch,'calendar-bootstrap.sql'); writeFileSync(file,sql)
  const r = spawnSync(process.env.PSQL||'psql',['-X','--no-password','--set','ON_ERROR_STOP=1','--dbname',address,'--file',file],{encoding:'utf8',maxBuffer:2*1024*1024})
  if(r.status!==0) throw Error(`${label}: ${r.stderr||r.error?.message}`)
}
run(`
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA supabase_migrations; CREATE SCHEMA extensions; CREATE SCHEMA vault;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,phone text,aud text,role text,encrypted_password text,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz,updated_at timestamptz,last_sign_in_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
CREATE FUNCTION storage.extension(text) RETURNS text LANGUAGE sql AS $$ SELECT regexp_replace($1,'^.*\\.','') $$;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
CREATE PUBLICATION supabase_realtime;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated,service_role;
-- Contract stand-in, test-only, inaccessible to client roles. Never deployed.
CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id,secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(p text) RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets(secret) VALUES(p) RETURNING id $$;
-- Legacy objects present remotely but absent from the repository's baseline.
CREATE TABLE public.activity_feed(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action_type text,actor_name text,entity_title text,user_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.traffic_metrics(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`,'foundation')
const directory=resolve(root,'supabase/migrations')
const selected=readdirSync(directory).filter(n=>n.endsWith('.sql') && n.slice(0,14)<='20260912090000')
selected.push(...readdirSync(directory).filter(n=>['20260914030000','20260921120000','20260921160000','20260922140000','20260923100000','20260923190000','20260925100000','20261006100000','20261007140000','20261008100000'].includes(n.slice(0,14))))
for(const name of selected.sort()) {
  // This unrelated data-only seed references tables never defined locally.
  if(name.startsWith('20260329054553')) continue
  if(name.startsWith('20260907180000')) run(`
    CREATE FUNCTION public.is_super_admin(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p AND role::text='super_admin') $$;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
    CREATE TABLE public.company_goals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,description text,target numeric,period text,status text,created_by uuid);
    CREATE TABLE public.saldos_disponiveis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE,valor_total_comissoes numeric DEFAULT 0,valor_sacado numeric DEFAULT 0,valor_liberado_para_saque numeric DEFAULT 0,updated_at timestamptz DEFAULT now());
    ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS consideracoes_gerais text;
  `,'legacy fixture objects')
  let sql=readFileSync(resolve(directory,name),'utf8')
  if(name.startsWith('20260907180000')) sql=sql.replace('REVOKE ALL ON FUNCTION public.process_withdrawal(uuid,numeric) FROM PUBLIC,anon,authenticated;','')
  if(name.startsWith('20260910050000')) sql=sql.replace(/REVOKE[^;]*public\.log_security_event\([^;]*;/g,'')
  // A real-company user-specific permission patch has no place in this blank fixture DB.
  if(name.startsWith('20260923190000')) sql=sql.split('DO $grant_sdr_head$')[0]+'COMMIT;'
  // Keep actual call-qualification permissions and guard; omit company-specific
  // user/ranking patches, which depend on unrelated competition migrations.
  if(name.startsWith('20260925100000')) sql=sql.slice(0,sql.indexOf('DO $$'))+sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.arena_sdr_exception'),sql.indexOf('-- Preserve the installed ranking'))+'COMMIT;'
  run(sql,name); console.log('Applied local fixture baseline',name)
}
console.log('Local CRM fixture target prepared; Vault cryptography is not exercised by this target.')
