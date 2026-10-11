CREATE OR REPLACE FUNCTION pg_temp.assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',p_message; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text,p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL: expected %, got %: %',p_state,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: accepted invalid operation (expected %)',p_state;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.seed_meta_actor(p_registration text,p_suspended boolean,p_role text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE actor uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,'qa-'||actor||'@example.invalid');
 INSERT INTO public.profiles(user_id,display_name,suspended) VALUES(actor,'Synthetic traffic test',p_suspended);
 INSERT INTO public.registration_requests(user_id,display_name,email,status,requested_role) VALUES(actor,'Synthetic traffic test','qa-'||actor||'@example.invalid',p_registration,'seller');
 INSERT INTO public.user_roles(user_id,role) VALUES(actor,p_role::public.app_role);
 RETURN actor;
END $$;
