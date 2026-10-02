/** Iniciais do nome ("Maria Eduarda Silva" → "MS"); vazio vira "?". */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => /\p{L}/u.test(p))
  if (partes.length === 0) return '?'
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}
