'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePerfílContext } from '@/lib/perfil-context'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'

export default function TrocarSenhaPage() {
  const { toast } = useToast()
  const { perfil } = usePerfílContext()
  const primeiroAcesso = !!perfil?.senha_provisoria

  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (senha.length < 6) { toast('A senha deve ter no mínimo 6 caracteres', 'error'); return }
    if (senha !== confirmar) { toast('As senhas não coincidem', 'error'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) { toast('Erro ao alterar senha', 'error'); setLoading(false); return }
    // Baixa a flag de senha provisória
    if (perfil) await supabase.from('perfis').update({ senha_provisoria: false }).eq('id', perfil.id)
    toast('Senha alterada com sucesso')
    // Reload completo para o perfil ser recarregado (sem a flag) e não re-redirecionar
    window.location.href = '/dashboard'
  }

  return (
    <div className="max-w-md mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">
          {primeiroAcesso ? 'Defina sua senha' : 'Alterar senha'}
        </h1>
        <p className="text-sm text-gray-400">
          {primeiroAcesso
            ? 'Este é seu primeiro acesso. Crie uma senha pessoal para continuar.'
            : 'Escolha uma nova senha para sua conta.'}
        </p>
      </div>

      {primeiroAcesso && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">
            Por segurança, a senha inicial fornecida pelo administrador deve ser trocada agora.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Nova senha</label>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} required minLength={6}
            placeholder="Mínimo 6 caracteres"
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Confirmar nova senha</label>
          <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} required
            placeholder="Repita a nova senha"
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        </div>
        <Button variant="primary" type="submit" disabled={loading} className="justify-center py-2.5">
          {loading ? 'Salvando…' : primeiroAcesso ? 'Definir senha e continuar' : 'Alterar senha'}
        </Button>
      </form>
    </div>
  )
}
