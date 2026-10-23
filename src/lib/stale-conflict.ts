// "O dado mudou, recarregue": o banco sinaliza com PT409 (HTTP 409). Antes era 40001, mas o PostgREST 14 repete a transação sem fim nesse código
// (ver supabase/migrations/20261023020000_postgrest_no_retry_errcode.sql). Aceita os dois enquanto houver erros antigos em circulação.
export const isStaleConflict = (cause: unknown): boolean => {
  const code = (cause as { code?: string } | null | undefined)?.code
  return code === 'PT409' || code === '40001'
}
