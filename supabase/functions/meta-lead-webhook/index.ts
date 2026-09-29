import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { ingestLeadgenId } from '../_shared/meta-lead-ingest.ts'

interface LeadgenChange {
  field: string
  value: { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string }
}
interface WebhookEntry { id: string; changes?: LeadgenChange[] }
interface WebhookPayload { entry?: WebhookEntry[] }

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

async function validSignature(raw: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const computedHex = Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  return timingSafeEqual(computedHex, signatureHeader.slice('sha256='.length))
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const challenge = url.searchParams.get('hub.challenge')
    const verified = url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') && challenge
    return verified ? new Response(challenge, { status: 200 }) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // O corpo TEM que ser lido como texto bruto e validado ANTES de qualquer
  // JSON.parse - assinar/comparar sobre o objeto ja parseado invalida a garantia
  // de integridade (reserializar pode nao bater byte a byte com o original).
  const raw = await req.text()
  const secret = Deno.env.get('META_APP_SECRET')
  if (!secret || !(await validSignature(raw, req.headers.get('x-hub-signature-256'), secret))) {
    return new Response('Invalid signature', { status: 403 })
  }
  let payload: WebhookPayload
  try { payload = JSON.parse(raw) } catch { return new Response('Bad Request', { status: 400 }) }

  const token = Deno.env.get('META_SYSTEM_USER_TOKEN')
  if (!token) {
    console.error('META_SYSTEM_USER_TOKEN não configurado - evento recebido mas não processado')
    return new Response('EVENT_RECEIVED', { status: 200 })
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue
      await ingestLeadgenId(admin, change.value.leadgen_id, entry.id, change.value.form_id || '', token)
    }
  }
  // Sempre 200 depois de logar: retry storm ou erro repetido pode fazer a Meta
  // desativar a assinatura do webhook. Falhas ficam em meta_webhook_events e
  // sao recuperadas pela reconciliacao horaria (meta-leads-reconciliation).
  return new Response('EVENT_RECEIVED', { status: 200 })
})
