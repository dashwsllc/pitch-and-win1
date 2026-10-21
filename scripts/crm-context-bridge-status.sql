-- Somente leitura. Estado da ponte dash -> VOXEN: saude da fila + alinhamento com o CRM. So contagens e codigos, nunca dado pessoal.
-- Termina em excecao de proposito (o resultado vem no texto do erro e nada e gravado). Rode na pasta pitch-and-win1:
--   npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file scripts/crm-context-bridge-status.sql --output json
-- Leitura do resultado: pending/blocked/error_codes = fila; trigger_error_count deve ser 0; last_reconcile_* = ultima varredura;
-- to_enqueue deve ser 0 (senao a fila esta desatualizada); with_answers_without_voxen_id = leads do CRM com respostas e sem ID da VOXEN.
DO $status$
BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 RAISE EXCEPTION 'STATUS_OK saude=% | alinhamento=%',public.crm_context_health()::text,public.crm_context_alignment()::text USING ERRCODE='P0001';
END $status$;
