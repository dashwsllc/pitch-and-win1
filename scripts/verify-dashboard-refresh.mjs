import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { globSync } from '../node_modules/tinyglobby/dist/index.mjs'
import { AUTO_REFRESH_INTERVAL_MS, AUTO_REFRESH_INTERVAL_LABEL } from '../src/lib/sync.ts'

const root = resolve(import.meta.dirname, '..')
assert.equal(AUTO_REFRESH_INTERVAL_MS, 50_000)
assert.equal(AUTO_REFRESH_INTERVAL_LABEL, '50 segundos')

const files = await globSync(['src/**/*.ts', 'src/**/*.tsx'], { cwd: root, absolute: true })
const intervals = []
const refetchIntervals = []
const focusRefreshes = []
const localReminderIntervals = []

for (const file of files) {
  const sourceText = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isInterval = ts.isIdentifier(callee) && callee.text === 'setInterval'
        || ts.isPropertyAccessExpression(callee) && callee.name.text === 'setInterval'
      if (isInterval) {
        const interval = { file, delay: node.arguments[1]?.getText(source) }
        // The CRM reminder evaluates already-loaded call times without fetching
        // data. Its clock is independent from the 50-second refresh cadence.
        if (file.replaceAll('\\', '/').endsWith('/src/hooks/useCRMNotifications.ts')) {
          localReminderIntervals.push(interval)
          assert(!/\bfetch\s*\(|supabase\s*\./.test(sourceText), 'Reminder timer must not query the server')
        } else intervals.push(interval)
      }
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === 'refetchInterval') refetchIntervals.push({ file, value: node.initializer.getText(source) })
      if (node.name.text === 'refetchOnWindowFocus' && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
        focusRefreshes.push({ file, value: node.initializer.getText(source) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(!sourceText.includes('postgres_changes'), `${file} still contains event-driven automatic database refresh`)
}

assert(intervals.length > 0)
assert(refetchIntervals.length > 0)
assert.deepEqual([...new Set(intervals.map(item => item.delay))], ['AUTO_REFRESH_INTERVAL_MS'])
assert.deepEqual([...new Set(refetchIntervals.map(item => item.value))], ['AUTO_REFRESH_INTERVAL_MS'])
assert.deepEqual(focusRefreshes, [])
assert.deepEqual(localReminderIntervals.map(item => item.delay), ['TICK_MS'])
console.log(`PASS: ${intervals.length} recurring timers and ${refetchIntervals.length} query pollers all use exactly 50 seconds; no event-driven or focus refresh remains.`)
