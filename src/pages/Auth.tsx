import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarChart3, BriefcaseBusiness, Check, ChevronDown, Clock3, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { Turnstile, captchaRequired } from '@/components/security/Turnstile'
import {
  displayNameSchema,
  emailSchema,
  firstIssue,
  loginPasswordSchema,
  publicAuthError,
  SIGNUP_ROLE_LABELS,
  signupRoleSchema,
  strongPasswordSchema,
} from '@/lib/auth-security'
import './Auth.css'

export default function Auth() {
  const { user, session, signIn, signUp, signOut, loading, registrationStatus, registrationError, refreshRegistration } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const submitting = useRef(false)
  const [showPassword, setShowPassword] = useState(false)
  const [signInCaptcha, setSignInCaptcha] = useState<string | null>(null)
  const [signUpCaptcha, setSignUpCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('suspended') === 'true') {
      toast({ title: 'Acesso suspenso', description: 'Sua conta foi suspensa pelo administrador.', variant: 'destructive' })
      navigate('/auth', { replace: true })
    }
  }, [searchParams, navigate, toast])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>, signup: boolean) => {
    event.preventDefault()
    if (submitting.current) return
    const formData = new FormData(event.currentTarget)
    const email = emailSchema.safeParse(formData.get('email'))
    const password = (signup ? strongPasswordSchema : loginPasswordSchema).safeParse(formData.get('password'))
    const name = displayNameSchema.safeParse(signup ? formData.get('name') : 'Login')
    const requestedRole = signupRoleSchema.safeParse(signup ? formData.get('cargo') : 'seller')
    const invalid = !email.success ? email.error : !password.success ? password.error : !name.success ? name.error : !requestedRole.success ? requestedRole.error : null
    const captcha = signup ? signUpCaptcha : signInCaptcha
    if (invalid || (captchaRequired && !captcha)) {
      setFormError(invalid ? firstIssue(invalid) : 'Conclua a verificação anti-bot.')
      return
    }
    submitting.current = true
    setIsLoading(true)
    setFormError(null)
    try {
      if (signup) {
        const { error } = await signUp(email.data, password.data, name.data, requestedRole.data, captcha ?? undefined)
        if (error) throw error
        // Success is independent of automatic login/email confirmation settings.
        // The request already exists in the same committed transaction as Auth.
        setSubmittedEmail(email.data)
      } else {
        const { error } = await signIn(email.data, password.data, captcha ?? undefined)
        if (error) throw error
      }
    } catch (error) {
      setFormError(signup
        ? 'Não foi possível confirmar o cadastro. Se você já enviou seus dados, entre com seu email e senha para acompanhar a solicitação.'
        : publicAuthError(error))
      setCaptchaKey(key => key + 1)
      setSignInCaptcha(null)
      setSignUpCaptcha(null)
    } finally {
      submitting.current = false
      setIsLoading(false)
    }
  }

  if (user && !loading) return <Navigate to="/" replace />

  const pending = registrationStatus === 'pending'
  const rejected = registrationStatus === 'rejected'
  const showStatus = !!submittedEmail || pending || rejected || (!!session && registrationError)

  const passwordField = (signup: boolean) => {
    const prefix = signup ? 'signup' : 'signin'
    return <div className="auth-field">
      <Label htmlFor={`${prefix}-password`}>Senha</Label>
      <div className="auth-input-wrap">
        <LockKeyhole className="auth-field-icon" aria-hidden="true" />
        <Input id={`${prefix}-password`} name="password" aria-label="Senha" type={showPassword ? 'text' : 'password'}
          placeholder="Digite sua senha" required minLength={signup ? 12 : undefined} maxLength={128}
          autoComplete={signup ? 'new-password' : 'current-password'} aria-describedby={signup ? 'password-hint' : undefined}
          className="auth-input auth-password" />
        <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={showPassword} aria-controls={`${prefix}-password`} onClick={() => setShowPassword(value => !value)}>
          {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {signup && <p id="password-hint" className="auth-hint">12 ou mais caracteres, com maiúscula, minúscula, número e símbolo.</p>}
    </div>
  }

  const emailField = (signup: boolean) => <div className="auth-field">
    <Label htmlFor={signup ? 'signup-email' : 'signin-email'}>Email</Label>
    <div className="auth-input-wrap">
      <Mail className="auth-field-icon" aria-hidden="true" />
      <Input id={signup ? 'signup-email' : 'signin-email'} name="email" aria-label="Email" type="email" placeholder="seu@email.com"
        autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} className="auth-input" />
    </div>
  </div>

  return <main className="auth-page">
    <div className="auth-shell">
      <header className="auth-brand">
        <div className="auth-brand-icon"><BarChart3 aria-hidden="true" /></div>
        <h1>WS LTDA</h1>
        <p>Sistema de gerenciamento comercial</p>
      </header>

      <section className="auth-card" aria-labelledby="auth-title">
        {showStatus ? <div className="auth-status" role="status" aria-live="polite">
          <div className="auth-status-icon">{rejected ? <ShieldCheck aria-hidden="true" /> : submittedEmail ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}</div>
          <h2 id="auth-title">{rejected ? 'Cadastro não aprovado' : registrationError ? 'Estamos verificando seu cadastro' : submittedEmail ? 'Conta criada com sucesso' : 'Seu cadastro está em análise'}</h2>
          <p>{rejected
            ? 'Sua solicitação foi analisada e não foi aprovada. Se precisar de ajuda ou acreditar que houve um engano, fale com o administrador da sua equipe.'
            : registrationError
              ? 'Não foi possível consultar o status agora. Sua solicitação permanece registrada. Vamos tentar novamente automaticamente.'
              : 'Sua solicitação foi enviada para análise. O acesso será liberado assim que um administrador aprovar seu cadastro.'}</p>
          <div className="auth-status-detail">
            <span className="auth-status-label">{rejected ? 'Não aprovado' : 'Aguardando aprovação'}</span>
            <span className="auth-status-email">{session?.user.email ?? submittedEmail}</span>
          </div>
          {!rejected && session && <p className="auth-hint">Esta tela será atualizada automaticamente após a análise.</p>}
          {!session && <p className="auth-hint">Entre com seu email e senha para acompanhar a aprovação.</p>}
          {registrationError && <Button type="button" className="auth-submit" onClick={refreshRegistration}>Verificar novamente</Button>}
          <Button type="button" variant="ghost" className="auth-link" onClick={async () => {
            await signOut()
            setSubmittedEmail(null)
          }}>{session ? 'Sair da conta' : 'Voltar para entrar'}</Button>
        </div> : loading ? <div className="auth-loading" role="status">
          <Loader2 className="animate-spin" aria-hidden="true" /><span>Verificando seu acesso…</span>
        </div> : <>
          <h2 id="auth-title">Acesse sua conta</h2>
          <p className="auth-card-subtitle">Seu time. Sua operação. Em um só lugar.</p>
          <Tabs defaultValue="signin" className="auth-tabs" onValueChange={() => { setShowPassword(false); setFormError(null) }}>
            <TabsList className="auth-tab-list" aria-label="Acesso à conta">
              <TabsTrigger className="auth-tab" value="signin" disabled={isLoading}>Entrar</TabsTrigger>
              <TabsTrigger className="auth-tab" value="signup" disabled={isLoading}>Cadastrar</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="auth-tab-panel">
              <form onSubmit={event => handleSubmit(event, false)} aria-label="Entrar na conta" aria-busy={isLoading}>
                <fieldset disabled={isLoading} className="auth-form-fields">
                  {emailField(false)}
                  {passwordField(false)}
                  <Turnstile key={`signin-${captchaKey}`} onToken={setSignInCaptcha} />
                  {formError && <p className="auth-error" role="alert">{formError}</p>}
                  <Button type="submit" className="auth-submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{isLoading ? 'Entrando…' : 'Entrar'}
                  </Button>
                </fieldset>
                <Button type="button" variant="link" className="auth-link auth-forgot" onClick={() => navigate('/reset-password')}>Esqueci a senha</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup" className="auth-tab-panel">
              <form onSubmit={event => handleSubmit(event, true)} aria-label="Solicitar acesso" aria-busy={isLoading}>
                <fieldset disabled={isLoading} className="auth-form-fields">
                  <div className="auth-field">
                    <Label htmlFor="signup-name">Nome completo</Label>
                    <div className="auth-input-wrap">
                      <UserRound className="auth-field-icon" aria-hidden="true" />
                      <Input id="signup-name" name="name" aria-label="Nome completo" type="text" placeholder="Seu nome completo" autoComplete="name"
                        required minLength={2} maxLength={120} className="auth-input" />
                    </div>
                  </div>
                  {emailField(true)}
                  <div className="auth-field">
                    <Label htmlFor="signup-cargo">Cargo</Label>
                    <div className="auth-input-wrap">
                      <BriefcaseBusiness className="auth-field-icon" aria-hidden="true" />
                      <select id="signup-cargo" name="cargo" aria-label="Cargo" defaultValue="" required className="auth-input auth-role-select">
                        <option value="" disabled>Selecione seu cargo</option>
                        {Object.entries(SIGNUP_ROLE_LABELS).map(([role, label]) => (
                          <option key={role} value={role}>{label}</option>
                        ))}
                      </select>
                      <ChevronDown className="auth-role-chevron" aria-hidden="true" />
                    </div>
                  </div>
                  {passwordField(true)}
                  <Turnstile key={`signup-${captchaKey}`} onToken={setSignUpCaptcha} />
                  {formError && <p className="auth-error" role="alert">{formError}</p>}
                  <Button type="submit" className="auth-submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{isLoading ? 'Solicitando acesso…' : 'Solicitar Acesso'}
                  </Button>
                </fieldset>
                <p className="auth-signup-note">O acesso depende da aprovação de um administrador.</p>
              </form>
            </TabsContent>
          </Tabs>
        </>}
      </section>
      <footer className="auth-footer"><ShieldCheck aria-hidden="true" /><span>Acesso exclusivo para colaboradores WS LTDA</span></footer>
    </div>
  </main>
}
