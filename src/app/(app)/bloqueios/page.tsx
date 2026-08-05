'use client'
import { useEffect, useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/layout/Toast'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtDateTime } from '@/lib/utils'
import { usePerfílContext } from '@/lib/perfil-context'
import type { Baixa, Item } from '@/lib/types'

export default function BloqueiosPage() {
  const { itens, loading, baixarItem, estornarBloqueio } = useItens()
  const { toast } = useToast()
  const { can, perfil } = usePerfílContext()
  // Responsável da baixa = conta logada (não digitado)
  const executor = perfil?.nome?.trim() || perfil?.email || 'sistema'
  const [tab, setTab] = useState<'bloqueados' | 'baixas'>('bloqueados')
  const [baixas, setBaixas] = useState<Baixa[]>([])
  const [baixaTarget, setBaixaTarget] = useState<{ sku: string; descricao: string; ids: string[]; qtd: number } | null>(null)
  const [nf, setNf] = useState('')
  const [baixando, setBaixando] = useState(false)
  const [estornoTarget, setEstornoTarget] = useState<Item | null>(null)
  const [estornando, setEstornando] = useState(false)

  const bloqueados = useMemo(() => itens.filter(i => i.status === 'bloqueado'), [itens])
  const contarSku = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const i of bloqueados) { const a = m.get(i.sku) ?? []; a.push(i); m.set(i.sku, a) }
    return m
  }, [bloqueados])

  useEffect(() => {
    const load = async () => {
      const [b] = await Promise.all([
        supabase.from('baixas').select('*').order('created_at', { ascending: false }),
      ])
      if (b.data) setBaixas(b.data as Baixa[])
    }
    load()
  }, [itens])

  // Dispara e-mail aos usuários com acesso ao Plano de Ação ao lançar a baixa
  const notificarBaixa = async (dados: { sku: string; descricao: string; quantidade: number }, resp: string, obs: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/plano-acao/notificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ acao: 'baixa_nf', responsavel: resp, obs, item: dados }),
      })
    } catch { /* baixa já registrada; e-mail é best-effort */ }
  }

  const handleBaixa = async () => {
    if (!baixaTarget || !nf) return
    setBaixando(true)
    const alvo = baixaTarget
    let erros = 0
    for (const id of alvo.ids) {
      const { error } = await baixarItem(id, nf, executor)
      if (error) erros++
    }
    if (erros === 0) {
      await notificarBaixa({ sku: alvo.sku, descricao: alvo.descricao, quantidade: alvo.qtd }, executor, `NF: ${nf}`)
    }
    setBaixando(false)
    if (erros > 0) toast(`Concluído com ${erros} erro(s)`, 'error')
    else toast(alvo.ids.length > 1 ? `${alvo.ids.length} baixas registradas` : 'Baixa registrada com sucesso')
    setBaixaTarget(null)
    setNf('')
  }

  // Estorno de bloqueio confirmado por equívoco: devolve o item ao Plano de Ação
  const handleEstorno = async () => {
    if (!estornoTarget) return
    setEstornando(true)
    const alvo = estornoTarget
    const { error } = await estornarBloqueio(alvo.id, executor)
    setEstornando(false)
    if (error) { toast('Erro ao estornar bloqueio', 'error'); return }
    toast(`${alvo.sku} retornou ao Plano de Ação`)
    setEstornoTarget(null)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Bloqueios e Perdas</h1>
        <p className="text-sm text-gray-400">Itens bloqueados aguardando NF e registro de baixas</p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {([['bloqueados', `Bloqueados (${bloqueados.length})`], ['baixas', 'Histórico de Baixas']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bloqueados' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          {bloqueados.length === 0 ? (
            <p className="text-center py-16 text-gray-400 text-sm">Nenhum item bloqueado</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['SKU', 'Descrição', 'Lote', 'Qtd', 'Validade', 'Motivo', 'Bloqueado em', 'Por', ...((can('bloqueios.baixar') || can('bloqueios.estornar')) ? ['Ação'] : [])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-gray-400 font-semibold text-[11px] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloqueados.map(item => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.sku}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate">{item.descricao}</td>
                    <td className="px-4 py-3 font-mono text-gray-500">{item.lote}</td>
                    <td className="px-4 py-3 font-mono font-bold">{item.quantidade}</td>
                    <td className="px-4 py-3"><ZoneCell validade={item.validade} /></td>
                    <td className="px-4 py-3">
                      {item.motivo_baixa
                        ? <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">{item.motivo_baixa}</span>
                        : <span className="text-gray-400 text-[11px]">Validade</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{item.bloqueado_em ? fmtDateTime(item.bloqueado_em) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.bloqueado_por || '—'}</td>
                    {(can('bloqueios.baixar') || can('bloqueios.estornar')) && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {can('bloqueios.baixar') && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => setBaixaTarget({ sku: item.sku, descricao: item.descricao, ids: [item.id], qtd: item.quantidade })}>Registrar Baixa</Button>
                              {(contarSku.get(item.sku)?.length ?? 0) > 1 && (
                                <Button size="sm" variant="secondary" onClick={() => {
                                  const grupo = contarSku.get(item.sku) ?? []
                                  setBaixaTarget({ sku: item.sku, descricao: item.descricao, ids: grupo.map(g => g.id), qtd: grupo.reduce((s, g) => s + g.quantidade, 0) })
                                }}>Baixar SKU ({contarSku.get(item.sku)?.length})</Button>
                              )}
                            </>
                          )}
                          {can('bloqueios.estornar') && (
                            <Button size="sm" variant="ghost" className="!bg-amber-500 hover:!bg-amber-600 !text-white !border-transparent" onClick={() => setEstornoTarget(item)}>Estornar</Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'baixas' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          {baixas.length === 0 ? (
            <p className="text-center py-16 text-gray-400 text-sm">Nenhuma baixa registrada</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Data', 'SKU', 'Descrição', 'Lote', 'Qtd', 'Validade', 'NF', 'Motivo', 'Responsável'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-gray-400 font-semibold text-[11px] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {baixas.map(b => (
                  <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{fmtDateTime(b.created_at)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-800">{b.sku}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[150px] truncate">{b.descricao}</td>
                    <td className="px-4 py-3 font-mono text-gray-500">{b.lote}</td>
                    <td className="px-4 py-3 font-mono font-bold">{b.quantidade}</td>
                    <td className="px-4 py-3">{fmtDate(b.validade)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-blue-600">{b.nf}</td>
                    <td className="px-4 py-3 text-gray-500">{b.motivo || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{b.responsavel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}


      <Modal open={!!baixaTarget} onClose={() => setBaixaTarget(null)} title="Registrar Baixa com NF">
        <p className="text-sm text-gray-600 mb-1">
          Registrando baixa de <strong>{baixaTarget?.sku}</strong> — {baixaTarget?.descricao}
        </p>
        {baixaTarget && baixaTarget.ids.length > 1 && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5 mb-4">
            <p className="text-xs text-blue-700">
              Baixa em lote: <strong>{baixaTarget.ids.length} posições</strong> deste SKU
              ({baixaTarget.qtd} un no total) com a <strong>mesma NF</strong>.
            </p>
          </div>
        )}
        {baixaTarget && baixaTarget.ids.length === 1 && <div className="mb-4" />}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Número da NF de Perda *</label>
            <input
              type="text"
              value={nf}
              onChange={e => setNf(e.target.value)}
              placeholder="Ex: NF-12345"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Responsável</label>
            <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {executor} <span className="text-[10px] text-gray-400">· sua conta</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setBaixaTarget(null)} disabled={baixando}>Cancelar</Button>
          <Button variant="primary" onClick={handleBaixa} disabled={!nf || baixando}>
            {baixando ? 'Processando…' : baixaTarget && baixaTarget.ids.length > 1 ? `Confirmar Baixa (${baixaTarget.ids.length})` : 'Confirmar Baixa'}
          </Button>
        </div>
      </Modal>

      {/* Modal de estorno de bloqueio — desfaz confirmação feita por equívoco */}
      <Modal open={!!estornoTarget} onClose={() => setEstornoTarget(null)} title="Estornar Bloqueio">
        <p className="text-sm text-gray-600 mb-3">
          Estornando <strong>{estornoTarget?.sku}</strong> — {estornoTarget?.descricao}
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
          <p className="text-xs text-amber-700">
            Use quando o bloqueio foi confirmado por equívoco. O item sai de <strong>Bloqueios e Perdas</strong> e
            retorna ao <strong>Plano de Ação</strong>
            {estornoTarget?.motivo_baixa
              ? <> como <strong>Quarentena</strong> (tinha motivo “{estornoTarget.motivo_baixa}”).</>
              : <> como <strong>Segregado</strong>, aguardando confirmação de bloqueio.</>}
            {' '}O saldo ({estornoTarget?.quantidade} un) é mantido.
          </p>
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-600">Responsável</label>
          <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {executor} <span className="text-[10px] text-gray-400">· sua conta</span>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setEstornoTarget(null)} disabled={estornando}>Cancelar</Button>
          <Button variant="primary" onClick={handleEstorno} disabled={estornando}>
            {estornando ? 'Processando…' : 'Confirmar Estorno'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
