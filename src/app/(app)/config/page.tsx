'use client'
import { useState } from 'react'
import { usePerfis, TODAS_TABS, type Perfil, type Role } from '@/hooks/usePerfil'
import { usePerfílContext } from '@/lib/perfil-context'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { useItens } from '@/hooks/useItens'
import type { Historico } from '@/lib/types'

function tipoEvento(desc: string): string {
  const d = desc.toLowerCase()
  if (d.startsWith('inspeção complementar')) return 'Inspeção Complementar'
  if (d.startsWith('inspeção')) return 'Inspeção'
  if (d.startsWith('baixa')) return 'Baixa'
  if (d.startsWith('estorno')) return 'Estorno'
  if (d.includes('bloqueado')) return 'Bloqueio'
  if (d.startsWith('wms') || d.startsWith('importação')) return 'Importação'
  return 'Geral'
}

function maskData(raw: string): { texto: string; iso: string } {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  let texto = digits
  if (digits.length > 2) texto = digits.slice(0, 2) + '/' + digits.slice(2)
  if (digits.length > 4) texto = texto.slice(0, 5) + '/' + digits.slice(4)
  let iso = ''
  if (digits.length === 8) {
    const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8)
    if (!isNaN(new Date(`${y}-${m}-${d}`).getTime())) iso = `${y}-${m}-${d}`
  }
  return { texto, iso }
}

export default function ConfigPage() {
  const { fetchItens } = useItens()
  const { toast } = useToast()
  const { isAdmin } = usePerfílContext()
  const { perfis, loading: perfisLoading, tabelaOk, updatePerfil, reload: reloadPerfis } = usePerfis()

  const [resetModal, setResetModal] = useState(false)
  const [editPerfil, setEditPerfil] = useState<Perfil | null>(null)
  const [savingPerfil, setSavingPerfil] = useState(false)

  // Cadastro de novo usuário pelo admin
  const novoUsuarioVazio = { nome: '', email: '', senha: '', role: 'operador' as Role, tabs: ['dashboard', 'estoque', 'inspecao', 'wms'] }
  const [novoModal, setNovoModal] = useState(false)
  const [novoUsuario, setNovoUsuario] = useState(novoUsuarioVazio)
  const [criando, setCriando] = useState(false)

  // Alteração de senha de usuário pelo admin
  const [senhaTarget, setSenhaTarget] = useState<Perfil | null>(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [alterandoSenha, setAlterandoSenha] = useState(false)

  const handleAlterarSenha = async () => {
    if (!senhaTarget || novaSenha.length < 6) return
    setAlterandoSenha(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ user_id: senhaTarget.user_id, senha: novaSenha }),
    })
    const json = await res.json().catch(() => ({}))
    setAlterandoSenha(false)
    if (!res.ok) {
      toast(json.error ?? 'Erro ao alterar senha', 'error')
      return
    }
    toast(`Senha de ${senhaTarget.email} alterada`)
    setSenhaTarget(null)
    setNovaSenha('')
  }

  const handleCriarUsuario = async () => {
    if (!novoUsuario.email || novoUsuario.senha.length < 6) return
    setCriando(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({
        nome: novoUsuario.nome,
        email: novoUsuario.email,
        senha: novoUsuario.senha,
        role: novoUsuario.role,
        tabs_permitidas: novoUsuario.role === 'admin' ? TODAS_TABS.map(t => t.key) : novoUsuario.tabs,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setCriando(false)
    if (!res.ok) {
      toast(json.error ?? 'Erro ao criar usuário', 'error')
      return
    }
    toast(`Usuário ${novoUsuario.email} criado`)
    setNovoModal(false)
    setNovoUsuario(novoUsuarioVazio)
    reloadPerfis()
  }

  const toggleTabNovo = (tab: string) => {
    setNovoUsuario(p => ({
      ...p,
      tabs: p.tabs.includes(tab) ? p.tabs.filter(t => t !== tab) : [...p.tabs, tab],
    }))
  }
  // Exportação da timeline em Excel com filtro de período
  const [deTexto, setDeTexto] = useState('')
  const [deISO, setDeISO] = useState('')
  const [ateTexto, setAteTexto] = useState('')
  const [ateISO, setAteISO] = useState('')
  const [gerando, setGerando] = useState(false)

  const setDe = (raw: string) => { const { texto, iso } = maskData(raw); setDeTexto(texto); setDeISO(iso) }
  const setAte = (raw: string) => { const { texto, iso } = maskData(raw); setAteTexto(texto); setAteISO(iso) }

  const periodoRapido = (dias: number | null) => {
    if (dias === null) { setDeTexto(''); setDeISO(''); setAteTexto(''); setAteISO(''); return }
    const hoje = new Date()
    const inicio = new Date()
    inicio.setDate(hoje.getDate() - dias)
    const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const toBR = (d: Date) => d.toLocaleDateString('pt-BR')
    setDeISO(toISO(inicio)); setDeTexto(toBR(inicio))
    setAteISO(toISO(hoje)); setAteTexto(toBR(hoje))
  }

  const gerarExcelTimeline = async () => {
    setGerando(true)
    try {
      // Busca paginada (PostgREST limita 1000 linhas por consulta)
      const eventos: Historico[] = []
      const pagina = 1000
      for (let offset = 0; ; offset += pagina) {
        let q = supabase
          .from('historico')
          .select('*')
          .order('created_at', { ascending: false })
          .range(offset, offset + pagina - 1)
        if (deISO) q = q.gte('created_at', `${deISO}T00:00:00-03:00`)
        if (ateISO) q = q.lte('created_at', `${ateISO}T23:59:59-03:00`)
        const { data, error } = await q
        if (error) { toast('Erro ao buscar eventos', 'error'); setGerando(false); return }
        eventos.push(...(data as Historico[]))
        if (!data || data.length < pagina) break
      }

      if (eventos.length === 0) {
        toast('Nenhum evento no período selecionado', 'info')
        setGerando(false)
        return
      }

      const { utils, writeFile } = await import('xlsx')
      const linhas = eventos.map(h => {
        const dt = new Date(h.created_at)
        return {
          'Data': dt.toLocaleDateString('pt-BR'),
          'Hora': dt.toLocaleTimeString('pt-BR'),
          'Tipo': tipoEvento(h.descricao),
          'Evento': h.descricao,
          'Responsável': h.responsavel,
        }
      })
      const ws = utils.json_to_sheet(linhas)
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 90 }, { wch: 30 }]
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'Timeline')

      const sufixo = deISO || ateISO ? `${deISO || 'inicio'}_a_${ateISO || 'hoje'}` : 'completa'
      writeFile(wb, `timeline-eventos-${sufixo}.xlsx`)
      toast(`Excel gerado: ${eventos.length} eventos`)
    } finally {
      setGerando(false)
    }
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
                {perfis.length} usuário{perfis.length !== 1 ? 's' : ''}
              </span>
              <Button size="sm" variant="primary" onClick={() => setNovoModal(true)}>
                + Novo usuário
              </Button>
            </div>
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
                  Use o botão <strong>+ Novo usuário</strong> para cadastrar operadores.
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
                    <div className="flex flex-col gap-1.5 flex-shrink-0 mt-0.5">
                      <Button size="sm" variant="secondary" onClick={() => setEditPerfil({ ...p })}>
                        Editar acesso
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setSenhaTarget(p); setNovaSenha('') }}>
                        Alterar senha
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!perfisLoading && tabelaOk && (
              <p className="text-[11px] text-gray-400 text-center mt-1">
                O usuário pode trocar a senha depois pelo <strong>&quot;Esqueci minha senha&quot;</strong> na tela de login
              </p>
            )}
          </div>
        </div>
      )}

      {/* Timeline — exportação em Excel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-sm">Timeline de Eventos</h2>
          <p className="text-xs text-gray-400 mt-0.5">Exporte o histórico completo de operações em Excel, com filtro de período</p>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {/* Períodos rápidos */}
          <div className="flex flex-wrap gap-2">
            {([['Hoje', 0], ['7 dias', 7], ['30 dias', 30], ['90 dias', 90], ['Tudo', null]] as const).map(([label, dias]) => (
              <button
                key={label}
                onClick={() => periodoRapido(dias)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Período manual */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">De</label>
              <input
                type="text" inputMode="numeric" value={deTexto}
                onChange={e => setDe(e.target.value)}
                placeholder="DD/MM/AAAA" maxLength={10}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Até</label>
              <input
                type="text" inputMode="numeric" value={ateTexto}
                onChange={e => setAte(e.target.value)}
                placeholder="DD/MM/AAAA" maxLength={10}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">Deixe em branco para exportar desde o início / até hoje</p>

          <Button variant="primary" onClick={gerarExcelTimeline} disabled={gerando} className="w-full justify-center py-2.5">
            {gerando ? '⏳ Gerando…' : '📊 Gerar Excel da Timeline'}
          </Button>

          <p className="text-[11px] text-gray-400">
            Colunas: <span className="font-mono">Data · Hora · Tipo · Evento · Responsável</span> — eventos do mais recente para o mais antigo
          </p>
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

      {/* Modal novo usuário */}
      <Modal open={novoModal} onClose={() => { setNovoModal(false); setNovoUsuario(novoUsuarioVazio) }} title="Cadastrar Novo Usuário">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Nome</label>
              <input type="text" value={novoUsuario.nome}
                onChange={e => setNovoUsuario(p => ({ ...p, nome: e.target.value }))}
                placeholder="Nome do operador"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Senha inicial *</label>
              <input type="text" value={novoUsuario.senha}
                onChange={e => setNovoUsuario(p => ({ ...p, senha: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">E-mail *</label>
            <input type="email" value={novoUsuario.email}
              onChange={e => setNovoUsuario(p => ({ ...p, email: e.target.value }))}
              placeholder="usuario@grfdistribuicao.com.br"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600">Função</label>
            <div className="flex gap-2">
              {(['admin', 'operador'] as const).map(r => (
                <button key={r}
                  onClick={() => setNovoUsuario(p => ({ ...p, role: r }))}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors"
                  style={novoUsuario.role === r
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
                const ativo = novoUsuario.role === 'admin' || novoUsuario.tabs.includes(t.key)
                const desabilitado = novoUsuario.role === 'admin'
                return (
                  <button key={t.key}
                    onClick={() => !desabilitado && toggleTabNovo(t.key)}
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
            {novoUsuario.role === 'admin' && (
              <p className="text-[11px] text-blue-500">Admin tem acesso a todas as abas automaticamente</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setNovoModal(false); setNovoUsuario(novoUsuarioVazio) }}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={handleCriarUsuario}
              disabled={criando || !novoUsuario.email || novoUsuario.senha.length < 6}
            >
              {criando ? 'Criando…' : 'Criar usuário'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal alterar senha */}
      <Modal open={!!senhaTarget} onClose={() => { setSenhaTarget(null); setNovaSenha('') }} title="Alterar Senha do Usuário">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Definindo nova senha para <strong>{senhaTarget?.nome || senhaTarget?.email}</strong>
            <span className="block text-xs text-gray-400 font-mono mt-0.5">{senhaTarget?.email}</span>
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Nova senha *</label>
            <input type="text" value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              autoFocus
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400">Repasse a senha ao usuário — ele pode trocá-la depois no login</p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setSenhaTarget(null); setNovaSenha('') }}>Cancelar</Button>
            <Button variant="primary" onClick={handleAlterarSenha} disabled={alterandoSenha || novaSenha.length < 6}>
              {alterandoSenha ? 'Alterando…' : 'Alterar senha'}
            </Button>
          </div>
        </div>
      </Modal>

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
