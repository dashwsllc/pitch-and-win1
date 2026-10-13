export const SITE_SOURCE_PROJECT = 'mehmqibxzxfqdxqjnjad'
export const SITE_MAX_BODY_BYTES = 16 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export interface SiteLeadEvent {
  schema_version: number; event_id: string; source_project: string; source_lead_id: string
  source_revision: number; generated_at: string; source_updated_at: string; payload: Record<string, unknown>
}
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
export async function siteSignature(raw: Uint8Array, timestamp: string, secret: string): Promise<string> {
  const prefix = new TextEncoder().encode(timestamp + '.')
  const input = new Uint8Array(prefix.byteLength + raw.byteLength)
  input.set(prefix); input.set(raw, prefix.byteLength)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, input))
}
export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}
export function validSiteIdentity(input: unknown): input is SiteLeadEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const e = input as SiteLeadEvent
  return e.source_project === SITE_SOURCE_PROJECT && uuid.test(e.event_id ?? '') && uuid.test(e.source_lead_id ?? '')
    && Number.isSafeInteger(e.source_revision) && e.source_revision > 0
    && Number.isSafeInteger(e.schema_version) && e.schema_version > 0
}
export async function boundedBody(req: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get('content-length')) > SITE_MAX_BODY_BYTES) throw new RangeError('body_limit')
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > SITE_MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('body_limit') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}
