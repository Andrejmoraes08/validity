'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export type Role = 'admin' | 'operador'

export interface Perfil {
  id: string
  user_id: string
  email: string
  nome: string
  role: Role
  tabs_permitidas: string[]
  created_at: string
  updated_at: string
}

export const TODAS_TABS = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'estoque',     label: 'Estoque' },
  { key: 'plano-acao',  label: 'Plano de Ação' },
  { key: 'inspecao',    label: 'Inspeção' },
  { key: 'wms',         label: 'WMS' },
  { key: 'bloqueios',   label: 'Bloqueios e Perdas' },
  { key: 'config',      label: 'Configurações' },
]

const TABS_PADRAO_OPERADOR = ['dashboard', 'estoque', 'inspecao', 'wms']

export function usePerfil(user: User | null) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOrCreate = useCallback(async (u: User) => {
    setLoading(true)

    // 1. Tenta buscar o perfil existente
    const { data: existing } = await supabase
      .from('perfis')
      .select('*')
      .eq('user_id', u.id)
      .maybeSingle()

    if (existing) {
      setPerfil(existing as Perfil)
      setLoading(false)
      return
    }

    // 2. Primeiro acesso — determina o role
    const { data: admins } = await supabase
      .from('perfis')
      .select('id')
      .eq('role', 'admin')
      .limit(1)

    const role: Role = !admins || admins.length === 0 ? 'admin' : 'operador'
    const tabs = role === 'admin' ? TODAS_TABS.map(t => t.key) : TABS_PADRAO_OPERADOR

    // 3. Tenta inserir (pode falhar por race condition em múltiplas abas)
    const { data: novo, error: insertError } = await supabase
      .from('perfis')
      .insert({ user_id: u.id, email: u.email ?? '', role, tabs_permitidas: tabs })
      .select()
      .maybeSingle()

    if (novo) {
      setPerfil(novo as Perfil)
    } else if (insertError) {
      // Race condition: outro processo já inseriu — busca novamente
      const { data: retry } = await supabase
        .from('perfis')
        .select('*')
        .eq('user_id', u.id)
        .maybeSingle()
      if (retry) setPerfil(retry as Perfil)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (user) {
      fetchOrCreate(user)
    } else {
      setPerfil(null)
      setLoading(false)
    }
  }, [user, fetchOrCreate])

  const isAdmin = perfil?.role === 'admin'
  const tabsPermitidas = perfil?.tabs_permitidas ?? []
  const primeiraTab = tabsPermitidas[0] ?? 'dashboard'

  return { perfil, loading, isAdmin, tabsPermitidas, primeiraTab, reload: () => user && fetchOrCreate(user) }
}

export function usePerfis() {
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [loading, setLoading] = useState(true)
  const [tabelaOk, setTabelaOk] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('perfis')
      .select('*')
      .order('created_at')
    if (error) {
      setTabelaOk(false)
    } else {
      setTabelaOk(true)
      if (data) setPerfis(data as Perfil[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const updatePerfil = async (id: string, updates: Partial<Perfil>) => {
    const { error } = await supabase.from('perfis').update(updates).eq('id', id)
    if (!error) await fetchAll()
    return { error }
  }

  return { perfis, loading, tabelaOk, updatePerfil, reload: fetchAll }
}
