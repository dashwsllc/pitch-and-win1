import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {createComponentLoader} from './helpers/meta-component-harness.mjs'
const api=existsSync('src/lib/meta-wave-decisions.ts')?createComponentLoader()('src/lib/meta-wave-decisions.ts'):{}
test('collective approval sends all displayed member versions and the opened wave version',()=>{
 assert.equal(typeof api.waveDecisionPayload,'function','versioned UI decisions are missing')
 const snapshot={wave:{id:'w',version:7},leads:[{id:'a',updated_at:'2026-10-13T12:00:00.123456Z'}, {id:'b',updated_at:'2026-10-13T12:00:01Z'}]}
 assert.deepEqual(JSON.parse(JSON.stringify(api.waveDecisionPayload(snapshot,'aprovar',[],'','request-1'))),{
  p_wave:'w',p_expected_version:7,p_members:[{id:'a',updated_at:'2026-10-13T12:00:00.123456Z'},{id:'b',updated_at:'2026-10-13T12:00:01Z'}],
  p_action:'aprovar',p_excluded:[],p_note:'',p_request_id:'request-1'})
})
