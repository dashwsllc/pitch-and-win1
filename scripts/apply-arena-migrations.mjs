import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Install only the reviewed Arena migrations, atomically. Older migrations in
// this repository were installed independently and must not be pushed again.
const apply = process.argv.includes("--apply");
const migrations = [
  ["20260923100000", "arena_events"],
  ["20260923110000", "arena_goals"],
  ["20260923120000", "arena_operations"],
];
const versions = migrations.map(([version]) => `'${version}'`).join(",");
const parts = migrations.map(([version, name]) => {
  const source = readFileSync(resolve("supabase/migrations", `${version}_${name}.sql`), "utf8");
  const tag = `$arena_migration_${version}$`;
  if (source.includes(tag)) throw new Error("SQL quoting delimiter conflict");
  return `${source.replace(/^BEGIN;\s*/m, "").replace(/^COMMIT;\s*/m, "")}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${tag}${source}${tag}]);`;
});
const query = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (${versions})) THEN
    RAISE EXCEPTION 'Arena migration already installed; inspect the database before retrying';
  END IF;
END $$;
${parts.join("\n")}
${apply ? "COMMIT" : "ROLLBACK"};
SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN (${versions}) ORDER BY version;
`;
mkdirSync(".verification.local", { recursive: true });
const path = resolve(".verification.local/apply-arena.sql");
writeFileSync(path, query);
console.log(apply ? "Installing the three Arena migrations in one transaction." : "Checking installation with ROLLBACK; pass --apply to install.");
const result = spawnSync(process.env.SUPABASE_CLI || "supabase", [
  "db", "query", "--linked", "--project-ref", "mbzwchnxtskysqplqiyy", "--file", path, "--output", "json",
], { encoding: "utf8", stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
