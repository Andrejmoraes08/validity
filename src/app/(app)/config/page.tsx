'use client'
import { useEffect, useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { usePerfis, TODAS_TABS, type Perfil } from '@/hooks/usePerfil'
import { usePerfílContext } from '@/lib/perfil-context'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import type { Config } from '@/lib/types'

export default function ConfigPage() {
  const { itens, fetchItens } = useItens()
  const { toast } = useToast()
  const { isAdmin } = usePerfílContext()
  const { perfis, loading: perfisLoading, tabelaOk, updatePerfil } = usePerfis()

  const fileRef = useRef<HTMLInputElement>(null)
  const [config, setConfig] = useState<Partial<Config>>({ gsheets_url: '', responsavel: '' })
  const [saving, setSaving] = useState(false)
  const [resetModal, setResetModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editPerfil, setEditPerfil] = useState<Perfil | null>(null)
  const [savingPerfil, setSavingPerfil] = useState(false)

  useEffect(() => {
    supabase.from('config').select('*').single().then(({ data }) => {
      if (data) setConfig(data as Config)
    })
  }, [])

  const saveConfig = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('config').upsert(
      { ...config, user_id: user!.id },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    if (error) toast('Erro ao salvar', 'error')
    else toast('Configurações salvas')
  }

  const exportarExcel = async () => {
    const { utils, writeFile } = await import('xlsx')
    const rows = itens.map(i => ({
      SKU: i.sku,
      Descrição: i.descricao,
      Lote: i.lote,
      'Endereço Frac.': i.endereco_frac,
      'Endereço Gran.': i.endereco_gran,
      Quantidade: i.quantidade,
      Validade: fmtDate(i.validade),
      Status: i.status,
    }))
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Estoque')
    writeFile(wb, `validity-estoque-${new Date().toISOString().split('T')[0]}.xlsx`)
    toast('Exportado com sucesso')
  }

  const importarExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const { read, utils } = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = utils.sheet_to_json<Record<string, string | number>>(ws)
    const { data: { user } } = await supabase.auth.getUser()
    const mapped = rows.map(r => ({
      sku: String(r['SKU'] ?? r['sku'] ?? ''),
      descricao: String(r['Descrição'] ?? r['descricao'] ?? ''),
      lote: String(r['Lote'] ?? r['lote'] ?? ''),
      endereco_frac: String(r['Endereço Frac.'] ?? r['endereco_frac'] ?? ''),
      endereco_gran: String(r['Endereço Gran.'] ?? r['endereco_gran'] ?? ''),
      quantidade: Number(r['Quantidade'] ?? r['quantidade'] ?? 0),
      validade: String(r['Validade'] ?? r['validade'] ?? ''),
      status: 'ativo' as const,
      user_id: user!.id,
    })).filter(r => r.sku && r.validade)
    if (mapped.length === 0) { toast('Nenhum item válido encontrado', 'error'); setImporting(false); return }
    const { error } = await supabase.from('itens').insert(mapped)
    setImporting(false)
    if (error) toast(`Erro: ${error.message}`, 'error')
    else { toast(`${mapped.length} itens importados`); fetchItens() }
    if (fileRef.current) fileRef.current.value = ''
  }

  const sincronizarGSheets = async () => {
    if (!config.gsheets_url) return
    try {
      const res = await fetch(config.gsheets_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write', data: itens }),
      })
      if (res.ok) toast('Sincronizado com Google Sheets')
      else toast('Erro na sincronização', 'error')
    } catch { toast('Erro na sincronização', 'error') }
  }

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
        <p className="text-sm text-gray-400">Importar, exportar e integrar dados</p>
      </div>

      {/* Controle de Acesso — somente admin */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-blue-100 shadow-sm overflow-hidden">
          {/* Cabeçalho */}
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
            {/* Migration não rodada */}
            {!tabelaOk && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex flex-col gap-2">
                <div className="text-sm font-bold text-amber-800">⚠ Tabela de perfis não encontrada</div>
                <p className="text-xs text-amber-700">
                  Execute a migration no Supabase: <strong>SQL Editor → cole o arquivo</strong>{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">supabase/migrations/002_perfis.sql</code>{' '}
                  → Run
                </p>
              </div>
            )}

            {/* Carregando */}
            {perfisLoading && tabelaOk && (
              <div className="flex items-center justify-center h-16">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Lista vazia */}
            {!perfisLoading && tabelaOk && perfis.length === 0 && (
              <div className="text-center py-6 flex flex-col gap-2">
                <div className="text-2xl">👤</div>
                <p className="text-sm font-semibold text-gray-600">Nenhum usuário registrado ainda</p>
                <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  Crie usuários no painel do Supabase em{' '}
                  <strong>Authentication → Users → Add user</strong>.
                  Eles aparecerão aqui após o primeiro login.
                </p>
              </div>
            )}

            {/* Lista de usuários */}
            {!perfisLoading && tabelaOk && perfis.length > 0 && (
              <div className="flex flex-col gap-2">
                {perfis.map(p => (
                  <div key={p.id}
                    className="flex items-start justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      {/* Nome e role */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900 truncate">
                          {p.nome || '—'}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${roleColors[p.role]}`}>
                          {roleLabel[p.role]}
                        </span>
                      </div>
                      {/* Email */}
                      <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">{p.email}</div>
                      {/* Abas permitidas */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {TODAS_TABS.map(t => (
                          <span key={t.key}
                            className={`text-[10px] px-2 py-0.5 rounded font-semibold border ${
                              p.tabs_permitidas.includes(t.key)
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-gray-50 text-gray-300 border-gray-100'
                            }`}>
                            {t.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setEditPerfil({ ...p })}
                      className="flex-shrink-0 mt-0.5">
                      Editar acesso
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Dica para adicionar usuários */}
            {!perfisLoading && tabelaOk && (
              <p className="text-[11px] text-gray-400 text-center mt-1">
                Novos usuários: <strong>Supabase → Authentication → Users → Add user</strong> (marque Auto Confirm)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Importar / Exportar */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm flex flex-col gap-4">
        <h2 className="font-bold text-gray-800 text-sm">Importar / Exportar Excel</h2>
        <div className="flex flex-wrap gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={importarExcel} className="hidden" />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importando…' : '📥 Importar Excel'}
          </Button>
          <Button variant="secondary" onClick={exportarExcel}>📤 Exportar Excel</Button>
        </div>
        <p className="text-xs text-gray-400">
          Colunas esperadas: SKU, Descrição, Lote, Endereço Frac., Endereço Gran., Quantidade, Validade
        </p>
      </div>

      {/* Google Sheets */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm flex flex-col gap-4">
        <h2 className="font-bold text-gray-800 text-sm">Integração Google Sheets</h2>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">URL do Google Apps Script</label>
          <input type="url" value={config.gsheets_url ?? ''}
            onChange={e => setConfig(c => ({ ...c, gsheets_url: e.target.value }))}
            placeholder="https://script.google.com/macros/s/..."
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
        </div>
        <Button variant="secondary" onClick={sincronizarGSheets} disabled={!config.gsheets_url}>
          🔄 Sincronizar agora
        </Button>
      </div>

      {/* Responsável padrão */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm flex flex-col gap-4">
        <h2 className="font-bold text-gray-800 text-sm">Geral</h2>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Responsável padrão</label>
          <input type="text" value={config.responsavel ?? ''}
            onChange={e => setConfig(c => ({ ...c, responsavel: e.target.value }))}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <Button variant="primary" onClick={saveConfig} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar Configurações'}
        </Button>
      </div>

      {/* Zona de perigo */}
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
            <div>
              <div className="text-sm font-bold text-gray-800">{editPerfil.email}</div>
            </div>

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
                  const ehAdmin = editPerfil.role === 'admin'
                  // Config só pode ser desmarcado manualmente — admin sempre tem acesso a tudo
                  const desabilitado = ehAdmin
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
          Tem certeza? Isso vai apagar <strong>todos os itens, baixas e histórico</strong> da sua conta. Não há como desfazer.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setResetModal(false)}>Cancelar</Button>
          <Button variant="danger" onClick={handleReset}>Confirmar Reset</Button>
        </div>
      </Modal>
    </div>
  )
}
