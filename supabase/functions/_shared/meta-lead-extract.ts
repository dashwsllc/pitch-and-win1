export interface FieldAnswer { name?: string; values?: string[] }
export interface ExtractedLeadFields { full_name: string; phone: string; email: string }
export interface ChoiceAnswer { choice: string; confidence: number }
export type SystemOneCaller = (
  criteria: Record<string, string>,
  instructions: Partial<Record<keyof ExtractedLeadFields, string>>,
) => Promise<Record<string, ChoiceAnswer>>

// Mesmos rotulos de campo que src/lib/meta-leads.ts (firstAnswer) reconhece no
// formulario de importacao manual. Usado como rede de seguranca quando o Jev
// esta indisponivel - mantenha os dois em sincronia se adicionar variantes novas.
const EXACT_LABELS: Record<keyof ExtractedLeadFields, string[]> = {
  full_name: ['full_name', 'nome_completo', 'nome'],
  phone: ['phone_number', 'telefone', 'whatsapp'],
  email: ['email', 'email_address'],
}

const QUESTION_INSTRUCTIONS: Record<keyof ExtractedLeadFields, string> = {
  full_name: 'Qual resposta contem o nome completo de quem preencheu o formulario (responsavel/contato)?',
  phone: 'Qual resposta contem o telefone/WhatsApp de contato?',
  email: 'Qual resposta contem o endereco de e-mail de contato?',
}

const CONFIDENCE_THRESHOLD = 0.5
const NONE_KEY = 'nenhuma'

function firstAnswer(fields: FieldAnswer[], names: string[]): string {
  const match = fields.find(field => names.includes((field.name || '').toLowerCase()))
  return match?.values?.[0] || ''
}

function exactMatchFallback(fieldData: FieldAnswer[]): ExtractedLeadFields {
  return {
    full_name: firstAnswer(fieldData, EXACT_LABELS.full_name),
    phone: firstAnswer(fieldData, EXACT_LABELS.phone),
    email: firstAnswer(fieldData, EXACT_LABELS.email),
  }
}

// Deterministic answers are authoritative. AI selects only among original answers
// for fields whose labels are unknown; it never generates contact values.
export async function extractLeadFields(fieldData: FieldAnswer[] | undefined, askJev: SystemOneCaller): Promise<ExtractedLeadFields> {
  if (!Array.isArray(fieldData) || !fieldData.length) return { full_name: '', phone: '', email: '' }
  const known = exactMatchFallback(fieldData)
  const missing = (Object.keys(QUESTION_INSTRUCTIONS) as (keyof ExtractedLeadFields)[]).filter(key => !known[key])
  if (!missing.length) return known
  const instructions = Object.fromEntries(missing.map(key => [key, QUESTION_INSTRUCTIONS[key]]))
  const criteria: Record<string, string> = { [NONE_KEY]: 'Nenhuma resposta corresponde' }
  fieldData.forEach((field, index) => { criteria[`f${index}`] = `Pergunta: "${field.name || '(sem rotulo)'}" — Resposta: "${field.values?.[0] || ''}"` })
  try {
    const answers = await askJev(criteria, instructions)
    for (const key of missing) {
      const answer = answers?.[key]
      if (!answer || typeof answer.choice !== 'string' || !/^f(0|[1-9][0-9]*)$/.test(answer.choice)
        || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence)
        || answer.confidence < CONFIDENCE_THRESHOLD || answer.confidence > 1) continue
      const index = Number(answer.choice.slice(1))
      if (!Number.isSafeInteger(index) || index >= fieldData.length) continue
      const value = fieldData[index]?.values?.[0]
      if (typeof value === 'string') known[key] = value
    }
  } catch { /* Keep original deterministic fields; missing contacts remain for human review. */ }
  return known
}
