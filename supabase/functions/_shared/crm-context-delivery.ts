export const CRM_RECEIVER_URL = 'https://mehmqibxzxfqdxqjnjad.supabase.co/functions/v1/crm-context-receiver'
export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]
const maxBytes = 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const receiptStates = new Set(['applied', 'waiting_member', 'superseded', 'duplicate', 'quarantined'])

interface RpcClient { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
interface ClaimedEvent { event_id: string; source_lead_id: string; source_revision: number; payload: unknown; claim_token: string; attempts: number }
export interface DeliveryOptions { receiverUrl: string; sharedSecret: string; deadlineMs: number; eventId?: string | null; fetchImpl?: typeof fetch }
export interface DeliveryRequestDeps {
  cronSecret?: string; sharedSecret: string; receiverUrl: string; createAdmin: () => RpcClient; fetchImpl?: typeof fetch
}

export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

export function backoffSeconds(attempts: number): number {
  return BACKOFF_SECONDS[Math.min(Math.max(Math.floor(attempts) || 1, 1), BACKOFF_SECONDS.length) - 1]
}

// HMAC-SHA256(segredo, timestamp + "." + corpo UTF-8 exato), em hexadecimal, com o prefixo do contrato.
export async function signContextBody(body: string, timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + body))
  return 'sha256=' + Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('')
}

// 400/403/409/413 e demais 4xx: repetir nao resolve, bloqueia. 408/425/429 e 5xx: repete com recuo.
function classifyStatus(status: number): { code: string; permanent: boolean } {
  if (status === 409) return { code: 'identity_conflict', permanent: true }
  if (status === 413) return { code: 'body_limit', permanent: true }
  const permanent = status >= 400 && status < 500 && ![408, 425, 429].includes(status)
  return { code: 'http_' + status, permanent }
}

function validReceipt(receipt: unknown, row: ClaimedEvent): boolean {
  if (!receipt || typeof receipt !== 'object') return false
  const r = receipt as Record<string, unknown>
  return r.ok === true && r.event_id === row.event_id && typeof r.receipt_id === 'string' && uuid.test(r.receipt_id)
    && typeof r.status === 'string' && receiptStates.has(r.status)
}

export async function deliverContextEvents(admin: RpcClient, options: DeliveryOptions) {
  const doFetch = options.fetchImpl ?? fetch
  const deadline = Date.now() + Math.min(45000, Math.max(0, options.deadlineMs))
  const result = { claimed: 0, delivered: 0, retryable: 0, blocked: 0 }
  const { data, error } = await admin.rpc('crm_context_claim', { p_limit: 20, p_lease_seconds: 60, p_event_id: options.eventId ?? null })
  if (error || !Array.isArray(data)) throw new Error('claim_unavailable')
  const rows = data as ClaimedEvent[]; result.claimed = rows.length
  const configured = !!options.sharedSecret && options.receiverUrl === CRM_RECEIVER_URL
  for (const row of rows) {
    // Claims nao processados continuam duraveis: o lease vence e a proxima execucao retoma.
    if (deadline - Date.now() < 12000) break
    let code = configured ? '' : 'configuration'
    let permanent = false
    const body = JSON.stringify(row.payload)
    if (!code && new TextEncoder().encode(body).byteLength > maxBytes) { code = 'body_limit'; permanent = true }
    if (!code) {
      try {
        const timestamp = String(Math.floor(Date.now() / 1000))
        const response = await doFetch(CRM_RECEIVER_URL, {
          method: 'POST', redirect: 'error', body,
          headers: { 'content-type': 'application/json', 'x-crm-timestamp': timestamp, 'x-crm-signature': await signContextBody(body, timestamp, options.sharedSecret) },
          signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
        })
        if (!response.ok) ({ code, permanent } = classifyStatus(response.status))
        else {
          let receipt: unknown
          try { receipt = await response.json() } catch { code = 'invalid_receipt'; permanent = true }
          if (!code && !validReceipt(receipt, row)) { code = 'invalid_receipt'; permanent = true }
          if (!code) {
            const ack = await admin.rpc('crm_context_ack', { p_event: row.event_id, p_claim: row.claim_token, p_receipt: receipt })
            if (ack.error) code = 'ack_unavailable'
            else { result.delivered++; continue }
          }
        }
      } catch (error) {
        code = error && typeof error === 'object' && 'name' in error && /Timeout|Abort/.test(String((error as { name: unknown }).name)) ? 'network_timeout' : 'network_error'
      }
    }
    try {
      await admin.rpc('crm_context_fail', { p_event: row.event_id, p_claim: row.claim_token, p_code: code,
        p_retry_at: new Date(Date.now() + backoffSeconds(row.attempts) * 1000).toISOString(), p_permanent: permanent })
    } catch { /* O lease recupera uma gravacao de repeticao que falhou. */ }
    if (permanent) result.blocked++
    else result.retryable++
  }
  return result
}

export async function handleDeliveryRequest(req: Request, deps: DeliveryRequestDeps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!deps.cronSecret) return new Response('Worker unavailable', { status: 503 })
  if (!sameSecret(req.headers.get('x-crm-cron-secret') ?? '', deps.cronSecret)) return new Response('Forbidden', { status: 403 })
  let eventId: string | null = null
  try {
    const text = await req.text()
    const parsed = text.trim() ? JSON.parse(text) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
    if (parsed.event_id !== undefined && parsed.event_id !== null) {
      if (typeof parsed.event_id !== 'string' || !uuid.test(parsed.event_id)) throw new Error('event_id')
      eventId = parsed.event_id
    }
  } catch { return new Response('Bad Request', { status: 400 }) }
  try {
    return Response.json(await deliverContextEvents(deps.createAdmin(), {
      receiverUrl: deps.receiverUrl, sharedSecret: deps.sharedSecret, deadlineMs: 45000, eventId, fetchImpl: deps.fetchImpl }))
  } catch { return new Response('Delivery unavailable', { status: 503 }) }
}
