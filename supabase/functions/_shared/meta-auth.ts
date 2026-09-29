import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { RequestError } from './http.ts'

export function requireCronSecret(req: Request): boolean {
  const secret = Deno.env.get('META_SYNC_CRON_SECRET')
  return !!secret && req.headers.get('x-cron-secret') === secret
}

// Mesmo padrao de reset-user-password/index.ts: client com anon key + Authorization
// do usuario, deixando a RPC (respeitando RLS) decidir se ele tem acesso a Trafego.
export async function requireTrafficUser(req: Request): Promise<{ userId: string }> {
  const authorization = req.headers.get('authorization')
  if (!authorization) throw new RequestError(401, 'Autenticação necessária')
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user) throw new RequestError(401, 'Sessão inválida. Entre novamente.')
  const { data: authorized, error } = await client.rpc('traffic_has_access')
  if (error || !authorized) throw new RequestError(403, 'Acesso de Tráfego necessário')
  return { userId: user.id }
}
