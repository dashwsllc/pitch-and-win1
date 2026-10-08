# Security operations

## Public and private configuration

The browser bundle may contain only `VITE_SUPABASE_URL`, the Supabase publishable/anon key in `VITE_SUPABASE_PUBLISHABLE_KEY`, and the optional public Turnstile site key. Never expose a service-role key, database password, CAPTCHA secret, or encryption key through a `VITE_` variable.

Copy `.env.example` to an ignored local `.env`. Store server-only values as Supabase Edge Function secrets. Set `ALLOWED_ORIGINS` there to a comma-separated allowlist of production origins.

## Required production controls

1. Apply all migrations with the Supabase CLI from a reviewed deployment environment.
2. Deploy both Edge Functions with JWT verification enabled.
3. In Supabase Auth, keep leaked-password protection and password complexity enabled, enforce email confirmation, and review the hosted-project rate limits.
4. Configure Cloudflare Turnstile in Supabase Auth, then expose only its site key as `VITE_TURNSTILE_SITE_KEY`.
5. Keep HTTPS redirects and the headers in `vercel.json` enabled.
6. Run `npm run security:check` before every release. GitHub Actions also runs it weekly and on changes to `main`.

## Data protection boundaries

Supabase encrypts hosted database storage and traffic at the platform layer. Authorization is enforced by RLS and audited server-side RPCs. Highly sensitive fields such as CPF and PIX data are not logged and are returned only to their owner or an executive.

Do not add browser-side field encryption: its key would ship to every browser. If application-level field encryption is required, move the affected reads and writes to a server/Edge Function backed by a managed key service, then remove direct table access for those columns.

This is a static SPA, so Supabase access and refresh tokens cannot be placed in true HttpOnly cookies by frontend code. Moving to HttpOnly, `Secure` cookies requires an SSR/BFF authentication layer.

Sessions are stored in `localStorage` (the implicit flow is used, not PKCE) so that a login survives closing the tab or the browser and is shared by every tab of the same browser. They used to be tab-scoped (`sessionStorage`), which signed people out whenever a tab was closed or reopened and let duplicated tabs share one refresh token that the server then revoked. The trade-off is that any script running on the origin can read the tokens, so the strict CSP in `vercel.json` (`script-src 'self'` plus Cloudflare Turnstile) is the control that matters and must not be loosened. On a shared computer, use **Sair**: it ends only that browser's session, not the account's sessions on other devices.

The app is served from one address, `https://www.wsltda.com`; `https://wsltda.com` redirects to it. The browser keeps a separate login per address, so serving both signed people out whenever they switched between them.

## Secret incident response

Deleting a value from the latest commit is insufficient. Rotate/revoke the value first, rewrite every affected Git ref, force-push the rewritten branches and tags, and have every collaborator re-clone. Cached forks, CI logs, and deployment-provider variables must be reviewed separately.

The legacy bootstrap account removed by the hardening migration must remain disabled. Create administrative users through the normal Auth flow and grant roles through reviewed server-side administration only.
