import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { CRM_RECEIVER_URL, handleDeliveryRequest } from '../_shared/crm-context-delivery.ts'

Deno.serve(req => handleDeliveryRequest(req, {
  cronSecret: Deno.env.get('CRM_CONTEXT_CRON_SECRET'),
  sharedSecret: Deno.env.get('CRM_BRIDGE_SHARED_SECRET') ?? '',
  receiverUrl: Deno.env.get('CRM_BRIDGE_RECEIVER_URL') ?? CRM_RECEIVER_URL,
  createAdmin: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  }),
}))
