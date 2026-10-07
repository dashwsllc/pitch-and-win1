-- Histórico da regra "cada lead cadastrado conta como uma abordagem": os leads que já existiam entram do mesmo jeito.
--
-- A migração 20261007150000 passou a contar cada lead NOVO (gatilho). Por decisão do dono ("quero que tudo entre, tudo
-- seja sincronizado"), os leads cadastrados antes dela entram agora pelo mesmo caminho:
--   * uma linha em abordagens por lead, com a data do cadastro (created_at do lead) e de quem cadastrou (SDR do lead, ou
--     quem o criou), como o gatilho faz;
--   * um evento lead.approached da Arena por lead, peso 0, proveniência 'legacy', com a data do cadastro. Os eventos legacy
--     não geram aviso nem som, não pontuam e não reabrem ciclos já fechados (o resultado de um ciclo fechado é congelado).
-- Fora da regra, como no gatilho: lead do Meta (lead_source = 'meta_ads_form') e lead sem autor.
-- É idempotente: os índices únicos (abordagens.crm_lead_id e activity_feed.event_key) fazem rodar de novo não duplicar nada.
-- No final, a própria migração confere que nenhum lead elegível ficou sem abordagem e sem evento, senão aborta tudo.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

INSERT INTO public.abordagens (user_id, nomes_abordados, dados_abordados, tempo_medio_abordagem, mostrou_ia, visao_geral, created_at, crm_lead_id)
SELECT COALESCE(l.sdr_id, l.created_by),
  left(COALESCE(NULLIF(btrim(l.name), ''), 'Lead'), 2000),
  left(COALESCE(NULLIF(concat_ws(' · ', 'Atleta ' || NULLIF(btrim(l.athlete_name), ''), NULLIF(btrim(l.phone), ''), NULLIF(btrim(l.email), '')), ''), 'Sem contato'), 5000),
  1, false, 'Lead cadastrado no CRM', l.created_at, l.id
FROM public.crm_leads l
WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source, '') <> 'meta_ads_form'
ON CONFLICT DO NOTHING;

SELECT public.arena_emit('lead.approached:' || l.id || ':registered', 'lead.approached', COALESCE(l.sdr_id, l.created_by), 'sdr',
  'crm_leads', l.id, l.created_at, 0, 0, l.id, NULL, NULL, 'legacy', l.created_by)
FROM public.crm_leads l
WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source, '') <> 'meta_ads_form';

DO $$
DECLARE v_sem_abordagem integer; v_sem_evento integer;
BEGIN
  SELECT count(*) INTO v_sem_abordagem FROM public.crm_leads l
    WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source, '') <> 'meta_ads_form'
      AND NOT EXISTS (SELECT 1 FROM public.abordagens a WHERE a.crm_lead_id = l.id);
  SELECT count(*) INTO v_sem_evento FROM public.crm_leads l
    WHERE l.created_by IS NOT NULL AND COALESCE(l.lead_source, '') <> 'meta_ads_form'
      AND NOT EXISTS (SELECT 1 FROM public.activity_feed f WHERE f.event_key = 'lead.approached:' || l.id || ':registered');
  IF v_sem_abordagem > 0 OR v_sem_evento > 0 THEN
    RAISE EXCEPTION 'Histórico incompleto: % leads sem abordagem e % sem evento da Arena', v_sem_abordagem, v_sem_evento;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
