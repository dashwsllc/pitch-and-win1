import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

// Compatibility route: use the atomic account transaction and its audit guards.
serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return respond({ error: 'Método inválido' }, 405)
  try {
    const authorization = req.headers.get('authorization')
    if (!authorization) return respond({ error: 'Autenticação necessária' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { user_id, new_password, reason } = await req.json()
    if (typeof new_password !== 'string' || new_password.length < 12 || new_password.length > 128
      || typeof reason !== 'string' || reason.trim().length < 5) {
      return respond({ error: 'Informe uma senha de 12 a 128 caracteres e o motivo da alteração.' }, 400)
    }
    const { data, error } = await client.rpc('executive_list_users')
    if (error) return respond({ error: 'Acesso executivo necessário' }, 403)
    const account = data.users.find((row: { user_id: string }) => row.user_id === user_id)
    if (!account) return respond({ error: 'Conta não encontrada' }, 404)
    const roles = account.user_roles
    if (!roles.length || roles.some((role: Record<string, unknown>) =>
      role.commission_rate !== roles[0].commission_rate || role.crm_access !== roles[0].crm_access
      || role.can_view_sales !== roles[0].can_view_sales)) {
      return respond({ error: 'Esta conta tem permissões diferentes por papel. Confira e atualize pela aba Contas.' }, 409)
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
    return respond(await response.json(), response.status)
  } catch {
    return respond({ error: 'Não foi possível redefinir a senha. Tente pela edição de conta.' }, 400)
  }
})
