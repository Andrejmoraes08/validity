'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { usePerfil } from '@/hooks/usePerfil'
import { PerfilContext } from '@/lib/perfil-context'
import { Topbar } from '@/components/layout/Topbar'
import { TabNav } from '@/components/layout/TabNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { perfil, loading: perfilLoading, isAdmin, tabsPermitidas, permissoes, can, primeiraTab } = usePerfil(user)
  const router = useRouter()
  const pathname = usePathname()

  // Redireciona para login se não autenticado
  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  // Primeiro acesso: senha provisória → força a troca antes de qualquer coisa
  useEffect(() => {
    if (perfilLoading || !perfil) return
    if (perfil.senha_provisoria && !pathname.startsWith('/trocar-senha')) {
      router.replace('/trocar-senha?primeiro=1')
    }
  }, [perfil, perfilLoading, pathname, router])

  // Redireciona para a primeira aba permitida se tentar acessar uma sem permissão
  useEffect(() => {
    if (perfilLoading || !perfil || tabsPermitidas.length === 0) return
    if (perfil.senha_provisoria) return // aguarda a troca de senha
    // Extrai a chave da rota atual: /dashboard → dashboard
    const rotaAtual = pathname.split('/')[1]
    // /trocar-senha é acessível a todos (não depende de aba)
    if (rotaAtual === 'trocar-senha') return
    if (rotaAtual && !tabsPermitidas.includes(rotaAtual)) {
      router.replace(`/${primeiraTab}`)
    }
  }, [perfil, perfilLoading, tabsPermitidas, pathname, primeiraTab, router])

  if (authLoading || perfilLoading || !user) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // Perfil ainda não carregado mas usuário está logado (ex: tabela não existe)
  if (!perfil) return (
    <div className="min-h-screen flex items-center justify-center flex-col gap-3">
      <div className="text-sm text-gray-500">Carregando perfil…</div>
      <p className="text-xs text-gray-400 max-w-xs text-center">
        Se isso persistir, verifique se a migration <code className="font-mono">002_perfis.sql</code> foi executada no Supabase.
      </p>
    </div>
  )

  return (
    <PerfilContext.Provider value={{ perfil, isAdmin, tabsPermitidas, permissoes, can }}>
      <Topbar />
      <TabNav tabsPermitidas={tabsPermitidas} />
      <main className="max-w-[1600px] mx-auto px-6 py-6">{children}</main>
    </PerfilContext.Provider>
  )
}
