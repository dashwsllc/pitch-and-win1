-- Meta-only traffic reporting and private collaboration for three roles.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE OR REPLACE FUNCTION public.traffic_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND public.registration_has_access()
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND NOT p.suspended)
   AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid()
     AND r.role::text IN ('executive','super_admin','traffic_manager'));
$$;
REVOKE ALL ON FUNCTION public.traffic_has_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.traffic_has_access() TO authenticated;

CREATE TABLE public.meta_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 imported_by uuid NOT NULL REFERENCES auth.users(id),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 180),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.meta_traffic_daily (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 date date NOT NULL,
 account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 80),
 account_name text NOT NULL DEFAULT '',
 campaign_id text NOT NULL CHECK(length(campaign_id) BETWEEN 1 AND 80),
 campaign_name text NOT NULL CHECK(length(campaign_name) BETWEEN 1 AND 160),
 adset_id text NOT NULL DEFAULT '',
 adset_name text NOT NULL DEFAULT '',
 ad_id text NOT NULL DEFAULT '',
 ad_name text NOT NULL DEFAULT '',
 level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 attribution_window text NOT NULL DEFAULT 'Conforme exportação Meta',
 spend numeric(16,2) NOT NULL CHECK(spend>=0 AND spend<=100000000),
 leads integer NOT NULL CHECK(leads>=0),
 purchases integer NOT NULL CHECK(purchases>=0),
 purchase_value numeric(16,2) NOT NULL DEFAULT 0 CHECK(purchase_value>=0),
 impressions bigint NOT NULL DEFAULT 0 CHECK(impressions>=0),
 reach bigint NOT NULL DEFAULT 0 CHECK(reach>=0),
 link_clicks bigint NOT NULL DEFAULT 0 CHECK(link_clicks>=0),
 imported_by uuid NOT NULL REFERENCES auth.users(id),
 import_batch_id uuid NOT NULL REFERENCES public.meta_import_batches(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(date,account_id,campaign_id,adset_id,ad_id),
 CHECK((level='campaign' AND adset_id='' AND ad_id='') OR
   (level='adset' AND adset_id<>'' AND ad_id='') OR
   (level='ad' AND adset_id<>'' AND ad_id<>''))
);
CREATE INDEX meta_traffic_daily_date_level ON public.meta_traffic_daily(date,level,account_id,campaign_id);

CREATE TABLE public.traffic_suggestions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 author_id uuid NOT NULL REFERENCES auth.users(id),
 author_name text NOT NULL,
 subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 160),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 5000),
 campaign_id text,
 status text NOT NULL DEFAULT 'nova' CHECK(status IN ('nova','em_analise','planejada','aplicada','descartada')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.traffic_suggestion_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 suggestion_id uuid NOT NULL REFERENCES public.traffic_suggestions(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES auth.users(id),
 author_name text NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 2 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX traffic_suggestion_replies_thread ON public.traffic_suggestion_replies(suggestion_id,created_at);

ALTER TABLE public.meta_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_traffic_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_suggestion_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_import_batches,public.meta_traffic_daily,public.traffic_suggestions,public.traffic_suggestion_replies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_import_batches,public.meta_traffic_daily,public.traffic_suggestions,public.traffic_suggestion_replies TO authenticated;
CREATE POLICY meta_import_read ON public.meta_import_batches FOR SELECT TO authenticated USING(public.traffic_has_access());
CREATE POLICY meta_daily_read ON public.meta_traffic_daily FOR SELECT TO authenticated USING(public.traffic_has_access());
CREATE POLICY traffic_suggestions_read ON public.traffic_suggestions FOR SELECT TO authenticated USING(public.traffic_has_access());
CREATE POLICY traffic_replies_read ON public.traffic_suggestion_replies FOR SELECT TO authenticated USING(public.traffic_has_access());

CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b uuid; item jsonb; v_count integer:=0; v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
   OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
 INSERT INTO public.meta_import_batches(imported_by,filename,row_count)
 VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows)) RETURNING id INTO b;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   v_date:=(item->>'date')::date;
   v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
   v_campaign:=btrim(coalesce(item->>'campaign_id',''));
   v_adset:=btrim(coalesce(item->>'adset_id','')); v_ad:=btrim(coalesce(item->>'ad_id',''));
   IF v_date IS NULL OR v_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date
     OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
     OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
     OR coalesce(item->>'currency','BRL')<>'BRL'
   THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
   INSERT INTO public.meta_traffic_daily(date,account_id,account_name,campaign_id,campaign_name,
     adset_id,adset_name,ad_id,ad_name,level,currency,attribution_window,spend,leads,purchases,
     purchase_value,impressions,reach,link_clicks,imported_by,import_batch_id)
   VALUES(v_date,v_account,left(coalesce(item->>'account_name',''),160),v_campaign,
     left(coalesce(item->>'campaign_name',''),160),v_adset,left(coalesce(item->>'adset_name',''),160),
     v_ad,left(coalesce(item->>'ad_name',''),160),v_level,'BRL',
     left(coalesce(nullif(item->>'attribution_window',''),'Conforme exportação Meta'),120),
     (item->>'spend')::numeric,(item->>'leads')::integer,(item->>'purchases')::integer,
     coalesce((item->>'purchase_value')::numeric,0),coalesce((item->>'impressions')::bigint,0),
     coalesce((item->>'reach')::bigint,0),coalesce((item->>'link_clicks')::bigint,0),auth.uid(),b)
   ON CONFLICT(date,account_id,campaign_id,adset_id,ad_id) DO UPDATE SET
     account_name=excluded.account_name,campaign_name=excluded.campaign_name,
     adset_name=excluded.adset_name,ad_name=excluded.ad_name,level=excluded.level,
     attribution_window=excluded.attribution_window,spend=excluded.spend,leads=excluded.leads,
     purchases=excluded.purchases,purchase_value=excluded.purchase_value,
     impressions=excluded.impressions,reach=excluded.reach,link_clicks=excluded.link_clicks,
     imported_by=excluded.imported_by,import_batch_id=excluded.import_batch_id,updated_at=clock_timestamp();
   v_count:=v_count+1;
 END LOOP;
 RETURN jsonb_build_object('batch_id',b,'rows',v_count);
END $$;
REVOKE ALL ON FUNCTION public.meta_import_daily(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_import_daily(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.traffic_create_suggestion(p_subject text,p_body text,p_campaign_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 INSERT INTO public.traffic_suggestions(author_id,author_name,subject,body,campaign_id)
 VALUES(auth.uid(),coalesce((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Equipe'),
   btrim(p_subject),btrim(p_body),nullif(btrim(p_campaign_id),'')) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.traffic_reply_suggestion(p_id uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.traffic_suggestions WHERE id=p_id) THEN RAISE EXCEPTION 'Sugestão não encontrada'; END IF;
 INSERT INTO public.traffic_suggestion_replies(suggestion_id,author_id,author_name,body)
 VALUES(p_id,auth.uid(),coalesce((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Equipe'),
   btrim(p_body)) RETURNING id INTO v_id;
 UPDATE public.traffic_suggestions SET updated_at=clock_timestamp() WHERE id=p_id;
 RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.traffic_set_suggestion_status(p_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 UPDATE public.traffic_suggestions SET status=p_status,updated_at=clock_timestamp() WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sugestão não encontrada'; END IF;
 INSERT INTO public.traffic_suggestion_replies(suggestion_id,author_id,author_name,body)
 VALUES(p_id,auth.uid(),coalesce((SELECT display_name FROM public.profiles WHERE user_id=auth.uid()),'Equipe'),
   'Status alterado para '||p_status);
END $$;
REVOKE ALL ON FUNCTION public.traffic_create_suggestion(text,text,text),public.traffic_reply_suggestion(uuid,text),public.traffic_set_suggestion_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.traffic_create_suggestion(text,text,text),public.traffic_reply_suggestion(uuid,text),public.traffic_set_suggestion_status(uuid,text) TO authenticated;

CREATE TRIGGER meta_traffic_signal AFTER INSERT OR UPDATE ON public.meta_traffic_daily FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER traffic_suggestions_signal AFTER INSERT OR UPDATE ON public.traffic_suggestions FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
CREATE TRIGGER traffic_replies_signal AFTER INSERT ON public.traffic_suggestion_replies FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('arena');
COMMIT;
