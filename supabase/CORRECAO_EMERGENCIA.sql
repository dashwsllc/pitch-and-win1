-- =============================================
-- SQL DE DIAGNÓSTICO + CORREÇÃO (v2)
-- Cole TUDO no SQL Editor do Supabase e execute
-- URL: https://supabase.com/dashboard/project/mbzwchnxtskysqplqiyy/sql/new
-- =============================================

-- PARTE 1: DIAGNÓSTICO — Execute primeiro para entender o estado
-- =============================================================

-- 1a. Verificar valores distintos em approval_status
SELECT approval_status, COUNT(*) as qtd
FROM public.vendas
GROUP BY approval_status;

-- 1b. Verificar se constraint já existe
SELECT conname, pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.vendas'::regclass
  AND conname LIKE '%approval%';

-- 1c. Ver todos os triggers no banco
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- 1d. Ver logs de erro do trigger
-- (execute separado se necessário)

-- =============================================
-- PARTE 2: CORREÇÃO DEFINITIVA
-- Execute depois de verificar os resultados
-- =============================================

-- Passo 1: Remover constraint inconsistente (qualquer valor de approval_status)
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_approval_status_check;

-- Passo 2: Verificar e normalizar valores existentes
UPDATE public.vendas 
SET approval_status = 'pendente' 
WHERE approval_status NOT IN ('pendente', 'aprovada', 'rejeitada');

-- Passo 3: Adicionar constraint correta
ALTER TABLE public.vendas 
ADD CONSTRAINT vendas_approval_status_check 
CHECK (approval_status IN ('pendente', 'aprovada', 'rejeitada'));

-- Passo 4: Adicionar campos de saque em vendas
ALTER TABLE public.vendas 
ADD COLUMN IF NOT EXISTS withdrawn boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
ADD COLUMN IF NOT EXISTS withdrawal_id uuid;

-- Passo 5: Remover constraint de valor_venda
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_valor_venda_check;

-- Passo 6: Corrigir tabela saques se existir com chave_pix NOT NULL
ALTER TABLE public.saques ALTER COLUMN chave_pix DROP NOT NULL;

-- Adicionar colunas faltantes em saques
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS tipo_chave_pix text;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS nome_titular text;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS cpf_titular text;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS motivo_rejeicao text;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS previsao_pagamento date;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS pago_em timestamptz;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS revisado_por uuid;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS revisado_em timestamptz;
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS valor_aprovado numeric(12,2);
ALTER TABLE public.saques ADD COLUMN IF NOT EXISTS vendas_incluidas uuid[];

-- Passo 7: RLS saques
ALTER TABLE public.saques ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sellers manage own saques" ON public.saques;
CREATE POLICY "sellers manage own saques"
  ON public.saques FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Passo 8: Funções corrigidas
CREATE OR REPLACE FUNCTION public.get_available_balance(p_seller_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT COALESCE(SUM(v.commission_amount), 0)
  FROM public.vendas v
  WHERE v.user_id = p_seller_id 
    AND v.approval_status = 'aprovada' 
    AND v.withdrawn = false
$$;

CREATE OR REPLACE FUNCTION public.get_pending_commission(p_seller_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT COALESCE(SUM(CASE WHEN commission_amount > 0 THEN commission_amount ELSE 0 END), 0)
  FROM public.vendas
  WHERE user_id = p_seller_id AND approval_status = 'pendente'
$$;

-- Passo 9: Garantir user_roles tem campos necessários
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS crm_access boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS granted_by uuid,
ADD COLUMN IF NOT EXISTS granted_at timestamptz,
ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 10;

-- =============================================
-- VERIFICAÇÃO FINAL
-- =============================================
SELECT 'CORREÇÃO APLICADA COM SUCESSO' as status,
  (SELECT COUNT(*) FROM public.vendas) as total_vendas,
  (SELECT COUNT(*) FROM public.user_roles) as total_roles,
  (SELECT COUNT(*) FROM information_schema.columns 
   WHERE table_name = 'saques' AND table_schema = 'public') as colunas_saques;
