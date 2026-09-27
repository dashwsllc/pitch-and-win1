// Real production smoke test. Creates one isolated account/lead and always removes both.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect as baseExpect } from '../.verification.local/node_modules/@playwright/test/index.mjs'

if (!process.argv.includes('--run-disposable-check')) throw Error('Use --run-disposable-check to create and remove one temporary CRM account and lead.')
const project = 'mbzwchnxtskysqplqiyy'
const origin = 'https://wsltda.com'
const url = `https://${project}.supabase.co`
const keyCommand = spawnSync('npx', ['supabase','projects','api-keys','--project-ref',project,'--output','json'], {
  shell: process.platform === 'win32', encoding: 'utf8', maxBuffer: 1024 * 1024,
})
if (keyCommand.status !== 0) throw Error('Could not read authorized project credentials')
const keys = JSON.parse(keyCommand.stdout)
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
const publicKey = keys.find(key => key.name === 'anon')?.api_key
assert(serviceKey && publicKey)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, options)
const collaborator = createClient(url, publicKey, options)
const suffix = randomUUID().slice(0, 8)
const email = `qa-crm-md-${suffix}@example.invalid`
const password = `CRM-Markdown-${randomUUID()}!Aa1`
const leadName = `QA Markdown ${suffix}`
const original = '\uFEFF  [12/09/2026, 10:01] José: Olá 😀\r\n[12/09/2026, 10:02] Ana: *Valor* R$ 20,00\r\nhttps://drive.google.com/file/d/example/view\r\n<script>literal</script>  \r\n'
const sourceName = `WhatsApp-${suffix}.txt`
const markdownName = sourceName.replace(/\.txt$/, '.md')
const mediaUrl = `https://drive.google.com/file/d/${suffix}/view?usp=sharing`
const expect = baseExpect.configure({ timeout: 30000 })
let userId
let leadId
let browser
const must = response => { if (response.error) throw Error(`${response.error.code || response.status || 'API'}: ${response.error.message}`); return response.data }

try {
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `QA CRM Markdown ${suffix}` } }))
  userId = created.user.id
  must(await admin.from('registration_requests').update({ status: 'approved' }).eq('user_id', userId))
  const session = must(await collaborator.auth.signInWithPassword({ email, password })).session
  const lead = must(await collaborator.from('crm_leads').insert({
    created_by: userId, name: leadName, athlete_name: 'Atleta QA', phone: '11999999999',
  }).select('*').single())
  leadId = lead.id

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await context.addInitScript(({ project, session }) => {
    sessionStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session))
  }, { project, session })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/crm`)
  await page.getByLabel('Buscar leads', { exact: true }).fill(leadName)
  const card = page.getByRole('article', { name: `Lead ${leadName}`, exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: `Contexto de ${leadName}`, exact: true })).toHaveCount(1)
  await card.getByRole('button', { name: `Contexto de ${leadName}`, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: `Ficha de ${leadName}`, exact: true })
  await sheet.getByRole('button', { name: 'Importar conversa/transcrição', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar contexto do lead', exact: true })
  const mediaInput = dialog.getByLabel('Link do Google Drive (opcional)', { exact: true })
  await expect(mediaInput).toBeVisible()
  await expect(dialog.getByText('Para vídeo, áudio ou outra mídia pesada', { exact: false })).toBeVisible()
  const input = dialog.getByLabel('Anexar texto transcrito (opcional)', { exact: true })
  await expect(input).toHaveAttribute('accept', '.txt')
  await dialog.getByLabel('Tipo do conteúdo *', { exact: true }).selectOption('whatsapp_summary')
  await input.setInputFiles({ name: sourceName, mimeType: 'text/plain', buffer: Buffer.from(original) })
  await mediaInput.fill(mediaUrl)
  await expect(dialog.getByText(`${markdownName} pronto para salvar.`, { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Importar e salvar', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const saved = must(await admin.from('crm_lead_contexts')
    .select('content,file_name,file_content,file_mime_type,media_url').eq('lead_id', leadId).single())
  assert.equal(saved.file_name, markdownName)
  assert.equal(saved.file_mime_type, 'text/markdown')
  assert.equal(saved.content, original)
  assert.equal(saved.file_content, original)
  assert.deepEqual(Buffer.from(saved.file_content), Buffer.from(original))
  assert.equal(saved.media_url, mediaUrl)

  const savedMediaLink = sheet.getByRole('link', { name: 'Abrir mídia no Google Drive em uma nova aba', exact: true })
  await expect(savedMediaLink).toHaveAttribute('href', mediaUrl)
  await expect(savedMediaLink).toHaveAttribute('target', '_blank')

  const downloadPromise = page.waitForEvent('download')
  await sheet.getByRole('button', { name: `Baixar ${markdownName}`, exact: true }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), markdownName)
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(original))

  const rejected = await collaborator.rpc('crm_import_txt_context', {
    p_lead_id: leadId, p_context_type: 'manual_note', p_content: 'video', p_source_name: 'video.mp4', p_source_content: 'video',
  })
  assert(rejected.error && rejected.status === 400, 'The production RPC must reject non-TXT uploads')
  const rejectedMedia = await collaborator.rpc('crm_add_lead_context_with_media', {
    p_lead_id: leadId, p_context_type: 'manual_note', p_content: 'bad media', p_media_url: 'https://example.com/video',
  })
  assert(rejectedMedia.error && rejectedMedia.status === 400, 'The production RPC must reject non-Drive media links')
  const counted = await admin.from('crm_lead_contexts').select('id', { count: 'exact', head: true }).eq('lead_id', leadId)
  assert.ifError(counted.error)
  assert.equal(counted.count, 1, 'Rejected upload must not create a partial context')
  assert.deepEqual(pageErrors, [])
  console.log('PASS: production browser Drive link + TXT upload → atomic storage → byte-identical Markdown download; invalid media/non-TXT rejected without partial row')
} finally {
  if (browser) await browser.close()
  if (leadId) {
    await admin.from('crm_activities').delete().eq('lead_id', leadId)
    await admin.from('crm_leads').delete().eq('id', leadId)
  }
  await collaborator.auth.signOut().catch(() => undefined)
  if (userId) {
    await admin.from('user_roles').delete().eq('user_id', userId)
    const removed = await admin.auth.admin.deleteUser(userId)
    if (removed.error) throw removed.error
  }
  await collaborator.removeAllChannels()
  await admin.removeAllChannels()
  console.log('Removed the disposable CRM Markdown account and lead.')
}
