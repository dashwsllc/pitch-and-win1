import assert from 'node:assert/strict'
import {
  notifyDashboardDataChanged,
  refreshApproachData,
  refreshDashboardData,
  refreshDashboardMutation,
  refreshIdentityData,
  refreshSalesData,
  shouldRefreshDashboardRevision,
} from '../src/lib/sync.ts'

const localEvents = []
const broadcasts = []
globalThis.window = new EventTarget()
window.addEventListener('dashboard-data-changed', () => localEvents.push('changed'))
globalThis.BroadcastChannel = class {
  constructor(name) { this.name = name }
  postMessage(message) { broadcasts.push([this.name, message]) }
  close() {}
}
const invalidations = []
const client = { invalidateQueries: async (...args) => { invalidations.push(args) } }

await refreshDashboardData(client)
assert.equal(localEvents.length, 1, 'Remote revision refreshes the local screen')
assert.equal(broadcasts.length, 0, 'Remote revisions must not echo between tabs')

for (const refresh of [refreshSalesData, refreshApproachData, refreshIdentityData, refreshDashboardMutation]) {
  await refresh(client)
}
assert.equal(localEvents.length, 5, 'Every local mutation refreshes legacy screens')
assert.equal(broadcasts.length, 4, 'Every local mutation alerts other tabs')
assert.equal(invalidations.length, 5)
assert.ok(invalidations.every(args => args.length === 0), 'Every mutation invalidates all dependent queries')

notifyDashboardDataChanged()
assert.equal(localEvents.length, 6)
assert.equal(broadcasts.length, 5, 'Local-state mutations also alert other tabs')
assert.equal(shouldRefreshDashboardRevision(undefined, 'sales:1', 1_000, 2_000), true)
assert.equal(shouldRefreshDashboardRevision('sales:1', 'sales:2', 1_000, 2_000), true)
assert.equal(shouldRefreshDashboardRevision('sales:1', 'sales:1', 1_000, 2_000), false)
assert.equal(shouldRefreshDashboardRevision('sales:1', 'sales:1', 1_000, 121_000), true,
  'A failed fetch must be retried even without another data change')
console.log('Dashboard sync: local refresh, complete invalidation and loop-free cross-tab broadcast passed.')
