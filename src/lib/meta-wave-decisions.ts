import type { Json } from '@/integrations/supabase/types'
import type { WaveDetail, WaveExclusion } from './meta-waves'

export function waveDecisionPayload(snapshot: WaveDetail, action: 'aprovar' | 'rejeitar', excluded: WaveExclusion[], note: string, requestId: string) {
  return { p_wave: snapshot.wave.id, p_expected_version: snapshot.wave.version,
    p_members: snapshot.leads.map(lead => ({ id: lead.id, updated_at: lead.updated_at })) as Json,
    p_action: action, p_excluded: excluded as unknown as Json, p_note: note, p_request_id: requestId }
}
