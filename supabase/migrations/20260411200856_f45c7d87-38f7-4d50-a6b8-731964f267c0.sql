-- Add new roles to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'closer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sdr';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'bdr';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'traffic_manager';

-- Update calc_ctr to also compute CPC and CPL
CREATE OR REPLACE FUNCTION public.calc_ctr()
RETURNS trigger
LANGUAGE plpgsql
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