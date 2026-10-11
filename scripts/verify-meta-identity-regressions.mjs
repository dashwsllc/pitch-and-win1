import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImportRows, defaultCsvMapping } from '../src/lib/meta-traffic.ts'
import { existsSync } from 'node:fs'
const identity = existsSync(new URL('../shared/meta-identity.ts',import.meta.url))
  ? await import('../shared/meta-identity.ts') : {}

test('account identifiers have one canonical numeric form', () => {
  assert.equal(typeof identity.normalizeMetaAccountId,'function','missing account normalizer')
  assert.equal(identity.normalizeMetaAccountId(' act_123 '),'123')
  for (const invalid of ['', 'act_act_123','12x','-12','１２３']) assert.throws(()=>identity.normalizeMetaAccountId(invalid))
})
test('identity keys do not collide on colon-containing entity IDs', () => {
  assert.equal(typeof identity.metaTrafficKey,'function','missing stable identity key')
  const row = {date:'2026-10-09',account_id:'123',campaign_id:'a:b',adset_id:'c'}
  assert.notEqual(identity.metaTrafficKey(row),identity.metaTrafficKey({...row,campaign_id:'a',adset_id:'b:c'}))
})
test('CSV prefix normalization detects duplicate canonical facts', () => {
  const headers=['Data','ID da conta','ID da campanha','Campanha','Valor gasto']
  const rows=[['2026-10-09','act_123','A','Campanha A','10'],['2026-10-09','123','A','Campanha A','20']]
  assert.throws(()=>buildImportRows(rows,headers,defaultCsvMapping(headers),'campaign','2026-10-11',''),/duplicada/)
})
