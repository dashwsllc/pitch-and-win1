DO $$
DECLARE v_user uuid; v_other uuid; v_suggestion uuid; v_first uuid; v_second uuid; v_data jsonb;
BEGIN
 SELECT id INTO v_user FROM auth.users WHERE lower(email)='cleitonrodrigues.ads@gmail.com';
 IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário autorizado não encontrado'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Executive sem acesso ao Tráfego'; END IF;
 v_data := jsonb_build_array(jsonb_build_object(
   'date', ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text,
   'account_id','verification-meta-account','campaign_id','verification-meta-campaign',
   'campaign_name','Campanha de verificação','level','campaign','currency','BRL',
   'spend',100,'leads',10,'purchases',2,'purchase_value',400,
   'impressions',1000,'reach',800,'link_clicks',50));
 PERFORM public.meta_import_daily('verification.csv',v_data);
 SELECT id INTO v_first FROM public.meta_traffic_daily WHERE account_id='verification-meta-account';
 PERFORM public.meta_import_daily('verification.csv',v_data);
 SELECT id INTO v_second FROM public.meta_traffic_daily WHERE account_id='verification-meta-account';
 IF v_first IS DISTINCT FROM v_second THEN RAISE EXCEPTION 'Reimportação duplicou métrica'; END IF;
 IF (SELECT count(*) FROM public.meta_traffic_daily WHERE account_id='verification-meta-account')<>1
   OR (SELECT spend FROM public.meta_traffic_daily WHERE id=v_first)<>100
 THEN RAISE EXCEPTION 'Métrica Meta incorreta'; END IF;
 v_suggestion:=public.traffic_create_suggestion('Teste de sugestão','Ajustar campanha de verificação','verification-meta-campaign');
 PERFORM public.traffic_reply_suggestion(v_suggestion,'Resposta de verificação');
 PERFORM public.traffic_set_suggestion_status(v_suggestion,'em_analise');
 IF (SELECT status FROM public.traffic_suggestions WHERE id=v_suggestion)<>'em_analise'
   OR (SELECT count(*) FROM public.traffic_suggestion_replies WHERE suggestion_id=v_suggestion)<>2
 THEN RAISE EXCEPTION 'Fluxo de sugestões inválido'; END IF;
 SELECT p.user_id INTO v_other FROM public.profiles p
 WHERE NOT p.suspended AND NOT EXISTS (
   SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id
   AND r.role::text IN ('executive','super_admin','traffic_manager'))
 LIMIT 1;
 IF v_other IS NOT NULL THEN
   PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
   IF public.traffic_has_access() THEN RAISE EXCEPTION 'Usuário sem papel acessou Tráfego'; END IF;
   BEGIN
     PERFORM public.traffic_create_suggestion('Negado','Não deve gravar',NULL);
     RAISE EXCEPTION 'RPC permitiu papel indevido';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END IF;
 RAISE NOTICE 'Meta e Sugestões verificados';
END $$;
SELECT set_config('request.jwt.claim.sub',(
  SELECT id::text FROM auth.users WHERE lower(email)='cleitonrodrigues.ads@gmail.com'),true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.meta_traffic_daily WHERE account_id='verification-meta-account')<>1
   OR (SELECT count(*) FROM public.traffic_suggestions WHERE subject='Teste de sugestão')<>1
 THEN RAISE EXCEPTION 'RLS ocultou dados do papel autorizado'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(
  SELECT p.user_id::text FROM public.profiles p
  WHERE NOT p.suspended AND NOT EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id=p.user_id
    AND r.role::text IN ('executive','super_admin','traffic_manager')) LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.meta_traffic_daily WHERE account_id='verification-meta-account')<>0
   OR (SELECT count(*) FROM public.traffic_suggestions WHERE subject='Teste de sugestão')<>0
 THEN RAISE EXCEPTION 'RLS permitiu dados a papel não autorizado'; END IF;
END $$;
RESET ROLE;
