// Contrato de interface do CRM: (1) o rótulo de um resultado diz o que ele é (lead perdido nunca aparece como "Venda
// recusada") e (2) cadastrar um lead com WhatsApp ou e-mail que outro lead já tem avisa antes de criar o segundo registro
// da mesma pessoa. Navegador real, tráfego do Supabase FALSO (nada toca em produção). Serve o build com o .env real em
// CRM_TEST_ORIGIN (como os outros verify-crm-*-ui) e roda de uma pasta de rascunho, porque grava capturas de tela.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { brasiliaDateKey, brasiliaLocalToDate } from '../src/lib/brasilia-time.ts'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = process.env.CRM_TEST_ORIGIN || 'http://127.0.0.1:5198'
if (!['127.0.0.1', 'localhost', 'wsltda.com', 'www.wsltda.com'].includes(new URL(origin).hostname)) throw Error('Unexpected frontend test origin')
const actor = randomUUID(), closer = randomUUID(), sdr = randomUUID()
const project = 'mbzwchnxtskysqplqiyy'
const now = new Date().toISOString(), today = brasiliaDateKey()
const at = (day, hour = '14:00:00') => brasiliaLocalToDate(day, hour).toISOString()
const profile = { id: actor, user_id: actor, display_name: 'Gestor QA', suspended: false, avatar_url: null, created_at: now, updated_at: now }
const lead = (name, extra = {}) => ({ id: randomUUID(), name, athlete_name: `Atleta ${name}`, phone: '11900000000', email: null,
  pipeline_stage: 'novo', approach_stage: 'nao_abordado', temperature: 'morno', sdr_id: sdr, closer_id: null, created_by: actor,
  created_at: now, updated_at: now, next_followup_at: null, version: 1, followup_status: null, followup_next_at: null,
  followup_attempt_count: 0, ...extra })
const leads = [
  lead('Maria Responsável', { phone: '(11) 99879-2426', email: 'maria@exemplo.com', pipeline_stage: 'em_qualificacao' }),
  lead('Joana Responsável', { phone: '61992322770', pipeline_stage: 'repassado_closer', closer_id: closer }),
  lead('Perdido pelo SDR', { phone: '11911111111', pipeline_stage: 'lead_perdido', last_result_outcome: 'lead_perdido', last_result_at: at(today), closed_at: at(today),
    last_result_closer_name: null, negative_reason: 'Não respondeu', followup_status: 'do_not_contact' }),
  lead('Recusado pelo Closer', { phone: '11922222222', pipeline_stage: 'fechado_perdido', closer_id: closer, last_result_outcome: 'venda_perdida', last_result_at: at(today),
    closed_at: at(today), last_result_closer_id: closer, last_result_closer_name: 'Maria Closer', negative_reason: 'Sem orçamento', followup_status: 'do_not_contact' }),
]
const requests = [], errors = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin === origin) return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.abort()
  const resource = url.pathname.split('/').at(-1)
  const method = route.request().method()
  const payload = route.request().postDataJSON() ?? {}
  let data = []
  if (resource === 'get_my_registration_status') data = { status: 'approved' }
  else if (resource === 'profiles') data = url.searchParams.has('user_id') ? profile : [profile]
  else if (resource === 'user_roles') data = [{ id: actor, user_id: actor, role: 'executive', crm_access: true, commission_rate: 10 }]
  else if (resource === 'crm_leads' && method === 'POST') {
    requests.push({ resource: 'insert', payload })
    data = { ...lead(payload.name), ...payload, id: randomUUID() }
    leads.push(data)
  } else if (resource === 'crm_leads') data = leads
  else if (resource === 'crm_call_assignees') data = [
    { user_id: actor, display_name: 'Gestor QA', role: 'executive' },
    { user_id: closer, display_name: 'Maria Closer', role: 'closer' },
    { user_id: sdr, display_name: 'João SDR', role: 'sdr' },
  ]
  else if (resource === 'get_sales_board') data = { items: [], total: 0, summary: { pending: 0, approved: 0, rejected: 0 }, fetched_at: now }
  else if (resource === 'crm_transition') {
    requests.push({ resource, payload })
    data = leads.find(l => l.id === payload.p_lead_id)
    Object.assign(data, payload.p_data, { version: data.version + 1 })
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.addInitScript(({ actor, project }) => {
  const enc = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${enc({alg:'HS256'})}.${enc({sub:actor,role:'authenticated',exp:4102444800})}.qa`, refresh_token: 'qa', expires_at: 4102444800,
    user: { id: actor, email: 'integrity@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { display_name: 'Gestor QA' }, created_at: new Date().toISOString() } }))
}, { actor, project })
const page = await context.newPage()
page.on('pageerror', e => errors.push(e.message))
const inserts = () => requests.filter(r => r.resource === 'insert')
try {
  // ---- (1) O resultado escrito certo: lead perdido não é venda recusada.
  await page.goto(`${origin}/crm?tab=results`)
  const results = page.getByRole('region', { name: 'Resultados comerciais' })
  await expect(results.getByRole('article')).toHaveCount(2)
  const perdido = results.getByRole('article', { name: 'Resultado de Perdido pelo SDR', exact: true })
  const recusado = results.getByRole('article', { name: 'Resultado de Recusado pelo Closer', exact: true })
  await expect(perdido).toContainText('Lead perdido')
  await expect(perdido).not.toContainText('Venda recusada')
  await expect(recusado).toContainText('Venda recusada')
  await expect(recusado).not.toContainText('Lead perdido')
  // O filtro "não concluídas" cobre as duas e diz isso.
  await results.getByLabel('Resultado', { exact: true }).selectOption('lost')
  await expect(results.getByRole('article')).toHaveCount(2)
  await expect(results.getByLabel('Resultado', { exact: true }).locator('option[value="lost"]')).toHaveText('Venda recusada ou lead perdido')

  // ---- (2) Lead duplicado: avisa antes de criar, e só cria depois da confirmação.
  await page.goto(`${origin}/crm`)
  await expect(page.getByRole('article', { name: 'Lead Atleta Maria Responsável' })).toBeVisible()
  await page.getByRole('button', { name: 'Novo Lead' }).click()
  let dialog = page.getByRole('dialog', { name: 'Novo Lead' })
  await dialog.getByLabel('Nome do responsável *').fill('Maria de Novo')
  await dialog.getByLabel('Nome do atleta *').fill('Outro Atleta')
  await dialog.getByLabel('WhatsApp *').fill('+55 11 99879-2426') // o mesmo número da Maria, escrito de outro jeito
  await dialog.getByRole('button', { name: 'Criar Lead' }).click()
  const aviso = dialog.getByRole('alert', { name: 'Lead possivelmente duplicado' })
  await expect(aviso).toBeVisible()
  await expect(aviso).toContainText('Já existe um lead com este WhatsApp ou e-mail')
  await expect(aviso).toContainText('Atleta Maria Responsável')
  await expect(aviso).toContainText('Em qualificação')
  assert.equal(inserts().length, 0, 'nada foi criado antes da confirmação')
  // Corrigir o número some com o aviso e deixa criar sem confirmação extra.
  await dialog.getByLabel('WhatsApp *').fill('11977777777')
  await expect(aviso).toHaveCount(0)
  await dialog.getByLabel('WhatsApp *').fill('(11) 99879-2426')
  await dialog.getByRole('button', { name: 'Criar Lead' }).click()
  await expect(aviso).toBeVisible()
  await aviso.getByRole('button', { name: 'Revisar os dados' }).click()
  await expect(aviso).toHaveCount(0)
  assert.equal(inserts().length, 0)
  await dialog.getByRole('button', { name: 'Criar Lead' }).click()
  await expect(aviso).toBeVisible()
  await aviso.getByRole('button', { name: 'Salvar mesmo assim' }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(inserts().length, 1, 'confirmado: criou um lead')
  assert.equal(inserts()[0].payload.phone, '(11) 99879-2426')

  // O e-mail também conta (sem diferenciar maiúsculas).
  await page.getByRole('button', { name: 'Novo Lead' }).click()
  dialog = page.getByRole('dialog', { name: 'Novo Lead' })
  await dialog.getByLabel('Nome do responsável *').fill('Outra Mãe')
  await dialog.getByLabel('Nome do atleta *').fill('Atleta Dois')
  await dialog.getByLabel('WhatsApp *').fill('11955555555')
  await dialog.getByLabel('E-mail (opcional)').fill('MARIA@exemplo.com')
  await dialog.getByRole('button', { name: 'Criar Lead' }).click()
  await expect(dialog.getByRole('alert', { name: 'Lead possivelmente duplicado' })).toBeVisible()
  assert.equal(inserts().length, 1, 'o e-mail repetido também espera a confirmação')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)

  // Número novo: cria direto, sem aviso.
  await page.getByRole('button', { name: 'Novo Lead' }).click()
  dialog = page.getByRole('dialog', { name: 'Novo Lead' })
  await dialog.getByLabel('Nome do responsável *').fill('Pessoa Nova')
  await dialog.getByLabel('Nome do atleta *').fill('Atleta Novo')
  await dialog.getByLabel('WhatsApp *').fill('11966666666')
  await dialog.getByRole('button', { name: 'Criar Lead' }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(inserts().length, 2)

  // Editar sem mexer no WhatsApp ou no e-mail nunca avisa (um lead que já nasceu duplicado continua editável).
  const duplicado = leads.find(l => l.name === 'Maria de Novo')
  assert.ok(duplicado, 'o lead duplicado confirmado existe')
  await page.getByRole('article', { name: 'Lead Outro Atleta' }).getByRole('button', { name: 'Editar' }).click()
  dialog = page.getByRole('dialog', { name: 'Editar lead' })
  await dialog.getByLabel('Cidade / UF').fill('Goiânia / GO')
  await dialog.getByRole('button', { name: 'Salvar cadastro' }).click()
  await expect(dialog).toHaveCount(0)
  assert.equal(requests.filter(r => r.resource === 'crm_transition').length, 1, 'a edição foi direto, sem aviso')
  assert.deepEqual(errors, [])
  console.log('PASS: lead perdido e venda recusada têm rótulos próprios; lead duplicado por WhatsApp (em qualquer formato) ou e-mail avisa antes de criar, só cria com confirmação, e editar sem mudar o contato nunca avisa. Tráfego do navegador falso; nenhum dado real tocado.')
} finally { await browser.close() }
