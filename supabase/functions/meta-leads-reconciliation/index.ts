import { handleLeadCron } from '../_shared/meta-lead-cron.ts'
import { requireCronSecret } from '../_shared/meta-auth.ts'
import { jsonResponse, readJsonBody, RequestError } from '../_shared/http.ts'
Deno.serve(async req => {
  if (req.method !== 'POST' || !requireCronSecret(req)) return handleLeadCron(req, true)
  try {
    const body = await readJsonBody<{ discover?: boolean }>(req)
    if (body.discover !== undefined && typeof body.discover !== 'boolean') throw new RequestError(400, 'Modo de descoberta inválido')
    return handleLeadCron(req, body.discover ?? true)
  } catch (cause) {
    return jsonResponse(req, { error: cause instanceof RequestError ? cause.message : 'Requisição inválida' }, cause instanceof RequestError ? cause.status : 400)
  }
})
