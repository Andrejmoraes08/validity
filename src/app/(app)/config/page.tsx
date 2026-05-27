'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useItens } from '@/hooks/useItens'
import { usePerfis, TODAS_TABS, type Perfil } from '@/hooks/usePerfil'
import { usePerfílContext } from '@/lib/perfil-context'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { fmtDate } from '@/lib/utils'
import type { Config, Historico } from '@/lib/types'

export default function ConfigPage() {
  const { itens, fetchItens } = useItens()
  const { toast } = useToast()
  const { isAdmin } = usePerfílContext()
  const { perfis, loading: perfisLoading, tabelaOk, updatePerfil } = usePerfis()

  const fileRef = useRef<HTMLInputElement>(null)
  const valRef = useRef<HTMLInputElement>(null)
  const movRef = useRef<HTMLInputElement>(null)
  const [config, setConfig] = useState<Partial<Config>>({ gsheets_url: '', responsavel: '' })
  const [saving, setSaving] = useState(false)
  const [resetModal, setResetModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editPerfil, setEditPerfil] = useState<Perfil | null>(null)
  const [savingPerfil, setSavingPerfil] = useState(false)
  const [wmsValStatus, setWmsValStatus] = useState<{ atualizados: number; criados: number; erros: number } | null>(null)
  const [wmsMovStatus, setWmsMovStatus] = useState<{ processados: number; entradas: number; saidas: number; movs: number; erros: number; ignorados: number } | null>(null)
  const [loadingWmsVal, setLoadingWmsVal] = useState(false)
  const [loadingWmsMov, setLoadingWmsMov] = useState(false)
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

  useEffect(() => {
    supabase.from('config').select('*').single().then(({ data }) => {
      if (data) setConfig(data as Config)
    })
    fetchHistorico()
  }, [fetchHistorico])

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

  // ── MINI WMS ──────────────────────────────────────────────────

  function excelSerialToISO(v: unknown): string | null {
    if (!v || v === '') return null
    if (typeof v === 'number' && v > 1000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return d.toISOString().split('T')[0]
    }
    const s = String(v)
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return null
  }

  function fmtEnd(rua: unknown, pred: unknown, niv: unknown, apto: unknown) {
    return [rua, pred, niv, apto].map(v => String(v ?? '').trim()).join(' - ')
  }

  const processarValidades = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadingWmsVal(true)
    setWmsValStatus(null)

    const { read, utils } = await import('xlsx')
    const buf = await file.arrayBuffer()
    const rows = utils.sheet_to_json<Record<string, unknown>>(read(buf).Sheets[read(buf).SheetNames[0]], { defval: '' })
    const { data: { user } } = await supabase.auth.getUser()

    let atualizados = 0, criados = 0, erros = 0

    for (const r of rows) {
      const sku = String(r['idProduto'] ?? '').trim()
      const descricao = String(r['Descricao'] ?? '').trim()
      const rua = String(r['Rua'] ?? '').trim()
      const predio = String(r['Predio'] ?? '').trim()
      const nivel = String(r['Nivel'] ?? '').trim()
      const apto = String(r['Apartamento'] ?? '').trim()
      const qtdeRaw = Number(r['Qtde'] ?? 0)
      const quantidade = qtdeRaw < 0 ? 0 : qtdeRaw
      const validade = excelSerialToISO(r['ValidadeNova']) ?? '9999-12-31'
      const endereco = fmtEnd(rua, predio, nivel, apto)
      const isPicking = nivel === '0'

      if (!sku || !endereco) continue

      // Tenta encontrar item existente por SKU + endereço (frac ou gran)
      const { data: existentes } = await supabase
        .from('itens')
        .select('id, endereco_frac, endereco_gran')
        .eq('sku', sku)
        .or(`endereco_frac.eq.${endereco},endereco_gran.eq.${endereco}`)
        .limit(1)

      if (existentes && existentes.length > 0) {
        const { error } = await supabase.from('itens').update({
          validade,
          quantidade,
          descricao,
        }).eq('id', existentes[0].id)
        if (error) erros++
        else atualizados++
      } else {
        // Cria nova posição
        const { error } = await supabase.from('itens').insert({
          sku,
          descricao,
          lote: 'S/L',
          endereco_frac: isPicking ? endereco : '',
          endereco_gran: isPicking ? '' : endereco,
          quantidade,
          validade,
          status: 'ativo',
          user_id: user!.id,
        })
        if (error) erros++
        else criados++
      }
    }

    await supabase.from('historico').insert({
      descricao: `WMS Validades: ${atualizados} atualizados, ${criados} criados, ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setWmsValStatus({ atualizados, criados, erros })
    setLoadingWmsVal(false)
    fetchItens()
    if (valRef.current) valRef.current.value = ''
  }

  const processarMovimentacoes = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadingWmsMov(true)
    setWmsMovStatus(null)

    const { read, utils } = await import('xlsx')
    const buf = await file.arrayBuffer()
    const allRows = utils.sheet_to_json<unknown[]>(read(buf).Sheets[read(buf).SheetNames[0]], { header: 1, defval: '' })
    const dataRows = allRows.slice(1) as unknown[][]
    const { data: { user } } = await supabase.auth.getUser()

    // Índices das colunas (0-based)
    const iTipoMovto=4, iProxTarefa=5
    const iRuaOrig=7, iPredOrig=8, iNivOrig=9, iAptoOrig=10
    const iRuaDest=13, iPredDest=14, iNivDest=15, iAptoDest=16
    const iIdProduto=19, iQtde=21

    const ENTRADA = ['Recebimento', 'Retorno']
    const SAIDA = ['Separacao-Fracionado', 'Separacao-Grandeza']
    const MOV = ['Transferencia', 'Reposicao']

    const concluidos = dataRows.filter(r =>
      String(r[iProxTarefa]).toLowerCase() === 'concluido'
    )

    // Carrega todos os SKUs cadastrados no sistema (uma única consulta)
    const { data: itensCadastrados } = await supabase
      .from('itens')
      .select('sku')
    const skusCadastrados = new Set((itensCadastrados ?? []).map(i => String(i.sku)))

    let processados = 0, entradas = 0, saidas = 0, movs = 0, erros = 0, ignorados = 0

    // Helper: busca item por SKU + endereço
    const findItem = async (sku: string, endereco: string) => {
      const { data } = await supabase
        .from('itens')
        .select('id, quantidade, validade, descricao')
        .eq('sku', sku)
        .or(`endereco_frac.eq.${endereco},endereco_gran.eq.${endereco}`)
        .limit(1)
      return data?.[0] ?? null
    }

    // Helper: atualiza saldo de item existente (nunca cria novos)
    const upsertEndereco = async (
      sku: string, endereco: string, delta: number
    ) => {
      if (!endereco || endereco.startsWith('0 -')) return // Rua 0 = fictícia
      const item = await findItem(sku, endereco)
      if (item) {
        const novaQtde = Math.max(0, (item.quantidade ?? 0) + delta)
        await supabase.from('itens').update({ quantidade: novaQtde }).eq('id', item.id)
      }
    }

    for (const r of concluidos) {
      const tipo = String(r[iTipoMovto] ?? '').trim()
      const sku = String(r[iIdProduto] ?? '').trim()
      const qtde = Math.abs(Number(r[iQtde] ?? 0))
      const endOrig = fmtEnd(r[iRuaOrig], r[iPredOrig], r[iNivOrig], r[iAptoOrig])
      const endDest = fmtEnd(r[iRuaDest], r[iPredDest], r[iNivDest], r[iAptoDest])

      if (!sku || !qtde) continue

      // Pula produtos não cadastrados no sistema
      if (!skusCadastrados.has(sku)) { ignorados++; continue }

      try {
        if (ENTRADA.includes(tipo)) {
          await upsertEndereco(sku, endDest, +qtde)
          entradas++
        } else if (SAIDA.includes(tipo)) {
          await upsertEndereco(sku, endOrig, -qtde)
          saidas++
        } else if (MOV.includes(tipo)) {
          await upsertEndereco(sku, endOrig, -qtde)
          await upsertEndereco(sku, endDest, +qtde)
          movs++
        }
        processados++
      } catch { erros++ }
    }

    await supabase.from('historico').insert({
      descricao: `WMS Movimentações: ${processados} processadas — ${entradas} entradas, ${saidas} saídas, ${movs} movimentações, ${ignorados} ignorados (SKU não cadastrado), ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setWmsMovStatus({ processados, entradas, saidas, movs, erros, ignorados })
    setLoadingWmsMov(false)
    fetchItens()
    fetchHistorico()
    if (movRef.current) movRef.current.value = ''
  }

  // ─────────────────────────────────────────────────────────────

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

      {/* Mini WMS */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Mini WMS — Processamento de Relatórios</h2>
            <p className="text-xs text-gray-400 mt-0.5">Atualiza validades e processa movimentações via planilha WMS</p>
          </div>
        </div>
        <div className="p-6 flex flex-col gap-5">

          {/* Atualizar Validades */}
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-sm font-bold text-gray-700">1. Atualizar Validades (Validades WMS.xls)</div>
              <p className="text-xs text-gray-400 mt-0.5">
                Picking (nível=0): atualiza validade e saldo · Pulmão (nível{'>'} 0): cadastra posição · Qtde negativa → zero
              </p>
            </div>
            <input ref={valRef} type="file" accept=".xls,.xlsx" onChange={processarValidades} className="hidden" />
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="secondary" onClick={() => valRef.current?.click()} disabled={loadingWmsVal}>
                {loadingWmsVal ? '⏳ Processando…' : '📋 Carregar Validades WMS'}
              </Button>
              {wmsValStatus && (
                <div className="flex gap-2 flex-wrap text-xs">
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-semibold">✓ {wmsValStatus.atualizados} atualizados</span>
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">+ {wmsValStatus.criados} criados</span>
                  {wmsValStatus.erros > 0 && <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">✕ {wmsValStatus.erros} erros</span>}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Processar Movimentações */}
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-sm font-bold text-gray-700">2. Processar Movimentações (Movimentação WMS.xls)</div>
              <p className="text-xs text-gray-400 mt-0.5">
                Entrada (Recebimento/Retorno) · Saída (Separação) · Movimentação (Transferência/Reposição) · Apenas status Concluído
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-500">
              <div className="bg-green-50 rounded-lg p-2 text-center">
                <div className="font-bold text-green-700">ENTRADA</div>
                <div>Recebimento</div>
                <div>Retorno</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="font-bold text-red-700">SAÍDA</div>
                <div>Separação Frac.</div>
                <div>Separação Gran.</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <div className="font-bold text-blue-700">MOVIMENTAÇÃO</div>
                <div>Transferência</div>
                <div>Reposição</div>
              </div>
            </div>
            <input ref={movRef} type="file" accept=".xls,.xlsx" onChange={processarMovimentacoes} className="hidden" />
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="secondary" onClick={() => movRef.current?.click()} disabled={loadingWmsMov}>
                {loadingWmsMov ? '⏳ Processando…' : '🔄 Carregar Movimentações WMS'}
              </Button>
              {wmsMovStatus && (
                <div className="flex gap-2 flex-wrap text-xs">
                  <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded font-semibold">{wmsMovStatus.processados} processadas</span>
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">↑ {wmsMovStatus.entradas} entradas</span>
                  <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">↓ {wmsMovStatus.saidas} saídas</span>
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-semibold">⇄ {wmsMovStatus.movs} movs.</span>
                  {wmsMovStatus.ignorados > 0 && <span className="bg-gray-50 text-gray-400 px-2 py-1 rounded font-semibold">⊘ {wmsMovStatus.ignorados} ignorados</span>}
                  {wmsMovStatus.erros > 0 && <span className="bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">✕ {wmsMovStatus.erros} erros</span>}
                </div>
              )}
            </div>
          </div>
        </div>
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

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Timeline de Eventos</h2>
            <p className="text-xs text-gray-400 mt-0.5">Histórico de todas as operações do sistema</p>
          </div>
          <button onClick={fetchHistorico} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
            ↻ Atualizar
          </button>
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
