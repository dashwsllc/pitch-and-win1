-- Keep the user-facing role vocabulary consistent across current database
-- functions without changing the internal enum values seller/executive.
BEGIN;

DO $$
DECLARE
  function_row record;
  definition text;
BEGIN
  FOR function_row IN
    SELECT procedure.oid
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prokind = 'f'
      AND pg_get_functiondef(procedure.oid) ~ '(Vendedores|vendedores|Vendedor|vendedor|Executivos|executivos|Executivo|executivo|Executiva|executiva)'
  LOOP
    definition := pg_get_functiondef(function_row.oid);
    definition := replace(definition, 'Vendedores', 'Sellers');
    definition := replace(definition, 'vendedores', 'Sellers');
    definition := replace(definition, 'Vendedor', 'Seller');
    definition := replace(definition, 'vendedor', 'Seller');
    definition := replace(definition, 'Executivos', 'Executives');
    definition := replace(definition, 'executivos', 'Executives');
    definition := replace(definition, 'Executivo', 'Executive');
    definition := replace(definition, 'executivo', 'Executive');
    definition := replace(definition, 'Executiva', 'Executive');
    definition := replace(definition, 'executiva', 'Executive');
    EXECUTE definition;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
