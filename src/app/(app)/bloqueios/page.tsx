'use client'
import { useEffect, useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/layout/Toast'
import { supabase } from '@/lib/supabase'
import { fmtDate, fmtDateTime } from '@/lib/utils'
import type { Baixa, Item } from '@/lib/types'

export default function BloqueiosPage() {
  const { itens, loading, baixarItem } = useItens()
  const { toast } = useToast()
  const [tab, setTab] = useState<'bloqueados' | 'baixas'>('bloqueados')
  const [baixas, setBaixas] = useState<Baixa[]>([])
  const [baixaTarget, setBaixaTarget] = useState<Item | null>(null)
  const [nf, setNf] = useState('')
  const [responsavel, setResponsavel] = useState('')

  const bloqueados = useMemo(() => itens.filter(i => i.status === 'bloqueado'), [itens])

  useEffect(() => {
    const load = async () => {
      const [b] = await Promise.all([
        supabase.from('baixas').select('*').order('created_at', { ascending: false }),
      ])
      if (b.data) setBaixas(b.data as Baixa[])
    }
    load()
  }, [itens])

  const handleBaixa = async () => {
    if (!baixaTarget || !nf || !responsavel) return
    const { error } = await baixarItem(baixaTarget.id, nf, responsavel)
    if (error) toast('Erro ao registrar baixa', 'error')
    else toast('Baixa registrada com sucesso')
    setBaixaTarget(null)
    setNf('')
    setResponsavel('')
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
                  {['SKU', 'Descrição', 'Lote', 'Qtd', 'Validade', 'Bloqueado em', 'Por', 'Ação'].map(h => (
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
                    <td className="px-4 py-3 text-gray-500">{item.bloqueado_em ? fmtDateTime(item.bloqueado_em) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.bloqueado_por || '—'}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="primary" onClick={() => setBaixaTarget(item)}>Registrar Baixa</Button>
                    </td>
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
                  {['Data', 'SKU', 'Descrição', 'Lote', 'Qtd', 'Validade', 'NF', 'Responsável'].map(h => (
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
                    <td className="px-4 py-3 text-gray-500">{b.responsavel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}


      <Modal open={!!baixaTarget} onClose={() => setBaixaTarget(null)} title="Registrar Baixa com NF">
        <p className="text-sm text-gray-600 mb-4">
          Registrando baixa de <strong>{baixaTarget?.sku}</strong> — {baixaTarget?.descricao}
        </p>
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
            <label className="text-xs font-semibold text-gray-600">Responsável *</label>
            <input
              type="text"
              value={responsavel}
              onChange={e => setResponsavel(e.target.value)}
              placeholder="Nome do responsável"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setBaixaTarget(null)}>Cancelar</Button>
          <Button variant="primary" onClick={handleBaixa} disabled={!nf || !responsavel}>Confirmar Baixa</Button>
        </div>
      </Modal>
    </div>
  )
}
