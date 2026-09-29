import assert from 'node:assert/strict'
import { parseCsv } from '../src/lib/meta-traffic.ts'
import { buildLeadImportRows, defaultLeadCsvMapping, summarizeLeadImport } from '../src/lib/meta-lead-import.ts'

const header = 'Lead ID;Created time;Full name;Phone number;Email;Campaign name;Athlete name;Athlete birth date;Athlete position;Motivacao\n'
const complete = '1001;20/09/2026 14:30;Maria Souza;11999990000;maria@example.com;Campanha Leads;João Souza;15/03/2010;Meia;Ser profissional\n'
const messy = '1002;21/09/2026;Ana Lima;11988880000;;Campanha Leads;;;volante/zagueiro/meio campo;Falta de oportunidades\n'
const { headers, values } = parseCsv(header + complete + messy)
const mapping = defaultLeadCsvMapping(headers)
const rows = buildLeadImportRows(values, headers, mapping, 'leads.csv')

assert.equal(rows.length, 2)
assert.equal(rows[0].meta_lead_id, '1001')
assert.equal(rows[0].full_name, 'Maria Souza')
assert.equal(rows[0].athlete_birth_date, '2010-03-15')
assert.equal(rows[0].complete, true)

// Posição fora do enum do CRM não bloqueia a linha nem é alterada: entra exatamente como está
// na planilha (sincroniza o que tem, sem reinterpretar), só não conta como "pronta pro CRM".
assert.equal(rows[1].athlete_position, 'volante/zagueiro/meio campo')
assert.equal(rows[1].complete, false, 'posição fora do enum não conta como pronta pro CRM automático')

// Coluna sem mapeamento estruturado (Motivacao) vira resposta de formulário, preservada
// integralmente — mesmo em linha "completa", nada se perde.
assert.deepEqual(rows[0].field_data, [{ name: 'Motivacao', values: ['Ser profissional'] }])
assert.equal(rows[0].raw_notes, 'Motivacao: Ser profissional')
assert.deepEqual(rows[1].field_data, [{ name: 'Motivacao', values: ['Falta de oportunidades'] }])

const summary = summarizeLeadImport(rows)
assert.equal(summary.total, 2)
assert.equal(summary.complete, 1)
assert.equal(summary.manual, 1)

// Sem ID na planilha: gera um sintético estável por linha, sem colidir.
const withoutId = parseCsv('Created time;Full name;Phone number\n20/09/2026;Pedro Alves;11977770000\n21/09/2026;Julia Reis;11966660000\n')
const idlessRows = buildLeadImportRows(withoutId.values, withoutId.headers, defaultLeadCsvMapping(withoutId.headers), 'sem-id.csv')
assert.equal(idlessRows[0].meta_lead_id, 'csv:sem-id.csv:0')
assert.equal(idlessRows[1].meta_lead_id, 'csv:sem-id.csv:1')

// Nome/telefone ausentes não bloqueiam a importação (o formulário real às vezes não traz
// e-mail nem alguns dados do atleta) — a linha entra do mesmo jeito, sem e-mail nem atleta,
// e cai para a fila /leads completar.
const missingFields = parseCsv(header + '1003;20/09/2026;;;;Campanha;;;;\n')
const missingRows = buildLeadImportRows(missingFields.values, missingFields.headers, defaultLeadCsvMapping(missingFields.headers), 'missing.csv')
assert.equal(missingRows.length, 1)
assert.equal(missingRows[0].full_name, '')
assert.equal(missingRows[0].complete, false)

// Duplicidade de ID dentro do mesmo arquivo não derruba a linha: ganha um sufixo e as duas entram.
const duplicated = parseCsv(header + complete + complete)
const duplicatedRows = buildLeadImportRows(duplicated.values, duplicated.headers, defaultLeadCsvMapping(duplicated.headers), 'dup.csv')
assert.equal(duplicatedRows.length, 2)
assert.notEqual(duplicatedRows[0].meta_lead_id, duplicatedRows[1].meta_lead_id)

console.log('Planilha de leads: mapeamento, datas, integridade de dados livres e sem bloqueio de linha verificados')
