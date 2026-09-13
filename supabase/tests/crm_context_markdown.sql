INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES('a9122222-0000-4000-8000-000000000001','crm-md-qa@example.invalid','{"display_name":"Markdown QA"}','{}',now(),now());
UPDATE public.registration_requests SET status='approved' WHERE user_id='a9122222-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"a9122222-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_lead_contexts; source text; n integer; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Markdown QA','QA','11999999999') RETURNING * INTO l;
  source := chr(65279) || E'  [12/09] José: Olá 😀\r\n\t*valor*: R$ 20\r\n<script>literal</script>  \r\n';
  c := public.crm_import_txt_context(l.id,'whatsapp_summary',source,'Conversa.TXT',source);
  IF c.file_name <> 'Conversa.md' OR c.file_mime_type <> 'text/markdown' OR c.file_content <> source OR c.content <> source THEN RAISE EXCEPTION 'FAIL faithful Markdown storage'; END IF;
  IF c.author_id <> auth.uid() OR c.author_name <> 'Markdown QA' THEN RAISE EXCEPTION 'FAIL authorship'; END IF;
  c := public.crm_update_lead_context(c.id,'whatsapp_summary','Contexto editado: https://drive.google.com/file/d/example/view',c.version);
  IF c.file_content <> source OR c.file_name <> 'Conversa.md' THEN RAISE EXCEPTION 'FAIL source mutated by edit'; END IF;
  SELECT count(*) INTO n FROM public.crm_lead_contexts WHERE lead_id=l.id;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','video.mp4','data'); RAISE EXCEPTION 'FAIL video accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','photo.jpg','data'); RAISE EXCEPTION 'FAIL photo accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','old.md','data'); RAISE EXCEPTION 'FAIL md accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','../file.txt','data'); RAISE EXCEPTION 'FAIL path accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','binary.txt',chr(1)); RAISE EXCEPTION 'FAIL binary accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','empty.txt',E' \r\n\t'); RAISE EXCEPTION 'FAIL empty accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_import_txt_context(l.id,'manual_note','data','long.txt',repeat('x',50001)); RAISE EXCEPTION 'FAIL truncation'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.crm_lead_contexts WHERE lead_id=l.id) <> n THEN RAISE EXCEPTION 'FAIL partial imports'; END IF;
  BEGIN UPDATE public.crm_lead_contexts SET file_content='changed' WHERE id=c.id; RAISE EXCEPTION 'FAIL direct attachment write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  c := public.crm_add_lead_context(l.id,'manual_note',E'  Manual\r\ncontext  ');
  IF c.content <> E'Manual\ncontext' OR c.file_name IS NOT NULL THEN RAISE EXCEPTION 'FAIL legacy note behavior'; END IF;
END; $$;
RESET ROLE;
UPDATE public.registration_requests SET status='pending' WHERE user_id='a9122222-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.crm_import_txt_context(gen_random_uuid(),'manual_note','data','file.txt','data'); RAISE EXCEPTION 'FAIL pending account import'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.crm_import_txt_context(uuid,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL anonymous upload'; END IF;
END; $$;
RESET ROLE;
