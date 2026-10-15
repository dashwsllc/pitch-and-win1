// Ficha real do CRM (SDR e Closer) para lead do SITE e lead criado a mao com as respostas do formulario Meta ligadas.
// Apenas a fronteira HTTP e sintetica; nenhuma escrita no CRM.
import assert from 'node:assert/strict'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'
import { buildFixtures, fakeSession, USER_ID } from './perf/mock.mjs'
const expect = baseExpect.configure({ timeout: 20000 }), origin = process.env.TRAFFIC_TEST_ORIGIN
assert(origin && new URL(origin).hostname === '127.0.0.1')
const reviewerId = 'ce120000-0000-4000-8000-000000000098', errors = [], writes = []
const LONG = 'Só a condição física sou muito magro. ' + 'Texto longo preservado. '.repeat(60) + 'FIM'
const answers = [
  ['Quem está preenchendo este formulário?', 'Sou o atleta'], ['Atualmente, o atleta está vinculado a algum clube?', 'Não'],
  ['O atleta já participou de avaliações ou peneiras em clubes?', 'Sim'], ['O atleta já recebeu alguma oportunidade relevante de um clube?', 'Sim, convite ou proposta'],
  ['Qual é o principal objetivo do atleta no futebol hoje?', 'Tornar-se jogador profissional'], ['O que mais está impedindo o atleta de chegar onde deseja hoje?', 'Falta de oportunidades'],
  ['Qual é a posição e a categoria atual do atleta?', 'Eu jogo mais na quadra então sou ala'], ['Quais são os principais clubes que o atleta já representou?', 'nenhum mn'],
  ['Quais clubes avaliou e qual foi o resultado?', 'Esse mlk e muito craque Zé, até me deram um apelido "franginha*"'],
  ['Quais são as 3 principais características do atleta como jogador e o que ele mais precisa melhorar?', LONG],
  ['De 0 a 10, quanto o atleta está comprometido em buscar seu objetivo no futebol? Escala de 0 a 10', 'Acho que us 8/10'],
]
const text = ['Respostas do formulário Meta · FORMULÁRIO ZYRON', 'Campanha: FORMULARIO ZYRON TST 04', 'Preenchido em: 09/10/2026 13:09:32 (Brasília)',
  'Ligado ao envio do site de 09/10/2026 13:10:33 (Brasília) — mesmo anúncio, nome completo igual, 61 s depois do formulário', '',
  ...answers.map(([q, a]) => `${q}\n→ ${a}`).join('\n\n').split('\n'), '', 'Nome completo\n→ João Pedro de Andrade Santana', '', 'Telefone\n→ +5511948173104'].join('\n')
const HINT = 'Quente: compromisso 10/10; objetivo: “Tornar-se jogador profissional”; impedimento: “Falta de oportunidades”; sinais de movimento: já participou de avaliações ou peneiras, já recebeu convite ou proposta.'
const siteSnapshot = { entry_channel: 'website', created_time: '2026-10-09T16:10:33Z', import_contact: { time_known: true, source_has_date: true },
  source_snapshot: { site_event: { payload: { contact: { name: 'Joao Pedro de Andrade Santana', email: 'qa@example.invalid', phone: '11918173104' },
    attribution: { utm_campaign: 'FORMULARIO ZYRON TST 04|1', utm_content: 'JOGADOR JA PERDI AS CONTAS|120246608254160088' } } } } }
const base = { temperature: 'frio', pipeline_stage: 'repassado_closer', approach_stage: 'abordado', tags: [], version: 1, approached: true, sdr_id: USER_ID, closer_id: USER_ID,
  created_at: '2026-10-13T21:49:00Z', updated_at: '2026-10-13T21:49:00Z', email: 'qa@example.invalid' }
const cases = [
  { name: 'site', lead: { ...base, id: 'ce120000-0000-4000-8000-0000000000a1', name: 'Joao Pedro de Andrade Santana', phone: '11918173104', lead_source: 'meta_ads_form',
    meta_form_lead_id: 'ce130000-0000-4000-8000-0000000000a1', import_channel: 'website', import_method: 'automatic', lead_received_at: '2026-10-13T21:46:38Z', lead_generated_at: '2026-10-09T16:10:33Z' }, snapshot: siteSnapshot },
  { name: 'manual', lead: { ...base, id: 'ce120000-0000-4000-8000-0000000000a2', name: 'Atleta Criado Pelo SDR', phone: '11900000000', lead_source: null }, snapshot: undefined },
  { name: 'manual-igual', lead: { ...base, id: 'ce120000-0000-4000-8000-0000000000a3', name: 'Atleta Mesmo Numero', phone: '(11) 94817-3104', lead_source: null }, snapshot: undefined },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const role of ['sdr', 'closer']) for (const c of cases) {
    const { lead } = c, id = lead.id, fixture = buildFixtures({ sales: 0, approaches: 0, role })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' })
    await context.routeWebSocket(/supabase\.co/, socket => socket.close())
    await context.route('https://**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (!url.hostname.endsWith('.supabase.co')) return route.abort()
      const name = url.pathname.split('/').at(-1); let data = []
      if (['crm_leads', 'crm_lead_contexts', 'meta_form_leads'].includes(name) && request.method() !== 'GET') writes.push(name)
      if (name === 'profiles') data = { user_id: USER_ID, display_name: role + ' QA', suspended: false }
      else if (name === 'user_roles') data = [{ user_id: USER_ID, role, crm_access: true, crm_closer_access: role === 'closer' }]
      else if (name === 'get_my_registration_status') data = { status: 'approved' }
      else if (name === 'dashboard_events') data = [{ topic: 'crm', revision: 1 }]
      else if (name === 'crm_context_summary') data = [{ lead_id: id }]
      else if (name === 'crm_lead_temperature_hint') data = [{ temperature: 'quente', reasons: HINT, applied: c.name === 'site' }]
      else if (name === 'crm_call_assignees') data = [{ user_id: USER_ID, display_name: role + ' QA', role }]
      else if (name === 'crm_leads') data = url.searchParams.get('select') === 'id,import_snapshot' ? { id, import_snapshot: c.snapshot } : [lead]
      else if (name === 'crm_lead_contexts') data = url.searchParams.get('select') === 'lead_id' ? [{ lead_id: id }]
        : [{ id: 'qa-answers', lead_id: id, author_id: reviewerId, author_name: 'Tráfego QA', author_role: 'trafego', context_type: 'meta_form', created_at: '2026-10-14T23:30:00Z', content: text, file_name: null }]
      else if (fixture.rpc[name]) data = fixture.rpc[name](request.postDataJSON() ?? {})
      else if (name.startsWith('get_')) data = 0
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await context.addInitScript(s => localStorage.setItem('sb-mbzwchnxtskysqplqiyy-auth-token', JSON.stringify(s)), fakeSession())
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
    await page.goto(origin + `/crm?tab=${role === 'closer' ? 'closer' : c.name === 'site' ? 'importacoes' : 'leads'}&lead=${id}`)
    const panel = page.getByRole('region', { name: 'Contexto para o contato' })
    const section = panel.getByRole('region', { name: 'Respostas do formulário Meta' })
    await expect(section.getByRole('heading', { name: 'Respostas do formulário Meta', exact: true })).toBeVisible()
    for (const [question, answer] of answers.slice(0, 9).concat([answers[10]])) {
      await expect(section.getByText(question + '\n→ ' + answer, { exact: false })).toBeVisible()
    }
    await expect(section).toContainText(LONG)
    await expect(section).toContainText('Ligado ao envio do site de 09/10/2026 13:10:33')
    await expect(section).toContainText('Telefone\n→ +5511948173104')
    // O rodapé não atribui a uma pessoa o que o sistema anexou sozinho.
    await expect(section).toContainText('anexado automaticamente do formulário Meta em'); await expect(section).not.toContainText('registrado por')
    // WhatsApp do lead diferente do telefone do formulário: aviso com os dois números; mesmo número em outro formato: sem aviso.
    const phoneWarning = panel.getByRole('alert', { name: 'WhatsApp diferente do formulário' })
    if (c.name === 'manual-igual') await expect(phoneWarning).toHaveCount(0)
    else { await expect(phoneWarning).toBeVisible(); await expect(phoneWarning).toContainText('Confira o WhatsApp antes de ligar'); await expect(phoneWarning).toContainText(lead.phone); await expect(phoneWarning).toContainText('+5511948173104') }
    await expect(page.getByText('Sem contexto importado.', { exact: false })).toHaveCount(0)
    await expect(section.locator('details')).toHaveCount(0)
    const hint = panel.getByRole('status', { name: 'Aquecimento sugerido pelo formulário' })
    await expect(hint).toContainText('Quente'); await expect(hint).toContainText(HINT)
    await expect(hint).toContainText(c.name === 'site' ? 'já marcado no lead; o SDR pode alterar' : 'sugestão; o aquecimento do lead não foi alterado')
    if (c.name === 'site') await expect(page.locator('button[aria-label^="Contexto de "]').first()).toHaveCSS('color', 'rgb(253, 135, 38)')
    await expect(panel.getByRole('region', { name: 'Dados completos da importação' })).toBeHidden() // recolhido: so as respostas aparecem de cara
    if (c.name === 'site') {
      await panel.locator('summary').filter({ hasText: 'Dados do site e da campanha' }).click()
      const sectionBox = await section.boundingBox(), siteBox = await panel.getByRole('region', { name: 'Dados completos da importação' }).boundingBox()
      assert(sectionBox.y < siteBox.y, 'as respostas do formulario aparecem antes dos dados do site')
      await expect(panel.getByRole('heading', { name: 'Dados informados no site', exact: true })).toBeVisible()
    }
    if (process.env.CRM_CONTEXT_SCREENSHOT_DIR) await page.screenshot({ path: process.env.CRM_CONTEXT_SCREENSHOT_DIR + `/crm-site-answers-${role}-${c.name}.png` })
    await context.close()
  }
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  console.log('PASS: SDR e Closer leem o aquecimento sugerido (com motivos) e as perguntas e respostas do formulario Meta no Contexto de lead do site e de lead criado a mao, antes dos dados do site, sem corte e sem escrita no CRM')
} finally { await browser.close() }
