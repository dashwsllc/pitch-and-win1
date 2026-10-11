import { handleLeadCron } from '../_shared/meta-lead-cron.ts'
Deno.serve(req => handleLeadCron(req, false))
