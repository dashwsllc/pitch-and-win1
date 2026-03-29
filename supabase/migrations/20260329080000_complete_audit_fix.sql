
-- =============================================
-- AUDITORIA COMPLETA — CORREÇÕES E NOVAS TABELAS
-- =============================================

-- PARTE 1: Garantir que vendas tem todos os campos necessários
-- =============================================

-- Remover constraint antiga que limita valor_venda (bloqueava valores não listados inicialmente)
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_valor_venda_check;

-- Adicionar campo withdrawn para controle de saque
ALTER TABLE public.vendas 
  ADD COLUMN IF NOT EXISTS withdrawn boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawal_id uuid;

-- Garantir que approval_status tem constraint correta
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_approval_status_check;
ALTER TABLE public.vendas 
  ADD CONSTRAINT vendas_approval_status_check 
  CHECK (approval_status IN ('pendente','aprovada','rejeitada'));

-- Índice de performance
CREATE INDEX IF NOT EXISTS idx_vendas_seller_approval_withdrawn 
  ON public.vendas(user_id, approval_status, withdrawn);

-- =============================================
-- PARTE 2: Criar/atualizar tabela saques
-- =============================================

CREATE TABLE IF NOT EXISTS public.saques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Valor
  valor_solicitado numeric(12,2) NOT NULL CHECK (valor_solicitado > 0),
  valor_aprovado numeric(12,2),
  
  -- Status compatível com código existente
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'processando', 'aprovado', 'pago', 'rejeitado', 'cancelado')),
  
  -- Dados bancários do vendedor no momento do saque
  chave_pix text,
  tipo_chave_pix text CHECK (tipo_chave_pix IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  nome_titular text,
  cpf_titular text,
  
  -- Prazo
  previsao_pagamento date,
  pago_em timestamptz,
  
  -- Revisão
  revisado_por uuid REFERENCES auth.users(id),
  revisado_em timestamptz,
  motivo_rejeicao text,
  
  -- Compatibilidade legada
  observacoes text,
  
  -- Vendas incluídas neste saque
  vendas_incluidas uuid[],
  
  -- Metadados
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_saques_user_status ON public.saques(user_id, status);

-- RLS em saques
ALTER TABLE public.saques ENABLE ROW LEVEL SECURITY;

-- Policies de saques
DROP POLICY IF EXISTS "sellers manage own saques" ON public.saques;
CREATE POLICY "sellers manage own saques"
  ON public.saques FOR ALL
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "executives see all saques" ON public.saques;
CREATE POLICY "executives see all saques"
  ON public.saques FOR SELECT
  USING (public.is_executive(auth.uid()));

DROP POLICY IF EXISTS "executives update any saque" ON public.saques;
CREATE POLICY "executives update any saque"
  ON public.saques FOR UPDATE
  USING (public.is_executive(auth.uid()));

-- Trigger updated_at em saques
DROP TRIGGER IF EXISTS update_saques_updated_at ON public.saques;
CREATE TRIGGER update_saques_updated_at
  BEFORE UPDATE ON public.saques
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- PARTE 3: Atualizar função get_available_balance
-- Corrigir bug: deve filtrar withdrawn = false
-- =============================================

CREATE OR REPLACE FUNCTION public.get_available_balance(p_seller_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    SUM(v.commission_amount), 0
  )
  FROM public.vendas v
  WHERE v.user_id = p_seller_id
    AND v.approval_status = 'aprovada'
    AND v.withdrawn = false
$$;

-- =============================================
-- PARTE 4: Função para comissão pendente
-- =============================================

CREATE OR REPLACE FUNCTION public.get_pending_commission(p_seller_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    SUM(
      CASE 
        WHEN v.commission_amount IS NOT NULL AND v.commission_amount > 0 THEN v.commission_amount
        ELSE 0
      END
    ), 0
  )
  FROM public.vendas v
  WHERE v.user_id = p_seller_id
    AND v.approval_status = 'pendente'
$$;

-- =============================================
-- PARTE 5: RLS adicional em vendas para sellers atualizarem
-- (sellers só atualizam suas próprias vendas pendentes)
-- =============================================

-- Remover policy de update antiga para sellers (muito permissiva)
DROP POLICY IF EXISTS "Users can update their own vendas" ON public.vendas;

-- Policy de update para sellers (apenas vendas pendentes)
CREATE POLICY "sellers update own pending vendas"
  ON public.vendas FOR UPDATE
  USING (auth.uid() = user_id AND approval_status = 'pendente');

-- Policy de update para executives (qualquer venda)
DROP POLICY IF EXISTS "executives update any venda" ON public.vendas;
CREATE POLICY "executives update any venda"
  ON public.vendas FOR UPDATE
  USING (public.is_executive(auth.uid()));

-- =============================================
-- PARTE 6: Garantir que user_roles tem todos os campos
-- (já feito na migration anterior, mas garantindo)
-- =============================================

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS crm_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_by uuid,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 10;

-- =============================================
-- PARTE 7: Atualizar existing user_roles sellers
-- para ter comissão padrão de 10%
-- =============================================

UPDATE public.user_roles
SET commission_rate = 10
WHERE commission_rate IS NULL OR commission_rate = 0;
