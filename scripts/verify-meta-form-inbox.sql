SELECT set_config('request.jwt.claim.sub',(
 SELECT id::text FROM auth.users WHERE lower(email)='cleitonrodrigues.ads@gmail.com'),true);
DO $$
BEGIN
 PERFORM public.meta_import_daily('message-verification.csv',jsonb_build_array(jsonb_build_object(
  'date',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'account_id','verification-message-account',
  'campaign_id','verification-message-campaign','campaign_name','Mensagens',
  'level','campaign','currency','BRL','spend',100,'leads',10,'purchases',2,
  'messaging_conversations_started',4)));
 IF (SELECT messaging_conversations_started FROM public.meta_traffic_daily
     WHERE account_id='verification-message-account')<>4
 THEN RAISE EXCEPTION 'Métrica de mensagens não foi importada'; END IF;
 PERFORM public.meta_import_daily('partial-verification.csv',jsonb_build_array(jsonb_build_object(
  'date',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'account_id','verification-message-account',
  'campaign_id','verification-message-campaign','campaign_name','Mensagens',
  'level','campaign','currency','BRL','spend',110,'leads',11,'purchases',0,
  'present_metrics',jsonb_build_array('leads'))));
 IF (SELECT messaging_conversations_started FROM public.meta_traffic_daily
     WHERE account_id='verification-message-account')<>4
   OR (SELECT purchases FROM public.meta_traffic_daily WHERE account_id='verification-message-account')<>2
 THEN RAISE EXCEPTION 'Reimportação parcial apagou métricas anteriores'; END IF;
END $$;
DO $$
DECLARE v_sdr uuid; v_lead uuid; v_crm uuid; v_repeat uuid;
BEGIN
 SELECT id INTO STRICT v_sdr FROM auth.users WHERE lower(email)='pedro10@gmail.com';
 PERFORM set_config('request.jwt.claim.sub',v_sdr::text,true);
 IF NOT public.meta_lead_inbox_access() THEN RAISE EXCEPTION 'SDR sem acesso à fila'; END IF;
 v_lead:=public.meta_ingest_form_lead(jsonb_build_object(
   'meta_lead_id','verification-meta-form-lead','page_id','page-test',
   'form_id','form-test','campaign_id','campaign-test','campaign_name','Teste',
   'created_time',now(),'full_name','Responsável Teste','phone','11999999999',
   'email','teste@example.com',
   'field_data',jsonb_build_array(jsonb_build_object('name','full_name','values',jsonb_build_array('Responsável Teste')))));
 v_repeat:=public.meta_ingest_form_lead(jsonb_build_object(
   'meta_lead_id','verification-meta-form-lead','page_id','page-test',
   'form_id','form-test','created_time',now(),'field_data','[]'::jsonb));
 IF v_lead IS DISTINCT FROM v_repeat OR
   (SELECT count(*) FROM public.meta_form_leads WHERE meta_lead_id='verification-meta-form-lead')<>1
 THEN RAISE EXCEPTION 'Ingestão duplicou o lead'; END IF;
 v_crm:=public.meta_promote_form_lead(v_lead,jsonb_build_object(
   'name','Responsável Teste','phone','11999999999','email','teste@example.com',
   'athlete_name','Atleta Teste','athlete_birth_date','2010-01-01',
   'athlete_position','Atacante','city_state','São Paulo, SP'));
 IF v_crm IS NULL OR (SELECT meta_form_lead_id FROM public.crm_leads WHERE id=v_crm) IS DISTINCT FROM v_lead
   OR (SELECT status FROM public.meta_form_leads WHERE id=v_lead)<>'importado'
 THEN RAISE EXCEPTION 'Promoção ao CRM falhou'; END IF;
 IF public.meta_promote_form_lead(v_lead,jsonb_build_object()) IS DISTINCT FROM v_crm
 THEN RAISE EXCEPTION 'Promoção repetida não foi idempotente'; END IF;
 IF has_function_privilege('authenticated','public.meta_ingest_form_lead(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Ingestão exposta ao navegador'; END IF;
 RAISE NOTICE 'Fila Meta e promoção CRM verificadas';
END $$;
SELECT set_config('request.jwt.claim.sub',(
 SELECT id::text FROM auth.users WHERE lower(email)='pedro10@gmail.com'),true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.meta_form_leads WHERE meta_lead_id='verification-meta-form-lead')<>1
 THEN RAISE EXCEPTION 'RLS ocultou lead para SDR'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(
 SELECT p.user_id::text FROM public.profiles p WHERE NOT p.suspended
 AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id
 AND r.role::text IN ('sdr','executive','super_admin')) LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.meta_form_leads WHERE meta_lead_id='verification-meta-form-lead')<>0
 THEN RAISE EXCEPTION 'RLS expôs lead a papel não autorizado'; END IF;
END $$;
RESET ROLE;
