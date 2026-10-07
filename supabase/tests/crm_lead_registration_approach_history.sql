-- Roda dentro de uma transação e termina sempre em ROLLBACK (scripts/check-crm-lead-approach-history-db.mjs): nada é gravado.
-- Verifica que TODO lead elegível (cadastrado por alguém, fora do Meta) tem exatamente uma abordagem e um evento da Arena,
-- com os dados certos, e que rodar a migração do histórico de novo não muda nada.
SELECT set_config('request.jwt.claim.sub', (
  SELECT r.user_id::text FROM public.user_roles r JOIN public.profiles p ON p.user_id = r.user_id
  WHERE r.role::text = 'super_admin' AND NOT p.suspended LIMIT 1
), true);

DO $$
DECLARE
  v_elegiveis integer;
  v_n integer;
  v_antes record;
  v_metricas jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem Super Admin ativo para a verificação'; END IF;
  SELECT count(*) INTO v_elegiveis FROM public.crm_leads l WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source,'')<>'meta_ads_form';
  IF v_elegiveis = 0 THEN RAISE EXCEPTION 'Sem leads para verificar'; END IF;

  -- 1) Cobertura: uma abordagem e um evento por lead elegível, nenhum a mais, nenhum a menos.
  SELECT count(*) INTO v_n FROM public.crm_leads l WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source,'')<>'meta_ads_form'
    AND (SELECT count(*) FROM public.abordagens a WHERE a.crm_lead_id=l.id)<>1;
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % leads sem exatamente uma abordagem', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.crm_leads l WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source,'')<>'meta_ads_form'
    AND (SELECT count(*) FROM public.activity_feed f WHERE f.event_key='lead.approached:'||l.id||':registered')<>1;
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % leads sem exatamente um evento da Arena', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.abordagens WHERE crm_lead_id IS NOT NULL;
  IF v_n<>v_elegiveis THEN RAISE EXCEPTION 'FAIL % abordagens do CRM para % leads elegíveis', v_n, v_elegiveis; END IF;

  -- 2) Os dados: data do cadastro, de quem cadastrou, tempo 1 min, sem "mostrou IA".
  SELECT count(*) INTO v_n FROM public.abordagens a JOIN public.crm_leads l ON l.id=a.crm_lead_id
    WHERE a.created_at<>l.created_at OR a.user_id<>COALESCE(l.sdr_id,l.created_by) OR a.tempo_medio_abordagem<>1 OR a.mostrou_ia
      OR a.visao_geral<>'Lead cadastrado no CRM' OR a.nomes_abordados<>l.name;
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % abordagens com dados diferentes do cadastro', v_n; END IF;
  -- Os eventos: do SDR do lead, peso 0, papel sdr. O histórico é 'legacy' e tem a data do cadastro.
  SELECT count(*) INTO v_n FROM public.activity_feed f JOIN public.crm_leads l ON f.event_key='lead.approached:'||l.id||':registered'
    WHERE f.action_type<>'lead.approached' OR f.responsible_id<>COALESCE(l.sdr_id,l.created_by) OR f.responsible_role<>'sdr'
      OR f.score_delta<>0 OR f.revenue_delta<>0 OR f.lead_id<>l.id OR f.source_type<>'crm_leads' OR f.source_id<>l.id;
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % eventos da Arena com dados errados', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.activity_feed f JOIN public.crm_leads l ON f.event_key='lead.approached:'||l.id||':registered'
    WHERE f.provenance='legacy' AND f.occurred_at<>l.created_at;
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % eventos legacy sem a data do cadastro', v_n; END IF;

  -- 3) Fora da regra: lead do Meta não tem abordagem nem evento.
  SELECT count(*) INTO v_n FROM public.crm_leads l WHERE (l.created_by IS NULL OR COALESCE(l.lead_source,'')='meta_ads_form')
    AND (EXISTS (SELECT 1 FROM public.abordagens a WHERE a.crm_lead_id=l.id)
      OR EXISTS (SELECT 1 FROM public.activity_feed f WHERE f.event_key='lead.approached:'||l.id||':registered'));
  IF v_n<>0 THEN RAISE EXCEPTION 'FAIL % leads fora da regra foram contados', v_n; END IF;

  -- 4) Idempotência: o script do teste rodou a migração duas vezes; a segunda não pode ter mudado nada.
  IF to_regclass('pg_temp.hist_counts') IS NOT NULL THEN
    EXECUTE 'SELECT a, e FROM pg_temp.hist_counts' INTO v_antes;
    IF v_antes.a<>(SELECT count(*) FROM public.abordagens WHERE crm_lead_id IS NOT NULL)
      OR v_antes.e<>(SELECT count(*) FROM public.activity_feed WHERE event_key LIKE 'lead.approached:%:registered') THEN
      RAISE EXCEPTION 'FAIL rodar a migração do histórico de novo mudou as contagens'; END IF;
  END IF;

  -- 5) Os contadores enxergam o histórico: as métricas da Arena de todo o período trazem ao menos as abordagens do CRM.
  v_metricas := public.arena_period_metrics((SELECT min(created_at) - interval '1 day' FROM public.crm_leads), now() + interval '1 day');
  IF (v_metricas->>'approaches')::int < v_elegiveis THEN
    RAISE EXCEPTION 'FAIL as métricas da Arena contam % abordagens, esperado ao menos %', v_metricas->>'approaches', v_elegiveis; END IF;
END $$;
