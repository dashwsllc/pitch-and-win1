-- Criar tabela para assinaturas de clientes
CREATE TABLE public.assinaturas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome_produto TEXT NOT NULL,
  valor_assinatura TEXT NOT NULL,
  nome_cliente TEXT NOT NULL,
  whatsapp_cliente TEXT NOT NULL,
  email_cliente TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Users can view their own assinaturas" 
ON public.assinaturas 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own assinaturas" 
ON public.assinaturas 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own assinaturas" 
ON public.assinaturas 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own assinaturas" 
ON public.assinaturas 
FOR DELETE 
USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE TRIGGER update_assinaturas_updated_at
BEFORE UPDATE ON public.assinaturas
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();