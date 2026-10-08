import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
// LEGADO: este roteiro (supabase/tests/crm_shared_workflow.sql) descreve o modelo de 09/2026 em que "seller" também era SDR
// e Closer. As migrações seguintes (seller_closer_access, crm_remarketing_sdr_qualification_permissions, sdr_head_closer_access,
// arena_call_guard) mudaram quem pode o quê (a capacidade SDR inclui Closer; Closer exige papel closer; quem agenda a call de
// fechamento nunca a atende), então contra o banco instalado ele falha por desenho, já na primeira regra de capacidade.
// A cobertura atual está em check-crm-results-db, check-crm-edit-call-db, check-crm-followup-db, check-crm-payment-status-db,
// check-crm-lead-deletion-db e check-crm-context-*-db, mais check-crm-health-db.mjs para o estado dos dados.
if (process.argv.includes('--deployed')) {
  console.log('LEGADO: modelo de permissões de 09/2026 substituído; veja o comentário no topo de scripts/check-crm-db.mjs.')
  process.exit(0)
}
const tests = readFileSync(resolve(root, 'supabase/tests/crm_shared_workflow.sql'), 'utf8')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260910010000_crm_shared_workflow.sql'), 'utf8')
const schedulingPatch = readFileSync(resolve(root, 'supabase/migrations/20260910030000_crm_claim_on_call_schedule.sql'), 'utf8')
const sellerCloserPatch = readFileSync(resolve(root, 'supabase/migrations/20260910120000_seller_closer_access.sql'), 'utf8')
const callSyncPatch = readFileSync(resolve(root, 'supabase/migrations/20260910160000_sdr_closer_call_sync.sql'), 'utf8')
const directory = resolve(root, '.verification.local')
mkdirSync(directory, { recursive: true })
const patchBody = schedulingPatch.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
const sellerCloserPatchBody = sellerCloserPatch.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
const callSyncPatchBody = callSyncPatch.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
const query = process.argv.includes('--deployed')
  ? 'BEGIN;'
  : process.argv.includes('--patch')
    ? 'BEGIN;\n' + patchBody + '\n' + sellerCloserPatchBody + '\n' + callSyncPatchBody
    : migration.replace(/COMMIT;\s*$/, '') + '\n' + patchBody + '\n' + sellerCloserPatchBody + '\n' + callSyncPatchBody
writeFileSync(
  resolve(directory, 'crm-query.sql'),
  query.replace('BEGIN;', "BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';") +
    '\n' +
    tests +
    '\nROLLBACK;'
)
const result = spawnSync(
  'npx',
  [
    'supabase',
    'db',
    'query',
    '--linked',
    '--project-ref',
    'mbzwchnxtskysqplqiyy',
    '--file',
    '.verification.local/crm-query.sql',
    '--output',
    'json'
  ],
  { cwd: root, shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
)
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || result.error?.message)
  process.exitCode = result.status ?? 1
} else
  console.log(
    'PASS: CRM schema, RLS, role boundaries, atomic transitions, conflicts, notes and sales linkage verified. Migration and all fixtures rolled back.'
  )
