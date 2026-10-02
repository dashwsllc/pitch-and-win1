/** Marcas "redondas" para um eixo de contagens (inteiros), começando em zero. */
export function niceTicks(max: number, alvo = 4): number[] {
  const m = Math.max(1, max)
  const bruto = m / alvo
  const magnitude = 10 ** Math.floor(Math.log10(bruto))
  // 2,5 só a partir das dezenas: contagem não tem meio.
  const multiplos = magnitude >= 10 ? [1, 2, 2.5, 5] : [1, 2, 5]
  const passo = Math.max(1, multiplos.map((p) => p * magnitude).find((p) => p >= bruto) ?? 10 * magnitude)
  const topo = Math.ceil(m / passo) * passo
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo)
}

const numero = new Intl.NumberFormat('pt-BR')
export const formatarNumero = (n: number) => numero.format(n)

const porcento = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })
export const formatarPct = (fracao: number) => porcento.format(fracao)
