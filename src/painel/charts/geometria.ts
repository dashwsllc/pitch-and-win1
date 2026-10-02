// Geometria dos gráficos em SVG: curva suave que não "ultrapassa" os dados e encaixe do ponteiro.

type Ponto = [number, number]

const r = (n: number) => Math.round(n * 100) / 100

/**
 * Curva cúbica monotônica (Fritsch–Carlson): suave, mas sem criar picos ou vales que não existem nos dados.
 * Os x precisam ser crescentes.
 */
export function caminhoSuave(pontos: Ponto[]): string {
  if (pontos.length === 0) return ''
  const [x0, y0] = pontos[0]
  if (pontos.length === 1) return `M${r(x0)},${r(y0)}`

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

  let d = `M${r(x0)},${r(y0)}`
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = pontos[i]
    const [xb, yb] = pontos[i + 1]
    const c1: Ponto = [xa + dx[i] / 3, ya + (tangente[i] * dx[i]) / 3]
    const c2: Ponto = [xb - dx[i] / 3, yb - (tangente[i + 1] * dx[i]) / 3]
    d += ` C${r(c1[0])},${r(c1[1])} ${r(c2[0])},${r(c2[1])} ${r(xb)},${r(yb)}`
  }
  return d
}

/** Índice do ponto mais próximo do ponteiro, com `n` pontos distribuídos de 0 a `largura`. */
export function indiceMaisProximo(x: number, n: number, largura: number): number {
  if (n <= 1) return 0
  const passo = largura / (n - 1)
  return Math.min(n - 1, Math.max(0, Math.round(x / passo)))
}
