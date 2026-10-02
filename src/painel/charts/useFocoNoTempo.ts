import { useCallback, useContext, useState } from 'react'
import { ContextoDoFoco } from './contextoDoFoco'
import { apontar, indiceNoGrafico, soltar, type Foco } from './foco'

/**
 * O intervalo ativo de um gráfico: o que ele mesmo aponta ou o que outro gráfico da mesma linha do tempo aponta.
 * `origem` diz se a dica é dele. Fora de um FocoNoTempo, cada gráfico guarda o próprio foco.
 */
export function useFocoNoTempo(id: string, chaves: string[]) {
  const compartilhado = useContext(ContextoDoFoco)
  const [local, setLocal] = useState<Foco | null>(null)
  const foco = compartilhado ? compartilhado.foco : local
  const mudar = compartilhado ? compartilhado.mudar : setLocal
  const ativo = indiceNoGrafico(foco, chaves)

  const focar = useCallback(
    (indice: number | null) => {
      if (indice === null) mudar((atual) => soltar(atual, id))
      else if (chaves[indice] !== undefined) mudar((atual) => apontar(atual, chaves[indice], id))
    },
    [chaves, id, mudar],
  )

  // Foco do teclado: começa no intervalo mais recente, a menos que a mira já seja deste gráfico (o ponteiro sobre ele).
  // Lê o foco na hora da atualização, nunca o da última pintura (a saída de outro gráfico pode ainda não ter sido pintada).
  const entrar = useCallback(() => {
    if (chaves.length) mudar((atual) => (atual?.origem === id ? atual : apontar(atual, chaves[chaves.length - 1], id)))
  }, [chaves, id, mudar])

  return { ativo, origem: ativo !== null && foco?.origem === id, focar, entrar }
}
