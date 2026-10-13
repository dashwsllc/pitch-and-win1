import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'supabase/functions')

// Run the deployed handlers and shared modules. Only network/database boundaries
// are substituted; no API credentials, server sockets or persistent fixtures.
export async function loadHandler(path, { fetch, admin, extraEnv = {}, clock = Date }) {
  let handler
  const env = { META_SYNC_CRON_SECRET: 'test-cron', META_SYSTEM_USER_TOKEN: 'test-token',
    META_PAGE_IDS: 'page1', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', ...extraEnv }
  const context = vm.createContext({ URL, Request, Response, TextEncoder, TextDecoder, crypto, fetch, AbortController, AbortSignal, setTimeout, clearTimeout, Date: clock,
    console: { error() {}, log() {} },
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value } },
    __admin: admin })
  const cache = new Map()
  function moduleFor(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = filename.startsWith('https:')
      ? 'export function createClient() { return globalThis.__admin }'
      : ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      } }).outputText
    const module = new vm.SourceTextModule(source, { context, identifier: filename })
    cache.set(filename, module)
    return module
  }
  const module = moduleFor(resolve(root, path))
  await module.link((specifier, parent) => moduleFor(specifier.startsWith('https:')
    ? specifier : resolve(dirname(parent.identifier), specifier)))
  await module.evaluate()
  return { handler, exports: module.namespace }
}
