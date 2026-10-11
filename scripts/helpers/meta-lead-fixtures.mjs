export function leadDatabase({ failReceive = '', failLead = '' } = {}) {
  const events = new Map(), discoveries = new Map(), calls = [], finishes = []
  return { events, discoveries, calls, finishes,
    from() { const builder = { select() { return builder }, eq(key, value) { builder.id = value; return builder }, async single() { return { data: [...events.values()].find(row => row.id === builder.id), error: null } } }; return builder },
    async rpc(name, args) {
      calls.push({ name, args })
      const ok = data => ({ data, error: null })
      const error = message => ({ data: null, error: { code: '22023', message } })
      if (name === 'meta_sync_run_start') return ok('run1')
      if (name === 'meta_sync_run_finish') { finishes.push(args); return ok(null) }
      if (name === 'meta_webhook_event_receive') {
        if (args.p_leadgen_id === failReceive) return error('receipt unavailable')
        const prior = events.get(args.p_leadgen_id)
        if (prior && (prior.page_id !== args.p_page_id || prior.form_id !== args.p_form_id)) return error('identity mismatch')
        if (!prior) events.set(args.p_leadgen_id, { id: `event-${args.p_leadgen_id}`, leadgen_id: args.p_leadgen_id,
          page_id: args.p_page_id, form_id: args.p_form_id, status: 'pending', processing_attempts: 0 })
        return ok(events.get(args.p_leadgen_id).id)
      }
      const event = [...events.values()].find(row => row.id === args.p_id)
      if (name === 'meta_lead_event_ignore') { if (event.status !== 'processed') event.status = 'ignored'; return ok(null) }
      if (name === 'meta_lead_events_claim') {
        const rows = [...events.values()].filter(row => row.status === 'pending' && args.p_page_ids.includes(row.page_id)).slice(0, args.p_limit)
        rows.forEach(row => { row.status = 'processing'; row.claim_token = `claim-${row.id}`; row.processing_attempts++ })
        return ok(rows.map(row => ({ ...row })))
      }
      if (name === 'meta_lead_event_ingest') {
        if (args.p_data.meta_lead_id === failLead) return error('invalid lead data')
        if (event.claim_token !== args.p_claim) return error('wrong claim')
        event.status = 'processed'; event.data = args.p_data; return ok(event.id)
      }
      if (name === 'meta_lead_event_fail') { event.status = 'error'; event.error_class = args.p_class; return ok(null) }
      if (name === 'meta_lead_discovery_claim') {
        let state = discoveries.get(args.p_page_id)
        if (!state) state = { page_id: args.p_page_id, version: 1, claim_token: 'discovery-claim', window_since: '2026-10-09T12:00:00Z',
          window_until: '2026-10-11T12:00:00Z', forms_next: { path: `/${args.p_page_id}/leadgen_forms`, params: { fields: 'id,name', limit: '50' } },
          form_id: null, leads_next: null, form_queue: [], active_form_name: null }
        discoveries.set(args.p_page_id, state); return ok({ ...state, form_queue: [...state.form_queue] })
      }
      if (name === 'meta_lead_discovery_checkpoint') {
        const state = discoveries.get(args.p_page_id)
        for (const id of args.p_state.received_ids) if (!events.has(id)) return error('receipt missing')
        Object.assign(state, args.p_state); state.version++; return ok(state.version)
      }
      if (name === 'meta_lead_discovery_release') return ok(null)
      throw new Error(`Unexpected RPC ${name}`)
    },
  }
}
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
export function leadsGraph(address) {
  const url = new URL(address)
  if (url.pathname.endsWith('/leadgen_forms')) return json({ data: [{ id: 'form1', name: 'Test' }] })
  if (url.pathname.endsWith('/leads')) return json({ data: [{ id: 'lead1' }, { id: 'lead2' }] })
  if (url.pathname.endsWith('/form1')) return json({ id: 'form1', name: 'Test' })
  if (/\/lead[12]$/.test(url.pathname)) return json({ id: url.pathname.split('/').at(-1), created_time: '2026-10-09T12:00:00Z',
    form_id: 'form1', field_data: [{ name: 'full_name', values: ['Test Person'] }, { name: 'phone_number', values: ['11999990000'] }] })
  throw new Error(`Unexpected Graph path ${url.pathname}`)
}
