export interface FieldAnswer { name?: string; values?: string[] }
export interface ExtractedLeadFields { full_name: string; phone: string; email: string }
export interface ChoiceAnswer { choice: string; confidence: number }
export type SystemOneCaller = (
  criteria: Record<string, string>,
  instructions: Record<'full_name' | 'phone' | 'email', string>,
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

// Formularios do Meta Lead Ads usam o texto real da pergunta como rotulo do
// campo, que varia por formulario/campanha. Em vez de comparar rotulo exato
// (fragil - quebra silenciosamente quando o marketing muda o texto), pedimos
// pro Jev escolher, entre as respostas reais recebidas, qual corresponde a
// cada campo alvo. Se a chamada falhar (API fora do ar, sem credencial), caimos
// pro casamento exato de sempre - nunca perdemos um lead por causa disso.
export async function extractLeadFields(
  fieldData: FieldAnswer[] | undefined,
  askJev: SystemOneCaller,
): Promise<ExtractedLeadFields> {
  if (!Array.isArray(fieldData) || fieldData.length === 0) {
    return { full_name: '', phone: '', email: '' }
  }

  const criteria: Record<string, string> = { [NONE_KEY]: 'Nenhuma resposta corresponde' }
  fieldData.forEach((field, index) => {
    criteria[`f${index}`] = `Pergunta: "${field.name || '(sem rotulo)'}" — Resposta: "${field.values?.[0] || ''}"`
  })

  try {
    const answers = await askJev(criteria, QUESTION_INSTRUCTIONS)
    const pick = (key: keyof ExtractedLeadFields): string => {
      const answer = answers[key]
      if (!answer || answer.confidence < CONFIDENCE_THRESHOLD || answer.choice === NONE_KEY) return ''
      const index = Number(answer.choice.slice(1))
      return fieldData[index]?.values?.[0] || ''
    }
    return { full_name: pick('full_name'), phone: pick('phone'), email: pick('email') }
  } catch (error) {
    console.error('extractLeadFields: Jev indisponivel, usando casamento exato como fallback', error)
    return exactMatchFallback(fieldData)
  }
}
