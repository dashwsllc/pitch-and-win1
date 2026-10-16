/**
 * Lê um valor digitado em reais ("500", "1.500,50", "R$ 2.997,00", "1500.5") e devolve o número com 2 casas, ou null se
 * não for um valor válido maior que zero. Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é decimal.
 */
export function lerValorEmReais(texto: string): number | null {
  let limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!limpo) return null
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.')
  else if ((limpo.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(limpo)) limpo = limpo.replace(/\./g, '')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(limpo)) return null
  const valor = Math.round(Number(limpo) * 100) / 100
  return valor > 0 ? valor : null
}

/** O valor no formato que o banco lê no JSON das ações do CRM ("1500.50"). */
export const valorParaBanco = (valor: number) => valor.toFixed(2)

/** O valor para preencher um campo de texto ("1.500,50"). */
export const valorParaCampo = (valor: number) =>
  valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
