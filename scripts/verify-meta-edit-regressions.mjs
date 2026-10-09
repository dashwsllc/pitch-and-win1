import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMetaEditPatch } from '../src/lib/meta-edit.ts'
import { metaContactDefaults } from '../src/lib/meta-leads.ts'

test('editing one contact sends only changed data and allows explicit clearing', () => {
  assert.deepEqual(buildMetaEditPatch('leads', { full_name: 'Maria', phone: '11999990000', field_data: [] },
    { full_name: 'Maria', phone: '', field_data: '[]' }), { phone: '' })
})
test('published metric corrections keep number types and ignore protected fields', () => {
  assert.deepEqual(buildMetaEditPatch('metrics', { spend: 10, leads: 2, id: 'same', source: 'api' },
    { spend: '12.50', leads: '2', id: 'changed', source: 'csv' }), { spend: 12.5 })
})
test('missing, negative, fractional counts and invalid metric values are rejected', () => {
  for (const value of ['', '-1', '1.5', 'Infinity', 'not a number']) {
    assert.throws(() => buildMetaEditPatch('metrics', { leads: 2 }, { leads: value }))
  }
})
test('form answers accept only arrays of named string answers', () => {
  assert.deepEqual(buildMetaEditPatch('leads', { field_data: [] },
    { field_data: '[{"name":"Objetivo","values":["Profissional"]}]' }),
    { field_data: [{ name: 'Objetivo', values: ['Profissional'] }] })
  for (const value of ['{}', '[{"name":"Idade","values":[12]}]', 'null', 'invalid']) {
    assert.throws(() => buildMetaEditPatch('leads', { field_data: [] }, { field_data: value }))
  }
})
test('the SDR form respects explicitly cleared manager fields over original answers', () => {
  const contact = metaContactDefaults({ full_name: '', phone: '', email: '', import_contact: { phone: '', city_state: '' },
    field_data: [{ name: 'phone_number', values: ['11999990000'] }, { name: 'cidade', values: ['Original'] }] })
  assert.equal(contact.phone, '')
  assert.equal(contact.city_state, '')
})
