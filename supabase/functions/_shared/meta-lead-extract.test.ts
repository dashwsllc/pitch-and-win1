import { assertEquals } from 'jsr:@std/assert@1'
import { extractLeadFields, type ChoiceAnswer, type FieldAnswer } from './meta-lead-extract.ts'

function fakeAskJev(
  answers: Partial<Record<'full_name' | 'phone' | 'email', ChoiceAnswer>>,
) {
  return async (
    _criteria: Record<string, string>,
    instructions: Record<string, string>,
  ): Promise<Record<string, ChoiceAnswer>> => {
    const result: Record<string, ChoiceAnswer> = {}
    for (const key of Object.keys(instructions)) {
      result[key] = answers[key as 'full_name' | 'phone' | 'email'] ?? { choice: 'nenhuma', confidence: 0 }
    }
    return result
  }
}

Deno.test('extractLeadFields returns all empty and skips Jev when field_data is empty', async () => {
  let called = false
  const askJev = async () => {
    called = true
    return {}
  }
  const result = await extractLeadFields([], askJev)
  assertEquals(result, { full_name: '', phone: '', email: '' })
  assertEquals(called, false)
})

Deno.test('extractLeadFields picks the field Jev points to, even with an unrecognized label', async () => {
  const fieldData: FieldAnswer[] = [
    { name: 'Como podemos te chamar?', values: ['Carla Souza'] },
    { name: 'Seu numero com DDD', values: ['11988887777'] },
  ]
  const askJev = fakeAskJev({
    full_name: { choice: 'f0', confidence: 0.92 },
    phone: { choice: 'f1', confidence: 0.87 },
    email: { choice: 'nenhuma', confidence: 0.95 },
  })
  const result = await extractLeadFields(fieldData, askJev)
  assertEquals(result, { full_name: 'Carla Souza', phone: '11988887777', email: '' })
})

Deno.test('extractLeadFields treats low confidence as no match', async () => {
  const fieldData: FieldAnswer[] = [{ name: 'campo ambiguo', values: ['talvez isso'] }]
  const askJev = fakeAskJev({
    full_name: { choice: 'f0', confidence: 0.3 },
  })
  const result = await extractLeadFields(fieldData, askJev)
  assertEquals(result.full_name, '')
})

Deno.test('extractLeadFields falls back to exact-label matching when the Jev call fails', async () => {
  const fieldData: FieldAnswer[] = [
    { name: 'email', values: ['carla@example.com'] },
    { name: 'telefone', values: ['11988887777'] },
  ]
  const askJev = async (): Promise<Record<string, ChoiceAnswer>> => {
    throw new Error('TypeSafe indisponivel')
  }
  const result = await extractLeadFields(fieldData, askJev)
  assertEquals(result, { full_name: '', phone: '11988887777', email: 'carla@example.com' })
})

Deno.test('known contact fields avoid AI entirely', async () => {
  const data = [{ name: 'full_name', values: ['Maria'] }, { name: 'phone_number', values: ['11999990000'] }, { name: 'email', values: ['m@example.invalid'] }]
  let calls = 0
  const result = await extractLeadFields(data, async () => { calls++; throw new Error('Unavailable') })
  assertEquals(result, { full_name: 'Maria', phone: '11999990000', email: 'm@example.invalid' })
  assertEquals(calls, 0)
})
Deno.test('only missing fields are requested; uncertainty never blanks deterministic data', async () => {
  const data = [{ name: 'full_name', values: ['Maria'] }, { name: 'Seu contato', values: ['11999990000'] }, { name: 'email', values: ['m@example.invalid'] }]
  const before = JSON.stringify(data)
  let requested: string[] = []
  const result = await extractLeadFields(data, async (_criteria, instructions) => {
    requested = Object.keys(instructions)
    return { full_name: { choice: 'nenhuma', confidence: 0 }, phone: { choice: 'f1', confidence: 0.49 } }
  })
  assertEquals(requested, ['phone'])
  assertEquals(result, { full_name: 'Maria', phone: '', email: 'm@example.invalid' })
  assertEquals(JSON.stringify(data), before)
})
Deno.test('choice must be a real exact option and confidence must be finite and bounded', async () => {
  const data = [{ name: 'Unknown', values: ['first'] }, { name: 'Other', values: ['second'] }]
  for (const choice of ['f-1', 'x1', 'f1abc', 'f01', 'f2', 'f999999999999999999999999', 'nenhuma']) {
    assertEquals((await extractLeadFields(data, fakeAskJev({ full_name: { choice, confidence: 1 } }))).full_name, '')
  }
  for (const confidence of [NaN, Infinity, -1, 1.01, 0.49]) {
    assertEquals((await extractLeadFields(data, fakeAskJev({ full_name: { choice: 'f0', confidence } }))).full_name, '')
  }
  assertEquals((await extractLeadFields(data, fakeAskJev({ full_name: { choice: 'f1', confidence: 0.5 } }))).full_name, 'second')
})
Deno.test('AI failure keeps deterministic fields and leaves original answers intact', async () => {
  const data = [{ name: 'full_name', values: ['Maria'] }, { name: 'Ambiguous', values: ['response'] }]
  const before = JSON.stringify(data)
  const result = await extractLeadFields(data, async () => { throw new Error('Timeout') })
  assertEquals(result, { full_name: 'Maria', phone: '', email: '' })
  assertEquals(JSON.stringify(data), before)
})
