'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/layout/Toast'

export default function RedefinirSenhaPage() {
  const { toast } = useToast()
  const router = useRouter()
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessaoOk, setSessaoOk] = useState<boolean | null>(null)

  useEffect(() => {
    // O link de recuperação cria a sessão automaticamente (detectSessionInUrl)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessaoOk(!!session)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessaoOk(true)
      // Aguarda o processamento do hash do link antes de concluir que não há sessão
      else setTimeout(() => setSessaoOk(prev => prev === null ? false : prev), 2500)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (senha.length < 6) { toast('A senha deve ter no mínimo 6 caracteres', 'error'); return }
    if (senha !== confirmar) { toast('As senhas não coincidem', 'error'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setLoading(false)
    if (error) {
      toast('Erro ao redefinir senha — o link pode ter expirado', 'error')
    } else {
      toast('Senha redefinida com sucesso')
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 text-white grid place-items-center font-extrabold text-2xl rounded-xl shadow-lg shadow-blue-200 mx-auto mb-4">V</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">VALIDITY</h1>
          <p className="text-sm text-gray-400 mt-1">Redefinição de senha</p>
        </div>

        {sessaoOk === null && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {sessaoOk === false && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col gap-4 text-center">
            <div className="text-3xl">⚠️</div>
            <p className="text-sm font-semibold text-gray-700">Link inválido ou expirado</p>
            <p className="text-xs text-gray-400">Solicite um novo link de recuperação na tela de login</p>
            <button
              onClick={() => router.push('/login')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg transition-colors text-sm"
            >
              Ir para o login
            </button>
          </div>
        )}

        {sessaoOk === true && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Nova senha</label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                minLength={6}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Confirmar nova senha</label>
              <input
                type="password"
                value={confirmar}
                onChange={e => setConfirmar(e.target.value)}
                required
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="Repita a nova senha"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Salvando…' : 'Redefinir senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
