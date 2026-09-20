import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

if (!process.argv.includes('--run-disposable-check')) throw Error('Use --run-disposable-check to create and remove temporary verification accounts.')
const project = 'mbzwchnxtskysqplqiyy'
const url = `https://${project}.supabase.co`
const origin = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:5198'
const keysCommand = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project, '--output', 'json'], {
  shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 1024 * 1024,
})
if (keysCommand.status !== 0) throw Error('Could not read authorized project credentials')
const keys = JSON.parse(keysCommand.stdout)
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
const publicKey = keys.find(key => key.name === 'anon')?.api_key
assert(serviceKey && publicKey)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const executive = createClient(url, publicKey, options)
const browser = await chromium.launch({ headless: true })
const expect = baseExpect.configure({ timeout: 20000 })
const suffix = randomUUID().slice(0, 8)
const password = `Registration-${randomUUID()}!Aa1`
const createdIds = new Set()
const clients = [admin, executive]
const must = response => { if (response.error) throw Error(response.error.message); return response.data }
const errors = []
let queueEvents = 0
let checkpoint = 'setup'
const step = value => { checkpoint = value; console.log(`Checking: ${value}`) }

try {
  const actor = must(await admin.auth.admin.createUser({ email: `qa-reviewer-${suffix}@example.invalid`, password, email_confirm: true, user_metadata: { display_name: 'QA revisão de cadastro' } })).user
  createdIds.add(actor.id)
  // Bootstrap exactly this disposable reviewer, not a real user's permissions.
  must(await admin.from('registration_requests').update({ status: 'approved' }).eq('user_id', actor.id))
  must(await admin.from('user_roles').insert({ user_id: actor.id, role: 'executive' }))
  const executiveSession = must(await executive.auth.signInWithPassword({ email: actor.email, password })).session
  await executive.realtime.setAuth(executiveSession.access_token)
  const channel = executive.channel(`qa-registration-events-${suffix}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dashboard_events', filter: 'topic=eq.users' }, () => { queueEvents++ })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Realtime subscription timed out')), 15000)
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
      if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(Error('Realtime subscription rejected')) }
    })
  })
  const executiveContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await executiveContext.addInitScript(({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)), { key: `sb-${project}-auth-token`, session: executiveSession })
  const executivePage = await executiveContext.newPage()
  executivePage.on('pageerror', error => errors.push(error.message))
  await executivePage.goto(`${origin}/executive`)
  const panel = executivePage.getByRole('region', { name: /^Cadastros pendentes/ })
  await expect(panel).toBeVisible()

  for (const action of ['approve', 'reject']) {
    step(`signup → Executive queue → ${action} → collaborator`)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const name = `QA cadastro ${action} ${suffix}`
    const email = `qa-${action}-${suffix}@example.invalid`
    await page.goto(`${origin}/auth`)
    await page.getByRole('tab', { name: 'Cadastrar', exact: true }).click()
    await page.getByLabel('Nome completo', { exact: true }).fill(name)
    await page.getByLabel('Email', { exact: true }).fill(email)
    const requestedRole = action === 'approve' ? 'closer' : 'traffic_manager'
    await page.getByLabel('Cargo', { exact: true }).selectOption(requestedRole)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    const responsePromise = page.waitForResponse(response => response.url().includes('/auth/v1/signup'))
    await page.getByRole('button', { name: 'Solicitar Acesso', exact: true }).click()
    const signupResponse = await responsePromise
    const signup = await signupResponse.json()
    const newUser = signup.user ?? signup
    if (newUser.id) createdIds.add(newUser.id)
    assert.equal(signupResponse.status(), 200, `Signup returned ${signupResponse.status()}`)
    await expect(page.getByRole('heading', { name: 'Conta criada com sucesso' })).toBeVisible()
    assert.equal(new URL(page.url()).pathname, '/auth')
    const record = must(await admin.from('registration_requests').select('*').eq('user_id', newUser.id).single())
    assert.equal(record.status, 'pending')
    assert.equal(record.requested_role, requestedRole)
    const provisionedRoles = must(await admin.from('user_roles').select('role').eq('user_id', newUser.id))
    assert.deepEqual(provisionedRoles.map(item => item.role), [requestedRole])
    const token = signup.access_token
    assert(token, 'Expected a tracking session')
    const collaborator = createClient(url, publicKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } })
    clients.push(collaborator)
    assert.equal(must(await collaborator.rpc('get_my_registration_status')).status, 'pending')
    assert.equal((await collaborator.from('products').select('id').limit(1)).status, 403)
    assert.equal((await collaborator.rpc('get_sales_board')).status, 403, 'RPCs must also be blocked')
    assert.equal((await collaborator.from('registration_requests').update({ status: 'approved' }).eq('user_id', newUser.id)).status, 403)
    assert.equal((await collaborator.rpc('executive_review_registration', { p_user_id: newUser.id, p_action: 'approve' })).status, 403)

    // An already-open Executive panel must update without navigating/reloading.
    const request = panel.getByRole('article', { name: `Cadastro de ${name}`, exact: true })
    await expect(request).toBeVisible()
    await expect.poll(() => queueEvents).toBeGreaterThan(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Seu cadastro está em análise' })).toBeVisible()
    await page.goto(`${origin}/crm`)
    await expect(page).toHaveURL(`${origin}/auth`)
    await expect(page.getByRole('heading', { name: 'Seu cadastro está em análise' })).toBeVisible()
    await request.getByRole('button', { name: action === 'approve' ? 'Aprovar' : 'Rejeitar', exact: true }).click()
    await expect(request).toHaveCount(0)
    const expectedStatus = action === 'approve' ? 'approved' : 'rejected'
    await expect.poll(async () => must(await collaborator.rpc('get_my_registration_status')).status).toBe(expectedStatus)
    if (action === 'approve') {
      await expect(page).toHaveURL(`${origin}/`)
      assert.equal((await collaborator.from('products').select('id').limit(1)).status, 200)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toHaveCount(0)
    } else {
      await expect(page.getByRole('heading', { name: 'Cadastro não aprovado' })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Cadastro não aprovado' })).toBeVisible()
      assert.equal((await collaborator.rpc('get_sales_board')).status, 403)
    }
    assert.equal((await executive.rpc('executive_review_registration', { p_user_id: newUser.id, p_action: 'approve' })).status, 409, 'A repeated/stale decision must not overwrite the first decision')
    const audit = must(await admin.from('executive_audit_events').select('id').eq('target_id', newUser.id).eq('action', `registration.${action}`))
    assert.equal(audit.length, 1)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real browser signup, atomic pending request, live Executive queue, manual approval/rejection, collaborator sync after reload, route/API protection, stale decisions and audit')
} catch (error) {
  console.error(`Failed at: ${checkpoint}`)
  throw error
} finally {
  await browser.close()
  for (const client of clients) await client.removeAllChannels()
  const ids = [...createdIds]
  if (ids.length) {
    must(await admin.from('executive_audit_events').delete().in('target_id', ids))
    must(await admin.from('user_roles').delete().in('user_id', ids))
    for (const id of ids) must(await admin.auth.admin.deleteUser(id))
  }
  console.log(`Removed ${ids.length} disposable verification accounts and their test audit entries.`)
}
