'use client'
import { useEffect, useState, useCallback } from 'react'
import { usePerfis, TODAS_TABS, type Perfil } from '@/hooks/usePerfil'
import { usePerfílContext } from '@/lib/perfil-context'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { useItens } from '@/hooks/useItens'
import type { Historico } from '@/lib/types'

export default function ConfigPage() {
  const { fetchItens } = useItens()
  const { toast } = useToast()
  const { isAdmin } = usePerfílContext()
  const { perfis, loading: perfisLoading, tabelaOk, updatePerfil } = usePerfis()

  const [resetModal, setResetModal] = useState(false)
  const [editPerfil, setEditPerfil] = useState<Perfil | null>(null)
  const [savingPerfil, setSavingPerfil] = useState(false)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  const fetchHistorico = useCallback(async () => {
    setLoadingHist(true)
    const { data } = await supabase
      .from('historico')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setHistorico(data as Historico[])
    setLoadingHist(false)
  }, [])

  useEffect(() => { fetchHistorico() }, [fetchHistorico])

  const handleReset = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('itens').delete().eq('user_id', user!.id)
    await supabase.from('baixas').delete().eq('user_id', user!.id)
    await supabase.from('historico').delete().eq('user_id', user!.id)
    fetchItens()
    setResetModal(false)
    toast('Dados resetados', 'info')
  }

  const handleSavePerfil = async () => {
    if (!editPerfil) return
    setSavingPerfil(true)
    const { error } = await updatePerfil(editPerfil.id, {
      nome: editPerfil.nome,
      role: editPerfil.role,
      tabs_permitidas: editPerfil.tabs_permitidas,
    })
    setSavingPerfil(false)
    if (error) toast('Erro ao salvar perfil', 'error')
    else { toast('Perfil atualizado'); setEditPerfil(null) }
  }

  const toggleTab = (tab: string) => {
    if (!editPerfil) return
    const atual = editPerfil.tabs_permitidas
    const novo = atual.includes(tab) ? atual.filter(t => t !== tab) : [...atual, tab]
    setEditPerfil({ ...editPerfil, tabs_permitidas: novo })
  }

  const roleLabel: Record<string, string> = { admin: 'Admin', operador: 'Operador' }
  const roleColors: Record<string, string> = {
    admin: 'bg-blue-100 text-blue-700',
    operador: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-400">Controle de acesso, timeline e administração</p>
      </div>

      {/* Controle de Acesso — somente admin */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-blue-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 bg-blue-50 border-b border-blue-100">
            <div>
              <h2 className="font-bold text-blue-900 text-sm">Controle de Acesso</h2>
              <p className="text-xs text-blue-500 mt-0.5">Gerencie permissões de abas por usuário</p>
            </div>
            <span className="text-[11px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
              {perfis.length} usuário{perfis.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="p-6 flex flex-col gap-3">
            {!tabelaOk && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex flex-col gap-2">
                <div className="text-sm font-bold text-amber-800">⚠ Tabela de perfis não encontrada</div>
                <p className="text-xs text-amber-700">
                  Execute a migration no Supabase: <strong>SQL Editor → cole o arquivo</strong>{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">supabase/migrations/002_perfis.sql</code> → Run
                </p>
              </div>
            )}
            {perfisLoading && tabelaOk && (
              <div className="flex items-center justify-center h-16">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!perfisLoading && tabelaOk && perfis.length === 0 && (
              <div className="text-center py-6 flex flex-col gap-2">
                <div className="text-2xl">👤</div>
                <p className="text-sm font-semibold text-gray-600">Nenhum usuário registrado ainda</p>
                <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  Crie usuários no Supabase em <strong>Authentication → Users → Add user</strong>.
                  Aparecerão aqui após o primeiro login.
                </p>
              </div>
            )}
            {!perfisLoading && tabelaOk && perfis.length > 0 && (
              <div className="flex flex-col gap-2">
                {perfis.map(p => (
                  <div key={p.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900 truncate">{p.nome || '—'}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleColors[p.role]}`}>{roleLabel[p.role]}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">{p.email}</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {TODAS_TABS.map(t => (
                          <span key={t.key} className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${
                            p.tabs_permitidas.includes(t.key)
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-gray-50 text-gray-300 border-gray-100'
                          }`}>{t.label}</span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setEditPerfil({ ...p })} className="flex-shrink-0 mt-0.5">
                      Editar acesso
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!perfisLoading && tabelaOk && (
              <p className="text-[11px] text-gray-400 text-center mt-1">
                Novos usuários: <strong>Supabase → Authentication → Users → Add user</strong> (marque Auto Confirm)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Timeline de Eventos</h2>
            <p className="text-xs text-gray-400 mt-0.5">Histórico de todas as operações do sistema</p>
          </div>
          <button onClick={fetchHistorico} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">↻ Atualizar</button>
        </div>
        <div className="p-5 max-h-96 overflow-y-auto">
          {loadingHist ? (
            <div className="flex items-center justify-center h-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : historico.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm">Nenhum evento registrado</p>
          ) : (
            <div className="flex flex-col">
              {historico.map((h, i) => (
                <div key={h.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                    {i < historico.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-1" />}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="text-xs text-gray-800">{h.descricao}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{h.responsavel} · {new Date(h.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zona de perigo — somente admin */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-red-100 p-6 shadow-sm flex flex-col gap-4">
          <h2 className="font-bold text-red-700 text-sm">Zona de Perigo</h2>
          <p className="text-xs text-gray-500">Remove todos os itens, baixas e histórico. Esta ação não pode ser desfeita.</p>
          <Button variant="danger" onClick={() => setResetModal(true)}>Resetar todos os dados</Button>
        </div>
      )}

      {/* Modal editar perfil */}
      <Modal open={!!editPerfil} onClose={() => setEditPerfil(null)} title="Editar Perfil de Acesso">
        {editPerfil && (
          <div className="flex flex-col gap-5">
            <div className="text-sm font-bold text-gray-800">{editPerfil.email}</div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Nome de exibição</label>
              <input type="text" value={editPerfil.nome}
                onChange={e => setEditPerfil({ ...editPerfil, nome: e.target.value })}
                placeholder="Nome do operador"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-600">Função</label>
              <div className="flex gap-2">
                {(['admin', 'operador'] as const).map(r => (
                  <button key={r}
                    onClick={() => setEditPerfil({ ...editPerfil, role: r,
                      tabs_permitidas: r === 'admin' ? TODAS_TABS.map(t => t.key) : editPerfil.tabs_permitidas
                    })}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors"
                    style={editPerfil.role === r
                      ? { background: '#1f6feb', color: '#fff', borderColor: '#1f6feb' }
                      : { background: '#f5f6f8', color: '#5a6070', borderColor: '#e1e4ea' }}>
                    {roleLabel[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-600">Abas permitidas</label>
              <div className="grid grid-cols-2 gap-2">
                {TODAS_TABS.map(t => {
                  const ativo = editPerfil.tabs_permitidas.includes(t.key)
                  const desabilitado = editPerfil.role === 'admin'
                  return (
                    <button key={t.key}
                      onClick={() => !desabilitado && toggleTab(t.key)}
                      disabled={desabilitado}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left disabled:opacity-60"
                      style={ativo
                        ? { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }
                        : { background: '#f9fafb', color: '#9ca3af', borderColor: '#f3f4f6' }}>
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${ativo ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                        {ativo && <span className="text-white text-[10px] font-bold">✓</span>}
                      </span>
                      {t.label}
                    </button>
                  )
                })}
              </div>
              {editPerfil.role === 'admin' && (
                <p className="text-[11px] text-blue-500">Admin tem acesso a todas as abas automaticamente</p>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setEditPerfil(null)}>Cancelar</Button>
              <Button variant="primary" onClick={handleSavePerfil} disabled={savingPerfil}>
                {savingPerfil ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={resetModal} onClose={() => setResetModal(false)} title="Confirmar Reset">
        <p className="text-sm text-gray-600 mb-6">
          Tem certeza? Isso vai apagar <strong>todos os itens, baixas e histórico</strong>. Não há como desfazer.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setResetModal(false)}>Cancelar</Button>
          <Button variant="danger" onClick={handleReset}>Confirmar Reset</Button>
        </div>
      </Modal>
    </div>
  )
}
