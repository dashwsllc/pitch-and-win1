import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Aplica migrations do dash (supabase/migrations) numa UNICA transacao, com ensaio desfeito antes. Este script SO GERA o SQL (nao conecta em nenhum banco);
// quem executa no banco real e o dono (ou quem ele autorizar), com a linha de comando que o script imprime.
//   node scripts/apply-migrations.mjs preflight <versao> [<versao>...]   ensaio: roda as migrations e termina SEMPRE em excecao, desfazendo tudo (+ relatorio da versao, se houver)
//   node scripts/apply-migrations.mjs apply     <versao> [<versao>...]   instalacao + registro em supabase_migrations.schema_migrations; ou entram todas, ou nenhuma
// Ex.: node scripts/apply-migrations.mjs apply 20261024010000
// Nao usa `db push`, reset nem reaplicacao geral. Recusa versao ja registrada.
const root = resolve(import.meta.dirname, '..')
const [mode, ...versions] = process.argv.slice(2).filter(a => a !== '--print')
if (!['preflight', 'apply'].includes(mode) || !versions.length || versions.some(v => !/^\d{14}$/.test(v))) { console.error('Use: preflight|apply <versao de 14 digitos> [...]'); process.exit(2) }
const dir = process.env.APPLY_MIGRATIONS_DIR ?? resolve(root, 'supabase/migrations')   // so a checagem de mutacao troca a pasta

// O que o ensaio mostra para cada migration, avaliado DENTRO da transacao desfeita, no banco real.
// declare/run rodam ANTES da expressao: uma linha gravada por funcao so e visivel para comandos seguintes, nao para a propria consulta que a chamou.
const REPORTS = {
  '20261024010000': {
    declare: 'v_foto bigint;',
    run: 'v_foto := public.db_pressure_snapshot();',
    expr: `jsonb_build_object('job', (SELECT schedule FROM cron.job WHERE jobname = 'db-pressure-snapshot'),
      'foto', (SELECT to_jsonb(h) - 'id' FROM public.db_pressure_history h WHERE h.id = v_foto))`,
  },
}

const files = versions.map(version => {
  const found = readdirSync(dir).filter(f => f.startsWith(version + '_') && f.endsWith('.sql'))
  if (found.length !== 1) { console.error(`Versao ${version}: esperava 1 arquivo em ${dir}, achei ${found.length}`); process.exit(2) }
  return { version, name: found[0].slice(version.length + 1, -4), source: readFileSync(resolve(dir, found[0]), 'utf8').replace(/\r\n/g, '\n') }
})
const bodyOf = text => text.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
const notInstalled = m => `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${m.version}') THEN RAISE EXCEPTION 'Migration ${m.version} ja instalada'; END IF; END $$;`
const parts = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", ...files.flatMap(m => [notInstalled(m), bodyOf(m.source)])]
let query
if (mode === 'apply') {
  for (const m of files) if (m.source.includes('$migration$')) { console.error(`${m.version}: o texto contem $migration$, que o registro usa como delimitador`); process.exit(2) }
  query = [...parts,
    ...files.map(m => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${m.version}','${m.name}',ARRAY[$migration$${m.source}$migration$]);`),
    'COMMIT;',
    `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN (${files.map(m => `'${m.version}'`).join(',')}) ORDER BY version;`].join('\n')
} else {
  const withReport = files.filter(m => REPORTS[m.version])
  const fields = withReport.length ? withReport.map(m => `'${m.version}', ${REPORTS[m.version].expr}`).join(',\n    ') : `'versoes', '${versions.join(',')}'`
  query = [...parts, `DO $pf$
DECLARE r jsonb; ${withReport.map(m => REPORTS[m.version].declare).join(' ')}
BEGIN
  ${withReport.map(m => REPORTS[m.version].run).join('\n  ')}
  SELECT jsonb_build_object(${fields}) INTO r;
  RAISE EXCEPTION 'PREFLIGHT_OK %', r::text USING ERRCODE = 'P0001';
END $pf$;`].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const out = resolve(root, `.verification.local/migrations-${mode}-${versions.join('_')}.sql`)
writeFileSync(out, query)
if (process.argv.includes('--print')) { console.log(out); process.exit(0) }   // so os testes: imprime o caminho do SQL gerado
console.log(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file "${out.replaceAll('\\', '/')}" --output json`)
