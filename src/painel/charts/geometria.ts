// Geometria dos gráficos em SVG: curva suave que não "ultrapassa" os dados e encaixe do ponteiro.

export type Ponto = [number, number]
/** Um trecho cúbico da curva: início, dois pontos de controle e fim. */
type Trecho = [Ponto, Ponto, Ponto, Ponto]

const r = (n: number) => Math.round(n * 100) / 100

/**
 * Curva cúbica monotônica (Fritsch–Carlson): suave, mas sem criar picos ou vales que não existem nos dados.
 * Os x precisam ser crescentes.
 */
export function caminhoSuave(pontos: Ponto[]): string {
  if (pontos.length === 0) return ''
  const [x0, y0] = pontos[0]
  if (pontos.length === 1) return `M${r(x0)},${r(y0)}`
  let d = `M${r(x0)},${r(y0)}`
  for (const [, c1, c2, [xb, yb]] of trechosSuaves(pontos)) d += ` C${r(c1[0])},${r(c1[1])} ${r(c2[0])},${r(c2[1])} ${r(xb)},${r(yb)}`
  return d
}

/**
 * A mesma curva de caminhoSuave, só até o x `limite` (a ponta de uma linha que está sendo desenhada da esquerda para a
 * direita). Os controles de cada trecho ficam a 1/3 e 2/3 do intervalo em x, então x cresce linearmente com o parâmetro
 * do trecho: o corte em `limite` é exato, sem esticar a curva.
 */
export function caminhoAte(pontos: Ponto[], limite: number): string {
  if (pontos.length === 0) return ''
  const [x0, y0] = pontos[0]
  let d = `M${r(x0)},${r(y0)}`
  if (pontos.length === 1 || limite <= x0) return d
  for (const [p0, c1, c2, p1] of trechosSuaves(pontos)) {
    if (p1[0] <= limite) {
      d += ` C${r(c1[0])},${r(c1[1])} ${r(c2[0])},${r(c2[1])} ${r(p1[0])},${r(p1[1])}`
      continue
    }
    // De Casteljau: a primeira parte do trecho, do início até o parâmetro t.
    const t = (limite - p0[0]) / (p1[0] - p0[0])
    const meio = (a: Ponto, b: Ponto): Ponto => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const a = meio(p0, c1)
    const b = meio(c1, c2)
    const c = meio(c2, p1)
    const ab = meio(a, b)
    const bc = meio(b, c)
    const fim = meio(ab, bc)
    d += ` C${r(a[0])},${r(a[1])} ${r(ab[0])},${r(ab[1])} ${r(fim[0])},${r(fim[1])}`
    break
  }
  return d
}

function trechosSuaves(pontos: Ponto[]): Trecho[] {
  const n = pontos.length
  const dx: number[] = []
  const inclinacao: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pontos[i + 1][0] - pontos[i][0])
    inclinacao.push((pontos[i + 1][1] - pontos[i][1]) / dx[i])
  }

  const tangente: number[] = [inclinacao[0]]
  for (let i = 1; i < n - 1; i++) {
    tangente.push(inclinacao[i - 1] * inclinacao[i] <= 0 ? 0 : (inclinacao[i - 1] + inclinacao[i]) / 2)
  }
  tangente.push(inclinacao[n - 2])

  for (let i = 0; i < n - 1; i++) {
    if (inclinacao[i] === 0) {
      tangente[i] = 0
      tangente[i + 1] = 0
      continue
    }
    const a = tangente[i] / inclinacao[i]
    const b = tangente[i + 1] / inclinacao[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      tangente[i] = t * a * inclinacao[i]
      tangente[i + 1] = t * b * inclinacao[i]
    }
  }

  const trechos: Trecho[] = []
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = pontos[i]
    const [xb, yb] = pontos[i + 1]
    const c1: Ponto = [xa + dx[i] / 3, ya + (tangente[i] * dx[i]) / 3]
    const c2: Ponto = [xb - dx[i] / 3, yb - (tangente[i + 1] * dx[i]) / 3]
    trechos.push([pontos[i], c1, c2, pontos[i + 1]])
  }
  return trechos
}

/** Índice do ponto mais próximo do ponteiro, com `n` pontos distribuídos de 0 a `largura`. */
export function indiceMaisProximo(x: number, n: number, largura: number): number {
  if (n <= 1) return 0
  const passo = largura / (n - 1)
  return Math.min(n - 1, Math.max(0, Math.round(x / passo)))
}
