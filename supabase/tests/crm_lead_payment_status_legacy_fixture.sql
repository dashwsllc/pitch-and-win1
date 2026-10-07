-- Seed meaningful legacy cases BEFORE the migration, only in the rollback verifier.
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
VALUES('fe000000-0000-4000-8000-000000000001','crm-legacy-qa@example.invalid','{"display_name":"Legacy payment QA"}','{}',now(),now());
UPDATE public.registration_requests SET status='approved' WHERE user_id='fe000000-0000-4000-8000-000000000001';
DELETE FROM public.user_roles WHERE user_id='fe000000-0000-4000-8000-000000000001';
INSERT INTO public.user_roles(user_id,role,crm_access) VALUES('fe000000-0000-4000-8000-000000000001','closer',true);
SELECT set_config('request.jwt.claims','{"sub":"fe000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO public.crm_leads(id,name,email,phone,athlete_name,athlete_birth_date,athlete_position)
SELECT ('fe100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Legacy QA '||n,'legacy-qa-'||n||'@example.invalid',
  '11999999999','Legacy QA athlete '||n,'2012-01-01','Meia' FROM generate_series(1,4) n;
INSERT INTO public.crm_lead_payments(lead_id,description,amount,status,paid_at,status_reason,due_date,created_by,updated_by,updated_at)
SELECT ('fe100000-0000-4000-8000-'||lpad(v.lead::text,12,'0'))::uuid,'QA parcela',100,v.status,
  CASE WHEN v.status='pago' THEN '2026-09-01'::timestamptz END,
  CASE WHEN v.status='nao_pago' THEN 'Sem pagamento' END,'2020-01-01',
  'fe000000-0000-4000-8000-000000000001','fe000000-0000-4000-8000-000000000001',
  ('2026-09-01'::timestamptz + v.seq * interval '1 day')
FROM (VALUES(1,'pago',1),(1,'pago',2),(2,'pago',1),(2,'pendente',2),
  (3,'nao_pago',1),(3,'pendente',2),(4,'pendente',1)) v(lead,status,seq);
INSERT INTO paystatus_backfill_expectations(lead_id,status,updated_by,updated_at)
SELECT ('fe100000-0000-4000-8000-'||lpad(v.lead::text,12,'0'))::uuid,v.status,
  'fe000000-0000-4000-8000-000000000001','2026-09-01'::timestamptz + v.seq * interval '1 day'
FROM (VALUES(1,'pago',2),(2,'pendente',2),(3,'nao_pago',2),(4,'pendente',1)) v(lead,status,seq);
SELECT set_config('request.jwt.claims','{}',true);
