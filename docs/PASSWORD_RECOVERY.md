# Recuperação de senha

O botão **Esqueci a senha** chama `supabase.auth.resetPasswordForEmail`. O link retorna
para `/reset-password`, onde a sessão de recuperação é verificada antes de permitir
`updateUser`. Depois da troca, a sessão é encerrada e o usuário volta ao login.

## Envio em produção

O envio é feito pelo **Supabase Auth**, não pela antiga Edge Function
`send-password-reset`. Configurar ou trocar somente o segredo `RESEND_API_KEY` dessa
função não habilita o email de recuperação da dashboard.

Em 21/09/2026, a chave Resend armazenada no projeto foi rejeitada pela API como
`API key is invalid`. O provedor padrão do Supabase não serve como envio de produção:
entrega apenas para endereços autorizados da equipe e limita o projeto a 2 emails
por hora.

Para ativar a entrega:

1. Verifique um domínio remetente no provedor de email e obtenha credenciais válidas.
2. No projeto Supabase `mbzwchnxtskysqplqiyy`, abra **Authentication → SMTP Settings**,
   habilite o SMTP próprio e configure remetente, host, porta, usuário e senha.
   Se usar Resend, o host é `smtp.resend.com`, a porta recomendada é `465`, o usuário
   é `resend` e a senha é uma API key válida. Use um endereço do domínio verificado.
3. Confirme que **Authentication → URL Configuration** contém a URL de produção
   `https://wsltda.com/reset-password`. Os domínios alternativos usados pela
   dashboard também devem ter `/reset-password` liberado.
4. Solicite a recuperação de uma conta real de teste, confirme o recebimento na
   caixa de entrada, abra o link em outra aba e entre com a senha nova. Confira o
   registro do envio no provedor se a mensagem não chegar.

Não salve credenciais SMTP em arquivos `VITE_` ou no repositório. A tela mostra
erro quando o serviço rejeita a solicitação e mantém a resposta genérica quando
o Supabase aceita um email não cadastrado, para não revelar contas existentes.

O teste `node scripts/verify-password-reset-ui.mjs` cobre erro de envio, link de
recuperação, troca de senha e link expirado com a rede simulada. Em 21/09/2026,
um link real do Supabase também redefiniu a senha de uma conta temporária, que
foi removida após o teste. Esse teste não comprova a entrega do email.
