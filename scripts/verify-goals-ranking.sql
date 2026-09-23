-- Executed after the new migration inside a transaction that always rolls back.
DO $verify$
DECLARE
  v_admin uuid;
  v_assignee uuid;
  v_other uuid;
  v_goal uuid;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
  v_sale public.vendas;
  v_task public.daily_goal_tasks;
  v_before numeric;
  v_after numeric;
BEGIN
  SELECT r.user_id INTO v_admin FROM public.user_roles r
  JOIN public.profiles p USING(user_id)
  WHERE r.role::text='super_admin' AND NOT p.suspended
    AND EXISTS(SELECT 1 FROM public.registration_requests q WHERE q.user_id=r.user_id AND q.status='approved')
  ORDER BY r.user_id LIMIT 1;
  SELECT r.user_id INTO v_assignee FROM public.user_roles r
  JOIN public.profiles p USING(user_id)
  WHERE r.role::text='closer' AND NOT p.suspended
    AND NOT EXISTS(SELECT 1 FROM public.user_roles x WHERE x.user_id=r.user_id AND x.role::text IN ('executive','super_admin'))
    AND EXISTS(SELECT 1 FROM public.registration_requests q WHERE q.user_id=r.user_id AND q.status='approved')
  ORDER BY r.user_id LIMIT 1;
  SELECT r.user_id INTO v_other FROM public.user_roles r
  JOIN public.profiles p USING(user_id)
  WHERE r.role::text IN ('closer','sdr') AND r.user_id<>v_assignee AND NOT p.suspended
    AND NOT EXISTS(SELECT 1 FROM public.user_roles x WHERE x.user_id=r.user_id AND x.role::text IN ('executive','super_admin'))
    AND EXISTS(SELECT 1 FROM public.registration_requests q WHERE q.user_id=r.user_id AND q.status='approved')
  ORDER BY r.user_id LIMIT 1;
  IF v_admin IS NULL OR v_assignee IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'A verificação exige executivo e dois colaboradores aprovados';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_start:=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo');
  v_end:=v_start+interval '1 month';
  IF public.get_team_ranking() IS DISTINCT FROM public.arena_team_ranking(
    v_start AT TIME ZONE 'America/Sao_Paulo',v_end AT TIME ZONE 'America/Sao_Paulo') THEN
    RAISE EXCEPTION 'O ranking de Closers difere do mês atual da Arena';
  END IF;
  SELECT s.* INTO v_sale FROM public.vendas s JOIN public.arena_sale_facts f ON f.sale_id=s.id
  WHERE f.active AND f.responsible_role='closer'
    AND f.occurred_at>=v_start AT TIME ZONE 'America/Sao_Paulo'
    AND f.occurred_at<v_end AT TIME ZONE 'America/Sao_Paulo'
  ORDER BY f.occurred_at DESC LIMIT 1;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Sem venda aprovada de Closer no mês para verificar atualização'; END IF;
  SELECT (x->>'totalVendas')::numeric INTO v_before
  FROM jsonb_array_elements(public.get_team_ranking()) x WHERE x->>'user_id'=v_sale.user_id::text;
  PERFORM set_config('dashboard.sale_edit',v_sale.id::text,true);
  PERFORM set_config('dashboard.sale_decision',v_sale.id::text,true);
  UPDATE public.vendas SET valor_venda=valor_venda+1 WHERE id=v_sale.id;
  PERFORM set_config('dashboard.sale_edit','',true);
  PERFORM set_config('dashboard.sale_decision','',true);
  SELECT (x->>'totalVendas')::numeric INTO v_after
  FROM jsonb_array_elements(public.get_team_ranking()) x WHERE x->>'user_id'=v_sale.user_id::text;
  IF v_after IS DISTINCT FROM v_before+1 THEN
    RAISE EXCEPTION 'Venda editada não atualizou o ranking mensal';
  END IF;
  v_task:=public.executive_create_daily_goal_task(v_assignee,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'Verificação transitória de tarefa individual');

  v_goal:=public.arena_save_goal(jsonb_build_object(
    'title','Verificação transitória de meta individual',
    'scope','user','period','daily','target_role','closer',
    'assignee_id',v_assignee,'target',137,'enabled',true
  ),'Verificação com rollback');
  IF EXISTS(SELECT 1 FROM public.arena_notifications n
    WHERE n.event_key='goal.version:'||v_goal
      AND n.recipient_id<>v_assignee
      AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=n.recipient_id
        AND r.role::text IN ('executive','super_admin'))) THEN
    RAISE EXCEPTION 'Meta individual notificada a outro colaborador';
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub',v_assignee::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.daily_goal_tasks WHERE id=v_task.id) THEN
    RAISE EXCEPTION 'Colaborador não vê a própria tarefa';
  END IF;
  v_task:=public.set_daily_goal_task_completed(v_task.id,true,v_task.version);
  IF NOT v_task.is_completed THEN RAISE EXCEPTION 'Colaborador não concluiu a tarefa'; END IF;
  BEGIN
    PERFORM public.executive_create_daily_goal_task(v_assignee,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date,'Criação indevida');
    RAISE EXCEPTION 'Colaborador criou tarefa sem permissão';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.company_goals WHERE id=v_goal) OR
     NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_visible_goals()) x
       WHERE x->>'goal_id'=v_goal::text) OR
     NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_dashboard(
       (now()-interval '1 hour'),now()+interval '1 hour')->'cycles') x
       WHERE x->>'goal_id'=v_goal::text) THEN
    RAISE EXCEPTION 'Colaborador escolhido não vê a própria meta';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
  IF EXISTS(SELECT 1 FROM public.daily_goal_tasks WHERE id=v_task.id) THEN
    RAISE EXCEPTION 'Outro colaborador viu tarefa individual';
  END IF;
  BEGIN
    PERFORM public.arena_complete_task(v_task.id,false,v_task.version,'');
    RAISE EXCEPTION 'Outro colaborador alterou tarefa individual';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.company_goals WHERE id=v_goal) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_visible_goals()) x
       WHERE x->>'goal_id'=v_goal::text) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_dashboard(
       (now()-interval '1 hour'),now()+interval '1 hour')->'cycles') x
       WHERE x->>'goal_id'=v_goal::text) THEN
    RAISE EXCEPTION 'Outro colaborador consegue ver meta individual';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_visible_goals()) x
    WHERE x->>'scope' IN ('global','role')) THEN
    RAISE EXCEPTION 'Metas coletivas não estão visíveis ao time';
  END IF;
  IF has_table_privilege('authenticated','public.goal_cycles','SELECT') THEN
    RAISE EXCEPTION 'Snapshots brutos de metas ficaram acessíveis';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_visible_goals()) x
    JOIN public.company_goals g ON g.id=(x->>'goal_id')::uuid
    CROSS JOIN LATERAL jsonb_array_elements(x->'result'->'members') member
    WHERE x->>'scope'='role' AND (member->>'target')::numeric IS DISTINCT FROM g.target) THEN
    RAISE EXCEPTION 'Meta individual vazou no resumo coletivo';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.company_goals WHERE id=v_goal) OR
     NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.arena_visible_goals()) x
       WHERE x->>'goal_id'=v_goal::text) THEN
    RAISE EXCEPTION 'Executivo perdeu acesso à meta individual';
  END IF;
  EXECUTE 'RESET ROLE';
END $verify$;

SELECT jsonb_build_object('validation','passed','committed',false) AS result;
