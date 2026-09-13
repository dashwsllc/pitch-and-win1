import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'

interface AuthContextType {
  user: User | null
  session: Session | null
  signUp: (email: string, password: string, displayName?: string, captchaToken?: string) => Promise<{ error: unknown; session: Session | null }>
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
  const refreshRegistration = useCallback(() => setRefreshKey(key => key + 1), [])
  const sessionUserId = session?.user.id
  const accessToken = session?.access_token
  const registrationStatus = registration?.userId === sessionUserId ? registration?.status ?? null : null
  const loading = authLoading || (!!session && !registrationStatus && !registrationError)
  // A session lets a pending collaborator follow their request, but only an
  // approved account is exposed to the existing dashboard routes and hooks.
  const user = registrationStatus === 'approved' ? session?.user ?? null : null

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setAuthLoading(false)
      }
    )

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
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
    const channel = supabase.channel(`registration-${sessionUserId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'registration_requests', filter: `user_id=eq.${sessionUserId}` }, () => { void refresh() })
    void supabase.realtime.setAuth(accessToken).then(() => {
      if (!disposed) channel.subscribe(status => { if (status === 'SUBSCRIBED') void refresh() })
    }).catch(() => { if (!disposed) void refresh() })
    const onVisible = () => { if (!document.hidden) void refresh() }
    // Realtime is immediate; polling catches reconnects and missed events.
    const interval = setInterval(onVisible, 5000)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [sessionUserId, accessToken, refreshKey])

  const signUp = async (email: string, password: string, displayName?: string, captchaToken?: string) => {
    const redirectUrl = `${window.location.origin}/`
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        captchaToken,
        data: {
          display_name: displayName
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

  const signOut = async () => {
    setRegistration(null)
    setSession(null)
    await supabase.auth.signOut()
    // onAuthStateChange + ProtectedRoute will redirect to /auth
  }

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
