-- Durable capture pages and one atomic, versioned human decision per revision.
BEGIN;
ALTER TABLE public.meta_sync_runs
 ADD COLUMN level text CHECK(level IN ('campaign','adset','ad')),
 ADD COLUMN coverage_state text NOT NULL DEFAULT 'legacy' CHECK(coverage_state IN ('legacy','partial','complete')),
 ADD COLUMN request_params jsonb, ADD COLUMN account_metadata jsonb, ADD COLUMN definition_version text,
 ADD COLUMN next_request jsonb, ADD COLUMN page_count integer NOT NULL DEFAULT 0 CHECK(page_count>=0),
 ADD COLUMN claim_token uuid, ADD COLUMN lease_until timestamptz, ADD COLUMN next_retry_at timestamptz;
ALTER TABLE public.meta_sync_runs DROP CONSTRAINT meta_sync_runs_status_check;
ALTER TABLE public.meta_sync_runs ADD CONSTRAINT meta_sync_runs_status_check CHECK(status IN ('running','partial','success','error'));
DROP INDEX public.meta_sync_runs_one_running;
CREATE UNIQUE INDEX meta_sync_runs_one_running ON public.meta_sync_runs(kind,coalesce(account_id,'')) WHERE status='running' AND level IS NULL;
CREATE UNIQUE INDEX meta_sync_runs_active_capture ON public.meta_sync_runs(account_id,level) WHERE level IS NOT NULL AND status IN ('running','partial');
CREATE TABLE public.meta_insights_pages (
 run_id uuid NOT NULL REFERENCES public.meta_sync_runs(id),page_no integer NOT NULL CHECK(page_no>=0),
 request_hash text NOT NULL,rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows)<=500),
 next_request jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(run_id,page_no)
);
CREATE TABLE public.meta_capture_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id text NOT NULL,level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
 window_start date NOT NULL,window_end date NOT NULL CHECK(window_end>=window_start),
 status text NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado','substituido')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),manifest jsonb NOT NULL,sync_run_id uuid NOT NULL REFERENCES public.meta_sync_runs(id),
 reviewed_by uuid REFERENCES auth.users(id),reviewed_at timestamptz,review_note text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX meta_capture_pending_review ON public.meta_capture_reviews(account_id,level) WHERE status='pendente';
CREATE TABLE public.meta_capture_review_rows (
 review_id uuid NOT NULL REFERENCES public.meta_capture_reviews(id),row_no integer NOT NULL,
 original_key jsonb NOT NULL,effective_key jsonb NOT NULL,operation text NOT NULL CHECK(operation IN ('upsert','remove')),
 payload jsonb NOT NULL,before_snapshot jsonb,before_version timestamptz,
 edited boolean NOT NULL DEFAULT false,edit_reason text,conflict_details jsonb,
 PRIMARY KEY(review_id,row_no),UNIQUE(review_id,original_key),UNIQUE(review_id,effective_key)
);
ALTER TABLE public.meta_import_batches ADD COLUMN replaced_by_review_id uuid REFERENCES public.meta_capture_reviews(id);
DROP INDEX public.meta_pending_api_batch;
CREATE UNIQUE INDEX meta_pending_api_batch ON public.meta_import_batches(account_id,level) WHERE source='api' AND status='pendente' AND replaced_by_review_id IS NULL;
ALTER TABLE public.meta_traffic_daily ADD COLUMN available_metrics text[],ADD COLUMN metric_metadata jsonb,
 ADD COLUMN original_key jsonb,ADD COLUMN capture_review_id uuid REFERENCES public.meta_capture_reviews(id),ADD COLUMN first_origin jsonb;
ALTER TABLE public.meta_audit_events DROP CONSTRAINT meta_audit_events_entity_type_check;
ALTER TABLE public.meta_audit_events ADD CONSTRAINT meta_audit_events_entity_type_check CHECK(entity_type IN ('lead','lead_batch','metrics_batch','metrics_row','capture_review'));
ALTER TABLE public.meta_audit_events DROP CONSTRAINT meta_audit_events_origin_check;
ALTER TABLE public.meta_audit_events ADD CONSTRAINT meta_audit_events_origin_check CHECK(origin IN ('api','csv','manual_legacy'));
ALTER TABLE public.meta_insights_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_capture_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_capture_review_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_insights_pages,public.meta_capture_review_rows,public.meta_capture_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_insights_pages,public.meta_capture_review_rows,public.meta_capture_reviews TO service_role;
GRANT SELECT ON public.meta_capture_reviews TO authenticated;
CREATE POLICY traffic_reviews_read ON public.meta_capture_reviews FOR SELECT TO authenticated USING(public.traffic_has_access());

CREATE FUNCTION public.meta_capture_require_service() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Serviço necessário' USING ERRCODE='42501'; END IF; END $$;
CREATE FUNCTION public.meta_capture_check_claim(p_id uuid,p_claim uuid) RETURNS public.meta_sync_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_sync_runs;
BEGIN
 PERFORM public.meta_capture_require_service();
 SELECT * INTO r FROM public.meta_sync_runs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.level IS NULL OR r.status NOT IN ('running','partial') OR r.claim_token IS DISTINCT FROM p_claim
   OR p_claim IS NULL OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Lease da captura expirado' USING ERRCODE='40001'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION public.meta_capture_open(p_account_id text,p_level text,p_start date,p_end date,p_params jsonb,p_metadata jsonb,p_triggered_by text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account text; id uuid; tz text;
BEGIN
 PERFORM public.meta_capture_require_service();account:=public.meta_normalize_account_id(p_account_id);PERFORM public.meta_assert_account_identity(account);
 SELECT timezone INTO tz FROM public.meta_ad_accounts WHERE account_id=account AND status='active';
 IF NOT FOUND OR p_level IS NULL OR p_level NOT IN ('campaign','adset','ad') OR p_start IS NULL OR p_end IS NULL OR p_end<p_start
   OR p_end>(now() AT TIME ZONE tz)::date OR p_end-p_start>31 OR p_metadata->>'currency' IS DISTINCT FROM 'BRL'
   OR public.meta_normalize_account_id(p_metadata->>'id') IS DISTINCT FROM account
   OR p_metadata->>'timezone' IS DISTINCT FROM tz OR p_params ?| ARRAY['access_token','appsecret_proof']
   OR p_params->>'level' IS DISTINCT FROM p_level
   OR (p_params->>'time_range')::jsonb->>'since' IS DISTINCT FROM p_start::text
   OR (p_params->>'time_range')::jsonb->>'until' IS DISTINCT FROM p_end::text THEN
   RAISE EXCEPTION 'Escopo de captura inválido' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-capture:'||account||':'||p_level,0));
 SELECT r.id INTO id FROM public.meta_sync_runs r WHERE r.account_id=account AND r.level=p_level AND status IN ('running','partial');
 IF id IS NOT NULL THEN RETURN id; END IF;
 INSERT INTO public.meta_sync_runs(kind,account_id,level,window_start,window_end,request_params,account_metadata,definition_version,coverage_state,triggered_by,triggered_by_user,next_request)
 VALUES('insights',account,p_level,p_start,p_end,p_params,p_metadata,'canonical-v1','partial',p_triggered_by,p_actor,
   jsonb_build_object('path','/act_'||account||'/insights','params',p_params)) RETURNING meta_sync_runs.id INTO id;
 RETURN id;
END $$;
CREATE FUNCTION public.meta_capture_claim(p_id uuid,p_lease_seconds integer DEFAULT 60) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_sync_runs; claim uuid:=gen_random_uuid();
BEGIN
 PERFORM public.meta_capture_require_service();
 SELECT * INTO r FROM public.meta_sync_runs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.level IS NULL OR r.status NOT IN ('running','partial') THEN RAISE EXCEPTION 'Captura indisponível' USING ERRCODE='55000'; END IF;
 IF r.lease_until>clock_timestamp() OR r.next_retry_at>clock_timestamp() THEN RETURN NULL; END IF;
 UPDATE public.meta_sync_runs SET status='running',claim_token=claim,lease_until=clock_timestamp()+make_interval(secs=>least(60,greatest(1,p_lease_seconds))) WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.meta_capture_append(p_id uuid,p_claim uuid,p_page_no integer,p_request_hash text,p_rows jsonb,p_next jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_sync_runs; old public.meta_insights_pages; item jsonb; params jsonb;
BEGIN
 r:=public.meta_capture_check_claim(p_id,p_claim);
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500 OR length(coalesce(p_request_hash,'')) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Página inválida' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.meta_insights_pages WHERE run_id=p_id AND page_no=p_page_no;
 IF FOUND THEN
     IF old.request_hash<>p_request_hash OR old.rows<>p_rows OR old.next_request IS DISTINCT FROM (CASE WHEN p_next IS NULL THEN NULL ELSE jsonb_build_object('path',p_next->>'path','params',r.request_params||(p_next->'params')) END) THEN RAISE EXCEPTION 'Replay de página divergente' USING ERRCODE='40001'; END IF;
   RETURN jsonb_build_object('page_count',r.page_count,'next_request',r.next_request);
 END IF;
 IF p_page_no IS DISTINCT FROM r.page_count OR r.next_request IS NULL THEN RAISE EXCEPTION 'Página fora de sequência' USING ERRCODE='22023'; END IF;
 IF p_next IS NOT NULL THEN
   params:=p_next->'params';
   IF p_next->>'path' IS DISTINCT FROM '/act_'||r.account_id||'/insights' OR jsonb_typeof(params) IS DISTINCT FROM 'object'
     OR params ?| ARRAY['access_token','appsecret_proof'] OR NOT params ? 'after'
     OR EXISTS(SELECT 1 FROM jsonb_each_text(params) p WHERE p.key NOT IN ('after','before') AND r.request_params->>p.key IS DISTINCT FROM p.value) THEN
     RAISE EXCEPTION 'Cursor fora do escopo' USING ERRCODE='22023'; END IF;
   -- Store the canonical parameters, never rely on a shortened echoed query.
   p_next:=jsonb_build_object('path',p_next->>'path','params',r.request_params||params);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   PERFORM public.meta_validate_traffic_row(item);
   IF public.meta_normalize_account_id(item->>'account_id')<>r.account_id OR item->>'level'<>r.level
     OR (item->>'date')::date NOT BETWEEN r.window_start AND r.window_end THEN RAISE EXCEPTION 'Linha fora da captura' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO public.meta_insights_pages VALUES(p_id,p_page_no,p_request_hash,p_rows,p_next,clock_timestamp());
 UPDATE public.meta_sync_runs SET page_count=page_count+1,next_request=p_next,rows_synced=rows_synced+jsonb_array_length(p_rows) WHERE id=p_id RETURNING * INTO r;
 RETURN jsonb_build_object('page_count',r.page_count,'next_request',r.next_request);
END $$;
CREATE FUNCTION public.meta_capture_release(p_id uuid,p_claim uuid,p_error text DEFAULT NULL,p_retry_at timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.meta_capture_check_claim(p_id,p_claim);
 UPDATE public.meta_sync_runs SET status='partial',claim_token=NULL,lease_until=NULL,error_message=left(p_error,1000),next_retry_at=p_retry_at WHERE id=p_id;
END $$;

-- Adds a frozen candidate, combining colliding identities into an explicit conflict.
CREATE FUNCTION public.meta_capture_candidate(p_review uuid,p_original jsonb,p_payload jsonb,p_operation text,p_edited boolean,p_reason text,p_conflict jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE effective jsonb:=public.meta_traffic_identity(p_payload)::jsonb; existing public.meta_capture_review_rows; published public.meta_traffic_daily; n int;
BEGIN
 SELECT * INTO existing FROM public.meta_capture_review_rows WHERE review_id=p_review AND (original_key=p_original OR effective_key=effective) FOR UPDATE;
 IF FOUND THEN
   IF existing.original_key=p_original THEN RETURN; END IF;
   UPDATE public.meta_capture_review_rows SET conflict_details=jsonb_build_object('reason','identity_collision','edited',existing.payload,'incoming',p_payload,
     'previous',existing.conflict_details,'incoming_original_key',p_original) WHERE review_id=p_review AND row_no=existing.row_no;
   RETURN;
 END IF;
 SELECT * INTO published FROM public.meta_traffic_daily WHERE date=(effective->>0)::date AND account_id=effective->>1 AND campaign_id=effective->>2 AND adset_id=effective->>3 AND ad_id=effective->>4;
 IF published.id IS NULL THEN
   SELECT * INTO published FROM public.meta_traffic_daily WHERE original_key=p_original;
 END IF;
 IF published.traffic_edited_at IS NOT NULL OR (published.id IS NOT NULL AND published.source<>'api') THEN
   p_conflict:=coalesce(p_conflict,jsonb_build_object('reason','published_requires_review','incoming',CASE WHEN p_operation='upsert' THEN p_payload END,'published',to_jsonb(published)));
 END IF;
 SELECT coalesce(max(row_no)+1,0) INTO n FROM public.meta_capture_review_rows WHERE review_id=p_review;
 INSERT INTO public.meta_capture_review_rows(review_id,row_no,original_key,effective_key,operation,payload,before_snapshot,before_version,edited,edit_reason,conflict_details)
 VALUES(p_review,n,p_original,effective,p_operation,p_payload,CASE WHEN published.id IS NOT NULL THEN to_jsonb(published) END,published.updated_at,coalesce(p_edited,false),p_reason,p_conflict);
END $$;
CREATE FUNCTION public.meta_capture_prepare(p_id uuid,p_claim uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_sync_runs; previous public.meta_capture_reviews; review uuid; row public.meta_capture_review_rows; item jsonb; fact public.meta_traffic_daily; b public.meta_import_batches;
BEGIN
 r:=public.meta_capture_check_claim(p_id,p_claim);
 IF r.next_request IS NOT NULL OR r.page_count=0 OR (SELECT count(*) FROM public.meta_insights_pages WHERE run_id=p_id)<>r.page_count THEN
   RAISE EXCEPTION 'Captura incompleta não pode ser revisada' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.meta_insights_pages p CROSS JOIN LATERAL jsonb_array_elements(p.rows) captured(value) WHERE run_id=p_id
   GROUP BY public.meta_traffic_identity(captured.value) HAVING count(*)>1) THEN RAISE EXCEPTION 'Identidades duplicadas na captura' USING ERRCODE='23505'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-capture:'||r.account_id||':'||r.level,0));
 SELECT * INTO previous FROM public.meta_capture_reviews WHERE account_id=r.account_id AND level=r.level AND status='pendente' FOR UPDATE;
 IF previous.id IS NOT NULL THEN UPDATE public.meta_capture_reviews SET status='substituido',version=version+1,updated_at=clock_timestamp() WHERE id=previous.id; END IF;
 INSERT INTO public.meta_capture_reviews(account_id,level,window_start,window_end,sync_run_id,manifest)
 VALUES(r.account_id,r.level,r.window_start,r.window_end,p_id,jsonb_build_object('version',1,'definition_version',r.definition_version,'account',r.account_metadata,
   'segments',coalesce(previous.manifest->'segments','[]')||jsonb_build_array(jsonb_build_object('start',r.window_start,'end',r.window_end,'run_id',p_id,'coverage','complete')),
   'page_count',r.page_count,'rows_captured',r.rows_synced)) RETURNING id INTO review;
 -- Edited rows retain their original identity, even when the new capture omits them.
 FOR row IN SELECT * FROM public.meta_capture_review_rows WHERE review_id=previous.id ORDER BY row_no LOOP
   IF row.edited OR (row.payload->>'date')::date NOT BETWEEN r.window_start AND r.window_end THEN
     PERFORM public.meta_capture_candidate(review,row.original_key,row.payload,row.operation,row.edited,row.edit_reason,row.conflict_details);
   END IF;
 END LOOP;
 FOR b IN SELECT * FROM public.meta_import_batches WHERE source='api' AND status='pendente' AND account_id=r.account_id AND level=r.level AND replaced_by_review_id IS NULL FOR UPDATE LOOP
   FOR item IN SELECT value FROM jsonb_array_elements(b.rows) LOOP
     IF item->>'traffic_edited'='true' OR (item->>'date')::date NOT BETWEEN r.window_start AND r.window_end THEN
       PERFORM public.meta_capture_candidate(review,public.meta_traffic_identity(coalesce(item->'traffic_original',item))::jsonb,
         item||jsonb_build_object('sync_run_id',b.sync_run_id),'upsert',item->>'traffic_edited'='true','Edição do lote legado');
     END IF;
   END LOOP;
   UPDATE public.meta_import_batches SET replaced_by_review_id=review,updated_at=clock_timestamp() WHERE id=b.id;
 END LOOP;
 FOR item IN SELECT value FROM public.meta_insights_pages p CROSS JOIN LATERAL jsonb_array_elements(p.rows) WHERE run_id=p_id ORDER BY page_no,value->>'date',value->>'campaign_id' LOOP
   PERFORM public.meta_capture_candidate(review,public.meta_traffic_identity(item)::jsonb,item||jsonb_build_object('sync_run_id',p_id),'upsert',false,NULL);
 END LOOP;
 FOR fact IN SELECT * FROM public.meta_traffic_daily WHERE account_id=r.account_id AND level=r.level AND date BETWEEN r.window_start AND r.window_end ORDER BY date,campaign_id,adset_id,ad_id LOOP
   IF NOT EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=review AND
     (effective_key=public.meta_traffic_identity(to_jsonb(fact))::jsonb OR original_key=coalesce(fact.original_key,public.meta_traffic_identity(to_jsonb(fact))::jsonb))) THEN
     -- Non-API and manually edited facts become conflicts; no implicit deletion.
     PERFORM public.meta_capture_candidate(review,coalesce(fact.original_key,public.meta_traffic_identity(to_jsonb(fact))::jsonb),
       to_jsonb(fact),'remove',false,NULL,CASE WHEN fact.source<>'api' OR fact.traffic_edited_at IS NOT NULL THEN jsonb_build_object('reason','absent_requires_review','published',to_jsonb(fact)) END);
   END IF;
 END LOOP;
 UPDATE public.meta_sync_runs SET status='success',coverage_state='complete',claim_token=NULL,lease_until=NULL,finished_at=clock_timestamp(),error_message=NULL WHERE id=p_id;
 PERFORM public.meta_record_edit('capture_review',review,'capture.prepared','api',jsonb_build_object('run_id',p_id,'replaced_review',previous.id,'manifest',(SELECT manifest FROM public.meta_capture_reviews WHERE id=review)));
 RETURN review;
END $$;

CREATE FUNCTION public.meta_capture_check_review(p_id uuid,p_version bigint) RETURNS public.meta_capture_reviews
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews;
BEGIN
 IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.meta_capture_reviews WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Revisão não encontrada' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-capture:'||r.account_id||':'||r.level,0));
 SELECT * INTO r FROM public.meta_capture_reviews WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.version IS DISTINCT FROM p_version OR r.status<>'pendente' THEN RAISE EXCEPTION 'Revisão alterada ou já decidida; recarregue' USING ERRCODE='40001'; END IF;
 PERFORM set_config('meta.capture_review',r.id::text,true);
 RETURN r;
END $$;
CREATE FUNCTION public.meta_capture_review_part(p_id uuid,p_version bigint,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; total int; part jsonb;
BEGIN
 r:=public.meta_capture_check_review(p_id,p_version);
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Parte inválida' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.meta_capture_review_rows WHERE review_id=p_id;
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.row_no),'[]') INTO part FROM
   (SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_id ORDER BY row_no OFFSET p_offset LIMIT p_limit) page;
 RETURN jsonb_build_object('id',r.id,'version',r.version,'total',total,'rows',part,'manifest',r.manifest,'next_offset',CASE WHEN p_offset+p_limit<total THEN p_offset+p_limit END);
END $$;
CREATE FUNCTION public.meta_capture_review_edit(p_id uuid,p_version bigint,p_row_no integer,p_patch jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; row public.meta_capture_review_rows; candidate jsonb; key jsonb;
BEGIN
 r:=public.meta_capture_check_review(p_id,p_version);PERFORM public.meta_validate_edit('metrics',p_patch,p_reason);
 SELECT * INTO STRICT row FROM public.meta_capture_review_rows WHERE review_id=p_id AND row_no=p_row_no;
 IF row.operation<>'upsert' OR row.conflict_details IS NOT NULL THEN RAISE EXCEPTION 'Resolva o conflito antes de editar' USING ERRCODE='55000'; END IF;
 candidate:=row.payload||p_patch;
 candidate:=candidate||jsonb_build_object('account_id',public.meta_normalize_account_id(candidate->>'account_id'));
 PERFORM public.meta_validate_traffic_row(candidate);key:=public.meta_traffic_identity(candidate)::jsonb;
 IF candidate->>'account_id'<>r.account_id OR candidate->>'level'<>r.level THEN RAISE EXCEPTION 'Conta e nível pertencem à revisão' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=p_id AND row_no<>p_row_no AND effective_key=key)
   OR EXISTS(SELECT 1 FROM public.meta_traffic_daily d WHERE d.date=(key->>0)::date AND d.account_id=key->>1 AND d.campaign_id=key->>2 AND d.adset_id=key->>3 AND d.ad_id=key->>4 AND d.id IS DISTINCT FROM (row.before_snapshot->>'id')::uuid) THEN
   RAISE EXCEPTION 'Identidade ocupada' USING ERRCODE='23505'; END IF;
 UPDATE public.meta_capture_review_rows SET payload=candidate,effective_key=key,edited=true,edit_reason=btrim(p_reason) WHERE review_id=p_id AND row_no=p_row_no;
 UPDATE public.meta_capture_reviews SET version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO r;
 PERFORM public.meta_record_edit('capture_review',p_id,'capture.row_edited','api',jsonb_build_object('row',p_row_no,'reason',p_reason,'before',row.payload,'after',candidate));
 RETURN jsonb_build_object('id',p_id,'version',r.version);
END $$;
CREATE FUNCTION public.meta_capture_review_resolve(p_id uuid,p_version bigint,p_row_no integer,p_action text,p_payload jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; row public.meta_capture_review_rows; candidate jsonb; key jsonb; published public.meta_traffic_daily;
BEGIN
 r:=public.meta_capture_check_review(p_id,p_version);
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 OR p_action IS NULL OR p_action NOT IN ('keep_published','use_incoming','use_edited','remove') THEN RAISE EXCEPTION 'Escolha e motivo necessários' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT row FROM public.meta_capture_review_rows WHERE review_id=p_id AND row_no=p_row_no;
 IF row.conflict_details IS NULL THEN RAISE EXCEPTION 'Linha sem conflito' USING ERRCODE='55000'; END IF;
 SELECT * INTO published FROM public.meta_traffic_daily WHERE id=(row.before_snapshot->>'id')::uuid FOR UPDATE;
 IF p_action='keep_published' THEN
   IF published.id IS NULL THEN RAISE EXCEPTION 'Fato publicado não existe' USING ERRCODE='40001'; END IF;
   DELETE FROM public.meta_capture_review_rows WHERE review_id=p_id AND row_no=p_row_no;
 ELSIF p_action='remove' THEN
   IF published.id IS NULL THEN RAISE EXCEPTION 'Fato publicado não existe' USING ERRCODE='40001'; END IF;
   UPDATE public.meta_capture_review_rows SET operation='remove',payload=to_jsonb(published),effective_key=public.meta_traffic_identity(to_jsonb(published))::jsonb,
     before_snapshot=to_jsonb(published),before_version=published.updated_at,conflict_details=NULL,edited=true,edit_reason=p_reason WHERE review_id=p_id AND row_no=p_row_no;
 ELSE
   IF p_action='use_edited' THEN PERFORM public.meta_validate_edit('metrics',coalesce(p_payload,'{}'),p_reason); END IF;
   candidate:=CASE WHEN p_action='use_incoming' THEN row.conflict_details->'incoming' ELSE row.payload||coalesce(p_payload,'{}') END;
   IF candidate IS NULL THEN RAISE EXCEPTION 'Candidato ausente' USING ERRCODE='22023'; END IF;
   candidate:=candidate||jsonb_build_object('account_id',public.meta_normalize_account_id(candidate->>'account_id'));
   PERFORM public.meta_validate_traffic_row(candidate);key:=public.meta_traffic_identity(candidate)::jsonb;
   IF candidate->>'account_id'<>r.account_id OR candidate->>'level'<>r.level OR EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=p_id AND row_no<>p_row_no AND effective_key=key) THEN
     RAISE EXCEPTION 'Identidade ocupada ou fora da revisão' USING ERRCODE='23505'; END IF;
   SELECT * INTO published FROM public.meta_traffic_daily WHERE date=(key->>0)::date AND account_id=key->>1 AND campaign_id=key->>2 AND adset_id=key->>3 AND ad_id=key->>4 FOR UPDATE;
   UPDATE public.meta_capture_review_rows SET operation='upsert',payload=candidate,effective_key=key,before_snapshot=CASE WHEN published.id IS NOT NULL THEN to_jsonb(published) END,
     before_version=published.updated_at,conflict_details=NULL,edited=true,edit_reason=p_reason WHERE review_id=p_id AND row_no=p_row_no;
 END IF;
 UPDATE public.meta_capture_reviews SET version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO r;
 PERFORM public.meta_record_edit('capture_review',p_id,'capture.conflict_resolved','api',jsonb_build_object('row',p_row_no,'action',p_action,'reason',p_reason,'candidates',row.conflict_details,'before',row.payload,'after',candidate));
 RETURN jsonb_build_object('id',p_id,'version',r.version);
END $$;
CREATE FUNCTION public.meta_capture_review_decide(p_id uuid,p_version bigint,p_action text,p_note text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.meta_capture_reviews; row public.meta_capture_review_rows; fact public.meta_traffic_daily; inserted int:=0; updated int:=0; removed int:=0; item jsonb;
BEGIN
 r:=public.meta_capture_check_review(p_id,p_version);
 IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') OR (p_action='rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500) THEN RAISE EXCEPTION 'Decisão ou motivo inválidos' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meta-capture:'||r.account_id||':'||r.level,0));
 IF p_action='aprovar' THEN
   IF EXISTS(SELECT 1 FROM public.meta_capture_review_rows WHERE review_id=p_id AND conflict_details IS NOT NULL) THEN RAISE EXCEPTION 'Resolva os conflitos antes de aprovar' USING ERRCODE='40001'; END IF;
   -- Lock and verify every target before applying any row. Unique constraints also
   -- protect the absent-target race with CSV or a concurrent published edit.
   FOR row IN SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_id ORDER BY effective_key::text LOOP
     PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||row.effective_key::text,0));
     SELECT * INTO fact FROM public.meta_traffic_daily WHERE date=(row.effective_key->>0)::date AND account_id=row.effective_key->>1 AND campaign_id=row.effective_key->>2 AND adset_id=row.effective_key->>3 AND ad_id=row.effective_key->>4 FOR UPDATE;
     IF row.before_snapshot IS NOT NULL AND fact.id IS NULL THEN
       SELECT * INTO fact FROM public.meta_traffic_daily WHERE id=(row.before_snapshot->>'id')::uuid FOR UPDATE;
     END IF;
     IF fact.updated_at IS DISTINCT FROM row.before_version OR (fact.id IS NOT NULL AND fact.id IS DISTINCT FROM (row.before_snapshot->>'id')::uuid) THEN
       RAISE EXCEPTION 'Fato publicado mudou; recapture e revise' USING ERRCODE='40001'; END IF;
   END LOOP;
   FOR row IN SELECT * FROM public.meta_capture_review_rows WHERE review_id=p_id ORDER BY effective_key::text LOOP
     IF row.operation='remove' THEN
       DELETE FROM public.meta_traffic_daily WHERE id=(row.before_snapshot->>'id')::uuid;
       removed:=removed+1;
       PERFORM public.meta_record_edit('metrics_row',(row.before_snapshot->>'id')::uuid,'metric.removed',row.before_snapshot->>'source',jsonb_build_object('review_id',p_id,'reason',coalesce(row.edit_reason,'Ausente na captura completa aprovada'),'before',row.before_snapshot));
     ELSE
       item:=row.payload||jsonb_build_object('capture_review_id',p_id,'original_key',row.original_key);
       IF row.before_snapshot IS NOT NULL AND public.meta_traffic_identity(row.before_snapshot)::jsonb<>row.effective_key THEN
         -- A reviewed identity correction keeps the existing fact and first origin.
         PERFORM public.meta_edit_traffic_row((row.before_snapshot->>'id')::uuid,row.before_version,
           jsonb_build_object('date',item->>'date','account_id',item->>'account_id','campaign_id',item->>'campaign_id','adset_id',coalesce(item->>'adset_id',''),'ad_id',coalesce(item->>'ad_id','')),
           coalesce(row.edit_reason,'Identidade corrigida na revisão'));
       END IF;
       PERFORM public.meta_upsert_traffic_row(item,'api',auth.uid(),NULL,coalesce((item->>'sync_run_id')::uuid,r.sync_run_id));
       IF row.edited THEN
         UPDATE public.meta_traffic_daily SET traffic_edited_at=clock_timestamp(),traffic_edit_reason=coalesce(row.edit_reason,'Correção aprovada na revisão')
           WHERE date=(row.effective_key->>0)::date AND account_id=row.effective_key->>1 AND campaign_id=row.effective_key->>2
             AND adset_id=row.effective_key->>3 AND ad_id=row.effective_key->>4;
       END IF;
       IF row.before_snapshot IS NULL THEN inserted:=inserted+1; ELSE updated:=updated+1; END IF;
     END IF;
   END LOOP;
 END IF;
 UPDATE public.meta_capture_reviews SET status=CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,version=version+1,
   reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=nullif(btrim(p_note),''),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO r;
 PERFORM public.meta_record_edit('capture_review',p_id,'capture.'||r.status,'api',jsonb_build_object('version',p_version,'inserted',inserted,'updated',updated,'removed',removed,'note',p_note,'manifest',r.manifest));
 RETURN jsonb_build_object('id',p_id,'status',r.status,'version',r.version,'inserted',inserted,'updated',updated,'removed',removed);
END $$;

REVOKE ALL ON FUNCTION public.meta_capture_require_service(),public.meta_capture_check_claim(uuid,uuid),public.meta_capture_candidate(uuid,jsonb,jsonb,text,boolean,text,jsonb),public.meta_capture_check_review(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.meta_capture_open(text,text,date,date,jsonb,jsonb,text,uuid),public.meta_capture_claim(uuid,integer),public.meta_capture_append(uuid,uuid,integer,text,jsonb,jsonb),public.meta_capture_release(uuid,uuid,text,timestamptz),public.meta_capture_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capture_open(text,text,date,date,jsonb,jsonb,text,uuid),public.meta_capture_claim(uuid,integer),public.meta_capture_append(uuid,uuid,integer,text,jsonb,jsonb),public.meta_capture_release(uuid,uuid,text,timestamptz),public.meta_capture_prepare(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.meta_capture_review_part(uuid,bigint,integer,integer),public.meta_capture_review_edit(uuid,bigint,integer,jsonb,text),public.meta_capture_review_resolve(uuid,bigint,integer,text,jsonb,text),public.meta_capture_review_decide(uuid,bigint,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.meta_capture_review_part(uuid,bigint,integer,integer),public.meta_capture_review_edit(uuid,bigint,integer,jsonb,text),public.meta_capture_review_resolve(uuid,bigint,integer,text,jsonb,text),public.meta_capture_review_decide(uuid,bigint,text,text) TO authenticated;
-- Preserve CSV patches and legacy lineage while incorporating old pending API batches.
CREATE OR REPLACE FUNCTION public.meta_upsert_traffic_row(item jsonb, p_source text, p_imported_by uuid, p_import_batch_id uuid, p_sync_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||public.meta_traffic_identity(item),0));
  item:=item||jsonb_build_object('account_id',public.meta_normalize_account_id(item->>'account_id'));
  PERFORM public.meta_validate_traffic_row(item);
  v_date:=(item->>'date')::date;
  v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
  v_campaign:=btrim(coalesce(item->>'campaign_id','')); v_adset:=btrim(coalesce(item->>'adset_id',''));
  v_ad:=btrim(coalesce(item->>'ad_id',''));
  IF v_date IS NULL
    OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
    OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
    OR coalesce(item->>'currency','BRL')<>'BRL'
  THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
  INSERT INTO public.meta_traffic_daily(date,account_id,account_name,campaign_id,campaign_name,
    adset_id,adset_name,ad_id,ad_name,level,currency,attribution_window,objective,spend,leads,purchases,
    purchase_value,impressions,reach,link_clicks,messaging_conversations_started,
    source,imported_by,import_batch_id,sync_run_id,available_metrics,metric_metadata,original_key,capture_review_id,first_origin)
  VALUES(v_date,v_account,left(coalesce(item->>'account_name',''),160),v_campaign,
    left(coalesce(item->>'campaign_name',''),160),v_adset,left(coalesce(item->>'adset_name',''),160),
    v_ad,left(coalesce(item->>'ad_name',''),160),v_level,'BRL',
    left(coalesce(nullif(item->>'attribution_window',''),'Conforme exportação Meta'),120),
    left(coalesce(nullif(item->>'objective',''),'nao_informado'),160),
    (item->>'spend')::numeric,(item->>'leads')::integer,(item->>'purchases')::integer,
    coalesce((item->>'purchase_value')::numeric,0),coalesce((item->>'impressions')::bigint,0),
    coalesce((item->>'reach')::bigint,0),coalesce((item->>'link_clicks')::bigint,0),
    coalesce((item->>'messaging_conversations_started')::bigint,0),
    p_source,p_imported_by,p_import_batch_id,p_sync_run_id,
    CASE WHEN item ? 'available_metrics' THEN ARRAY(SELECT jsonb_array_elements_text(item->'available_metrics'))
      WHEN item ? 'present_metrics' THEN ARRAY['spend']||ARRAY(SELECT jsonb_array_elements_text(item->'present_metrics')) END,
    item->'metric_metadata',coalesce(item->'original_key',public.meta_traffic_identity(item)::jsonb),(item->>'capture_review_id')::uuid,
    jsonb_build_object('source',p_source,'imported_by',p_imported_by,'import_batch_id',p_import_batch_id,'sync_run_id',p_sync_run_id))
  ON CONFLICT(date,account_id,campaign_id,adset_id,ad_id) DO UPDATE SET
    account_name=excluded.account_name,campaign_name=excluded.campaign_name,
    adset_name=excluded.adset_name,ad_name=excluded.ad_name,level=excluded.level,
    attribution_window=excluded.attribution_window,spend=excluded.spend,
    objective=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'objective' THEN excluded.objective ELSE meta_traffic_daily.objective END,
    leads=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'leads' THEN excluded.leads ELSE meta_traffic_daily.leads END,
    purchases=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchases' THEN excluded.purchases ELSE meta_traffic_daily.purchases END,
    purchase_value=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'purchase_value' THEN excluded.purchase_value ELSE meta_traffic_daily.purchase_value END,
    impressions=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'impressions' THEN excluded.impressions ELSE meta_traffic_daily.impressions END,
    reach=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'reach' THEN excluded.reach ELSE meta_traffic_daily.reach END,
    link_clicks=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'link_clicks' THEN excluded.link_clicks ELSE meta_traffic_daily.link_clicks END,
    messaging_conversations_started=CASE WHEN item->'present_metrics' IS NULL OR item->'present_metrics' ? 'messaging_conversations_started' THEN excluded.messaging_conversations_started ELSE meta_traffic_daily.messaging_conversations_started END,
    source=excluded.source,imported_by=excluded.imported_by,import_batch_id=excluded.import_batch_id,
    sync_run_id=excluded.sync_run_id,
    available_metrics=CASE WHEN item ? 'available_metrics' THEN excluded.available_metrics
      WHEN item ? 'present_metrics' AND meta_traffic_daily.available_metrics IS NOT NULL THEN ARRAY(SELECT DISTINCT m FROM unnest(meta_traffic_daily.available_metrics||excluded.available_metrics) m)
      ELSE meta_traffic_daily.available_metrics END,
    metric_metadata=CASE WHEN item ? 'metric_metadata' THEN excluded.metric_metadata ELSE meta_traffic_daily.metric_metadata END,
    original_key=coalesce(meta_traffic_daily.original_key,public.meta_traffic_identity(to_jsonb(meta_traffic_daily))::jsonb),
    capture_review_id=excluded.capture_review_id,
    first_origin=coalesce(meta_traffic_daily.first_origin,jsonb_build_object('source',meta_traffic_daily.source,'imported_by',meta_traffic_daily.imported_by,'import_batch_id',meta_traffic_daily.import_batch_id,'sync_run_id',meta_traffic_daily.sync_run_id)),
    updated_at=clock_timestamp();
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_review_traffic_import(p_batch_id uuid, p_action text, p_expected_updated_at timestamp with time zone, p_note text DEFAULT ''::text)
 RETURNS meta_import_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE b public.meta_import_batches; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.replaced_by_review_id IS NOT NULL THEN RAISE EXCEPTION 'Lote incorporado à revisão; recarregue' USING ERRCODE='40001'; END IF;
  IF b.status <> 'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action = 'rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)';
  END IF;
  IF p_action = 'aprovar' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(b.rows) LOOP
      PERFORM public.meta_upsert_traffic_row(item,b.source,b.imported_by,b.id,
        CASE WHEN b.source='api' THEN coalesce((item->>'sync_run_id')::uuid,b.sync_run_id) END);
    END LOOP;
  END IF;
  UPDATE public.meta_import_batches SET
    status = CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    review_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = clock_timestamp()
  WHERE id = p_batch_id
  RETURNING * INTO b;
  RETURN b;
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_import_daily_system(p_rows jsonb, p_sync_run_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE item jsonb; batch public.meta_import_batches; account text; row_level text; merged jsonb; incoming jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Quantidade de linhas inválida'; END IF;
  SELECT account_id INTO account FROM public.meta_sync_runs WHERE id=p_sync_run_id AND status='running' AND kind='insights';
  IF NOT FOUND THEN RAISE EXCEPTION 'Captura inválida ou não está em execução'; END IF;
  row_level:=p_rows->0->>'level';
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_validate_traffic_row(item);
    IF btrim(item->>'account_id') IS DISTINCT FROM account OR item->>'level' IS DISTINCT FROM row_level THEN RAISE EXCEPTION 'Conta ou nível diferente da captura'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-pending:'||account||':'||row_level,0));
  SELECT * INTO batch FROM public.meta_import_batches WHERE source='api' AND account_id=account AND level=row_level AND status='pendente' AND replaced_by_review_id IS NULL FOR UPDATE;
  SELECT jsonb_agg(value||jsonb_build_object('sync_run_id',p_sync_run_id)) INTO incoming FROM jsonb_array_elements(p_rows) incoming_row(value)
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(batch.rows,'[]')) edited
      WHERE edited->>'traffic_edited'='true' AND
        ROW(incoming_row.value->>'date',incoming_row.value->>'account_id',incoming_row.value->>'campaign_id',coalesce(incoming_row.value->>'adset_id',''),coalesce(incoming_row.value->>'ad_id',''))=
        ROW(edited->'traffic_original'->>'date',edited->'traffic_original'->>'account_id',edited->'traffic_original'->>'campaign_id',
          coalesce(edited->'traffic_original'->>'adset_id',''),coalesce(edited->'traffic_original'->>'ad_id','')));
  -- Keep dates outside the latest capture window; replace matching rows with the newest capture.
  SELECT jsonb_agg(value ORDER BY value->>'date',value->>'campaign_id',value->>'adset_id',value->>'ad_id') INTO merged FROM (
    SELECT DISTINCT ON (value->>'date',value->>'account_id',value->>'campaign_id',coalesce(value->>'adset_id',''),coalesce(value->>'ad_id','')) value
    FROM (SELECT value,CASE WHEN value->>'traffic_edited'='true' THEN 2 ELSE 0 END AS priority,ordinality FROM jsonb_array_elements(coalesce(batch.rows,'[]')) WITH ORDINALITY
      UNION ALL SELECT value,1,ordinality FROM jsonb_array_elements(coalesce(incoming,'[]')) WITH ORDINALITY) captures
    ORDER BY value->>'date',value->>'account_id',value->>'campaign_id',coalesce(value->>'adset_id',''),coalesce(value->>'ad_id',''),priority DESC,ordinality DESC
  ) latest;
  IF jsonb_array_length(merged)>2000 THEN RAISE EXCEPTION 'Aprove a captura pendente antes de receber mais de 2.000 linhas'; END IF;
  IF batch.id IS NULL THEN
    INSERT INTO public.meta_import_batches(imported_by,filename,row_count,status,rows,source,sync_run_id,account_id,level)
      VALUES(p_actor,'Meta API · '||account||' · '||row_level,jsonb_array_length(merged),'pendente',merged,'api',p_sync_run_id,account,row_level) RETURNING * INTO batch;
  ELSE
    UPDATE public.meta_import_batches SET rows=merged,row_count=jsonb_array_length(merged),sync_run_id=p_sync_run_id,updated_at=clock_timestamp() WHERE id=batch.id RETURNING * INTO batch;
  END IF;
  RETURN jsonb_build_object('rows',jsonb_array_length(p_rows),'batch_id',batch.id,'status','pendente');
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_edit_import_row(p_kind text, p_batch_id uuid, p_row_index integer, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE rows_json jsonb; before_row jsonb; after_row jsonb; version timestamptz; decision text; origin text; filename text; delta jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  PERFORM public.meta_validate_edit(p_kind,p_patch,p_reason);
  IF p_kind='leads' THEN
    SELECT rows,updated_at,status,'csv',b.filename INTO rows_json,version,decision,origin,filename FROM public.meta_lead_import_batches b WHERE id=p_batch_id FOR UPDATE;
  ELSE
    SELECT rows,updated_at,status,source,b.filename INTO rows_json,version,decision,origin,filename FROM public.meta_import_batches b WHERE id=p_batch_id FOR UPDATE;
  END IF;
  IF p_kind='metrics' AND EXISTS(SELECT 1 FROM public.meta_import_batches WHERE id=p_batch_id AND replaced_by_review_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Lote incorporado à revisão; recarregue' USING ERRCODE='40001'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF version IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Importação alterada, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  IF p_row_index IS NULL OR p_row_index<0 OR p_row_index>=jsonb_array_length(rows_json) THEN RAISE EXCEPTION 'Linha inválida'; END IF;
  before_row:=rows_json->p_row_index; after_row:=before_row||p_patch;
  delta:=public.meta_edit_diff(before_row,after_row);
  IF delta='[]' THEN RETURN jsonb_build_object('updated_at',version); END IF;
  IF p_kind='metrics' THEN
    after_row:=after_row||jsonb_build_object('account_id',public.meta_normalize_account_id(after_row->>'account_id'));
    PERFORM public.meta_validate_traffic_row(after_row);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows_json) WITH ORDINALITY r(value,n)
      WHERE n<>p_row_index+1 AND public.meta_traffic_identity(value)=public.meta_traffic_identity(after_row)) THEN
      RAISE EXCEPTION 'A edição ocupa a identidade de outra linha do lote' USING ERRCODE='23505'; END IF;
    IF public.meta_traffic_identity(before_row) IS DISTINCT FROM public.meta_traffic_identity(after_row)
      AND EXISTS(SELECT 1 FROM public.meta_traffic_daily d WHERE d.date=(after_row->>'date')::date AND d.account_id=after_row->>'account_id' AND d.campaign_id=after_row->>'campaign_id' AND d.adset_id=coalesce(after_row->>'adset_id','') AND d.ad_id=coalesce(after_row->>'ad_id','')) THEN
      RAISE EXCEPTION 'A edição ocupa a identidade de uma linha publicada' USING ERRCODE='23505'; END IF;
    IF origin='api' AND (after_row->>'account_id' IS DISTINCT FROM public.meta_normalize_account_id(before_row->>'account_id')
      OR after_row->>'level' IS DISTINCT FROM before_row->>'level') THEN
      RAISE EXCEPTION 'Conta e nível pertencem à captura' USING ERRCODE='22023'; END IF;
    -- Preserve numeric/default and identity constraints already used by published rows.
    PERFORM public.meta_validate_edit('metrics',jsonb_build_object('spend',coalesce(after_row->'spend','0'),
      'leads',coalesce(after_row->'leads','0'),'purchases',coalesce(after_row->'purchases','0')),p_reason);
    IF (after_row->>'level'='campaign' AND (coalesce(after_row->>'adset_id','')<>'' OR coalesce(after_row->>'ad_id','')<>''))
      OR (after_row->>'level'='adset' AND coalesce(after_row->>'ad_id','')<>'')
      OR length(btrim(coalesce(after_row->>'campaign_name',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Identificadores ou campanha inválidos'; END IF;
    after_row:=after_row||jsonb_build_object('traffic_edited',true,'traffic_original',coalesce(before_row->'traffic_original',before_row));
    IF after_row ? 'present_metrics' THEN
      after_row:=after_row||jsonb_build_object('present_metrics',(SELECT jsonb_agg(DISTINCT key) FROM
        (SELECT jsonb_array_elements_text(after_row->'present_metrics') key UNION ALL SELECT jsonb_object_keys(p_patch)) k));
    END IF;
  ELSE
    after_row:=after_row||jsonb_build_object('complete',length(btrim(coalesce(after_row->>'full_name','')))>=2
      AND length(btrim(coalesce(after_row->>'phone',''))) BETWEEN 8 AND 32
      AND coalesce(after_row->>'email','') ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
      AND length(btrim(coalesce(after_row->>'athlete_name','')))>=2 AND nullif(after_row->>'athlete_birth_date','') IS NOT NULL
      AND coalesce(after_row->>'athlete_position','') IN ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante'),
      'traffic_original',coalesce(before_row->'traffic_original',before_row));
  END IF;
  rows_json:=jsonb_set(rows_json,ARRAY[p_row_index::text],after_row);
  IF p_kind='leads' THEN UPDATE public.meta_lead_import_batches SET rows=rows_json,updated_at=clock_timestamp() WHERE id=p_batch_id RETURNING updated_at INTO version;
  ELSE UPDATE public.meta_import_batches SET rows=rows_json,updated_at=clock_timestamp() WHERE id=p_batch_id RETURNING updated_at INTO version; END IF;
  PERFORM public.meta_record_edit(CASE p_kind WHEN 'leads' THEN 'lead_batch' ELSE 'metrics_batch' END,p_batch_id,'batch.row_edited',origin,
    jsonb_build_object('reason',btrim(p_reason),'filename',filename,'row',p_row_index+1,'changes',delta));
  RETURN jsonb_build_object('updated_at',version);
END $function$
;

CREATE OR REPLACE FUNCTION public.meta_edit_traffic_row(p_id uuid, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old public.meta_traffic_daily; edited public.meta_traffic_daily;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso de Tráfego necessário' USING ERRCODE='42501'; END IF;
  IF p_patch ? 'account_id' THEN p_patch:=p_patch||jsonb_build_object('account_id',public.meta_normalize_account_id(p_patch->>'account_id')); END IF;
  PERFORM public.meta_validate_edit('metrics',p_patch,p_reason);
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||public.meta_traffic_identity(to_jsonb(d)),0)) FROM public.meta_traffic_daily d WHERE id=p_id;
  SELECT * INTO old FROM public.meta_traffic_daily WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Métrica não encontrada'; END IF;
  IF old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Métrica alterada, recarregue antes de editar' USING ERRCODE='40001'; END IF;
  IF public.meta_edit_diff(to_jsonb(old),to_jsonb(old)||p_patch)='[]' THEN RETURN to_jsonb(old); END IF;
  PERFORM set_config('meta.capture_review',coalesce(old.capture_review_id::text,''),true);
  edited:=jsonb_populate_record(old,p_patch);
  PERFORM public.meta_validate_traffic_row(to_jsonb(edited));
  PERFORM pg_advisory_xact_lock(hashtextextended('meta-fact:'||public.meta_traffic_identity(to_jsonb(edited)),0));
  UPDATE public.meta_traffic_daily SET original_key=coalesce(old.original_key,public.meta_traffic_identity(to_jsonb(old))::jsonb), date=edited.date,account_id=edited.account_id,account_name=edited.account_name,
    campaign_id=edited.campaign_id,campaign_name=edited.campaign_name,adset_id=edited.adset_id,adset_name=edited.adset_name,
    ad_id=edited.ad_id,ad_name=edited.ad_name,level=edited.level,currency=edited.currency,attribution_window=edited.attribution_window,
    objective=edited.objective,spend=edited.spend,leads=edited.leads,purchases=edited.purchases,purchase_value=edited.purchase_value,
    impressions=edited.impressions,reach=edited.reach,link_clicks=edited.link_clicks,messaging_conversations_started=edited.messaging_conversations_started,
    traffic_edited_at=clock_timestamp(),traffic_edit_reason=btrim(p_reason),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO edited;
  RETURN to_jsonb(edited);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe uma métrica para esta data e identificação. Edite a linha existente.';
END $function$
;
CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE b uuid; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
  -- Valida cada linha antes de existir um lote pendente, para não aceitar lixo agora e falhar só na aprovação.
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_validate_traffic_row(item);
  END LOOP;
  SELECT jsonb_agg((value-ARRAY['capture_review_id','metric_metadata','first_origin','original_key','available_metrics','sync_run_id'])||jsonb_build_object('account_id',public.meta_normalize_account_id(value->>'account_id'))) INTO p_rows FROM jsonb_array_elements(p_rows);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY public.meta_traffic_identity(r) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Identidade repetida no arquivo' USING ERRCODE='22023'; END IF;
  INSERT INTO public.meta_import_batches(imported_by,filename,row_count,status,rows)
  VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'pendente',p_rows) RETURNING id INTO b;
  RETURN jsonb_build_object('batch_id',b,'rows',jsonb_array_length(p_rows));
END $function$
;


CREATE OR REPLACE FUNCTION public.meta_validate_traffic_row(item jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE day date; lvl text; acct text; campaign text; adset text; ad text; key text; amount numeric; max_value numeric; today date;
BEGIN
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'Data ou linha inválida' USING ERRCODE='22023'; END IF;
 BEGIN day:=(item->>'date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Data inválida' USING ERRCODE='22023'; END;
 acct:=public.meta_normalize_account_id(item->>'account_id');
 PERFORM public.meta_assert_account_identity(acct);
 today:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
 -- Only a service capture may use the registered account timezone.
 IF auth.role()='service_role' THEN
   SELECT (now() AT TIME ZONE a.timezone)::date INTO today FROM public.meta_ad_accounts a WHERE a.account_id=acct;
   today:=coalesce(today,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
 ELSIF nullif(current_setting('meta.capture_review',true),'') IS NOT NULL THEN
   SELECT (now() AT TIME ZONE (r.manifest->'account'->>'timezone'))::date INTO today FROM public.meta_capture_reviews r
     WHERE r.id=nullif(current_setting('meta.capture_review',true),'')::uuid AND r.account_id=acct AND r.status IN ('pendente','aprovado');
   today:=coalesce(today,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
 END IF;
 lvl:=item->>'level'; campaign:=btrim(coalesce(item->>'campaign_id',''));
 adset:=btrim(coalesce(item->>'adset_id','')); ad:=btrim(coalesce(item->>'ad_id',''));
 IF day>today OR lvl IS NULL OR lvl NOT IN ('campaign','adset','ad')
   OR length(campaign) NOT BETWEEN 1 AND 80 OR length(adset)>80 OR length(ad)>80
   OR (lvl IN ('adset','ad') AND adset='') OR (lvl='ad' AND ad='')
   OR (lvl='campaign' AND (adset<>'' OR ad<>'')) OR (lvl='adset' AND ad<>'')
   OR coalesce(item->>'currency','BRL')<>'BRL'
   OR length(btrim(coalesce(item->>'campaign_name',''))) NOT BETWEEN 1 AND 160
   OR length(coalesce(item->>'adset_name',''))>160 OR length(coalesce(item->>'ad_name',''))>160
   OR length(coalesce(item->>'objective',''))>80 THEN
   RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores, texto ou moeda' USING ERRCODE='22023'; END IF;
 FOREACH key IN ARRAY ARRAY['spend','purchase_value','leads','purchases','impressions','reach','link_clicks','messaging_conversations_started'] LOOP
   IF NOT item ? key THEN CONTINUE; END IF;
   IF jsonb_typeof(item->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Métrica % deve ser numérica',key USING ERRCODE='22023'; END IF;
   amount:=(item->>key)::numeric;
   max_value:=CASE WHEN key='spend' THEN 100000000 WHEN key='purchase_value' THEN 99999999999999.99
     WHEN key IN ('leads','purchases') THEN 2147483647 ELSE 9007199254740991 END;
   IF amount<0 OR amount>max_value OR (key NOT IN ('spend','purchase_value') AND amount<>trunc(amount)) THEN
     RAISE EXCEPTION 'Métrica % fora dos limites',key USING ERRCODE='22023'; END IF;
 END LOOP;
 IF item ? 'present_metrics' AND (jsonb_typeof(item->'present_metrics') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'present_metrics') v WHERE jsonb_typeof(v)<>'string'
     OR v#>>'{}' NOT IN ('objective','leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started'))) THEN
   RAISE EXCEPTION 'Disponibilidade de métricas inválida' USING ERRCODE='22023'; END IF;
END $$;

CREATE FUNCTION public.meta_capture_abort(p_id uuid,p_claim uuid,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.meta_capture_check_claim(p_id,p_claim);
 UPDATE public.meta_sync_runs SET status='error',coverage_state='partial',claim_token=NULL,lease_until=NULL,
   error_message=left(p_error,1000),finished_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.meta_capture_abort(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capture_abort(uuid,uuid,text) TO service_role;
COMMIT;
