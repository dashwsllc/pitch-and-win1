import assert from 'node:assert/strict'
import { crmCapabilities } from '../src/lib/crm-capabilities.ts'
import { emptyContact, validateContact, contactPayload } from '../src/lib/crm.ts'
const minimal = { ...emptyContact, name: 'Responsável QA', athlete_name: 'Atleta QA', phone: '11999999999' }
assert.equal(validateContact(minimal), null)
for (const field of ['email','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','performance_report_url','city_state']) assert.equal(contactPayload(minimal)[field], null)
for (const field of ['name','athlete_name','phone']) assert.ok(validateContact({ ...minimal, [field]: '' }))
assert.ok(validateContact({ ...minimal, email: 'invalid' }))
assert.ok(validateContact({ ...minimal, athlete_height_cm: '999' }))
assert.deepEqual(crmCapabilities(['seller']), { admin: false, leads: true, sdr: true, closer: true, sales: true })
assert.equal(crmCapabilities(['seller','sdr']).closer, false)
assert.equal(crmCapabilities(['seller','closer']).sdr, false)
assert.equal(crmCapabilities(['bdr'], false).leads, false)
assert.equal(crmCapabilities(['bdr'], true).leads, true)
assert.equal(crmCapabilities(['seller'], true, false).leads, false)
assert.ok(Object.values(crmCapabilities(['executive'])).every(Boolean))
console.log('PASS: contact validation/null payload and frontend capability matrix.')
