import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLeadImportRows, defaultLeadCsvMapping, summarizeLeadImport } from '../src/lib/meta-lead-import.ts'
import { metaContactDefaults } from '../src/lib/meta-leads.ts'

const headers = ['Lead ID', 'Created time', 'Full name', 'Phone number', 'Email', 'Athlete name', 'Athlete birth date', 'Athlete position', 'Motivação']
const row = ['1001', '20/09/2026 14:30', 'Maria Souza', '11999990000', 'maria@example.com', 'João Souza', '15/03/2010', 'Meia', 'Ser profissional']
const build = (values, columns = headers, filename = 'leads.csv') => buildLeadImportRows(values, columns, defaultLeadCsvMapping(columns), filename)

test('an incomplete lead keeps mapped athlete answers as well as custom answers', async () => {
  const incomplete = [...row]; incomplete[4] = ''
  const [lead] = await build([incomplete])
  assert.equal(lead.complete, false)
  assert.deepEqual(lead.field_data.find(answer => answer.name === 'Athlete name'), { name: 'Athlete name', values: ['João Souza'] })
  assert.deepEqual(lead.field_data.find(answer => answer.name === 'Motivação'), { name: 'Motivação', values: ['Ser profissional'] })
})

test('repeated Meta IDs stay identical, including the l: prefix from exports', async () => {
  const prefixed = [...row]; prefixed[0] = 'l:1001'
  const leads = await build([row, prefixed])
  assert.deepEqual(leads.map(lead => lead.meta_lead_id), ['1001', '1001'])
  assert.deepEqual(summarizeLeadImport(leads), { total: 2, complete: 1, manual: 0, duplicates: 1 })
})

test('ID-less reimports keep their identity after renaming and reordering a file', async () => {
  const columns = headers.slice(1)
  const other = [...row.slice(1)]; other[1] = 'Ana Lima'
  const first = await build([row.slice(1), other], columns, 'primeiro.csv')
  const again = await build([other, row.slice(1)], columns, 'renomeado.xlsx')
  assert.equal(first[0].meta_lead_id, again[1].meta_lead_id)
  assert.notEqual(first[0].meta_lead_id, first[1].meta_lead_id)
  assert(first[0].meta_lead_id.length <= 100)
})

test('Brazilian lead times are interpreted in Brasilia even on a UTC computer', async () => {
  const original = process.env.TZ; process.env.TZ = 'UTC'
  try {
    const [lead] = await build([row])
    assert.equal(lead.created_time, '2026-09-20T17:30:00.000Z')
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
})

test('an impossible birth date is not counted as ready for the CRM', async () => {
  const invalid = [...row]; invalid[6] = '31/02/2010'
  const [lead] = await build([invalid])
  assert.equal(lead.complete, false)
  assert.equal(lead.athlete_birth_date, '')
  assert.equal(lead.field_data.find(answer => answer.name === 'Athlete birth date').values[0], '31/02/2010')
})

test('missing required contact values do not claim the lead is ready for the CRM', async () => {
  const invalid = [...row]; invalid[2] = ''; invalid[3] = ''
  const [lead] = await build([invalid])
  assert.equal(lead.complete, false)
})

test('a file missing contact columns still reaches the completion queue, without blank rows', async () => {
  const leads = await build([['João', '16'], ['', ''], ['Ana', '15']], ['Nome do atleta', 'Idade'])
  assert.equal(leads.length, 2)
  assert.deepEqual(leads.map(lead => lead.source_row), [2, 4])
  assert.equal(leads[0].complete, false)
})

test('the completion dialog starts with the imported mapping and preserves free positions', () => {
  const lead = {
    full_name: 'Maria Souza', phone: '11999990000', email: '', field_data: [],
    import_contact: { athlete_name: 'João Souza', athlete_birth_date: '2010-03-15', athlete_position: 'volante/meia',
      athlete_age: '16', athlete_height_cm: '172', athlete_weight_kg: '65', city_state: 'São Paulo/SP', performance_report_url: 'https://example.com/relatorio' },
  }
  assert.deepEqual(metaContactDefaults(lead), {
    name: 'Maria Souza', phone: '11999990000', email: '', athlete_name: 'João Souza',
    athlete_birth_date: '2010-03-15', athlete_position: 'volante/meia', athlete_age: '16',
    athlete_height_cm: '172', athlete_weight_kg: '65', city_state: 'São Paulo/SP', performance_report_url: 'https://example.com/relatorio',
  })
})
