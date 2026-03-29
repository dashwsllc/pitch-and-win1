
-- Insert custom positions for Editor de Vídeos and Gestor de Tráfego
INSERT INTO public.custom_positions (name, max_members)
VALUES ('Editor de Vídeos', 5), ('Gestor de Tráfego', 5)
ON CONFLICT DO NOTHING;

-- Insert team members
INSERT INTO public.team_members (name, position, status, date_added)
VALUES 
  ('Felipe Rösler', 'Editor de Vídeos', 'Ativo', now()),
  ('Ismael', 'Gestor de Tráfego', 'Ativo', now());
