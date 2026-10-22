import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, loginEmail } from './supabase.js'
import { can } from './lib/perms.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      .then(({ data }) => setProfile(data ?? { missing: true }))
  }, [userId])

  const signIn = useCallback(async (login, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(login), password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message)
  }, [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const role = profile?.active ? profile.role : null
  const value = {
    loading: session === undefined || (!!session && profile === null),
    session,
    profile,
    role,
    can: (perm) => can(role, perm),
    signIn,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
