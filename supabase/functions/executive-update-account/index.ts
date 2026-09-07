import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const validRoles = ['seller','executive','super_admin','closer','sdr','bdr','traffic_manager']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return respond({ error: 'Método inválido' }, 405)
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return respond({ error: 'Autenticação necessária' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user: actor }, error: authError } = await admin.auth.getUser(token)
    if (authError || !actor) return respond({ error: 'Sessão inválida. Entre novamente.' }, 401)
    const { data: authorized, error: roleError } = await admin.rpc('is_executive', { _user_id: actor.id })
    if (roleError || !authorized) return respond({ error: 'Acesso executivo necessário' }, 403)

    const body = await req.json()
    const { user_id, display_name, email, phone, avatar_url, password, roles, commission_rate,
      crm_access, can_view_sales, suspended, reason, expected_revision, expected_updated_at } = body
    if (typeof user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user_id)
      || typeof display_name !== 'string' || display_name.trim().length < 1 || display_name.length > 120
      || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || typeof phone !== 'string' || (phone !== '' && !/^\+[1-9]\d{7,14}$/.test(phone))
      || typeof avatar_url !== 'string' || (avatar_url !== '' && !/^https:\/\//i.test(avatar_url))
      || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 2000
      || !Array.isArray(roles) || roles.length === 0 || roles.some(r => !validRoles.includes(r))
      || typeof commission_rate !== 'number' || !Number.isFinite(commission_rate) || commission_rate < 0 || commission_rate > 100
      || typeof crm_access !== 'boolean' || typeof can_view_sales !== 'boolean' || typeof suspended !== 'boolean'
      || typeof expected_revision !== 'string' || (expected_updated_at !== null && typeof expected_updated_at !== 'string')) {
      return respond({ error: 'Confira nome, e-mail, telefone internacional, permissões, comissão e motivo.' }, 400)
    }
    if (password && (typeof password !== 'string' || password.length < 12 || password.length > 128)) {
      return respond({ error: 'A nova senha deve ter de 12 a 128 caracteres.' }, 400)
    }
    const { data: { user: target }, error: targetError } = await admin.auth.admin.getUserById(user_id)
    if (targetError || !target) return respond({ error: 'Usuário não encontrado' }, 404)
    if ((target.app_metadata?.dashboard_account?.revision ?? '') !== expected_revision) {
      return respond({ error: 'A conta mudou durante a edição. Reabra e confira os dados.' }, 409)
    }
    // The auth.users trigger applies profile + roles + audit inside this same Auth transaction.
    // A validation failure rolls back email/password as well, avoiding partially updated accounts.
    const patch = {
      revision: crypto.randomUUID(), actor_id: actor.id, expected_revision, expected_updated_at,
      display_name: display_name.trim(), avatar_url: avatar_url.trim(), roles: [...new Set(roles)],
      commission_rate, crm_access, can_view_sales, suspended, reason: reason.trim(),
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(user_id, {
      ...(email.trim().toLowerCase() !== target.email?.toLowerCase() ? { email: email.trim().toLowerCase(), email_confirm: true } : {}),
      ...(phone !== (target.phone || '') ? { phone } : {}),
      ...(password ? { password } : {}),
      ban_duration: suspended ? '876000h' : 'none',
      user_metadata: { ...target.user_metadata, display_name: display_name.trim(), avatar_url: avatar_url.trim() || null },
      app_metadata: { ...target.app_metadata, dashboard_account: patch },
    })
    if (updateError) {
      console.error('Account update rejected', { code: updateError.code, target: user_id })
      return respond({ error: updateError.message.includes('Database')
        ? 'A alteração foi recusada. Reabra a conta e confira suas permissões. Seu próprio acesso e contas super admin são protegidos.'
        : updateError.message }, 400)
    }
    return respond({ success: true })
  } catch {
    return respond({ error: 'Não foi possível atualizar a conta. Confira os dados e tente novamente.' }, 400)
  }
})
