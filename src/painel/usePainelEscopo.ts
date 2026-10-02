import { useLayoutEffect } from 'react'

/**
 * Liga os tokens da Home (src/painel/painel.css) enquanto ela está montada. A classe fica no <html> e não num
 * contêiner interno porque dica, menu, gaveta e avisos renderizam em portais, fora da página: com os tokens presos
 * a um elemento, a dica perderia a cor e a gaveta ficaria transparente. Sai ao desmontar, e as outras telas
 * voltam a ter só os tokens globais.
 */
export function usePainelEscopo() {
  useLayoutEffect(() => {
    const raiz = document.documentElement
    raiz.classList.add('painel')
    return () => raiz.classList.remove('painel')
  }, [])
}
