/**
 * Mira sincronizada entre os gráficos que dividem a mesma linha do tempo (as chaves dos intervalos): o gráfico que o
 * ponteiro ou o teclado aponta é a "origem" e mostra a dica; os outros só acendem o mesmo intervalo.
 */
export interface Foco {
  /** Chave do intervalo apontado ('yyyy-MM-dd HH' por hora; o rótulo do dia, mês ou ano nos períodos longos). */
  chave: string
  /** Quem apontou: só ele mostra a dica e só ele apaga o foco ao sair. */
  origem: string
}

/** O gráfico `origem` aponta o intervalo `chave`. O mesmo ponto devolve o mesmo objeto (nada para redesenhar). */
export function apontar(atual: Foco | null, chave: string, origem: string): Foco {
  return atual && atual.chave === chave && atual.origem === origem ? atual : { chave, origem }
}

/** O gráfico `origem` saiu: apaga o foco só se ainda for dele (o ponteiro pode já estar em outro gráfico). */
export function soltar(atual: Foco | null, origem: string): Foco | null {
  return atual?.origem === origem ? null : atual
}

/** O índice do intervalo em foco na linha do tempo de um gráfico, ou null se ele não estiver nela. */
export function indiceNoGrafico(atual: Foco | null, chaves: string[]): number | null {
  if (!atual) return null
  const i = chaves.indexOf(atual.chave)
  return i < 0 ? null : i
}
