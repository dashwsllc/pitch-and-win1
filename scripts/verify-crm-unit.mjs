import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crmCapabilities } from '../src/lib/crm-capabilities.ts'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/brasilia-time') return nextResolve(new URL('../src/lib/brasilia-time.ts', import.meta.url).href, context)
  return nextResolve(specifier, context)
} })
const { emptyContact, validateContact, contactPayload } = await import('../src/lib/crm.ts')
const minimal = { ...emptyContact, name: 'Responsável QA', athlete_name: 'Atleta QA', phone: '11999999999' }
assert.equal(validateContact(minimal), null)
for (const field of ['email','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','performance_report_url','city_state']) assert.equal(contactPayload(minimal)[field], null)
for (const field of ['name','athlete_name','phone']) assert.ok(validateContact({ ...minimal, [field]: '' }))
assert.ok(validateContact({ ...minimal, email: 'invalid' }))
assert.ok(validateContact({ ...minimal, athlete_height_cm: '999' }))
assert.deepEqual(crmCapabilities(['seller']), { admin: false, leads: true, sdr: true, closer: true, sales: true })
assert.equal(crmCapabilities(['seller','sdr']).closer, true)
assert.equal(crmCapabilities(['seller','sdr']).sales, true)
assert.equal(crmCapabilities(['seller','closer']).sdr, false)
assert.equal(crmCapabilities(['bdr'], false).leads, false)
assert.equal(crmCapabilities(['bdr'], true).leads, true)
assert.equal(crmCapabilities(['seller'], true, false).leads, false)
assert.ok(Object.values(crmCapabilities(['executive'])).every(Boolean))
const callsSource = readFileSync(new URL('../src/components/crm/CRMCalls.tsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../src/components/crm/CRMLeadCard.tsx', import.meta.url), 'utf8')
assert.match(callsSource, /isSdrHandoff[\s\S]*handoff_and_schedule_closer_call/)
assert.match(callsSource, /O lead só será enviado ao Closer depois que o agendamento for/)
assert.match(cardSource, /Agendar call e enviar/)
assert.doesNotMatch(cardSource, /onAction\("handoff"\)/)
console.log('PASS: contact validation, capability matrix and schedule-before-handoff wiring.')
