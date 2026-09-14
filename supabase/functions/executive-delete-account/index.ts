import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0"
import { isTrustedOrigin, jsonResponse, preflightResponse, readJsonBody, RequestError } from '../_shared/http.ts'

// Sibling of executive-update-account: same auth shape, but performs an
// irreversible account deletion instead of a patch. The actual DELETE FROM
// auth.users happens inside public.executive_delete_account, called here with
// the service-role client so auth.uid() is null during the cascade — the same
// reason apply_executive_account_patch can rewrite user_roles when editing an
// account. That RPC is granted to service_role only, never to authenticated,
// so this function is the only caller.
Deno.serve(async (req) => {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (!isTrustedOrigin(req)) return jsonResponse(req, { error: 'Origem não autorizada' }, 403)
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return jsonResponse(req, { error: 'Autenticação necessária' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user: actor }, error: authError } = await admin.auth.getUser(token)
    if (authError || !actor) return jsonResponse(req, { error: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: authorized, error: roleError } = await admin.rpc('is_executive', { _user_id: actor.id })
    if (roleError || !authorized) return jsonResponse(req, { error: 'Acesso executivo necessário' }, 403)

    const body = await readJsonBody<Record<string, unknown>>(req)
    const allowedFields = new Set(['user_id', 'reason'])
    if (Object.keys(body).some(key => !allowedFields.has(key))) {
      return jsonResponse(req, { error: 'A solicitação contém campos não permitidos.' }, 400)
    }
    const { user_id, reason } = body
    if (typeof user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user_id)
      || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 2000) {
      return jsonResponse(req, { error: 'Informe uma conta válida e o motivo da exclusão (mínimo 5 caracteres).' }, 400)
    }
    if (user_id === actor.id) {
      return jsonResponse(req, { error: 'Você não pode excluir sua própria conta.' }, 400)
    }

    const { error: deleteError } = await admin.rpc('executive_delete_account', {
      p_user_id: user_id, p_actor_id: actor.id, p_reason: reason,
    })
    if (deleteError) {
      const status = deleteError.code === '42501' ? 403 : deleteError.code === 'P0002' ? 404 : deleteError.code === 'PT409' ? 409 : 400
      return jsonResponse(req, { error: deleteError.message }, status)
    }
    return jsonResponse(req, { success: true })
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
    return jsonResponse(req, { error: 'Não foi possível excluir a conta. Confira os dados e tente novamente.' }, 400)
  }
})
