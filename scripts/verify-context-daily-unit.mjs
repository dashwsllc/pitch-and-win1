import assert from 'node:assert/strict'
import { brasiliaDateKey, brasiliaDayBounds, brasiliaDateRange, brasiliaLocalInputToIso, isoToBrasiliaLocalInput, millisecondsUntilBrasiliaMidnight, isValidDateKey, formatDateKey } from '../src/lib/brasilia-time.ts'
import { sanitizePlainText, validatePlainText, safePlainText } from '../src/lib/plain-text.ts'
import { compareLeadUrgency, nextLeadSchedule } from '../src/lib/crm-order.ts'
import { AUTO_REFRESH_INTERVAL_MS, AUTO_REFRESH_INTERVAL_LABEL } from '../src/lib/sync.ts'
assert.equal(AUTO_REFRESH_INTERVAL_MS, 50000)
assert.equal(AUTO_REFRESH_INTERVAL_LABEL, '50 segundos')

assert.equal(brasiliaDateKey('2026-09-12T02:59:59Z'), '2026-09-11')
assert.equal(brasiliaDateKey('2026-09-12T03:00:00Z'), '2026-09-12')
assert.equal(brasiliaDayBounds('2026-09-11').end.toISOString(), '2026-09-12T03:00:00.000Z')
assert.equal(brasiliaDateRange(7, '2026-09-11').start.toISOString(), '2026-09-05T03:00:00.000Z')
assert.equal(millisecondsUntilBrasiliaMidnight(new Date('2026-09-12T02:59:59Z')), 1000)
assert.equal(millisecondsUntilBrasiliaMidnight(new Date('2026-09-12T03:00:00Z')), 86400000)
assert.equal(brasiliaLocalInputToIso('2026-09-11T23:30'), '2026-09-12T02:30:00.000Z')
assert.equal(isoToBrasiliaLocalInput('2026-09-12T02:30:00Z'), '2026-09-11T23:30')
for (const value of ['2026-02-30T10:00', '2026-09-11T24:00', '2026-09-11T12:61', '']) assert.equal(brasiliaLocalInputToIso(value), null)
assert.equal(isValidDateKey('2024-02-29'), true)
assert.equal(isValidDateKey('2026-02-29'), false)
assert.equal(formatDateKey(''), 'Data não selecionada')
assert.equal(sanitizePlainText(' a\r\nb\u0001\u0080\tç😀 ', 100), 'a\nb\tç😀')
assert.throws(() => validatePlainText('x'.repeat(50001), 50000), /excede/)
assert.equal(validatePlainText('x'.repeat(50000), 50000).length, 50000)
assert.equal(safePlainText('<script>alert(1)</script>', 50000), '<script>alert(1)</script>') // React text, never innerHTML.
const lead = (id, date, stage='em_qualificacao') => ({id, next_followup_at:date, pipeline_stage:stage, created_at:'2026-09-01T00:00:00Z'})
const rows = [lead('none', null), lead('future', '2026-09-12T12:00:00Z'), lead('late', '2026-09-10T12:00:00Z'), lead('closed', '2026-09-01T12:00:00Z', 'fechado_ganho'), lead('soon', '2026-09-11T12:00:00Z')]
assert.deepEqual([...rows].sort((a,b)=>compareLeadUrgency(a,b)).map(r=>r.id), ['late','soon','future','closed','none'])
assert.equal(nextLeadSchedule(rows[1], '2026-09-11T11:00:00Z'), '2026-09-11T11:00:00Z')
assert.equal(nextLeadSchedule(lead('offset', '2026-09-11T10:00:00-03:00'), '2026-09-11T12:00:00Z'), '2026-09-11T12:00:00Z')
rows[1].next_followup_at = '2026-09-09T12:00:00Z'
assert.equal([...rows].sort((a,b)=>compareLeadUrgency(a,b))[0].id, 'future')
console.log('PASS: Brasília boundaries, midnight rollover, invalid dates, text size/control characters and automatic schedule ordering.')
