import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { isStaleConflict } from '../src/lib/stale-conflict.ts'

test('PT409 (novo) e 40001 (antigo) contam como "o dado mudou"; o resto nao', () => {
  assert.equal(isStaleConflict({ code: 'PT409', message: 'x' }), true)
  assert.equal(isStaleConflict({ code: '40001' }), true)
  for (const other of [{ code: '42501' }, { code: 'PGRST003' }, { code: '22023' }, { message: 'sem codigo' }, new Error('x'), null, undefined, 'PT409', 409]) assert.equal(isStaleConflict(other), false)
})

test('nenhuma tela compara o codigo na mao: todas passam por isStaleConflict', () => {
  for (const file of ['src/components/traffic/MetaPendingImports.tsx', 'src/components/traffic/MetaLeadWaves.tsx', 'src/lib/meta-traffic-queries.ts']) {
    const text = readFileSync(file, 'utf8')
    assert.match(text, /isStaleConflict/, `${file} nao usa o helper`)
    assert.doesNotMatch(text, /code\s*===\s*'40001'/, `${file} ainda compara 40001 na mao`)
  }
})
