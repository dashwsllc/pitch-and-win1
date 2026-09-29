-- Importação de métricas Meta (CSV) passa a ficar pendente até um Executive aprovar.
-- API (meta_import_daily_system) e histórico já existente não mudam de comportamento.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.meta_import_batches
  ADD COLUMN status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  ADD COLUMN rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 3 AND 500);

-- Batches já existentes já foram aplicados em meta_traffic_daily no momento do import
-- (regra antiga, sem pendência) - viram 'aprovado' com rows vazio: não há o que reaplicar,
-- só passam a valer pendência as importações feitas a partir desta migration.
UPDATE public.meta_import_batches SET status = 'aprovado', reviewed_at = created_at
  WHERE status = 'pendente';

-- Extraído de meta_upsert_traffic_row: só a validação, sem gravar nada. Reusado no import
-- (falha cedo, antes de existir um lote pendente) e continua também dentro do upsert no aprovar.
CREATE OR REPLACE FUNCTION public.meta_validate_traffic_row(item jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_date date; v_level text; v_account text; v_campaign text; v_adset text; v_ad text;
BEGIN
  v_date:=(item->>'date')::date;
  v_level:=item->>'level'; v_account:=btrim(coalesce(item->>'account_id',''));
  v_campaign:=btrim(coalesce(item->>'campaign_id','')); v_adset:=btrim(coalesce(item->>'adset_id',''));
  v_ad:=btrim(coalesce(item->>'ad_id',''));
  IF v_date IS NULL OR v_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date
    OR v_level NOT IN ('campaign','adset','ad') OR v_account='' OR v_campaign=''
    OR (v_level IN ('adset','ad') AND v_adset='') OR (v_level='ad' AND v_ad='')
    OR coalesce(item->>'currency','BRL')<>'BRL'
  THEN RAISE EXCEPTION 'Linha Meta inválida: data, nível, identificadores ou moeda'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.meta_validate_traffic_row(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Wrapper CSV: agora só registra o lote como pendente. A gravação em meta_traffic_daily
-- (via meta_upsert_traffic_row, já existente) passa a acontecer somente na aprovação.
CREATE OR REPLACE FUNCTION public.meta_import_daily(p_filename text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b uuid; item jsonb;
BEGIN
  IF NOT public.traffic_has_access() THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Arquivo ou quantidade de linhas inválida'; END IF;
  -- Valida cada linha antes de existir um lote pendente, para não aceitar lixo agora e falhar só na aprovação.
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    PERFORM public.meta_validate_traffic_row(item);
  END LOOP;
  INSERT INTO public.meta_import_batches(imported_by,filename,row_count,status,rows)
  VALUES(auth.uid(),btrim(p_filename),jsonb_array_length(p_rows),'pendente',p_rows) RETURNING id INTO b;
  RETURN jsonb_build_object('batch_id',b,'rows',jsonb_array_length(p_rows));
END $$;

-- Aprova ou rejeita um lote pendente. Mesmo contrato de manage_sale: concorrência otimista
-- por updated_at, motivo obrigatório na rejeição, só Executive/Super Admin decide.
CREATE OR REPLACE FUNCTION public.meta_review_traffic_import(p_batch_id uuid, p_action text,
  p_expected_updated_at timestamptz, p_note text DEFAULT '')
RETURNS public.meta_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.meta_import_batches; item jsonb;
BEGIN
  IF NOT public.is_executive(auth.uid()) THEN RAISE EXCEPTION 'Acesso de Executive necessário' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('aprovar','rejeitar') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO b FROM public.meta_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada'; END IF;
  IF b.status <> 'pendente' THEN RAISE EXCEPTION 'Esta importação já foi revisada'; END IF;
  IF b.updated_at <> p_expected_updated_at THEN RAISE EXCEPTION 'Importação foi alterada por outra pessoa, recarregue' USING ERRCODE='40001'; END IF;
  IF p_action = 'rejeitar' AND length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição (3 a 500 caracteres)';
  END IF;
  IF p_action = 'aprovar' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(b.rows) LOOP
      PERFORM public.meta_upsert_traffic_row(item,'csv',b.imported_by,b.id,NULL);
    END LOOP;
  END IF;
  UPDATE public.meta_import_batches SET
    status = CASE p_action WHEN 'aprovar' THEN 'aprovado' ELSE 'rejeitado' END,
    reviewed_by = auth.uid(), reviewed_at = clock_timestamp(),
    review_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = clock_timestamp()
  WHERE id = p_batch_id
  RETURNING * INTO b;
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.meta_review_traffic_import(uuid,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meta_review_traffic_import(uuid,text,timestamptz,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
