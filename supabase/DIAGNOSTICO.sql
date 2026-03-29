-- =============================================
-- DIAGNÓSTICO E CORREÇÃO DE EMERGÊNCIA
-- Execute no SQL Editor do Supabase
-- =============================================

-- PASSO 1: Verificar se saques tem colunas conflitantes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'saques' AND table_schema = 'public'
ORDER BY ordinal_position;

-- PASSO 2: Verificar constraints da tabela saques
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.saques'::regclass;
