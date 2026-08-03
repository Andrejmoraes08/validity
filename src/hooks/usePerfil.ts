'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  permissoes: string[]
  senha_provisoria?: boolean
  created_at: string
  updated_at: string
}

export const TODAS_TABS = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'estoque',     label: 'Estoque' },
  { key: 'plano-acao',  label: 'Plano de Ação' },
  { key: 'inspecao',    label: 'Inspeção' },
  { key: 'paletes',     label: 'Paletes' },
  { key: 'wms',         label: 'Importação' },
  { key: 'bloqueios',   label: 'Bloqueios e Perdas' },
  { key: 'config',      label: 'Configurações' },
]

// Catálogo de permissões granulares por ação, agrupadas pela aba.
// O acesso à aba é dado por tabs_permitidas; estas restringem ações DENTRO da aba.
export const TODAS_PERMISSOES: { key: string; label: string; tab: string; descricao?: string }[] = [
  { key: 'plano.ver_zonas',      tab: 'plano-acao', label: 'Ver zonas crítica/atenção' },
  { key: 'plano.ver_segregados', tab: 'plano-acao', label: 'Ver segregados' },
  { key: 'plano.ver_quarentena', tab: 'plano-acao', label: 'Ver quarentena' },
  { key: 'plano.bloquear',       tab: 'plano-acao', label: 'Confirmar bloqueio' },
  { key: 'plano.quarentena',     tab: 'plano-acao', label: 'Enviar para quarentena' },
  { key: 'plano.quarentena_resolver', tab: 'plano-acao', label: 'Resolver quarentena (devolução/descarte)' },
  { key: 'plano.estornar',       tab: 'plano-acao', label: 'Estornar para venda' },
  { key: 'plano.exportar',       tab: 'plano-acao', label: 'Exportar PDF' },
  { key: 'inspecao.segregar',    tab: 'inspecao',   label: 'Segregar item' },
  { key: 'inspecao.baixar',      tab: 'inspecao',   label: 'Baixar endereço' },
  { key: 'estoque.cadastrar',    tab: 'estoque',    label: 'Cadastrar item' },
  { key: 'estoque.editar',       tab: 'estoque',    label: 'Editar item' },
  { key: 'estoque.excluir',      tab: 'estoque',    label: 'Excluir item' },
  { key: 'bloqueios.baixar',     tab: 'bloqueios',  label: 'Registrar baixa (NF)' },
  { key: 'wms.importar',         tab: 'wms',        label: 'Importar planilha' },
]

export const TODAS_PERMISSOES_KEYS = TODAS_PERMISSOES.map(p => p.key)

const TABS_PADRAO_OPERADOR = ['dashboard', 'estoque', 'inspecao', 'wms']
// Novo operador começa com permissões amplas; o admin restringe depois.
const PERMISSOES_PADRAO_OPERADOR = [
  'plano.ver_zonas', 'plano.ver_segregados', 'plano.ver_quarentena', 'plano.exportar',
  'inspecao.segregar', 'inspecao.baixar', 'wms.importar',
]

export function usePerfil(user: User | null) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [loading, setLoading] = useState(true)
  const perfilRef = useRef<Perfil | null>(null)

  const aplicarPerfil = (p: Perfil | null) => {
    perfilRef.current = p
    setPerfil(p)
  }

  const fetchOrCreate = useCallback(async (u: User) => {
    // Perfil deste usuário já carregado → atualização silenciosa, sem tela de loading
    const jaCarregado = perfilRef.current?.user_id === u.id
    if (!jaCarregado) setLoading(true)

    // 1. Tenta buscar o perfil existente
    const { data: existing } = await supabase
      .from('perfis')
      .select('*')
      .eq('user_id', u.id)
      .maybeSingle()

    if (existing) {
      aplicarPerfil(existing as Perfil)
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
    const permissoes = role === 'admin' ? TODAS_PERMISSOES_KEYS : PERMISSOES_PADRAO_OPERADOR

    // 3. Tenta inserir (pode falhar por race condition em múltiplas abas)
    const { data: novo, error: insertError } = await supabase
      .from('perfis')
      .insert({ user_id: u.id, email: u.email ?? '', role, tabs_permitidas: tabs, permissoes })
      .select()
      .maybeSingle()

    if (novo) {
      aplicarPerfil(novo as Perfil)
    } else if (insertError) {
      // Race condition: outro processo já inseriu — busca novamente
      const { data: retry } = await supabase
        .from('perfis')
        .select('*')
        .eq('user_id', u.id)
        .maybeSingle()
      if (retry) aplicarPerfil(retry as Perfil)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (user) {
      fetchOrCreate(user)
    } else {
      aplicarPerfil(null)
      setLoading(false)
    }
  }, [user, fetchOrCreate])

  const isAdmin = perfil?.role === 'admin'
  // Admin sempre enxerga todas as abas (inclusive novas), sem depender do que está salvo no banco
  const tabsPermitidas = isAdmin ? TODAS_TABS.map(t => t.key) : (perfil?.tabs_permitidas ?? [])
  const permissoes = perfil?.permissoes ?? []
  const primeiraTab = tabsPermitidas[0] ?? 'dashboard'
  // Admin pode tudo; operador precisa da permissão explícita
  const can = (key: string) => isAdmin || permissoes.includes(key)

  return { perfil, loading, isAdmin, tabsPermitidas, permissoes, can, primeiraTab, reload: () => user && fetchOrCreate(user) }
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
