const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://wsltda.site,https://www.wsltda.site')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

const allowedOrigins = new Set([
  ...configuredOrigins,
  'http://localhost:5173',
  'http://localhost:8080',
])

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  return {
    ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}

export function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  return !origin || allowedOrigins.has(origin)
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function preflightResponse(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  if (!isTrustedOrigin(req)) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

export async function readJsonBody<T>(req: Request, maxBytes = 32_768): Promise<T> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, 'Envie um corpo JSON válido.')
  }
  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RequestError(413, 'A solicitação é muito grande.')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new RequestError(400, 'Envie um corpo JSON válido.')
  }
}
