import { metaAnswers } from './meta-leads'

/** Últimos 8 dígitos do telefone: a mesma chave que o banco usa para ligar formulário, site e lead. */
export const phoneTail = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-8)

/** Telefone que o atleta informou no formulário, lido do texto gravado no Contexto ("Telefone\n→ +5511…"). */
export function formPhoneFromContext(content: string | null | undefined) {
  const match = /^Telefone\n→ (.+)$/m.exec(content ?? '')
  return match ? match[1].trim() : null
}

/** Telefone do formulário a partir das respostas cruas (field_data). */
export function formPhoneFromFields(fields: unknown) {
  const found = metaAnswers(fields).find(answer => answer.label.toLowerCase() === 'phone_number' && answer.value.trim())
  return found ? found.value.trim() : null
}

/** Verdadeiro só quando os dois números existem e terminam diferente (formatos diferentes do mesmo número não contam). */
export function phonesDiffer(a: unknown, b: unknown) {
  const x = phoneTail(a), y = phoneTail(b)
  return x.length >= 8 && y.length >= 8 && x !== y
}
