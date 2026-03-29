-- =============================================
-- CORREÇÃO DE EMERGÊNCIA — Execute no Supabase SQL Editor
-- Projeto: mbzwchnxtskysqplqiyy
-- 
-- Cole TUDO isso no SQL Editor e execute de uma vez.
-- Isso é seguro (usa IF NOT EXISTS / IF EXISTS / OR REPLACE)
-- =============================================

-- PASSO 1: Verificar e corrigir tabela saques
-- Se saques já existe com schema antigo, adicionar colunas que faltam
DO $$
BEGIN
  -- Adicionar colunas novas se não existirem
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'saques' AND table_schema = 'public') THEN
    -- Colunas para compatibilidade com o novo código
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'tipo_chave_pix' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN tipo_chave_pix text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'nome_titular' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN nome_titular text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'cpf_titular' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN cpf_titular text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'motivo_rejeicao' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN motivo_rejeicao text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'previsao_pagamento' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN previsao_pagamento date;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'pago_em' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN pago_em timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'revisado_por' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN revisado_por uuid;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'revisado_em' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN revisado_em timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'valor_aprovado' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN valor_aprovado numeric(12,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saques' AND column_name = 'vendas_incluidas' AND table_schema = 'public') THEN
      ALTER TABLE public.saques ADD COLUMN vendas_incluidas uuid[];
    END IF;
    -- Tornar chave_pix nullable se foi criada como NOT NULL
    ALTER TABLE public.saques ALTER COLUMN chave_pix DROP NOT NULL;
    
    RAISE NOTICE 'Tabela saques atualizada com sucesso';
  ELSE
    -- Criar tabela saques do zero
    CREATE TABLE public.saques (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      valor_solicitado numeric(12,2) NOT NULL CHECK (valor_solicitado > 0),
      valor_aprovado numeric(12,2),
      status text NOT NULL DEFAULT 'pendente',
      chave_pix text,
      tipo_chave_pix text,
      nome_titular text,
      cpf_titular text,
      previsao_pagamento date,
      pago_em timestamptz,
      revisado_por uuid,
      revisado_em timestamptz,
      motivo_rejeicao text,
      observacoes text,
      vendas_incluidas uuid[],
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    ALTER TABLE public.saques ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Tabela saques criada do zero';
  END IF;
END $$;

-- PASSO 2: Garantir RLS em saques
ALTER TABLE public.saques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sellers manage own saques" ON public.saques;
CREATE POLICY "sellers manage own saques"
  ON public.saques FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "executives see all saques" ON public.saques;
CREATE POLICY "executives see all saques"
  ON public.saques FOR SELECT
  USING (public.is_executive(auth.uid()));

DROP POLICY IF EXISTS "executives update any saque" ON public.saques;
CREATE POLICY "executives update any saque"
  ON public.saques FOR UPDATE
  USING (public.is_executive(auth.uid()));

-- PASSO 3: Campos em vendas
ALTER TABLE public.vendas 
  ADD COLUMN IF NOT EXISTS withdrawn boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawal_id uuid;

-- PASSO 4: Remover constraint de valor_venda se existir
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_valor_venda_check;

-- PASSO 5: Atualizar approval_status constraint
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_approval_status_check;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_approval_status_check
  CHECK (approval_status IN ('pendente','aprovada','rejeitada'));

-- PASSO 6: Corrigir get_available_balance (filtra withdrawn = false)
CREATE OR REPLACE FUNCTION public.get_available_balance(p_seller_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(SUM(v.commission_amount), 0)
  FROM public.vendas v
  WHERE v.user_id = p_seller_id
    AND v.approval_status = 'aprovada'
    AND v.withdrawn = false
$$;

-- PASSO 7: Criar get_pending_commission
CREATE OR REPLACE FUNCTION public.get_pending_commission(p_seller_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN v.commission_amount IS NOT NULL AND v.commission_amount > 0 
    THEN v.commission_amount ELSE 0 END
  ), 0)
  FROM public.vendas v
  WHERE v.user_id = p_seller_id
    AND v.approval_status = 'pendente'
$$;

-- PASSO 8: Corrigir RLS de vendas
DROP POLICY IF EXISTS "Users can update their own vendas" ON public.vendas;
DROP POLICY IF EXISTS "sellers update own pending vendas" ON public.vendas;
DROP POLICY IF EXISTS "executives update any venda" ON public.vendas;

CREATE POLICY "sellers update own pending vendas"
  ON public.vendas FOR UPDATE
  USING (auth.uid() = user_id AND approval_status = 'pendente');

CREATE POLICY "executives update any venda"
  ON public.vendas FOR UPDATE
  USING (public.is_executive(auth.uid()));

-- PASSO 9: Garantir campos em user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS crm_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_by uuid,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 10;

-- PASSO 10: Índices de performance
CREATE INDEX IF NOT EXISTS idx_vendas_seller_approval_withdrawn 
  ON public.vendas(user_id, approval_status, withdrawn);
CREATE INDEX IF NOT EXISTS idx_saques_user_status 
  ON public.saques(user_id, status);

-- PASSO 11: Trigger updated_at para saques
DROP TRIGGER IF EXISTS update_saques_updated_at ON public.saques;
CREATE TRIGGER update_saques_updated_at
  BEFORE UPDATE ON public.saques
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- VERIFICAÇÃO FINAL
SELECT 
  'saques' as tabela,
  COUNT(*) as num_colunas,
  string_agg(column_name, ', ' ORDER BY ordinal_position) as colunas
FROM information_schema.columns
WHERE table_name = 'saques' AND table_schema = 'public'
UNION ALL
SELECT 
  'vendas (novos campos)',
  COUNT(*),
  string_agg(column_name, ', ' ORDER BY ordinal_position)
FROM information_schema.columns
WHERE table_name = 'vendas' AND table_schema = 'public'
  AND column_name IN ('withdrawn', 'withdrawn_at', 'withdrawal_id')
UNION ALL
SELECT
  'funcoes RPC',
  COUNT(*),
  string_agg(proname, ', ')
FROM pg_proc
WHERE proname IN ('get_available_balance', 'get_pending_commission')
  AND pronamespace = 'public'::regnamespace;
