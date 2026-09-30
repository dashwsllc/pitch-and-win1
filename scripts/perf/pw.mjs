// Single import point for Playwright. It is installed with the repo's other UI checks
// (.verification.local/node_modules), so nothing new has to be installed for these tools.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(projectRoot, '.verification.local', 'package.json'))
export const { chromium } = require('playwright')
