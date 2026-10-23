import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Politicas de acesso (RLS) avaliadas uma vez por consulta: migration 20261023140000_rls_initplan_wrap (so reescreve expressoes de politicas; nenhuma tabela ou dado muda).
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-rls-initplan-migration.mjs preflight   ensaio: roda a migration inteira (incluindo a comparacao "o que cada usuario enxerga antes x depois") e termina SEMPRE em
//                                                             excecao, desfazendo tudo. Mostra quantas politicas mudariam, quantas ficaram ocupadas, quantas comparacoes passaram e o tempo
//                                                             por tabela antes/depois.
//   node scripts/apply-rls-initplan-migration.mjs apply       gera a instalacao. A propria migration aborta se alguem passar a enxergar algo diferente. Se alguma tabela estiver ocupada
//                                                             (consulta longa em andamento), as politicas dela sao puladas e a migration NAO e registrada: rode `apply` de novo (e idempotente).
// Nao usa `db push`, reset nem reaplicacao geral.
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261023140000', name: 'rls_initplan_wrap' }
if (!['preflight', 'apply'].includes(mode)) { console.error('Use: preflight | apply'); process.exit(2) }
const dir = process.env.RLS_MIGRATIONS_DIR ?? resolve(root, 'supabase/migrations')   // so a checagem de mutacao troca a pasta
const source = readFileSync(resolve(dir, `${migration.version}_${migration.name}.sql`), 'utf8')
const bodyOf = text => text.replace(/^BEGIN[^;]*;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ;'
const notInstalled = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration ${migration.version} ja instalada'; END IF; END; $$;`
let query
if (mode === 'apply') {
  const register = `
    DO $reg$
    BEGIN
      IF (SELECT (v)::int FROM rls_wrap_report WHERE k = 'ocupadas') = 0 THEN
        INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}',ARRAY[$migration$${source}$migration$]);
      ELSE
        RAISE NOTICE 'rls_initplan: ha politicas puladas por tabela ocupada; migration NAO registrada. Rode apply de novo.';
      END IF;
    END $reg$;`
  query = [BEGIN, notInstalled, bodyOf(source), register, 'COMMIT;',
    `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`].join('\n')
} else {
  const report = `
    DO $pf$
    DECLARE r jsonb;
    BEGIN
      SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO r FROM rls_wrap_report;
      RAISE EXCEPTION 'PREFLIGHT_RLS_OK %', r::text USING ERRCODE = 'P0001';
    END $pf$;`
  query = [BEGIN, notInstalled, bodyOf(source), report].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/rls-initplan-${mode}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) console.log(out)
else console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file .verification.local/rls-initplan-${mode}.sql --output json\n${out}`)
