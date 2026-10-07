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
