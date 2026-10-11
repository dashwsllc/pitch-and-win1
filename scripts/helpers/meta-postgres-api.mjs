// Real PostgreSQL adapter for the Edge Supabase boundary. No persistence mocks.
export function postgresApi(client) {
  const signatures = new Map()
  const identifier = value => { if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw Error('Unsafe test identifier'); return '"' + value + '"' }
  return {
    async rpc(name, args = {}) {
      try {
        if (!name.startsWith('meta_')) throw Error('Meta RPC only')
        if (!signatures.has(name)) signatures.set(name, (await client.query(`SELECT p.proargnames,p.proretset,
          ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes) t) AS types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`, [name])).rows)
        const signature = signatures.get(name).find(s => Object.keys(args).every(key => s.proargnames?.includes(key)))
        if (!signature) throw Error('Unknown Meta signature: ' + name)
        const entries = Object.entries(args), values = entries.map(([key, value]) => signature.types[signature.proargnames.indexOf(key)] === 'jsonb' && value !== null ? JSON.stringify(value) : value)
        const call = `public.${identifier(name)}(${entries.map(([key], i) => `${identifier(key)}=>$${i + 1}::${signature.types[signature.proargnames.indexOf(key)]}`).join(',')})`
        const sql = signature.proretset ? `SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') AS data FROM ${call} r` : `SELECT ${call} AS data`
        return { data: (await client.query(sql, values)).rows[0].data, error: null }
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
    },
    from(table) {
      if (!['meta_ad_accounts', 'meta_sync_runs', 'meta_webhook_events'].includes(table)) throw Error('Unexpected test table')
      let columns = '*', patch = null, limit = null, single = false
      const conditions = [], values = [], orders = []
      const filter = (column, operator, value) => { values.push(value); conditions.push(`${identifier(column)} ${operator} $${values.length}`) }
      const query = {
        select(value = '*') { if (!/^[a-z_0-9,*]+$/.test(value)) throw Error('Unsafe test columns'); columns = value; return query },
        update(value) { patch = value; return query }, eq(column, value) { filter(column, '=', value); return query },
        in(column, value) { values.push(value); conditions.push(`${identifier(column)} = ANY($${values.length})`); return query },
        not(column, operator, value) { if (operator !== 'is' || value !== null) throw Error('Unexpected filter'); conditions.push(identifier(column) + ' IS NOT NULL'); return query },
        order(column, options) { orders.push(identifier(column) + (options?.ascending === false ? ' DESC' : ' ASC')); return query },
        limit(value) { if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid test limit'); limit = value; return query },
        single() { single = true; return query },
        async then(resolve, reject) {
          try {
            let sql = `SELECT ${columns} FROM public.${identifier(table)}`
            if (patch) { const assignments = Object.entries(patch).map(([key, value]) => { values.push(value); return `${identifier(key)}=$${values.length}` }); sql = `UPDATE public.${identifier(table)} SET ${assignments.join(',')}` }
            if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
            if (orders.length) sql += ' ORDER BY ' + orders.join(',')
            if (limit !== null) sql += ' LIMIT ' + limit
            const rows = (await client.query(sql, values)).rows
            return resolve({ data: single ? rows[0] : rows, error: null })
          } catch (error) { return resolve({ data: null, error: { code: error.code, message: error.message } }) }
        },
      }
      return query
    },
  }
}
