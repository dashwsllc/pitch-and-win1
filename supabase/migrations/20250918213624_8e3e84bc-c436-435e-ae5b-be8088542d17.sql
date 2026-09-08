-- Criar enum para roles de usuário
CREATE TYPE public.app_role AS ENUM ('seller', 'executive');

-- Criar tabela de roles de usuário
CREATE TABLE public.user_roles (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    role public.app_role NOT NULL DEFAULT 'seller',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Habilitar RLS na tabela user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Função para verificar se usuário tem um role específico (SECURITY DEFINER para evitar recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Função para verificar se usuário é executive
CREATE OR REPLACE FUNCTION public.is_executive(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'executive')
$$;

-- Políticas RLS para user_roles
CREATE POLICY "Executives can view all user roles"
ON public.user_roles
FOR SELECT
USING (public.is_executive(auth.uid()));

CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Executives can manage all user roles"
ON public.user_roles
FOR ALL
USING (public.is_executive(auth.uid()));

-- Tabela para solicitações de redefinição de senha (para executives aprovarem)
CREATE TABLE public.password_reset_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    processed_at TIMESTAMP WITH TIME ZONE NULL,
    processed_by UUID NULL
);

-- Habilitar RLS na tabela de solicitações
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para password_reset_requests
CREATE POLICY "Executives can view all reset requests"
ON public.password_reset_requests
FOR SELECT
USING (public.is_executive(auth.uid()));

CREATE POLICY "Executives can update reset requests"
ON public.password_reset_requests
FOR UPDATE
USING (public.is_executive(auth.uid()));

CREATE POLICY "Users can create their own reset requests"
ON public.password_reset_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Atualizar políticas RLS das tabelas existentes para permitir acesso de executives
-- Vendas
CREATE POLICY "Executives can view all vendas"
ON public.vendas
FOR SELECT
USING (public.is_executive(auth.uid()));

-- Abordagens
CREATE POLICY "Executives can view all abordagens"
ON public.abordagens
FOR SELECT
USING (public.is_executive(auth.uid()));

-- Assinaturas
CREATE POLICY "Executives can view all assinaturas"
ON public.assinaturas
FOR SELECT
USING (public.is_executive(auth.uid()));

-- Profiles
CREATE POLICY "Executives can view all profiles"
ON public.profiles
FOR SELECT
USING (public.is_executive(auth.uid()));

-- Trigger para atualizar updated_at em user_roles
CREATE TRIGGER update_user_roles_updated_at
    BEFORE UPDATE ON public.user_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Security: privileged users must be provisioned through Supabase Auth and
-- promoted through an audited administrative process. Never bootstrap a
-- password or auth.users row in a migration.
