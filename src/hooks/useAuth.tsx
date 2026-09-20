import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { clearStoredSupabaseSession, supabase } from '@/integrations/supabase/client'
import { AUTO_REFRESH_INTERVAL_MS } from '@/lib/sync'
import type { SignupRole } from '@/lib/auth-security'

interface AuthContextType {
  user: User | null
  session: Session | null
  signUp: (email: string, password: string, displayName: string, requestedRole: SignupRole, captchaToken?: string) => Promise<{ error: unknown; session: Session | null }>
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: unknown }>
  signOut: () => Promise<void>
  loading: boolean
  registrationStatus: 'pending' | 'approved' | 'rejected' | null
  registrationError: boolean
  refreshRegistration: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [registration, setRegistration] = useState<{ userId: string; status: 'pending' | 'approved' | 'rejected' } | null>(null)
  const [registrationError, setRegistrationError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const signingOut = useRef(false)
  const refreshRegistration = useCallback(() => setRefreshKey(key => key + 1), [])
  const sessionUserId = session?.user.id
  const accessToken = session?.access_token
  const registrationStatus = registration?.userId === sessionUserId ? registration?.status ?? null : null
  const loading = authLoading || (!!session && !registrationStatus && !registrationError)
  // A session lets a pending collaborator follow their request, but only an
  // approved account is exposed to the existing dashboard routes and hooks.
  const user = registrationStatus === 'approved' ? session?.user ?? null : null

  useEffect(() => {
    let disposed = false
    let authRevision = 0
    const applySession = (nextSession: Session | null) => {
      if (disposed || (signingOut.current && nextSession)) return
      authRevision += 1
      setSession(nextSession)
      setAuthLoading(false)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => applySession(nextSession)
    )

    // Do not let a slower initial read overwrite a newer sign-in/sign-out event.
    const initialRevision = authRevision
    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (disposed || authRevision !== initialRevision) return
        applySession(error ? null : data.session)
      })
      .catch(() => {
        if (disposed || authRevision !== initialRevision) return
        applySession(null)
      })

    return () => {
      disposed = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    setRegistrationError(false)
    if (!sessionUserId || !accessToken) { setRegistration(null); return }
    let disposed = false
    let running = false
    let rerun = false
    const refresh = async () => {
      if (running) { rerun = true; return }
      running = true
      do {
        rerun = false
        try {
          const { data, error } = await supabase.rpc('get_my_registration_status')
          const status = (data as { status?: string } | null)?.status
          if (error || !status || !['pending', 'approved', 'rejected'].includes(status)) throw error ?? new Error('Invalid registration status')
          if (!disposed) {
            setRegistration({ userId: sessionUserId, status: status as 'pending' | 'approved' | 'rejected' })
            setRegistrationError(false)
          }
        } catch {
          if (!disposed) setRegistrationError(true)
        }
      } while (rerun && !disposed)
      running = false
    }
    void refresh()
    const onVisible = () => { if (!document.hidden) void refresh() }
    const channel = supabase
      .channel(`registration-status-${sessionUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'registration_requests',
        filter: `user_id=eq.${sessionUserId}`,
      }, () => { void refresh() })

    void supabase.realtime.setAuth(accessToken)
      .then(() => { if (!disposed) channel.subscribe() })
      .catch(() => { /* The polling fallback below remains active. */ })

    const interval = window.setInterval(onVisible, AUTO_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [sessionUserId, accessToken, refreshKey])

  const signUp = async (email: string, password: string, displayName: string, requestedRole: SignupRole, captchaToken?: string) => {
    const redirectUrl = `${window.location.origin}/`
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        captchaToken,
        data: {
          display_name: displayName,
          requested_role: requestedRole,
        }
      }
    })

    // The database trigger atomically creates the pending approval request.
    // A session is retained only to track that request until it is approved.
    if (!error && data.session) {
      setSession(data.session)
    }

    const duplicate = !error && data.user?.identities?.length === 0
    return { error: duplicate ? new Error('Registration not created') : error, session: data.session }
  }

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    return { error }
  }

  const signOut = useCallback(async () => {
    signingOut.current = true
    setRegistration(null)
    setRegistrationError(false)
    setSession(null)
    try {
      const { error } = await supabase.auth.signOut()
      // A transport failure prevents supabase-js from reaching its normal
      // local cleanup. Never leave a refresh token behind after the UI exits.
      if (error) clearStoredSupabaseSession()
    } catch {
      clearStoredSupabaseSession()
    } finally {
      setRegistration(null)
      setRegistrationError(false)
      setSession(null)
      signingOut.current = false
    }
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      session,
      signUp,
      signIn,
      signOut,
      loading,
      registrationStatus, registrationError, refreshRegistration
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
