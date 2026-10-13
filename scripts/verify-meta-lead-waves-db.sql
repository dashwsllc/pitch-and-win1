-- Levas de leads, envio ao CRM, publicação automática de métricas e conferência.
-- Banco real em transação; todos os dados sintéticos e permissões voltam com o ROLLBACK.
BEGIN;
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.mk_lead(p_key text,p_time timestamptz,p_phone text DEFAULT '+5511999990000',p_name text DEFAULT 'Responsavel QA') RETURNS uuid LANGUAGE sql AS $$
  SELECT public.meta_ingest_form_lead(jsonb_build_object('meta_lead_id',p_key,'page_id','qa-page','form_id','qa-form','form_name','Formulario QA',
    'campaign_id','QA-CAMP','campaign_name','Campanha QA','created_time',p_time,'full_name',p_name,'phone',p_phone,'email','',
    'field_data',jsonb_build_array(
      jsonb_build_object('name','full_name','values',jsonb_build_array(p_name)),
      jsonb_build_object('name','quais_sao_as_3_principais_caracteristicas_do_atleta?','values',jsonb_build_array('velocidade e finalizacao')),
      jsonb_build_object('name','quem_esta_preenchendo_este_formulario?','values',jsonb_build_array('sou_o_atleta')),
      jsonb_build_object('name','state','values',jsonb_build_array('SP')))))
$$;

-- 1. Distribuição em levas de 20, sem contar vaga para lead repetido.
DO $$
DECLARE exec uuid; sdr uuid; susp uuid; i integer; waves integer; sizes text; before_wave uuid;
BEGIN
  exec:=pg_temp.seed_meta_actor('approved',false,'executive');
  sdr:=pg_temp.seed_meta_actor('approved',false,'sdr');
  susp:=pg_temp.seed_meta_actor('approved',true,'executive');
  CREATE TEMP TABLE t_actor(name text PRIMARY KEY,id uuid);
  INSERT INTO t_actor VALUES('exec',exec),('sdr',sdr),('susp',susp);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR i IN 1..45 LOOP PERFORM pg_temp.mk_lead('qa-w-'||i,timestamptz '2026-10-08 12:00:00-03'+(i||' minutes')::interval,
    CASE WHEN i=3 THEN '12' ELSE '+55119999'||lpad(i::text,5,'0') END); END LOOP;
  SELECT string_agg(n::text,',' ORDER BY number) INTO sizes FROM (SELECT w.number,count(l.id) n FROM public.meta_lead_waves w JOIN public.meta_form_leads l ON l.wave_id=w.id GROUP BY w.number) s;
  PERFORM pg_temp.assert(sizes='20,20,5','45 leads must become waves of 20,20,5 (got '||coalesce(sizes,'none')||')');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_lead_waves WHERE is_open)=1 AND (SELECT is_open FROM public.meta_lead_waves WHERE number=3),'only the newest wave stays open');
  -- Duplicate delivery neither joins a wave twice nor consumes a slot.
  SELECT wave_id INTO before_wave FROM public.meta_form_leads WHERE meta_lead_id='qa-w-45';
  FOR i IN 1..5 LOOP PERFORM pg_temp.mk_lead('qa-w-45',timestamptz '2026-10-08 12:45:00-03'); END LOOP;
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_form_leads WHERE wave_id=before_wave)=5,'duplicate delivery changed wave membership');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_lead_waves)=3,'duplicate delivery created or consumed a wave');
  -- 15 more fill wave 3; the next lead opens wave 4.
  FOR i IN 46..60 LOOP PERFORM pg_temp.mk_lead('qa-w-'||i,timestamptz '2026-10-08 12:00:00-03'+(i||' minutes')::interval); END LOOP;
  PERFORM pg_temp.assert(NOT (SELECT is_open FROM public.meta_lead_waves WHERE number=3) AND (SELECT count(*) FROM public.meta_lead_waves WHERE is_open)=0,'full wave 3 must close');
  PERFORM pg_temp.mk_lead('qa-w-61',timestamptz '2026-10-08 13:01:00-03');
  PERFORM pg_temp.assert((SELECT is_open FROM public.meta_lead_waves WHERE number=4) AND (SELECT count(*) FROM public.meta_form_leads WHERE wave_id=(SELECT id FROM public.meta_lead_waves WHERE number=4))=1,'wave 4 must open with the 21st lead of wave 3');
  -- Grants: only authenticated users reach the wave contract, only the service publishes captures.
  PERFORM pg_temp.assert(has_function_privilege('authenticated','public.meta_wave_decide_versioned(uuid,bigint,jsonb,text,jsonb,text,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.meta_wave_decide(uuid,text,uuid[],jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.meta_wave_decide(uuid,text,uuid[],jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.meta_wave_decide(uuid,text,uuid[],jsonb,text)','EXECUTE'),'wave decision grants');
  PERFORM pg_temp.assert(NOT has_function_privilege('authenticated','public.meta_capture_publish_system(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.meta_capture_publish_system(uuid)','EXECUTE')
    AND has_function_privilege('service_role','public.meta_capture_publish_system(uuid)','EXECUTE'),'automatic publication grants');
  PERFORM pg_temp.assert(NOT has_function_privilege('authenticated','public.meta_sync_form_lead_to_crm(uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.meta_wave_rebuild_core()','EXECUTE'),'internal helpers must stay private');
END $$;

-- 2. Listagem, ordem, permissões, aprovação com exclusões, falha visível e reenvio.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); sdr uuid:=(SELECT id FROM t_actor WHERE name='sdr'); susp uuid:=(SELECT id FROM t_actor WHERE name='susp');
  w1 uuid; ids uuid[]; lead3 uuid; lead5 uuid; lead6 uuid; r jsonb; list jsonb; detail jsonb; crm_before integer; ctx text;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
  PERFORM pg_temp.expect_error('SELECT public.meta_wave_list()','42501');
  PERFORM pg_temp.expect_error('SELECT public.meta_wave_leads((SELECT id FROM public.meta_lead_waves LIMIT 1))','42501');
  PERFORM set_config('request.jwt.claim.sub',susp::text,true);
  PERFORM pg_temp.expect_error('SELECT public.meta_wave_list()','42501');
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  list:=public.meta_wave_list('pendente',20,0);
  PERFORM pg_temp.assert((list->>'pending_waves')::int=4 AND (list->>'pending_leads')::int=61,'list must count pending waves and leads');
  PERFORM pg_temp.assert((list->'waves'->0->>'number')::int=4 AND (list->'waves'->3->>'number')::int=1,'waves must list newest first');
  PERFORM pg_temp.assert((list->'waves'->3->>'lead_count')::int=20 AND (list->'waves'->3->>'first_lead_at')::timestamptz=timestamptz '2026-10-08 12:01:00-03'
    AND (list->'waves'->3->>'last_lead_at')::timestamptz=timestamptz '2026-10-08 12:20:00-03','wave 1 must expose first and last lead time');
  SELECT id INTO STRICT w1 FROM public.meta_lead_waves WHERE number=1;
  detail:=public.meta_wave_leads(w1);
  PERFORM pg_temp.assert(jsonb_array_length(detail->'leads')=20 AND (detail->'leads'->0->>'created_time')::timestamptz=timestamptz '2026-10-08 12:20:00-03'
    AND (detail->'leads'->19->>'created_time')::timestamptz=timestamptz '2026-10-08 12:01:00-03','leads must open newest first with their own time');
  SELECT id INTO STRICT lead3 FROM public.meta_form_leads WHERE meta_lead_id='qa-w-3';
  SELECT id INTO STRICT lead5 FROM public.meta_form_leads WHERE meta_lead_id='qa-w-5';
  SELECT id INTO STRICT lead6 FROM public.meta_form_leads WHERE meta_lead_id='qa-w-6';
  SELECT array_agg(id) INTO ids FROM public.meta_form_leads WHERE wave_id=w1;
  -- Approval needs a reason for exclusions, only accepts members and refuses the SDR.
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[],%L::jsonb)',w1,'aprovar',ids,format('[{"id":"%s","reason":"x"}]',lead5)),'22023');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[])',w1,'aprovar',ARRAY[gen_random_uuid()]),'40001');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[])',w1,'rejeitar',ids),'22023');
  PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[])',w1,'aprovar',ids),'42501');
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  SELECT count(*) INTO crm_before FROM public.crm_leads WHERE meta_form_lead_id IS NOT NULL;
  r:=public.meta_wave_decide(w1,'aprovar',ids,format('[{"id":"%s","reason":"Telefone de teste"},{"id":"%s","reason":"Lead duplicado do cliente"}]',lead5,lead6)::jsonb);
  PERFORM pg_temp.assert(r->>'status'='aprovada' AND (r->>'approved')::int=18 AND (r->>'rejected')::int=2 AND (r->>'sent')::int=17 AND (r->>'failed')::int=1 AND (r->>'already')::boolean=false,
    'approval summary wrong: '||r::text);
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads WHERE meta_form_lead_id IS NOT NULL)=crm_before+17,'approval must create one CRM lead per sent lead');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads c JOIN public.meta_form_leads f ON f.crm_lead_id=c.id
    WHERE f.wave_id=w1 AND c.sdr_id IS NULL AND c.athlete_name IS NULL AND c.email IS NULL AND c.lead_source='meta_ads_form'
      AND c.lead_generated_at=f.created_time AND c.pipeline_stage='novo' AND c.phone=f.phone AND c.name=f.full_name)=17,'CRM leads must carry name, WhatsApp and the real generation time');
  SELECT content INTO ctx FROM public.crm_lead_contexts WHERE lead_id=(SELECT crm_lead_id FROM public.meta_form_leads WHERE meta_lead_id='qa-w-20');
  PERFORM pg_temp.assert(ctx LIKE '%Caiu em: 08/10/2026 12:20 (Brasília)%' AND ctx LIKE '%Quais sao as 3 principais caracteristicas do atleta?: velocidade e finalizacao%'
    AND ctx LIKE '%Quem esta preenchendo este formulario?: sou o atleta%' AND ctx LIKE '%Estado: SP%' AND ctx LIKE '%Campanha: Campanha QA%','context must list every written answer');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_lead_contexts x JOIN public.meta_form_leads f ON f.crm_lead_id=x.lead_id
    WHERE f.wave_id=w1 AND x.context_type='meta_form' AND x.author_role='trafego' AND x.author_id=exec)=17,'one read-only context per sent lead');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.abordagens a JOIN public.meta_form_leads f ON f.crm_lead_id=a.crm_lead_id WHERE f.wave_id=w1)=0,'Meta leads must not count as SDR approaches');
  -- Visible failure on the lead with an invalid WhatsApp; excluded leads carry their reasons.
  PERFORM pg_temp.assert((SELECT crm_sync_status='falhou' AND crm_sync_error LIKE '%WhatsApp%' AND crm_lead_id IS NULL AND crm_sync_attempts=1 AND import_warning LIKE 'Falha no envio ao CRM:%' FROM public.meta_form_leads WHERE id=lead3),'failure must stay visible on the lead');
  PERFORM pg_temp.assert((SELECT approval_status='rejeitado' AND status='ignorado' AND review_note='Telefone de teste' AND ignored_reason='Telefone de teste' FROM public.meta_form_leads WHERE id=lead5),'excluded lead must keep its reason');
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_type='lead_wave' AND entity_id=w1 AND action='wave.approved' AND actor_id=exec),'wave approval must be audited');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_audit_events WHERE action='lead.synced' AND entity_id IN (SELECT id FROM public.meta_form_leads WHERE wave_id=w1))=17,'each sent lead must be audited');
  -- Idempotence: approving again changes nothing and still answers.
  r:=public.meta_wave_decide(w1,'aprovar',ids);
  PERFORM pg_temp.assert((r->>'already')::boolean AND (r->>'sent')::int=17 AND (r->>'failed')::int=1,'second approval must return the same result');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads WHERE meta_form_lead_id IS NOT NULL)=crm_before+17
    AND (SELECT count(*) FROM public.crm_lead_contexts WHERE context_type='meta_form')=17
    AND (SELECT count(*) FROM public.meta_audit_events WHERE entity_id=w1 AND action='wave.approved')=1,'second approval duplicated leads, contexts or audit');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[],%L::jsonb,%L)',w1,'rejeitar',ids,'[]','Motivo valido'),'22023');
  -- Retry: still failing, then fixed and sent exactly once.
  r:=public.meta_wave_retry(w1);
  PERFORM pg_temp.assert((r->>'retried')::int=1 AND (r->>'recovered')::int=0 AND (SELECT crm_sync_attempts FROM public.meta_form_leads WHERE id=lead3)=2,'retry must report the lead that still fails');
  UPDATE public.meta_form_leads SET phone='+5511988887777' WHERE id=lead3;
  r:=public.meta_wave_retry(w1);
  PERFORM pg_temp.assert((r->>'retried')::int=1 AND (r->>'recovered')::int=1 AND (r->>'sent')::int=18 AND (r->>'failed')::int=0,'retry must send the corrected lead');
  PERFORM pg_temp.assert((SELECT crm_sync_status='enviado' AND crm_sync_error IS NULL AND import_warning IS NULL AND status='importado' AND crm_lead_id IS NOT NULL FROM public.meta_form_leads WHERE id=lead3),'corrected lead must be marked as sent');
  r:=public.meta_wave_retry(w1);
  PERFORM pg_temp.assert((r->>'retried')::int=0 AND (SELECT count(*) FROM public.crm_leads WHERE meta_form_lead_id IS NOT NULL)=crm_before+18,'extra retry duplicated a CRM lead');
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=w1 AND action='wave.retried'),'retry must be audited');
  -- Form answers are read-only for the CRM team and unique per lead.
  PERFORM pg_temp.expect_error('UPDATE public.crm_lead_contexts SET content=''alterado'' WHERE context_type=''meta_form''','42501');
  PERFORM pg_temp.expect_error(format('INSERT INTO public.crm_lead_contexts(lead_id,author_id,author_name,author_role,context_type,content) VALUES(%L,%L,%L,%L,%L,%L)',
    (SELECT crm_lead_id FROM public.meta_form_leads WHERE meta_lead_id='qa-w-20'),exec,'x','trafego','meta_form','duplicado'),'23505');
END $$;

-- 3. Lead que chega com a tela aberta vai para a próxima leva; rejeição de leva exige motivo.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); w2 uuid; w3 uuid; ids uuid[]; late uuid; r jsonb; open_wave uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  SELECT id INTO STRICT w2 FROM public.meta_lead_waves WHERE number=2;
  SELECT id INTO STRICT w3 FROM public.meta_lead_waves WHERE number=3;
  SELECT id INTO STRICT late FROM public.meta_form_leads WHERE meta_lead_id='qa-w-40';
  SELECT array_agg(id) INTO ids FROM public.meta_form_leads WHERE wave_id=w2 AND id<>late;
  r:=public.meta_wave_decide(w2,'aprovar',ids);
  PERFORM pg_temp.assert((r->>'approved')::int=19 AND (r->>'sent')::int=19 AND r->>'status'='aprovada','partial screen must approve exactly its leads');
  SELECT id INTO STRICT open_wave FROM public.meta_lead_waves WHERE is_open;
  PERFORM pg_temp.assert((SELECT wave_id FROM public.meta_form_leads WHERE id=late)=open_wave AND (SELECT approval_status FROM public.meta_form_leads WHERE id=late)='pendente'
    AND open_wave NOT IN (w2,w3),'leads outside the screen must move intact to the next wave');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads c JOIN public.meta_form_leads f ON f.crm_lead_id=c.id WHERE f.id=late)=0,'a lead not shown on screen must not be sent');
  -- Whole-wave rejection.
  SELECT array_agg(id) INTO ids FROM public.meta_form_leads WHERE wave_id=w3;
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[])',w3,'rejeitar',ids),'22023');
  r:=public.meta_wave_decide(w3,'rejeitar',ids,'[]','Campanha de teste encerrada');
  PERFORM pg_temp.assert(r->>'status'='rejeitada' AND (r->>'rejected')::int=20 AND (r->>'sent')::int=0 AND r->>'review_note'='Campanha de teste encerrada','wave rejection summary wrong');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_form_leads WHERE wave_id=w3 AND approval_status='rejeitado' AND status='ignorado' AND crm_lead_id IS NULL)=20,'rejected wave must not reach the CRM');
  PERFORM pg_temp.assert((public.meta_wave_decide(w3,'rejeitar',ids,'[]','Campanha de teste encerrada')->>'already')::boolean,'second rejection must be idempotent');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_decide(%L,%L,%L::uuid[])',w3,'aprovar',ids),'22023');
END $$;

-- 4. Historical arrivals preserve all existing memberships; receipt time determines priority.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); i integer; before_sizes text; after_ok boolean; w1_before text; w1_after text; pending_before integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  -- Fill the open wave with newer leads so the next one opens a second pending wave.
  FOR i IN 62..80 LOOP PERFORM pg_temp.mk_lead('qa-w-'||i,timestamptz '2026-10-08 12:00:00-03'+(i||' minutes')::interval); END LOOP;
  SELECT string_agg(l.id::text||l.wave_id::text,',' ORDER BY l.id) INTO w1_before FROM public.meta_form_leads l WHERE l.wave_id IN (SELECT id FROM public.meta_lead_waves WHERE status<>'pendente');
  SELECT count(*) INTO pending_before FROM public.meta_form_leads WHERE approval_status='pendente' AND lead_import_batch_id IS NULL;
  -- Older leads (before everything else) are found late and fall into the newest wave.
  FOR i IN 1..7 LOOP PERFORM pg_temp.mk_lead('qa-old-'||i,timestamptz '2026-10-07 09:00:00-03'+(i||' minutes')::interval); END LOOP;
  PERFORM pg_temp.assert(NOT public.meta_wave_needs_rebuild(),'dated historical leads with assigned waves must not trigger regrouping');
  -- Completed discovery keeps the distribution stable.
  INSERT INTO public.meta_lead_discovery_state(page_id,window_since,window_until,last_completed_until) VALUES('qa-page',now()-interval '1 day',now()-interval '1 hour',now()-interval '2 hours');
  UPDATE public.meta_lead_discovery_state SET last_completed_until=now()-interval '1 hour' WHERE page_id='qa-page';
  PERFORM pg_temp.assert(NOT public.meta_wave_needs_rebuild(),'completed discovery must restore chronological waves');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_form_leads WHERE approval_status='pendente' AND lead_import_batch_id IS NULL)=pending_before+7
    AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE approval_status='pendente' AND lead_import_batch_id IS NULL AND wave_id IS NULL),'every pending lead must keep a wave');
  SELECT string_agg(l.id::text||l.wave_id::text,',' ORDER BY l.id) INTO w1_after FROM public.meta_form_leads l WHERE l.wave_id IN (SELECT id FROM public.meta_lead_waves WHERE status<>'pendente');
  PERFORM pg_temp.assert(w1_before=w1_after,'decided waves must never be reorganized');
  PERFORM pg_temp.assert((SELECT max(first_received_at) FROM public.meta_form_leads WHERE meta_lead_id LIKE 'qa-old-%') >=
    (SELECT max(first_received_at) FROM public.meta_form_leads WHERE meta_lead_id LIKE 'qa-w-%'),'new historical receipts must preserve current arrival priority');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.meta_lead_waves WHERE is_open)=1 AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE wave_id IS NOT NULL GROUP BY wave_id HAVING count(*)>20),'one open wave and at most 20 leads per wave');
  PERFORM pg_temp.assert(EXISTS(SELECT FROM public.meta_form_leads WHERE meta_lead_id='qa-old-1' AND created_time=timestamptz '2026-10-07 09:01:00-03'),'historical generation must remain distinct from receipt time');
  -- The manual fallback does nothing when there is nothing to reorganize.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  PERFORM pg_temp.assert((public.meta_wave_rebuild()->>'rebuilt')::boolean=false,'manual rebuild must be a no-op when ordered');
END $$;

-- 5. Caminho individual antigo usa o mesmo envio e encerra a leva quando todos foram decididos.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); wave uuid; lead public.meta_form_leads; r jsonb; n integer:=0;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  SELECT w.id INTO STRICT wave FROM public.meta_lead_waves w WHERE w.status='pendente' ORDER BY w.number DESC LIMIT 1;
  FOR lead IN SELECT * FROM public.meta_form_leads WHERE wave_id=wave AND approval_status='pendente' ORDER BY created_time LOOP
    r:=public.meta_review_form_lead(lead.id,'aprovar',lead.updated_at);
    PERFORM pg_temp.assert((r->>'crm')::int=1,'individual approval must reach the CRM');
    n:=n+1;
  END LOOP;
  PERFORM pg_temp.assert(n>0 AND (SELECT status FROM public.meta_lead_waves WHERE id=wave)='aprovada' AND NOT (SELECT is_open FROM public.meta_lead_waves WHERE id=wave),'wave must close when every lead was decided one by one');
END $$;

-- 5b. Nenhum lead se perde: lead ou leva rejeitados voltam como pendentes, na ordem cronológica.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); sdr uuid:=(SELECT id FROM t_actor WHERE name='sdr'); lead5 uuid; w1 uuid; w3 uuid; before_count integer; r jsonb; detail jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT id INTO STRICT lead5 FROM public.meta_form_leads WHERE meta_lead_id='qa-w-5';
  SELECT id INTO STRICT w1 FROM public.meta_lead_waves WHERE number=1;
  SELECT id INTO STRICT w3 FROM public.meta_lead_waves WHERE number=3;
  PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_reopen(NULL,%L)',lead5),'42501');
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  PERFORM pg_temp.expect_error('SELECT public.meta_wave_reopen(NULL,NULL)','22023');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_reopen(%L,%L)',w1,lead5),'22023');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_reopen(%L)',w1),'22023');
  PERFORM pg_temp.expect_error(format('SELECT public.meta_wave_reopen(NULL,%L)',(SELECT id FROM public.meta_form_leads WHERE meta_lead_id='qa-w-1')),'22023');
  SELECT (public.meta_wave_summary(w1)->>'lead_count')::int INTO before_count;
  r:=public.meta_wave_reopen(NULL,lead5);
  PERFORM pg_temp.assert((r->>'reopened')::int=1,'single lead reopen must report one lead');
  PERFORM pg_temp.assert((SELECT approval_status='pendente' AND status='novo' AND review_note IS NULL AND ignored_reason IS NULL AND crm_lead_id IS NULL AND wave_id IS NOT NULL
    AND (SELECT status FROM public.meta_lead_waves WHERE id=wave_id)='pendente' FROM public.meta_form_leads WHERE id=lead5),'reopened lead must wait in a pending wave');
  PERFORM pg_temp.assert((public.meta_wave_summary(w1)->>'lead_count')::int=before_count-1,'approved wave must not keep the reopened lead');
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=lead5 AND action='lead.reopened' AND actor_id=exec)
    AND (SELECT count(*) FROM public.meta_audit_events WHERE entity_id=lead5 AND action='lead.rejected')=1,'reopening must be audited as a reopening');
  r:=public.meta_wave_reopen(w3);
  PERFORM pg_temp.assert((r->>'reopened')::int=20 AND EXISTS(SELECT 1 FROM public.meta_lead_waves WHERE id=w3),'reopening must preserve the original wave record');
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=w3 AND action='wave.reopened'),'wave reopening must be audited');
  PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_form_leads WHERE approval_status='pendente' AND wave_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads l JOIN public.meta_lead_waves w ON w.id=l.wave_id WHERE l.approval_status='pendente' AND w.status<>'pendente')
    AND NOT public.meta_wave_needs_rebuild(),'no pending lead may be outside a pending wave, and the order stays chronological');
  -- The reopened lead goes through the same approval and reaches the CRM.
  SELECT wave_id INTO STRICT w1 FROM public.meta_form_leads WHERE id=lead5;
  r:=public.meta_wave_decide(w1,'aprovar',ARRAY(SELECT id FROM public.meta_form_leads WHERE wave_id=w1 AND approval_status='pendente'));
  PERFORM pg_temp.assert((SELECT crm_sync_status='enviado' FROM public.meta_form_leads WHERE id=lead5),'reopened lead must reach the CRM after approval');
  detail:=public.meta_wave_leads(w1);
  PERFORM pg_temp.assert(detail->'leads'->0->>'source'='api' AND (detail->'leads'->0->>'time_known')::boolean,'wave detail must say the origin and that the time is exact');
END $$;

-- 6. Publicação automática: captura completa sem conflito publica; edição manual e remoção em massa esperam revisão.
CREATE FUNCTION pg_temp.capture(p_account text,p_rows jsonb,p_start date DEFAULT '2026-10-07',p_end date DEFAULT '2026-10-09') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE run uuid; claim uuid; zone text;
BEGIN
  SELECT timezone INTO zone FROM public.meta_ad_accounts WHERE account_id=p_account;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  run:=public.meta_capture_open(p_account,'campaign',p_start,p_end,
    jsonb_build_object('level','campaign','time_range',format('{"since":"%s","until":"%s"}',p_start,p_end)),
    jsonb_build_object('id',p_account,'currency','BRL','timezone',zone),'cron',NULL);
  claim:=(public.meta_capture_claim(run)->>'claim_token')::uuid;
  PERFORM public.meta_capture_append(run,claim,0,md5(p_rows::text||clock_timestamp()::text),p_rows,NULL);
  RETURN public.meta_capture_prepare(run,claim);
END $$;
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); review uuid; rows jsonb; r jsonb; fact public.meta_traffic_daily; second uuid; edited_id uuid;
BEGIN
  INSERT INTO public.meta_ad_accounts(account_id,account_name,currency,timezone,status,connected_by) VALUES('9901','QA sales','BRL','America/Sao_Paulo','active',exec);
  rows:='[{"date":"2026-10-08","account_id":"9901","level":"campaign","campaign_id":"QA-CAMP","campaign_name":"Campanha QA","objective":"OUTCOME_SALES","spend":120.5,"leads":0,"purchases":3,
    "purchase_value":900,"impressions":10000,"link_clicks":300,"landing_page_views":220,"adds_to_cart":40,"checkouts_initiated":12,
    "available_metrics":["spend","impressions","link_clicks","purchases","purchase_value","landing_page_views","adds_to_cart","checkouts_initiated"],
    "metric_metadata":{"version":1,"definition_version":"canonical-v1","purchase_action":"purchase","account_timezone":"America/Sao_Paulo"}}]'::jsonb;
  review:=pg_temp.capture('9901',rows);
  PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.meta_traffic_daily WHERE account_id='9901'),'capture must not publish by itself');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.expect_error(format('SELECT public.meta_capture_publish_system(%L)',review),'42501');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  r:=public.meta_capture_publish_system(review);
  PERFORM pg_temp.assert((r->>'published')::boolean AND (r->>'inserted')::int=1,'clean complete capture must publish');
  SELECT * INTO STRICT fact FROM public.meta_traffic_daily WHERE account_id='9901';
  PERFORM pg_temp.assert(fact.landing_page_views=220 AND fact.adds_to_cart=40 AND fact.checkouts_initiated=12 AND fact.purchases=3 AND fact.spend=120.5 AND fact.source='api'
    AND 'landing_page_views' = ANY(fact.available_metrics) AND fact.imported_by IS NULL,'published fact must carry Sales funnel metrics');
  PERFORM pg_temp.assert((SELECT status='aprovado' AND reviewed_by IS NULL FROM public.meta_capture_reviews WHERE id=review)
    AND EXISTS(SELECT 1 FROM public.meta_audit_events WHERE entity_id=review AND action='capture.auto_approved' AND (summary->>'automatic')::boolean),'automatic publication must be audited as automatic');
  PERFORM pg_temp.assert((public.meta_capture_publish_system(review)->>'published')::boolean=false,'published review must not publish twice');
  -- Same data again: one fact, no duplicate; a changed value updates in place.
  second:=pg_temp.capture('9901',rows);
  r:=public.meta_capture_publish_system(second);
  PERFORM pg_temp.assert((r->>'published')::boolean AND (r->>'updated')::int=1 AND (SELECT count(*) FROM public.meta_traffic_daily WHERE account_id='9901')=1,'repeated capture duplicated facts');
  second:=pg_temp.capture('9901',jsonb_set(rows,'{0,spend}','130.25'));
  PERFORM public.meta_capture_publish_system(second);
  PERFORM pg_temp.assert((SELECT spend FROM public.meta_traffic_daily WHERE account_id='9901')=130.25,'changed value must update the published fact');
  -- A manual correction keeps a later capture waiting for a human.
  SELECT id INTO edited_id FROM public.meta_traffic_daily WHERE account_id='9901';
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  PERFORM public.meta_edit_traffic_row(edited_id,(SELECT updated_at FROM public.meta_traffic_daily WHERE id=edited_id),'{"spend":99}'::jsonb,'Correção manual de teste');
  second:=pg_temp.capture('9901',jsonb_set(rows,'{0,spend}','140'));
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  r:=public.meta_capture_publish_system(second);
  PERFORM pg_temp.assert(NOT (r->>'published')::boolean AND (SELECT status FROM public.meta_capture_reviews WHERE id=second)='pendente'
    AND (SELECT spend FROM public.meta_traffic_daily WHERE id=edited_id)=99,'manual correction must wait for human review');
  -- Negative or oversized values are still rejected by the shared validator.
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.capture(''9901'',%L::jsonb)',jsonb_set(rows,'{0,adds_to_cart}','-1')),'22023');
END $$;

-- 7. Conferência por dia e campanha: Meta × recebidos × CRM.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); sdr uuid:=(SELECT id FROM t_actor WHERE name='sdr'); row_count integer; item record; expected_received integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',sdr::text,true);
  PERFORM pg_temp.expect_error('SELECT * FROM public.meta_traffic_conference(''2026-10-07'',''2026-10-09'')','42501');
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  PERFORM pg_temp.expect_error('SELECT * FROM public.meta_traffic_conference(''2026-10-09'',''2026-10-07'')','22023');
  SELECT count(*) INTO expected_received FROM public.meta_form_leads WHERE campaign_id='QA-CAMP' AND (created_time AT TIME ZONE 'America/Sao_Paulo')::date='2026-10-08';
  FOR item IN SELECT * FROM public.meta_traffic_conference('2026-10-07','2026-10-09') WHERE campaign_id='QA-CAMP' AND stat_day='2026-10-08' LOOP
    row_count:=coalesce(row_count,0)+1;
    PERFORM pg_temp.assert(item.received=expected_received AND item.meta_leads=0 AND item.received=item.pending+item.approved+item.rejected,'conference counts wrong');
    PERFORM pg_temp.assert(item.in_crm=(SELECT count(*) FROM public.meta_form_leads WHERE campaign_id='QA-CAMP' AND crm_lead_id IS NOT NULL AND (created_time AT TIME ZONE 'America/Sao_Paulo')::date='2026-10-08')
      AND item.failed=0,'conference CRM counts wrong');
  END LOOP;
  PERFORM pg_temp.assert(row_count=1,'conference must return one row per day and campaign');
  -- Metrics without leads on a day, and leads without metrics, both stay visible.
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.meta_traffic_conference('2026-10-07','2026-10-07') WHERE campaign_id='QA-CAMP' AND received>0 AND meta_leads=0),'leads without published metrics must stay visible');
END $$;

-- 8. Alertas de falha prolongada e estado do webhook na operação.
DO $$
DECLARE exec uuid:=(SELECT id FROM t_actor WHERE name='exec'); op jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',exec::text,true);
  DELETE FROM public.meta_sync_runs WHERE kind='leads_reconciliation';
  INSERT INTO public.meta_sync_runs(kind,account_id,status,triggered_by,request_params,started_at,finished_at) VALUES
   ('leads_reconciliation','qa-page','success','cron','{"discover":true}',now()-interval '3 hours',now()-interval '3 hours'),
   ('leads_reconciliation','qa-page','error','cron','{"discover":true}',now()-interval '30 minutes',now()-interval '29 minutes');
  op:=public.meta_traffic_operation();
  PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(op->'alerts') a WHERE a->>'kind'='leads_reconciliation'),'lead capture failing for over an hour must raise an alert');
  UPDATE public.meta_sync_runs SET started_at=now()-interval '10 minutes',finished_at=now()-interval '9 minutes' WHERE kind='leads_reconciliation' AND status='success';
  op:=public.meta_traffic_operation();
  PERFORM pg_temp.assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(op->'alerts') a WHERE a->>'kind'='leads_reconciliation'),'a recent success must not raise an alert');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.meta_lead_discovery_note_webhook('qa-page',false);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  op:=public.meta_traffic_operation();
  PERFORM pg_temp.assert(op->'webhook'->0->>'page_id'='qa-page' AND (op->'webhook'->0->>'leadgen_subscribed')::boolean=false,'webhook state must be exposed');
END $$;

-- 9. Um backfill antigo não fica acima de uma leva decidida mais recente.
DO $$
DECLARE actor uuid:=(SELECT id FROM t_actor WHERE name='exec'); recent_lead uuid; old_lead uuid; recent_wave uuid; old_wave uuid; page jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  UPDATE public.meta_lead_waves SET is_open=false WHERE is_open;
  recent_lead:=pg_temp.mk_lead('qa-list-recent',timestamptz '2026-10-12 08:00:00-03');
  SELECT wave_id INTO recent_wave FROM public.meta_form_leads WHERE id=recent_lead;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM public.meta_wave_decide(recent_wave,'rejeitar',ARRAY[recent_lead],'[]','Teste de ordenação');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  old_lead:=pg_temp.mk_lead('qa-list-backfill',timestamptz '2026-10-06 08:00:00-03');
  PERFORM public.meta_wave_rebuild_core();
  SELECT wave_id INTO old_wave FROM public.meta_form_leads WHERE id=old_lead;
  PERFORM pg_temp.assert((SELECT number FROM public.meta_lead_waves WHERE id=old_wave)>
    (SELECT number FROM public.meta_lead_waves WHERE id=recent_wave),'backfill must reproduce a newer wave number');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  page:=public.meta_wave_list(NULL,1,0);
  PERFORM pg_temp.assert(page->'waves'->0->>'id'=old_wave::text,'wave list must prioritize the latest receipt even for old generation');
  page:=public.meta_wave_list(NULL,1,1);
  PERFORM pg_temp.assert(page->'waves'->0->>'id'<>old_wave::text,'pagination must not repeat the latest received wave');
END $$;
SELECT 'PASS: waves, minimal CRM sync with context, idempotence, visible failures and retry, chronological rebuild, automatic metric publication and conference' AS verification;
ROLLBACK;
