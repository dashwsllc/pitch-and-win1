// Deixa o Node puro (24+, que tira os tipos) importar módulos de src/ como o Vite os escreve: com o alias "@/" e
// com importações relativas sem extensão. Usado pelos verify-painel-*.mjs; não muda nada no app.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const tentar = (base) => ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find((f) => existsSync(f)) ?? null

export function instalarResolvedor(raiz) {
  registerHooks({
    resolve(specifier, contexto, proximo) {
      if (specifier.startsWith('@/')) {
        const f = tentar(path.join(raiz, 'src', specifier.slice(2)))
        if (f) return proximo(pathToFileURL(f).href, contexto)
      }
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && contexto.parentURL?.startsWith('file:')) {
        const f = tentar(path.resolve(path.dirname(fileURLToPath(contexto.parentURL)), specifier))
        if (f) return proximo(pathToFileURL(f).href, contexto)
      }
      return proximo(specifier, contexto)
    },
  })
}
