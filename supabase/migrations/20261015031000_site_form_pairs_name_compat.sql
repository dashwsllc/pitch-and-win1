-- Ligar a pessoa errada mostraria as respostas de OUTRO atleta ao SDR. As regras 2 e 3 do vinculo
-- (primeiro nome igual) passam a exigir tambem nomes COMPATIVEIS: os nomes do menor precisam estar no maior
-- (ignorando de/da/do/dos/das/e/di/du); com 4+ nomes tolera-se uma letra diferente em um deles. Nome de
-- apelido/usuario no formulario ("kaio_xz123", "@carlos.X7") segue valendo pelo primeiro nome. Pares com nomes
-- incompativeis nao sao ligados: aparecem como "revisar (ambiguo)" para decisao humana.
-- Depende de 20261015021500_site_form_answers_link.sql.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF to_regprocedure('public.meta_site_form_pairs()') IS NULL THEN
  RAISE EXCEPTION 'Aplique antes a migration 20261015021500_site_form_answers_link' USING ERRCODE='55000'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.meta_names_compatible(a text,b text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE ta text[]; tb text[]; short text[]; long text[]; hits int;
 stop constant text[]:=ARRAY['de','da','do','dos','das','e','di','du'];
BEGIN
 ta:=ARRAY(SELECT t FROM unnest(string_to_array(public.meta_match_name(a),' ')) t WHERE t<>'' AND t<>ALL(stop));
 tb:=ARRAY(SELECT t FROM unnest(string_to_array(public.meta_match_name(b),' ')) t WHERE t<>'' AND t<>ALL(stop));
 IF cardinality(ta)=0 OR cardinality(tb)=0 THEN RETURN false; END IF;
 IF cardinality(ta)<=cardinality(tb) THEN short:=ta; long:=tb; ELSE short:=tb; long:=ta; END IF;
 SELECT count(*) INTO hits FROM unnest(short) t WHERE t=ANY(long);
 RETURN hits=cardinality(short) OR (cardinality(short)>=4 AND hits>=cardinality(short)-1);
END $$;

CREATE OR REPLACE FUNCTION public.meta_site_form_pairs() RETURNS TABLE(site_id uuid,form_id uuid,rule smallint,delta_seconds numeric,ambiguous boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH s AS (
  SELECT m.id,m.created_time t,public.meta_site_ad_id(m.source_snapshot#>>'{site_event,payload,attribution,utm_content}') ad,
   public.meta_match_name(m.full_name) nome,m.full_name raw,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='website' AND m.answers_form_lead_id IS NULL
 ), f AS (
  SELECT m.id,m.created_time t,m.ad_id ad,public.meta_match_name(m.full_name) nome,m.full_name raw,public.meta_phone_tail(m.phone) k8
  FROM public.meta_form_leads m WHERE m.entry_channel='form' AND public.crm_form_answers_present(to_jsonb(m))
   AND NOT EXISTS(SELECT 1 FROM public.meta_form_leads x WHERE x.answers_form_lead_id=m.id)
 ), p AS (
  SELECT s.id sid,f.id fid,extract(epoch FROM s.t-f.t) d,
   (CASE
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND s.nome<>'' AND s.nome=f.nome AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '10 minutes' THEN 1
    WHEN s.ad IS NOT NULL AND s.ad=f.ad AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '15 minutes' THEN 2
    WHEN s.k8<>'' AND s.k8=f.k8 AND split_part(s.nome,' ',1)<>'' AND split_part(s.nome,' ',1)=split_part(f.nome,' ',1)
     AND s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours' THEN 3 END)::smallint rule,
   (s.nome=f.nome OR f.raw ~ '[._@~0-9]' OR public.meta_names_compatible(s.raw,f.raw)) compat
  FROM s JOIN f ON s.t-f.t BETWEEN interval '-2 minutes' AND interval '72 hours'
 ), q AS (
  SELECT *,min(rule) FILTER (WHERE compat) OVER (PARTITION BY fid) best_f,min(rule) FILTER (WHERE compat) OVER (PARTITION BY sid) best_s
  FROM p WHERE rule IS NOT NULL
 ), k AS (
  SELECT *,count(*) FILTER (WHERE compat) OVER (PARTITION BY fid) n_f,count(*) FILTER (WHERE compat) OVER (PARTITION BY sid) n_s
  FROM q WHERE NOT compat OR (rule=best_f AND rule=best_s)
 )
 SELECT sid,fid,rule,d,(NOT compat OR n_f>1 OR n_s>1) FROM k
$$;

REVOKE ALL ON FUNCTION public.meta_names_compatible(text,text),public.meta_site_form_pairs() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
