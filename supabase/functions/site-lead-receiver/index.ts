import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { boundedBody, hex, sameSecret, siteSignature, SITE_SOURCE_PROJECT, validSiteIdentity } from '../_shared/site-bridge-protocol.ts'

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('SITE_BRIDGE_SHARED_SECRET')
  if (!secret) return new Response('Receiver unavailable', { status: 503 })
  const timestamp = req.headers.get('x-site-timestamp') ?? ''
  const signature = req.headers.get('x-site-signature') ?? ''
  if (!/^\d{10,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    || !/^sha256=[0-9a-f]{64}$/.test(signature)) return new Response('Forbidden', { status: 403 })
  let raw: Awaited<ReturnType<typeof boundedBody>>
  try { raw = await boundedBody(req) } catch (error) {
    return new Response('Body unavailable', { status: error instanceof RangeError ? 413 : 400 })
  }
  if (!sameSecret(signature, await siteSignature(raw, timestamp, secret))) return new Response('Forbidden', { status: 403 })
  let event
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { return new Response('Bad Request', { status: 400 }) }
  const heartbeat = event?.kind === 'heartbeat'
  if (heartbeat ? !validHeartbeat(event) : !validSiteIdentity(event)) return new Response('Bad Request', { status: 400 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  })
  try {
    const { data, error } = heartbeat
      ? await admin.rpc('site_bridge_heartbeat_receive', { p_status: event })
      : await admin.rpc('site_import_receive', { p_event: event, p_body_sha256: hex(await crypto.subtle.digest('SHA-256', raw)) })
    if (error) return new Response('Receipt unavailable', { status: error.code === '23505' ? 409 : 503 })
    if (!heartbeat && (!data?.receipt_id || data.event_id !== event.event_id)) return new Response('Receipt unavailable', { status: 503 })
    return Response.json(heartbeat ? { ok: true } : data)
  } catch { return new Response('Receipt unavailable', { status: 503 }) }
})

function validHeartbeat(e: Record<string, unknown>): boolean {
  return e.schema_version === 1 && e.source_project === SITE_SOURCE_PROJECT && typeof e.observed_at === 'string'
    && Number.isFinite(Date.parse(e.observed_at)) && Number.isSafeInteger(e.pending_count) && Number(e.pending_count) >= 0
    && Number.isSafeInteger(e.quarantined_count) && Number(e.quarantined_count) >= 0
    && (e.oldest_pending_at === null || typeof e.oldest_pending_at === 'string' && Number.isFinite(Date.parse(e.oldest_pending_at)))
}
