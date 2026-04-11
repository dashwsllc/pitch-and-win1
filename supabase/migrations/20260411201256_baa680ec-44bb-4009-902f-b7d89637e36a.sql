CREATE OR REPLACE FUNCTION public.calc_ctr()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  new.ctr := case when new.impressions > 0
    then round((new.clicks::numeric / new.impressions * 100)::numeric, 2)
    else 0 end;
  new.cpc := case when new.clicks > 0
    then round((new.spend / new.clicks)::numeric, 2)
    else 0 end;
  new.cpl := case when new.leads_generated > 0
    then round((new.spend / new.leads_generated)::numeric, 2)
    else 0 end;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  select role from user_roles where user_id = uid limit 1;
$$;