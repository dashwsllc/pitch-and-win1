# Instruções do dashboard

## Superpowers

- Leia e siga `using-superpowers` no início de cada tarefa.
- Use as skills relevantes do plugin Superpowers antes de agir; skills de processo vêm primeiro.
- Use `brainstorming` antes de criar ou alterar comportamento, `systematic-debugging` antes de corrigir falhas, `test-driven-development` antes de implementar e `verification-before-completion` antes de afirmar conclusão.
- Para consultar o código ou a documentação do Superpowers, use `C:/Users/Me/Documents/ChatGPT/Dashboard - WS/superpowers`.
- Instruções diretas do usuário e instruções mais específicas têm precedência.

## Projeto Supabase

- O destino comercial confirmado pelo usuário é **dash**, ref **`mbzwchnxtskysqplqiyy`**.
- URL pública: `https://mbzwchnxtskysqplqiyy.supabase.co`.
- Antes de uma operação remota, confira o ref em `supabase/config.toml`, `supabase/.temp/project-ref` e na URL pública usada pelo frontend. Em caso de divergência, identifique o ambiente pretendido antes de escrever.
- Nos comandos da CLI que aceitam o argumento, informe explicitamente `--project-ref mbzwchnxtskysqplqiyy`. Nos tools do Supabase, informe esse mesmo ID em `project_id`.
- O projeto **321**, ref `mehmqibxzxfqdxqjnjad`, pertence a outra aplicação. Não use esse projeto como destino comercial deste dashboard.
- Não altere o destino comercial sem pedido explícito do usuário. Ambientes isolados de teste devem ser identificados e usados somente para o ensaio autorizado.
- Guarde credenciais OAuth, tokens e segredos somente nos mecanismos privados do servidor. Não os coloque no frontend, Git, logs ou conversa.
- Callback Google comercial: `https://mbzwchnxtskysqplqiyy.supabase.co/functions/v1/google-calendar-oauth-callback`.
- Antes de modificar o banco, confira o histórico remoto de migrations. Ele diverge do checkout; não execute `db push`, reset ou reaplicação geral como parte da configuração do Google Agenda.
- Para a integração dos closers, consulte `docs/GOOGLE_CALENDAR_CLOSERS_SETUP.md` no checkout da feature quando disponível. A conexão ao Supabase não comprova autorização ou ativação do Google Agenda.
