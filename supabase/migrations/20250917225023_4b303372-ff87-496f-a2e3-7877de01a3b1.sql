-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create profiles policies
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create abordagens table
CREATE TABLE public.abordagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nomes_abordados TEXT NOT NULL,
  dados_abordados TEXT NOT NULL,
  tempo_medio_abordagem INTEGER NOT NULL, -- em minutos
  mostrou_ia BOOLEAN NOT NULL DEFAULT false,
  visao_geral TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on abordagens
ALTER TABLE public.abordagens ENABLE ROW LEVEL SECURITY;

-- Create abordagens policies
CREATE POLICY "Users can view their own abordagens" 
ON public.abordagens 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own abordagens" 
ON public.abordagens 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own abordagens" 
ON public.abordagens 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own abordagens" 
ON public.abordagens 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create vendas table
CREATE TABLE public.vendas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_produto TEXT NOT NULL,
  valor_venda DECIMAL(10,2) NOT NULL CHECK (valor_venda IN (2997, 500, 275, 250)),
  nome_comprador TEXT NOT NULL,
  whatsapp_comprador TEXT NOT NULL,
  email_comprador TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on vendas
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;

-- Create vendas policies
CREATE POLICY "Users can view their own vendas" 
ON public.vendas 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own vendas" 
ON public.vendas 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vendas" 
ON public.vendas 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vendas" 
ON public.vendas 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_abordagens_updated_at
  BEFORE UPDATE ON public.abordagens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendas_updated_at
  BEFORE UPDATE ON public.vendas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'display_name');
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();