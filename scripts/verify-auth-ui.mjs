import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:5198'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
// No Auth or database mutations in this visual/failure-state suite.
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
let releaseSignup
const signupWait = new Promise(resolve => { releaseSignup = resolve })
await context.route('https://**/*', async route => {
  if (new URL(route.request().url()).origin === origin) return route.continue()
  if (route.request().url().includes('/auth/v1/signup')) {
    await signupWait
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'a9120000-0000-4000-8000-000000000099', aud: 'authenticated', email: 'auth-ui@example.invalid',
      identities: [{ id: 'identity' }], user_metadata: { display_name: 'Teste Cadastro' },
    }) })
  }
  return route.abort()
})
const luminance = hex => {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(x => parseInt(x, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
try {
  await page.goto(`${origin}/auth`)
  await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible()
  for (const pair of [['f0eff1','0b0515'],['b4b1b3','1a1523'],['9c96a4','1a1523'],['9c96a4','0b0515'],['241006','fe5606'],['241006','fd7e20']]) {
    assert(contrast(...pair) >= 4.5, `AA text contrast failed for ${pair}`)
  }
  await page.screenshot({ path: '.verification.local/auth-login-desktop.png' })
  await page.getByLabel('Email', { exact: true }).focus()
  assert.equal(await page.getByLabel('Email', { exact: true }).evaluate(el => getComputedStyle(el).borderColor), 'rgb(253, 126, 32)')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Mostrar senha' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('tab', { name: 'Cadastrar', exact: true }).click()
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'password')
  await expect(page.getByLabel('Cargo', { exact: true })).toHaveValue('Seller')
  await expect(page.getByLabel('Cargo', { exact: true })).toHaveAttribute('readonly')
  assert.equal(await page.getByRole('combobox').count(), 0)
  const fields = await page.locator('.auth-input').evaluateAll(inputs => inputs.map(el => ({ background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color })))
  assert.equal(fields.length, 4)
  assert(fields.every(f => f.background === 'rgb(11, 5, 21)' && f.text === 'rgb(240, 239, 241)'))
  await page.screenshot({ path: '.verification.local/auth-signup-desktop.png' })
  // Chromium's real autofill pseudoclass, not an emulated class on the input.
  const cdp = await context.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#signup-email' })
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['autofill'] })
  const autofill = await page.getByLabel('Email', { exact: true }).evaluate(el => ({ shadow: getComputedStyle(el).boxShadow, text: getComputedStyle(el).webkitTextFillColor }))
  assert(autofill.shadow.includes('rgb(11, 5, 21)') && autofill.shadow.includes('1000px'), 'Autofill must be covered by the dark inset background')
  assert.equal(autofill.text, 'rgb(240, 239, 241)')
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`)
    await expect(page.getByRole('button', { name: 'Criar conta', exact: true })).toBeVisible()
    if (width === 390) await page.screenshot({ path: '.verification.local/auth-signup-mobile.png', fullPage: true })
  }
  await page.getByLabel('Nome completo', { exact: true }).fill('Teste Cadastro')
  await page.getByLabel('Email', { exact: true }).fill('auth-ui@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('Weakpassword12')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('símbolo')
  await page.getByLabel('Senha', { exact: true }).fill('Strongpassword12!')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Criando conta…', exact: true })).toBeDisabled()
  await expect(page.locator('button[type=submit] svg.animate-spin')).toBeVisible()
  releaseSignup()
  await expect(page.getByRole('heading', { name: 'Conta criada com sucesso' })).toBeVisible()
  await expect(page.getByText('Sua solicitação foi enviada para análise.', { exact: false })).toBeVisible()
  assert.equal(new URL(page.url()).pathname, '/auth', 'Signup without session must not redirect into dashboard')
  await page.screenshot({ path: '.verification.local/auth-pending-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: desktop/mobile, dark fields and Chromium autofill, AA text contrast, keyboard navigation, fixed Seller, password toggle, validation, spinner and signup without session')
} finally { await browser.close() }
