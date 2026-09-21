import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:5198'
const browser = await chromium.launch({ headless: true })
const user = {
  id: 'a9120000-0000-4000-8000-000000000099',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'recovery@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

async function isolatedPage() {
  const context = await browser.newContext()
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, errors }
}

try {
  const request = await isolatedPage()
  let responseStatus = 500
  let recoverCalls = 0
  await request.context.route('https://**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/v1/recover') {
      recoverCalls++
      return route.fulfill({
        status: responseStatus,
        contentType: 'application/json',
        body: responseStatus === 200 ? '{}' : JSON.stringify({ code: 'unexpected_failure', message: 'Email delivery failed' }),
      })
    }
    return route.abort()
  })
  await request.page.goto(`${origin}/reset-password`)
  await request.page.getByLabel('Email').fill(user.email)
  await request.page.getByRole('button', { name: 'Enviar Link de Recuperação' }).click()
  await expect(request.page.getByRole('alert')).toContainText('Não foi possível enviar o link agora')
  await expect(request.page.getByText('Se o email estiver cadastrado')).toHaveCount(0)
  responseStatus = 200
  await request.page.getByRole('button', { name: 'Enviar Link de Recuperação' }).click()
  await expect(request.page.getByText('Se o email estiver cadastrado')).toBeVisible()
  assert.equal(recoverCalls, 2)
  assert.deepEqual(request.errors, [])
  await request.context.close()

  const recovery = await isolatedPage()
  let updatedPassword = false
  let signedOut = false
  await recovery.context.route('https://**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/v1/user') {
      if (route.request().method() === 'PUT') {
        updatedPassword = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    }
    if (url.pathname === '/auth/v1/logout') {
      signedOut = true
      return route.fulfill({ status: 204, body: '' })
    }
    return route.abort()
  })
  await recovery.page.goto(`${origin}/reset-password#access_token=recovery-token&refresh_token=recovery-refresh&expires_in=3600&token_type=bearer&type=recovery`)
  await expect(recovery.page.getByRole('heading', { name: 'Nova Senha' })).toBeVisible()
  await recovery.page.getByLabel('Nova Senha', { exact: true }).fill('NovaSenha!2026')
  await recovery.page.getByLabel('Confirmar Nova Senha').fill('NovaSenha!2026')
  await recovery.page.getByRole('button', { name: 'Redefinir Senha' }).click()
  await expect(recovery.page).toHaveURL(`${origin}/auth`)
  await expect(recovery.page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible()
  assert(updatedPassword, 'The new password was not submitted')
  assert(signedOut, 'The recovery session was not closed')
  assert.deepEqual(recovery.errors, [])
  await recovery.context.close()

  const invalid = await isolatedPage()
  await invalid.context.route('https://**/*', route => route.abort())
  await invalid.page.goto(`${origin}/reset-password#error=access_denied&error_description=expired`)
  await expect(invalid.page.getByRole('alert')).toContainText('inválido ou expirou')
  await expect(invalid.page.getByRole('button', { name: 'Solicitar novo link' })).toBeVisible()
  assert.deepEqual(invalid.errors, [])
  await invalid.context.close()

  console.log('PASS: failed send, successful request, cross-tab recovery link, password update, sign-out and expired link')
} finally {
  await browser.close()
}
