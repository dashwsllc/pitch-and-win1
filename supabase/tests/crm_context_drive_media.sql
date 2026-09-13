INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES('a9123333-0000-4000-8000-000000000001','crm-drive-qa@example.invalid','{"display_name":"Drive QA"}','{}',now(),now());
UPDATE public.registration_requests SET status='approved' WHERE user_id='a9123333-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"a9123333-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE l public.crm_leads; c public.crm_lead_contexts; n integer; source text := E'Conversa fiel\r\nLinha 2'; BEGIN
  INSERT INTO public.crm_leads(name,athlete_name,phone) VALUES('Drive QA','QA','11999999999') RETURNING * INTO l;
  c := public.crm_import_txt_context_with_media(
    l.id, 'whatsapp_summary', source, 'Conversa.txt', source,
    '  https://drive.google.com/file/d/media-example/view?usp=sharing  '
  );
  IF c.media_url <> 'https://drive.google.com/file/d/media-example/view?usp=sharing'
    OR c.file_name <> 'Conversa.md' OR c.file_content <> source THEN
    RAISE EXCEPTION 'FAIL Drive link or Markdown archive storage';
  END IF;
  c := public.crm_update_lead_context_with_media(
    c.id, 'manual_note', 'Atualizado',
    'https://drive.google.com/drive/folders/folder-example', c.version
  );
  IF c.media_url <> 'https://drive.google.com/drive/folders/folder-example'
    OR c.file_content <> source OR c.version <> 2 THEN
    RAISE EXCEPTION 'FAIL media edit or archived original preservation';
  END IF;
  c := public.crm_update_lead_context_with_media(c.id, 'manual_note', 'Sem mídia', NULL, c.version);
  IF c.media_url IS NOT NULL OR c.version <> 3 THEN RAISE EXCEPTION 'FAIL media removal'; END IF;
  c := public.crm_add_lead_context_with_media(
    l.id, 'manual_note', 'Somente um link de mídia',
    'https://drive.google.com/open?id=media-example'
  );
  IF c.media_url <> 'https://drive.google.com/open?id=media-example' OR c.file_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL manual context media storage';
  END IF;
  SELECT count(*) INTO n FROM public.crm_lead_contexts WHERE lead_id=l.id;
  BEGIN PERFORM public.crm_add_lead_context_with_media(l.id,'manual_note','x','https://example.com/video'); RAISE EXCEPTION 'FAIL foreign host accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context_with_media(l.id,'manual_note','x','http://drive.google.com/file/d/x'); RAISE EXCEPTION 'FAIL HTTP accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context_with_media(l.id,'manual_note','x','https://drive.google.com.evil.test/file/d/x'); RAISE EXCEPTION 'FAIL lookalike host accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.crm_add_lead_context_with_media(l.id,'manual_note','x','https://drive.google.com/'); RAISE EXCEPTION 'FAIL empty Drive target accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.crm_lead_contexts WHERE lead_id=l.id) <> n THEN RAISE EXCEPTION 'FAIL invalid media created partial context'; END IF;
  BEGIN UPDATE public.crm_lead_contexts SET media_url='https://drive.google.com/file/d/direct' WHERE id=c.id; RAISE EXCEPTION 'FAIL direct media write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

UPDATE public.registration_requests SET status='pending' WHERE user_id='a9123333-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.crm_add_lead_context_with_media(gen_random_uuid(),'manual_note','x','https://drive.google.com/file/d/x'); RAISE EXCEPTION 'FAIL pending account write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.crm_add_lead_context_with_media(uuid,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.crm_import_txt_context_with_media(uuid,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.crm_update_lead_context_with_media(uuid,text,text,text,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anonymous media RPC grant';
  END IF;
END; $$;
RESET ROLE;
