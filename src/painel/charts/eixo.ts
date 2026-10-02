/**
 * Quais intervalos ganham rótulo no eixo X, sem colisão: espaçados pela largura útil (no mínimo `espaco` px entre
 * vizinhos), sempre com o primeiro e o último. Se o último cair colado no penúltimo, ele toma o lugar do penúltimo.
 */
export function indicesDosRotulos(n: number, larguraUtil: number, espaco = 44): number[] {
  if (n <= 0) return []
  const cada = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(larguraUtil / espaco))))
  const indices: number[] = []
  for (let i = 0; i < n; i += cada) indices.push(i)
  const ultimo = indices[indices.length - 1]
  if (ultimo !== n - 1) {
    if (n - 1 - ultimo < cada * 0.6 && indices.length > 1) indices[indices.length - 1] = n - 1
    else indices.push(n - 1)
  }
  return indices
}
