import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { isTrustedOrigin, jsonResponse, preflightResponse, readJsonBody, RequestError } from '../_shared/http.ts'

// Compatibility route: use the atomic account transaction and its audit guards.
Deno.serve(async req => {
  const preflight = preflightResponse(req)
  if (preflight) return preflight
  if (!isTrustedOrigin(req)) return jsonResponse(req, { error: 'Origem não autorizada' }, 403)
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método inválido' }, 405)
  try {
    const authorization = req.headers.get('authorization')
    if (!authorization) return jsonResponse(req, { error: 'Autenticação necessária' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const body = await readJsonBody<Record<string, unknown>>(req)
    const { user_id, new_password, reason } = body
    if (Object.keys(body).some(key => !['user_id', 'new_password', 'reason'].includes(key))
      || typeof user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user_id)
      || typeof new_password !== 'string' || new_password.length < 12 || new_password.length > 128
      || typeof reason !== 'string' || reason.trim().length < 5) {
      return jsonResponse(req, { error: 'Informe uma senha de 12 a 128 caracteres e o motivo da alteração.' }, 400)
    }
    const { data, error } = await client.rpc('executive_list_users')
    if (error) return jsonResponse(req, { error: 'Acesso executivo necessário' }, 403)
    const account = data.users.find((row: { user_id: string }) => row.user_id === user_id)
    if (!account) return jsonResponse(req, { error: 'Conta não encontrada' }, 404)
    const roles = account.user_roles
    if (!roles.length || roles.some((role: Record<string, unknown>) =>
      role.commission_rate !== roles[0].commission_rate || role.crm_access !== roles[0].crm_access
      || role.can_view_sales !== roles[0].can_view_sales)) {
      return jsonResponse(req, { error: 'Esta conta tem permissões diferentes por papel. Confira e atualize pela aba Contas.' }, 409)
    }
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/executive-update-account`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id, password: new_password, reason, display_name: account.display_name || '', email: account.email || '',
        phone: account.phone ? `+${account.phone.replace(/^\+/, '')}` : '', avatar_url: account.avatar_url || '',
        roles: roles.map((role: { role: string }) => role.role), commission_rate: Number(roles[0].commission_rate ?? 10),
        crm_access: !!roles[0].crm_access, can_view_sales: !!roles[0].can_view_sales, suspended: account.suspended,
        expected_revision: account.account_revision, expected_updated_at: account.updated_at,
      }),
    })
    return jsonResponse(req, await response.json(), response.status)
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse(req, { error: error.message }, error.status)
    return jsonResponse(req, { error: 'Não foi possível redefinir a senha. Tente pela edição de conta.' }, 400)
  }
})
