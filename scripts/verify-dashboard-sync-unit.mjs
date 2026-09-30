import assert from 'node:assert/strict'
import {
  isRevisionNewer,
  maxRevision,
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
// Realtime already delivered these counters: the revision poll must not repeat the refresh.
assert.equal(isRevisionNewer(undefined, 5), true, 'An unseen topic is always news')
assert.equal(isRevisionNewer('5', 5), false, 'Same revision as Realtime delivered is not news')
assert.equal(isRevisionNewer('5', '4'), false, 'A stale poll read never moves the cursor backwards')
assert.equal(isRevisionNewer('5', 6), true, 'A newer revision is a missed change and must refresh')
assert.equal(isRevisionNewer('9007199254740993', '9007199254740994'), true, 'bigint counters compare exactly')
assert.equal(isRevisionNewer('abc', 7), true, 'Unparseable values refresh when in doubt')
assert.equal(maxRevision(undefined, 3), '3')
assert.equal(maxRevision('5', 3), '5')
assert.equal(maxRevision('5', 8), '8')
console.log('Dashboard sync: local refresh, complete invalidation and loop-free cross-tab broadcast passed.')
