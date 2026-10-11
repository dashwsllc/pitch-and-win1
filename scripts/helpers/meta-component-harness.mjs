import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url), root = resolve('src')
export function createComponentLoader(overrides = {}) {
const cache = new Map()
function loadComponent(filename) {
  let path = resolve(filename)
  if (!existsSync(path)) path = ['.ts', '.tsx'].map(ext => path + ext).find(existsSync) ?? path
  if (cache.has(path)) return cache.get(path).exports
  const module = { exports: {} }; cache.set(path, module)
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const dependency = spec => overrides[spec] || (spec.startsWith('@/') ? loadComponent(resolve(root, spec.slice(2))) : spec.startsWith('.') ? loadComponent(resolve(dirname(path), spec)) : require(spec))
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: path })(dependency, module, module.exports)
  return module.exports
}
return loadComponent
}
export const loadComponent = createComponentLoader()
