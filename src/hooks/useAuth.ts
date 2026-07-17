'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Mantém a MESMA referência de objeto quando o usuário não mudou —
    // eventos de foco/refresh de token não devem re-renderizar o app inteiro
    const aplicar = (next: User | null) => {
      setUser(prev => (prev?.id === next?.id ? prev : next))
    }
    supabase.auth.getSession().then(({ data }) => {
      aplicar(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      aplicar(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const login = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password })

  const logout = () => supabase.auth.signOut()

  return { user, loading, login, logout }
}
