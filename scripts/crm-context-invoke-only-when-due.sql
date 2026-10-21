CREATE OR REPLACE FUNCTION public.crm_context_delivery_invoke() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_secret text; v_request bigint;
BEGIN
 IF NOT EXISTS(SELECT FROM public.crm_context_delivery_control WHERE singleton AND enabled) THEN RETURN NULL; END IF;
 -- Fila vazia ou sem nada vencido: nao chama a Edge Function (poupa a chamada HTTP, o registro do pg_net e IO a cada minuto).
 IF NOT EXISTS(SELECT FROM public.crm_context_outbox WHERE (state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp())) THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='crm_context_delivery_cron_secret' LIMIT 1;
 IF nullif(v_secret,'') IS NULL THEN RETURN NULL; END IF;
 SELECT net.http_post(url:='https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/voxen-context-delivery',
  headers:=jsonb_build_object('content-type','application/json','x-crm-cron-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=50000) INTO v_request;
 RETURN v_request;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
