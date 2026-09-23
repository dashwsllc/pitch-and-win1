import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli = process.env.SUPABASE_CLI || "supabase";
const files = [
  "20260923100000_arena_events.sql",
  "20260923110000_arena_goals.sql",
  "20260923120000_arena_operations.sql",
];
const migrations = files.map((file) =>
  readFileSync(resolve("supabase/migrations", file), "utf8")
    .replace(/^BEGIN;\s*/m, "")
    .replace(/^COMMIT;\s*/m, ""),
);
mkdirSync(".verification.local", { recursive: true });
const path = resolve(".verification.local/arena-transaction.sql");
writeFileSync(
  path,
  `BEGIN;\n${migrations.join("\n")}\n${readFileSync("scripts/verify-arena-db.sql", "utf8")}\nROLLBACK;\n`,
);
const result = spawnSync(
  cli,
  [
    "db",
    "query",
    "--linked",
    "--project-ref",
    "mbzwchnxtskysqplqiyy",
    "--file",
    path,
    "--output",
    "json",
  ],
  { encoding: "utf8", stdio: "inherit" },
);
process.exit(result.status ?? 1);
