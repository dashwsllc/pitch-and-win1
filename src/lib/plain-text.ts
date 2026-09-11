export function sanitizePlainText(value: string, maximumLength: number) {
  return Array.from(value.replace(/\r\n?/g, '\n'))
    .filter((character) => {
      const code = character.codePointAt(0)!
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159))
    })
    .join('')
    .trim()
    .slice(0, maximumLength)
}

export function validatePlainText(value: string, maximumLength: number) {
  const text = sanitizePlainText(value, Number.MAX_SAFE_INTEGER)
  if (text.length > maximumLength) {
    throw new Error(`O conteúdo excede ${maximumLength.toLocaleString('pt-BR')} caracteres. Divida-o em entradas menores.`)
  }
  return text
}

// React renders this value as a text node (never as HTML). Sanitizing again at
// the display boundary protects legacy/imported rows that predate validation.
export function safePlainText(value: string | null | undefined, maximumLength: number) {
  return sanitizePlainText(value ?? '', maximumLength)
}
