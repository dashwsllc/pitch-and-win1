import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { globSync } from '../node_modules/tinyglobby/dist/index.mjs'
import {
  AUTO_REFRESH_INTERVAL_MS,
  AUTO_REFRESH_INTERVAL_LABEL,
  CRM_CLOCK_INTERVAL_MS,
  LIVE_CLOCK_INTERVAL_MS,
  RECENT_SALES_AUTOPLAY_INTERVAL_MS,
} from '../src/lib/sync.ts'

const root = resolve(import.meta.dirname, '..')
assert.equal(AUTO_REFRESH_INTERVAL_MS, 50_000)
assert.equal(AUTO_REFRESH_INTERVAL_LABEL, '50 segundos')
assert.equal(LIVE_CLOCK_INTERVAL_MS, 1_000)
assert.equal(CRM_CLOCK_INTERVAL_MS, 15_000)
assert.equal(RECENT_SALES_AUTOPLAY_INTERVAL_MS, 6_000)

const files = await globSync(['src/**/*.ts', 'src/**/*.tsx'], { cwd: root, absolute: true })
const intervals = []
const sources = new Map()

for (const file of files) {
  const sourceText = readFileSync(file, 'utf8')
  sources.set(file.replaceAll('\\', '/').replace(root.replaceAll('\\', '/'), ''), sourceText)
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isInterval = ts.isIdentifier(callee) && callee.text === 'setInterval'
        || ts.isPropertyAccessExpression(callee) && callee.name.text === 'setInterval'
      if (isInterval) intervals.push({ file: file.replaceAll('\\', '/'), delay: node.arguments[1]?.getText(source) })
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'refetchInterval') {
      assert.fail(`${file} owns an independent query polling timer`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const intervalSummary = intervals.map(item => [item.file.slice(root.length + 1), item.delay])
assert.deepEqual(intervalSummary.sort(), [
  ['src/components/DataSync.tsx', 'AUTO_REFRESH_INTERVAL_MS'],
  ['src/components/dashboard/RecentSales.tsx', 'RECENT_SALES_AUTOPLAY_INTERVAL_MS'],
  ['src/hooks/useAuth.tsx', 'AUTO_REFRESH_INTERVAL_MS'],
  ['src/hooks/useCRMNotifications.ts', 'TICK_MS'],
].sort())

const source = relative => sources.get(`/${relative}`) ?? sources.get(relative)
assert.match(source('src/components/DataSync.tsx'), /table:\s*'dashboard_events'/)
assert.match(source('src/components/DataSync.tsx'), /refreshDashboardData\(queryClient\)/)
assert.match(source('src/hooks/useCRM.tsx'), /table:\s*"crm_leads"/)
assert.match(source('src/hooks/useCRM.tsx'), /table:\s*"crm_activities"/)
assert.match(source('src/hooks/useCRM.tsx'), /table:\s*"crm_lead_contexts"/)
assert.match(source('src/pages/Dashboard.tsx'), /useLiveClock\(\)/)
assert.match(source('src/components/dashboard/GoalsProgress.tsx'), /useLiveClock\(\)/)
assert.match(source('src/pages/CRM.tsx'), /useLiveClock\(CRM_CLOCK_INTERVAL_MS\)/)
assert.match(source('src/components/executive/ExecutiveSellerDetails.tsx'), /dashboard-data-changed/)
assert.match(source('src/components/executive/ExecutivePasswordRequests.tsx'), /dashboard-data-changed/)

const migration = readFileSync(resolve(root, 'supabase/migrations/20260920203000_complete_dashboard_realtime_signals.sql'), 'utf8')
assert.match(migration, /dashboard_subscriptions_signal/)
assert.match(migration, /dashboard_password_requests_signal/)

console.log('PASS: clocks are independent, query refresh is centralized, realtime covers every live surface, and the 50-second fallback stays synchronized.')
