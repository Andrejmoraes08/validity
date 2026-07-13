'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/layout/Toast'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const { login } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [modoRecuperar, setModoRecuperar] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await login(email, password)
    setLoading(false)
    if (error) {
      toast('Email ou senha incorretos', 'error')
    } else {
      router.push('/dashboard')
    }
  }

  const handleRecuperar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setLoading(false)
    toast('Se o e-mail estiver cadastrado, você receberá um link de recuperação', 'info')
    setModoRecuperar(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 text-white grid place-items-center font-extrabold text-2xl rounded-xl shadow-lg shadow-blue-200 mx-auto mb-4">V</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">VALIDITY</h1>
          <p className="text-sm text-gray-400 mt-1">Gestão de Validade de Estoque</p>
        </div>

        {!modoRecuperar ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="seu@email.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => setModoRecuperar(true)}
              className="text-xs text-blue-500 hover:text-blue-700 font-semibold text-center"
            >
              Esqueci minha senha
            </button>
          </form>
        ) : (
          <form onSubmit={handleRecuperar} className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Recuperar senha</h2>
              <p className="text-xs text-gray-400 mt-1">Informe seu e-mail — enviaremos um link para redefinir a senha</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="seu@email.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Enviando…' : 'Enviar link de recuperação'}
            </button>
            <button
              type="button"
              onClick={() => setModoRecuperar(false)}
              className="text-xs text-gray-400 hover:text-gray-600 font-semibold text-center"
            >
              ← Voltar ao login
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
