-- Executive-managed product catalog and ticket prices.
BEGIN;

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON public.products (lower(name));

CREATE TABLE IF NOT EXISTS public.product_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  price numeric(12,2) NOT NULL CHECK (price > 0 AND price <= 100000000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_tickets_name_unique
  ON public.product_tickets (product_id, lower(name));
CREATE INDEX IF NOT EXISTS product_tickets_active_idx
  ON public.product_tickets(product_id, active, price);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_tickets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.products, public.product_tickets FROM anon;
REVOKE ALL ON public.products, public.product_tickets FROM authenticated;
GRANT SELECT ON public.products, public.product_tickets TO authenticated;

DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated
  USING (active OR public.is_executive(auth.uid()));
DROP POLICY IF EXISTS product_tickets_select ON public.product_tickets;
CREATE POLICY product_tickets_select ON public.product_tickets FOR SELECT TO authenticated
  USING ((active AND EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = product_id AND p.active
  )) OR public.is_executive(auth.uid()));

ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id);
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.product_tickets(id);
CREATE INDEX IF NOT EXISTS vendas_product_id_idx ON public.vendas(product_id);
CREATE INDEX IF NOT EXISTS vendas_ticket_id_idx ON public.vendas(ticket_id);

-- The browser submits IDs only; the database resolves the active catalog row
-- and overwrites the displayed name and amount. This prevents ticket tampering.
CREATE OR REPLACE FUNCTION public.enforce_catalog_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  product_name text;
  ticket_name text;
  ticket_price numeric;
  ticket_product uuid;
BEGIN
  IF NEW.product_id IS NULL OR NEW.ticket_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um produto e um ticket ativo' USING ERRCODE = '22023';
  END IF;

  SELECT p.name, t.name, t.price, t.product_id
    INTO product_name, ticket_name, ticket_price, ticket_product
    FROM public.products p
    JOIN public.product_tickets t ON t.product_id = p.id
   WHERE p.id = NEW.product_id
     AND t.id = NEW.ticket_id
     AND p.active
     AND t.active;
  IF NOT FOUND OR ticket_product IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Produto ou ticket não está disponível' USING ERRCODE = '22023';
  END IF;

  NEW.nome_produto := product_name || ' / ' || ticket_name;
  NEW.valor_venda := ticket_price;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS vendas_catalog_on_insert ON public.vendas;
CREATE TRIGGER vendas_catalog_on_insert
  BEFORE INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_sale();

-- New sales must reference the catalog; legacy rows remain readable and keep
-- their original snapshots.
DROP POLICY IF EXISTS vendas_insert ON public.vendas;
CREATE POLICY vendas_insert ON public.vendas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()
    AND product_id IS NOT NULL AND ticket_id IS NOT NULL
    AND approval_status = 'pendente'
    AND COALESCE(commission_amount, 0) = 0 AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND rejection_reason IS NULL AND NOT withdrawn AND withdrawal_id IS NULL AND withdrawn_at IS NULL);

CREATE OR REPLACE FUNCTION public.executive_save_product(
  p_product_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_active boolean DEFAULT true
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  before_row public.products;
  after_row public.products;
  actor_name text;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 160
    OR char_length(COALESCE(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'Nome ou descrição do produto inválidos' USING ERRCODE = '22023';
  END IF;

  IF p_product_id IS NULL THEN
    INSERT INTO public.products(name, description, active, created_by)
      VALUES (btrim(p_name), NULLIF(btrim(p_description), ''), COALESCE(p_active, true), auth.uid())
      RETURNING * INTO after_row;
  ELSE
    SELECT * INTO before_row FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
    UPDATE public.products
       SET name = btrim(p_name), description = NULLIF(btrim(p_description), ''),
           active = COALESCE(p_active, true), updated_at = clock_timestamp()
     WHERE id = p_product_id
     RETURNING * INTO after_row;
  END IF;

  SELECT display_name INTO actor_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
    VALUES (auth.uid(), COALESCE(actor_name, 'Executivo'),
      CASE WHEN p_product_id IS NULL THEN 'product.create' ELSE 'product.update' END,
      after_row.id, after_row.name, 'Catálogo atualizado pelo painel executivo',
      CASE WHEN p_product_id IS NULL THEN NULL ELSE to_jsonb(before_row) END, to_jsonb(after_row));
  RETURN after_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.executive_save_product_ticket(
  p_ticket_id uuid,
  p_product_id uuid,
  p_name text,
  p_price numeric,
  p_active boolean DEFAULT true
)
RETURNS public.product_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  before_row public.product_tickets;
  after_row public.product_tickets;
  actor_name text;
BEGIN
  PERFORM public.dashboard_require_access(true);
  IF p_product_id IS NULL OR char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 120
    OR p_price IS NULL OR p_price <= 0 OR p_price > 100000000 THEN
    RAISE EXCEPTION 'Produto, nome ou preço do ticket inválidos' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  IF p_ticket_id IS NULL THEN
    INSERT INTO public.product_tickets(product_id, name, price, active, created_by)
      VALUES (p_product_id, btrim(p_name), round(p_price, 2), COALESCE(p_active, true), auth.uid())
      RETURNING * INTO after_row;
  ELSE
    SELECT * INTO before_row FROM public.product_tickets WHERE id = p_ticket_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ticket não encontrado'; END IF;
    IF before_row.product_id IS DISTINCT FROM p_product_id THEN
      RAISE EXCEPTION 'O produto de um ticket existente não pode ser trocado';
    END IF;
    UPDATE public.product_tickets
       SET name = btrim(p_name), price = round(p_price, 2),
           active = COALESCE(p_active, true), updated_at = clock_timestamp()
     WHERE id = p_ticket_id
     RETURNING * INTO after_row;
  END IF;

  SELECT display_name INTO actor_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.executive_audit_events(actor_id, actor_name, action, target_id, target_label, reason, before_data, after_data)
    VALUES (auth.uid(), COALESCE(actor_name, 'Executivo'),
      CASE WHEN p_ticket_id IS NULL THEN 'ticket.create' ELSE 'ticket.update' END,
      after_row.id, after_row.name, 'Ticket atualizado pelo painel executivo',
      CASE WHEN p_ticket_id IS NULL THEN NULL ELSE to_jsonb(before_row) END, to_jsonb(after_row));
  RETURN after_row;
END;
$$;

REVOKE ALL ON FUNCTION public.executive_save_product(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.executive_save_product_ticket(uuid, uuid, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executive_save_product(uuid, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.executive_save_product_ticket(uuid, uuid, text, numeric, boolean) TO authenticated, service_role;

-- Realtime invalidates seller catalog queries when an executive changes it.
ALTER TABLE public.dashboard_events DROP CONSTRAINT IF EXISTS dashboard_events_topic_check;
ALTER TABLE public.dashboard_events ADD CONSTRAINT dashboard_events_topic_check
  CHECK (topic IN ('sales', 'users', 'audit', 'goals', 'products'));
INSERT INTO public.dashboard_events(topic) VALUES ('products') ON CONFLICT (topic) DO NOTHING;
DROP POLICY IF EXISTS dashboard_events_read ON public.dashboard_events;
CREATE POLICY dashboard_events_read ON public.dashboard_events FOR SELECT TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.suspended)
    AND (topic IN ('sales', 'goals', 'products') OR public.is_executive(auth.uid())));
DROP TRIGGER IF EXISTS dashboard_products_signal ON public.products;
CREATE TRIGGER dashboard_products_signal AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('products');
DROP TRIGGER IF EXISTS dashboard_product_tickets_signal ON public.product_tickets;
CREATE TRIGGER dashboard_product_tickets_signal AFTER INSERT OR UPDATE OR DELETE ON public.product_tickets
  FOR EACH STATEMENT EXECUTE FUNCTION public.dashboard_signal('products');

NOTIFY pgrst, 'reload schema';
COMMIT;
