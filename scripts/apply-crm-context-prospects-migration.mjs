import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Leads sem cadastro na VOXEN enviados por escolha do time (botao no lead e secao VOXEN do CRM): migration 20261021233000_crm_context_prospects.
// Este script SO GERA o SQL (nao conecta em nenhum banco). Quem executa no banco real e o dono (ou quem ele autorizar), por passo:
//   node scripts/apply-crm-context-prospects-migration.mjs preflight   ensaio: instala tudo e termina SEMPRE em excecao (nada e gravado). Compara, cadastro por cadastro do site,
//                                                                       a funcao de producao com a nova (as unicas diferencas aceitas sao a observacao gerada pelo sistema, que
//                                                                       perde campanha e IDs da Meta, e pergunta nova de formulario), conta os leads candidatos, o tamanho do corpo
//                                                                       e faz a varredura de dados sensiveis (SO contagens, nunca conteudo).
//   node scripts/apply-crm-context-prospects-migration.mjs rehearsal   ensaio COMPLETO com dados reais, tambem desfeito (termina SEMPRE em excecao): instala a migration, simula a VOXEN
//                                                                       aceitando o ensaio, entra como um usuario real do CRM (papel authenticated + JWT) e envia todos os leads
//                                                                       candidatos em blocos de 15 como o app faz, edita um lead e cria uma nota pelas RPCs reais do app, para a
//                                                                       sincronia, roda a varredura e confere as negacoes de permissao. So contagens, tempos e codigos de erro.
//   node scripts/apply-crm-context-prospects-migration.mjs apply       gera a instalacao + registro em schema_migrations (nao envia nem enfileira nada)
// Nao usa `db push`, reset nem reaplicacao geral (o historico remoto de migrations diverge do checkout).
const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const migration = { version: '20261021233000', name: 'crm_context_prospects' }
if (!['preflight', 'rehearsal', 'apply'].includes(mode)) { console.error('Use: preflight | rehearsal | apply'); process.exit(2) }
const source = readFileSync(resolve(root, `supabase/migrations/${migration.version}_${migration.name}.sql`), 'utf8')
const bodyOf = text => text.replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/m, '')
const notInstalled = `DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${migration.version}') THEN RAISE EXCEPTION 'Migration ${migration.version} ja instalada'; END IF; END; $$;`
let query
if (mode === 'apply') {
  query = ['BEGIN;', notInstalled, bodyOf(source),
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${migration.version}','${migration.name}',ARRAY[$migration$${source}$migration$]);`,
    'COMMIT;', `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`].join('\n')
} else if (mode === 'preflight') {
  // 1) guarda a funcao REAL de producao como "legado"; 2) instala a migration; 3) compara e conta; 4) desfaz tudo.
  const legacy = `
    DO $legacy$
    DECLARE d text;
    BEGIN
      d:=pg_get_functiondef('public.crm_context_payload(uuid)'::regprocedure);
      IF position('FUNCTION public.crm_context_payload(' in d)=0 THEN RAISE EXCEPTION 'definicao inesperada'; END IF;
      EXECUTE replace(d,'FUNCTION public.crm_context_payload(','FUNCTION public.crm_context_payload_legacy(');
    END $legacy$;
    CREATE FUNCTION pg_temp.pf_norm(x jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE WHEN x IS NULL THEN NULL WHEN x->'crm' IS NULL THEN x WHEN (x->'crm') - 'observations' = '{}'::jsonb THEN x - 'crm'
        ELSE jsonb_set(x,'{crm}',(x->'crm') - 'observations') END $$;`
  // Tres blocos (cada um e um comando, com o proprio limite de tempo); o resultado de cada um fica numa variavel local da transacao.
  const timeout = `SET LOCAL statement_timeout='300s';`
  const normal = `
    DO $pf_normal$
    DECLARE r record; a jsonb; b jsonb; v_f record; v_sites integer:=0; v_equal integer:=0; v_obs integer:=0; v_other integer:=0; v_null integer:=0; v_align jsonb; v_ids integer:=0; v_tpl integer:=0;
    BEGIN
      -- fluxo normal: o payload novo tem de ser IGUAL ao da funcao de producao, exceto a observacao gerada pelo sistema (campanha e IDs da Meta saem)
      FOR r IN SELECT id FROM public.meta_form_leads WHERE entry_channel='website' LOOP
        v_sites:=v_sites+1; a:=public.crm_context_payload(r.id); b:=public.crm_context_payload_legacy(r.id);
        IF a IS NOT DISTINCT FROM b THEN v_equal:=v_equal+1;
        ELSIF pg_temp.pf_norm(a) IS NOT DISTINCT FROM pg_temp.pf_norm(b) THEN v_obs:=v_obs+1;
        ELSE v_other:=v_other+1; END IF;
        IF b IS NULL THEN v_null:=v_null+1; ELSE
          -- informativo (texto de producao): quantos atletas JA entregues levam campanha ou IDs da Meta
          SELECT m.campaign_name,m.campaign_id,m.ad_id,m.form_id,m.page_id,m.meta_lead_id INTO v_f FROM public.meta_form_leads m WHERE m.id=(b->'link'->>'form_lead_id')::uuid;
          IF EXISTS(SELECT 1 FROM unnest(ARRAY[v_f.campaign_name,v_f.campaign_id,v_f.ad_id,v_f.form_id,v_f.page_id,v_f.meta_lead_id]) x WHERE length(coalesce(x,''))>=4 AND position(lower(x) in lower(b::text))>0) THEN v_ids:=v_ids+1; END IF;
          IF (b->'crm'->>'observations') ~ 'Formul.rio Meta' THEN v_tpl:=v_tpl+1; END IF;
        END IF;
      END LOOP;
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      v_align:=public.crm_context_alignment();
      PERFORM set_config('pf.normal',format('normal: sites=%s iguais=%s so_observacao=%s outras_diferencas=%s sem_corpo=%s | alinhamento: in_sync=%s to_enqueue=%s skipped=%s | atuais_com_campanha_ou_ids_da_meta=%s atuais_com_observacao_automatica=%s',
        v_sites,v_equal,v_obs,v_other,v_null,v_align->>'in_sync',v_align->>'to_enqueue',v_align->>'skipped',v_ids,v_tpl),true);
    END $pf_normal$;`
  const prospects = `
    DO $pf_prospects$
    DECLARE
      r record; a jsonb; v_f record; t text; digits text; v_phone text; v_cand integer:=0; v_body_null integer:=0; v_max integer:=0; v_total bigint:=0;
      v_answers integer:=0; v_extra integer:=0; v_notes integer:=0; v_obs integer:=0; v_qual integer:=0; v_guard integer:=0; v_athlete integer:=0; v_formlink integer:=0;
      v_email integer:=0; v_run8 integer:=0; v_own integer:=0; v_url integer:=0; v_handle integer:=0; v_removed integer:=0; v_badkey integer:=0; v_ids integer:=0;
      t0 timestamptz; v_ms_build numeric:=0; v_ms_states numeric; v_reg integer;
    BEGIN
      -- o corpo de cada candidato e examinado SO por contagens (o tempo de montar cada corpo importa: o app envia em blocos de 15 e a sessao tem limite de tempo)
      t0:=clock_timestamp();
      PERFORM public.crm_context_payload_prospect(c) FROM public.crm_context_prospect_candidates() c;
      v_ms_build:=round(extract(epoch from clock_timestamp()-t0)*1000);
      t0:=clock_timestamp();
      SELECT count(*) INTO v_reg FROM public.crm_leads c WHERE public.crm_context_lead_has_voxen(c.id);
      v_ms_states:=round(extract(epoch from clock_timestamp()-t0)*1000);
      FOR r IN SELECT c AS id FROM public.crm_context_prospect_candidates() c LOOP
        v_cand:=v_cand+1; a:=public.crm_context_payload_prospect(r.id);
        IF a IS NULL THEN v_body_null:=v_body_null+1; CONTINUE; END IF;
        t:=a::text; v_total:=v_total+length(t); v_max:=greatest(v_max,length(t));
        IF a->'answers' IS NOT NULL THEN v_answers:=v_answers+1; END IF;
        IF jsonb_array_length(coalesce(a->'answers','[]'::jsonb))>11 THEN v_extra:=v_extra+1; END IF;
        IF a->'notes' IS NOT NULL THEN v_notes:=v_notes+1; END IF;
        IF a->'crm'->'observations' IS NOT NULL THEN v_obs:=v_obs+1; END IF;
        IF a->'crm'->'qualification' IS NOT NULL THEN v_qual:=v_qual+1; END IF;
        IF a->'guardian' IS NOT NULL THEN v_guard:=v_guard+1; END IF;
        IF a->'structured'->'athlete_name' IS NOT NULL THEN v_athlete:=v_athlete+1; END IF;
        IF a->'link'->>'form_lead_id' IS NOT NULL THEN v_formlink:=v_formlink+1; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_object_keys(a) k WHERE k NOT IN('link','profile','context','structured','guardian','crm','notes','answers')) THEN v_badkey:=v_badkey+1; END IF;
        IF t ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' THEN v_email:=v_email+1; END IF;
        IF t ~* '(https?://|www\\.|wa\\.me|t\\.me/)' THEN v_url:=v_url+1; END IF;
        IF t ~ '(^|[^A-Za-z0-9_.])@[A-Za-z0-9_.]{3,}' THEN v_handle:=v_handle+1; END IF;
        IF position('[contato removido]' in t)>0 THEN v_removed:=v_removed+1; END IF;
        digits:=regexp_replace(t,'[^0-9]','','g');
        -- sequencias de 8+ digitos fora de "link" (os UUIDs do proprio link podem ter algumas)
        IF (a-'link')::text ~ '[0-9]{8,}' THEN v_run8:=v_run8+1; END IF;
        -- campanha, anuncio e IDs da Meta do formulario deste lead: nada disso pode aparecer no corpo
        SELECT m.campaign_name,m.campaign_id,m.ad_id,m.form_id,m.page_id,m.meta_lead_id INTO v_f FROM public.meta_form_leads m WHERE m.id=(a->'link'->>'form_lead_id')::uuid;
        IF EXISTS(SELECT 1 FROM unnest(ARRAY[v_f.campaign_name,v_f.campaign_id,v_f.ad_id,v_f.form_id,v_f.page_id,v_f.meta_lead_id]) x WHERE length(coalesce(x,''))>=4 AND position(lower(x) in lower(t))>0) THEN v_ids:=v_ids+1; END IF;
        SELECT regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') INTO v_phone FROM public.crm_leads c WHERE c.id=r.id;
        IF length(coalesce(v_phone,''))>=8 AND position(right(v_phone,8) in digits)>0 THEN v_own:=v_own+1; END IF;
      END LOOP;
      PERFORM set_config('pf.prospects',format('leads sem cadastro: candidatos=%s sem_corpo=%s | conteudo: respostas=%s com_pergunta_nova=%s notas=%s observacoes=%s qualificacao=%s responsavel=%s nome_atleta=%s com_formulario=%s bytes_max=%s bytes_total=%s | varredura: email=%s digitos8_fora_do_link=%s telefone_proprio=%s url=%s arroba=%s contato_removido=%s chaves_fora=%s campanha_ou_ids_da_meta=%s | tempo: montar_todos_os_corpos_ms=%s estados_de_todos_os_leads_ms=%s cadastrados_na_voxen=%s',
        v_cand,v_body_null,v_answers,v_extra,v_notes,v_obs,v_qual,v_guard,v_athlete,v_formlink,v_max,v_total,v_email,v_run8,v_own,v_url,v_handle,v_removed,v_badkey,v_ids,v_ms_build,v_ms_states,v_reg),true);
    END $pf_prospects$;`
  const finish = `
    DO $pf_end$
    BEGIN
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      RAISE EXCEPTION 'PREFLIGHT_OK % | % | situacao: % | entrega_ligada=% jobs_ativos=%',current_setting('pf.normal'),current_setting('pf.prospects'),public.crm_context_prospects_status()::text,
        (SELECT enabled FROM public.crm_context_delivery_control WHERE singleton)::text,
        (SELECT coalesce(string_agg(jobname,',' ORDER BY jobname),'') FROM cron.job WHERE jobname LIKE 'crm-context-%' AND active) USING ERRCODE='P0001';
    END $pf_end$;`
  query = ['BEGIN;', notInstalled, legacy, bodyOf(source), timeout, normal, prospects, finish, 'ROLLBACK;'].join('\n')
} else {
  // Ensaio completo: tudo dentro de uma transacao que SEMPRE termina em excecao e ROLLBACK. Nada chega a ser gravado nem enviado (o cron so enxerga o que foi confirmado).
  // Nunca imprime dado de lead: so contagens, tempos, booleanos e codigos SQLSTATE. Os usuarios reais usados na simulacao nao sao impressos.
  const rehearsal = `
    DO $rh$
    DECLARE
      r jsonb:='{}'::jsonb; counts jsonb:='{}'::jsonb; x record;
      v_crm uuid; v_none uuid; v_ev uuid; v_tok uuid; v_claim jsonb; v_all uuid[]; v_chunk uuid[]; v_lead uuid; v_reg uuid; v_ver bigint;
      v_res jsonb; v_f jsonb; v_none_real boolean; t0 timestamptz; t1 timestamptz; v_ms numeric; v_max_ms numeric:=0; v_err text; v_errs_before bigint; v_n bigint; i integer;
      v_obs constant text:='Observação de ensaio digitada pela equipe.'; v_note constant text:='Nota de ensaio da equipe.';
    BEGIN
      -- usuarios reais para simular (nunca impressos): um SDR/closer ativo (de preferencia que NAO seja executivo) e um perfil sem nenhum acesso ao CRM
      -- (suspenso ou sem papel de CRM); se nao existir, um uid autenticado sem perfil
      SELECT ur.user_id INTO v_crm FROM public.user_roles ur JOIN public.profiles p ON p.user_id=ur.user_id AND NOT p.suspended
       WHERE ur.role::text IN('sdr','closer') ORDER BY public.crm_user_can(ur.user_id,'executive'), ur.user_id LIMIT 1;
      SELECT p.user_id INTO v_none FROM public.profiles p WHERE NOT public.crm_user_can(p.user_id,'leads') ORDER BY p.user_id LIMIT 1;
      v_none_real:=v_none IS NOT NULL;
      v_none:=coalesce(v_none,gen_random_uuid());
      IF v_crm IS NULL THEN RAISE EXCEPTION 'ENSAIO_ABORTADO: nenhum SDR/closer ativo para simular'; END IF;
      r:=r||jsonb_build_object('usuario_crm_achado',true,'usuario_crm_tambem_executivo',public.crm_user_can(v_crm,'executive'),'usuario_sem_crm_e_perfil_real',v_none_real,
        'usuario_sem_crm_tem_acesso',public.crm_user_can(v_none,'leads'));
      SELECT trigger_error_count INTO v_errs_before FROM public.crm_context_delivery_control WHERE singleton;
      SELECT array_agg(c ORDER BY c) INTO v_all FROM public.crm_context_prospect_candidates() c;
      IF v_all IS NULL THEN RAISE EXCEPTION 'ENSAIO_ABORTADO: nenhum lead candidato'; END IF;
      v_reg:=(SELECT l.id FROM public.crm_leads l WHERE public.crm_context_lead_has_voxen(l.id) ORDER BY l.id LIMIT 1);
      r:=r||jsonb_build_object('candidatos',array_length(v_all,1),'lead_ja_cadastrado_achado',v_reg IS NOT NULL);

      -- 1. a VOXEN aceita o ensaio (recibo applied), como a Zyron faria
      v_ev:=public.crm_context_enqueue_synthetic_prospect();
      v_claim:=public.crm_context_claim(1,60,v_ev); v_tok:=(v_claim->0->>'claim_token')::uuid;
      PERFORM public.crm_context_ack(v_ev,v_tok,jsonb_build_object('ok',true,'receipt_id',gen_random_uuid(),'event_id',v_ev,'status','applied'));
      r:=r||jsonb_build_object('ensaio_aceito',public.crm_context_rehearsal_accepted());

      -- 2. a partir daqui, como o usuario real do CRM (papel authenticated + JWT), igual ao que o PostgREST faz
      PERFORM set_config('request.jwt.claim.sub',v_crm::text,true);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_crm,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      t0:=clock_timestamp(); v_res:=public.crm_voxen_sync_states(); v_ms:=round(extract(epoch from clock_timestamp()-t0)*1000);
      r:=r||jsonb_build_object('estados',jsonb_build_object('pronto',v_res->'ready','linhas',jsonb_array_length(v_res->'rows'),'ms',v_ms,
        'por_estado',(SELECT jsonb_object_agg(s,n) FROM (SELECT e->>'state' AS s,count(*) AS n FROM jsonb_array_elements(v_res->'rows') e GROUP BY 1) z)));
      -- o que o app NAO pode tocar (esperado: 42501 em todos)
      BEGIN PERFORM count(*) FROM public.crm_voxen_prospects; v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_le_tabela_escolhidos',v_err);
      BEGIN PERFORM count(*) FROM public.crm_context_outbox; v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_le_fila',v_err);
      BEGIN PERFORM public.crm_context_build(NULL,NULL,NULL,NULL,false); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_chama_montador',v_err);
      BEGIN PERFORM public.crm_context_enqueue_prospect(v_all[1],false,true); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_enfileira_direto',v_err);
      BEGIN PERFORM public.crm_context_enqueue_synthetic_prospect(); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_cria_ensaio',v_err);
      BEGIN PERFORM public.crm_context_prospects_status(); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('app_le_situacao_do_executivo',v_err);

      -- 3. "Enviar para a VOXEN" em todos os candidatos, em blocos de 15, como o app faz
      t0:=clock_timestamp();
      FOR i IN 0..((array_length(v_all,1)-1)/15) LOOP
        v_chunk:=v_all[(i*15+1):(i*15+15)];
        t1:=clock_timestamp(); v_res:=public.crm_voxen_send(v_chunk);
        v_max_ms:=greatest(v_max_ms,round(extract(epoch from clock_timestamp()-t1)*1000));
        FOR x IN SELECT e->>'result' AS res FROM jsonb_array_elements(v_res) e LOOP
          counts:=jsonb_set(counts,ARRAY[x.res],to_jsonb(coalesce((counts->>x.res)::integer,0)+1));
        END LOOP;
      END LOOP;
      v_ms:=round(extract(epoch from clock_timestamp()-t0)*1000);
      v_res:=public.crm_voxen_send(v_all[1:15]);   -- clicar de novo
      r:=r||jsonb_build_object('reenviar_primeiro_bloco',(SELECT jsonb_object_agg(s,n) FROM (SELECT e->>'result' AS s,count(*) AS n FROM jsonb_array_elements(v_res) e GROUP BY 1) z));
      v_res:=public.crm_voxen_send(ARRAY[v_reg,gen_random_uuid()]);   -- um ja cadastrado na VOXEN e um que nao existe
      r:=r||jsonb_build_object('cadastrado_e_inexistente',(SELECT jsonb_agg(e->>'result' ORDER BY e->>'result') FROM jsonb_array_elements(v_res) e));
      RESET ROLE;
      SELECT jsonb_build_object('eventos',count(*),'leads',count(DISTINCT source_lead_id),'pendentes',count(*) FILTER (WHERE state='pending'),
        'bytes_max',max(length(payload::text)),'bytes_total',sum(length(payload::text)),'tipo_ok',bool_and(payload->>'kind'='prospect_context'),
        'link_ok',bool_and((payload->'link'->>'crm_lead_id')::uuid=source_lead_id),'so_revisao_1',bool_and(source_revision=1),
        'saem_na_hora',bool_and(next_attempt_at<=clock_timestamp()+interval '2 seconds')) INTO v_f
        FROM public.crm_context_outbox WHERE payload->>'kind'='prospect_context' AND coalesce(payload->'link'->>'basis','')<>'teste de integração';
      r:=r||jsonb_build_object('envio_em_massa',jsonb_build_object('tempo_total_ms',v_ms,'maior_bloco_ms',v_max_ms,'resultados',counts,'fila',v_f,
        'escolhidos',(SELECT count(*) FROM public.crm_voxen_prospects WHERE enabled)));

      -- 4. um lead enviado: a primeira versao e entregue; depois edicao e nota pelas RPCs reais do app chegam como versao nova
      v_lead:=v_all[1];
      SELECT event_id INTO v_ev FROM public.crm_context_outbox WHERE source_lead_id=v_lead AND payload->>'kind'='prospect_context' ORDER BY source_revision DESC LIMIT 1;
      v_claim:=public.crm_context_claim(1,60,v_ev); v_tok:=(v_claim->0->>'claim_token')::uuid;
      PERFORM public.crm_context_ack(v_ev,v_tok,jsonb_build_object('ok',true,'receipt_id',gen_random_uuid(),'event_id',v_ev,'status','applied'));
      SELECT version INTO v_ver FROM public.crm_leads WHERE id=v_lead;
      SET LOCAL ROLE authenticated;
      BEGIN PERFORM public.crm_transition(v_lead,'edit',v_ver,jsonb_build_object('observations',v_obs)); v_err:='ok'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE||' '||left(SQLERRM,90); END;
      RESET ROLE;
      SELECT jsonb_build_object('rpc',v_err,'versoes',count(*),'ultima_versao',max(source_revision),'ultima_estado',(array_agg(state ORDER BY source_revision DESC))[1],
        'texto_chegou',coalesce(bool_or(payload->'crm'->>'observations'=v_obs),false),
        'espera_janela',coalesce((array_agg(next_attempt_at>clock_timestamp() ORDER BY source_revision DESC))[1],false)) INTO v_f
        FROM public.crm_context_outbox WHERE source_lead_id=v_lead AND payload->>'kind'='prospect_context';
      r:=r||jsonb_build_object('editar_lead_pela_rpc_do_app',v_f);
      SET LOCAL ROLE authenticated;
      BEGIN PERFORM public.crm_add_lead_context_with_media(v_lead,'manual_note',v_note,NULL); v_err:='ok'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE||' '||left(SQLERRM,90); END;
      RESET ROLE;
      SELECT jsonb_build_object('rpc',v_err,'versoes',count(*),
        'nota_chegou',coalesce(bool_or(EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'notes','[]'::jsonb)) n WHERE n->>'content'=v_note)),false)) INTO v_f
        FROM public.crm_context_outbox WHERE source_lead_id=v_lead AND payload->>'kind'='prospect_context';
      r:=r||jsonb_build_object('criar_nota_pela_rpc_do_app',v_f);
      -- parar de sincronizar: mudancas depois nao geram versao
      SELECT count(*) INTO v_n FROM public.crm_context_outbox WHERE source_lead_id=v_lead AND payload->>'kind'='prospect_context';
      SET LOCAL ROLE authenticated;
      v_res:=public.crm_voxen_stop(ARRAY[v_lead]);
      RESET ROLE;
      SELECT version INTO v_ver FROM public.crm_leads WHERE id=v_lead;
      SET LOCAL ROLE authenticated;
      BEGIN PERFORM public.crm_transition(v_lead,'edit',v_ver,jsonb_build_object('observations','Outra observação depois de parar.')); v_err:='ok'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE||' '||left(SQLERRM,90); END;
      RESET ROLE;
      r:=r||jsonb_build_object('parar',jsonb_build_object('resultado',v_res->0->>'result','rpc_edicao',v_err,'versoes_antes',v_n,
        'versoes_depois',(SELECT count(*) FROM public.crm_context_outbox WHERE source_lead_id=v_lead AND payload->>'kind'='prospect_context')));

      -- 5. sem acesso ao CRM (perfil suspenso/sem papel, ou uid sem perfil) e o papel anon: as tres acoes precisam recusar (42501)
      PERFORM set_config('request.jwt.claim.sub',v_none::text,true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_none,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      BEGIN PERFORM public.crm_voxen_send(ARRAY[v_all[2]]); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('sem_crm_enviar',v_err);
      BEGIN PERFORM public.crm_voxen_stop(ARRAY[v_all[2]]); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('sem_crm_parar',v_err);
      BEGIN PERFORM public.crm_voxen_sync_states(); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('sem_crm_estados',v_err);
      RESET ROLE;
      PERFORM set_config('request.jwt.claim.sub','',true);
      PERFORM set_config('request.jwt.claim.role','anon',true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
      SET LOCAL ROLE anon;
      BEGIN PERFORM public.crm_voxen_send(ARRAY[v_all[2]]); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('anon_enviar',v_err);
      BEGIN PERFORM public.crm_voxen_sync_states(); v_err:='PERMITIDO'; EXCEPTION WHEN OTHERS THEN v_err:=SQLSTATE; END;
      r:=r||jsonb_build_object('anon_estados',v_err);
      RESET ROLE;

      -- 6. varredura de seguranca (o que o cron faz a cada 15 min), duas vezes: a primeira enfileira o que mudou (as observacoes dos atletas ja entregues), a segunda nao muda nada
      PERFORM set_config('request.jwt.claim.role','service_role',true);
      t0:=clock_timestamp(); v_res:=public.crm_context_reconcile(500);
      r:=r||jsonb_build_object('varredura_1',v_res||jsonb_build_object('ms',round(extract(epoch from clock_timestamp()-t0)*1000)));
      SELECT jsonb_build_object('athlete_context_pendentes',count(*) FILTER (WHERE payload->>'kind'='athlete_context' AND state='pending'),
        'prospect_pendentes',count(*) FILTER (WHERE payload->>'kind'='prospect_context' AND state='pending' AND coalesce(payload->'link'->>'basis','')<>'teste de integração')) INTO v_f
        FROM public.crm_context_outbox;
      r:=r||jsonb_build_object('fila_depois_da_varredura',v_f);
      t0:=clock_timestamp(); v_res:=public.crm_context_reconcile(500);
      r:=r||jsonb_build_object('varredura_2',v_res||jsonb_build_object('ms',round(extract(epoch from clock_timestamp()-t0)*1000)));
      r:=r||jsonb_build_object('situacao',public.crm_context_prospects_status());
      r:=r||jsonb_build_object('erros_de_gatilho_novos',(SELECT trigger_error_count FROM public.crm_context_delivery_control WHERE singleton)-v_errs_before);
      RAISE EXCEPTION 'ENSAIO_OK %',r::text USING ERRCODE='P0001';
    END $rh$;`
  query = ['BEGIN;', notInstalled, bodyOf(source), `SET LOCAL statement_timeout='300s';`, rehearsal, 'ROLLBACK;'].join('\n')
}
mkdirSync(resolve(root, '.verification.local'), { recursive: true })
const file = `.verification.local/crm-context-prospects-${mode}.sql`
writeFileSync(resolve(root, file), query)
console.error(`SQL gerado, nada foi executado. Para rodar no banco real (so com o seu ok):\n  npx supabase db query --linked --project-ref mbzwchnxtskysqplqiyy --file ${file} --output json`)
console.log(file)
