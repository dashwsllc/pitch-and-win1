import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { instalarResolvedor } from './perf/ts-alias.mjs'
instalarResolvedor(resolve(import.meta.dirname, '..'))
const { saleDashboardPath } = await import('../src/lib/sales.ts')

for (const [at, day] of [
  ['2026-10-02T21:57:49.890846Z', '2026-10-02'],
  ['2026-10-03T02:59:59Z', '2026-10-02'],
  ['2026-10-03T03:00:00Z', '2026-10-03'],
  ['2026-01-01T01:00:00Z', '2025-12-31'],
]) {
  const url = new URL(saleDashboardPath(at), 'https://example.test')
  assert.equal(url.pathname, '/')
  assert.equal(url.searchParams.get('periodo'), 'intervalo')
  assert.equal(url.searchParams.get('de'), day)
  assert.equal(url.searchParams.get('ate'), day)
}
console.log('PASS: sale navigation follows the purchase date in Brasília, including midnight/year boundaries.')
