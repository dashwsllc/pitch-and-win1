-- O PostgREST 14 repete SEM FIM toda transacao que termina com SQLSTATE 40001 (serialization_failure): trata como falha passageira,
-- refaz BEGIN/set_config/check_registration_access/chamada/ABORT em laco apertado e prende a conexao do pool (bug corrigido so no PostgREST 16;
-- Supabase: "SQLSTATE 40001 in an RPC function causes infinite retries"). Em 22-23/10 o pool inteiro (10 conexoes) ficou preso por horas em
-- claims/leases vencidos (crm_context_fail/ack, meta_capture_release, meta_lead_discovery_checkpoint...) e toda a API travou.
-- Esta migration reescreve cada funcao (public e calendar_private) que levanta ERRCODE/SQLSTATE '40001' para 'PT409' (HTTP 409, sem repeticao).
-- Le a definicao VIVA com pg_get_functiondef (owner, grants, SECURITY DEFINER e search_path ficam como estao) e falha se sobrar qualquer 40001.
-- Regra daqui em diante: nenhuma migration nova pode usar 40001 (scripts/verify-postgrest-no-retry-errcode-db.mjs vigia).
BEGIN;

DO $$
DECLARE
  r record; def text; fixed text; n integer := 0; leftover text;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS signature
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname IN ('public', 'calendar_private') AND p.prokind IN ('f', 'p')
       AND p.prosrc ~* '(errcode\s*=\s*|sqlstate\s+)''40001'''
     ORDER BY p.oid
  LOOP
    def := pg_get_functiondef(r.oid);
    fixed := regexp_replace(def, '(errcode\s*=\s*|sqlstate\s+)''40001''', '\1''PT409''', 'gi');
    IF fixed = def THEN
      RAISE EXCEPTION 'Funcao % usa 40001 de um jeito que esta migration nao sabe trocar', r.signature USING ERRCODE = 'P0001';
    END IF;
    EXECUTE fixed;
    n := n + 1;
  END LOOP;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftover
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname IN ('public', 'calendar_private') AND p.prokind IN ('f', 'p') AND p.prosrc ~ '40001';
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Ainda mencionam 40001 depois da troca: %', leftover USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'postgrest_no_retry_errcode: % funcao(oes) reescrita(s)', n;
END $$;

COMMIT;
