'use client'
import { useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ItemForm } from '@/components/estoque/ItemForm'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { EnderecoTag } from '@/components/ui/EnderecoTag'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/layout/Toast'
import { getZone } from '@/lib/zones'
import type { Item } from '@/lib/types'

type StatusFilter = 'todos' | 'ativo' | 'segregado' | 'bloqueado' | 'baixado'

// Ordena endereços por segmento numérico: "1 - 2 - 0" antes de "1 - 10 - 0"
function cmpEndereco(a: string, b: string): number {
  const pa = a.split('-').map(s => parseInt(s.trim(), 10) || 0)
  const pb = b.split('-').map(s => parseInt(s.trim(), 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export default function EstoquePage() {
  const { itens, loading, addItem, updateItem, deleteItem } = useItens()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ativo')
  const [zoneFilter, setZoneFilter] = useState('')
  const [filtroFrac, setFiltroFrac] = useState('')
  const [filtroGran, setFiltroGran] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Item | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null)

  type ItemResumo = { validade: string; quantidade: number }

  const enderecoFracMap = useMemo(() => {
    const m = new Map<string, ItemResumo[]>()
    for (const i of itens) {
      if (!i.endereco_frac) continue
      if (!m.has(i.endereco_frac)) m.set(i.endereco_frac, [])
      m.get(i.endereco_frac)!.push({ validade: i.validade, quantidade: i.quantidade })
    }
    return m
  }, [itens])

  const enderecoGranMap = useMemo(() => {
    const m = new Map<string, ItemResumo[]>()
    for (const i of itens) {
      if (!i.endereco_gran) continue
      if (!m.has(i.endereco_gran)) m.set(i.endereco_gran, [])
      m.get(i.endereco_gran)!.push({ validade: i.validade, quantidade: i.quantidade })
    }
    return m
  }, [itens])

  const enderecosFrac = useMemo(() =>
    Array.from(new Set(itens.map(i => i.endereco_frac).filter(Boolean))).sort(cmpEndereco),
    [itens]
  )
  const enderecosGran = useMemo(() =>
    Array.from(new Set(itens.map(i => i.endereco_gran).filter(Boolean))).sort(cmpEndereco),
    [itens]
  )

  const filtered = useMemo(() => {
    return itens.filter(i => {
      if (statusFilter !== 'todos' && i.status !== statusFilter) return false
      if (zoneFilter && getZone(i.validade).name !== zoneFilter) return false
      if (filtroFrac && i.endereco_frac !== filtroFrac) return false
      if (filtroGran && i.endereco_gran !== filtroGran) return false
      if (search) {
        const q = search.toLowerCase()
        if (!i.sku.toLowerCase().includes(q) &&
            !i.descricao.toLowerCase().includes(q) &&
            !i.lote.toLowerCase().includes(q) &&
            !(i.endereco_frac ?? '').toLowerCase().includes(q) &&
            !(i.endereco_gran ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [itens, statusFilter, zoneFilter, search, filtroFrac, filtroGran])

  const handleSave = async (data: Partial<Item>) => {
    if (editItem) {
      const { error } = await updateItem(editItem.id, data)
      if (error) toast('Erro ao salvar', 'error')
      else toast('Item atualizado')
    } else {
      const { error } = await addItem(data as Omit<Item, 'id' | 'created_at' | 'updated_at' | 'user_id'>)
      if (error) toast('Erro ao cadastrar', 'error')
      else toast('Item cadastrado')
    }
    setEditItem(null)
    setShowForm(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const { error } = await deleteItem(deleteTarget.id)
    if (error) toast('Erro ao excluir', 'error')
    else toast('Item excluído')
    setDeleteTarget(null)
  }

  const statusColors: Record<string, string> = {
    ativo: 'bg-green-100 text-green-700',
    segregado: 'bg-orange-100 text-orange-700',
    bloqueado: 'bg-red-100 text-red-700',
    baixado: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Estoque</h1>
          <p className="text-sm text-gray-400">{filtered.length} itens exibidos</p>
        </div>
        <Button variant="primary" onClick={() => { setEditItem(null); setShowForm(true) }}>
          + Cadastrar Item
        </Button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Buscar SKU, descrição, lote, endereço…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:border-blue-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="todos">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="segregado">Segregado</option>
          <option value="bloqueado">Bloqueado</option>
          <option value="baixado">Baixado</option>
        </select>
        <select
          value={zoneFilter}
          onChange={e => setZoneFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Todas as zonas</option>
          <option value="vencido">Vencido</option>
          <option value="vermelho">Crítico (&lt;30d)</option>
          <option value="amarelo">Atenção (30-90d)</option>
          <option value="verde">Seguro (90-180d)</option>
          <option value="azul">OK (&gt;180d)</option>
        </select>
        <select
          value={filtroFrac}
          onChange={e => setFiltroFrac(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
        >
          <option value="">End. Fracionado — todos</option>
          {enderecosFrac.map(end => (
            <option key={end} value={end}>{end}</option>
          ))}
        </select>
        <select
          value={filtroGran}
          onChange={e => setFiltroGran(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
        >
          <option value="">End. Grandeza — todos</option>
          {enderecosGran.map(end => (
            <option key={end} value={end}>{end}</option>
          ))}
        </select>
        {(search || zoneFilter || statusFilter !== 'ativo' || filtroFrac || filtroGran) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setZoneFilter(''); setStatusFilter('ativo'); setFiltroFrac(''); setFiltroGran('') }}>
            Limpar
          </Button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">Nenhum item encontrado</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['SKU', 'Descrição', 'Lote', 'End. Frac.', 'End. Gran.', 'Qtd', 'Validade', 'Status', 'Ações'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.sku}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{item.descricao}</td>
                  <td className="px-4 py-3 font-mono text-gray-500">{item.lote}</td>
                  <td className="px-4 py-3">
                    <EnderecoTag endereco={item.endereco_frac} itens={enderecoFracMap.get(item.endereco_frac) ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    <EnderecoTag endereco={item.endereco_gran} itens={enderecoGranMap.get(item.endereco_gran) ?? []} />
                  </td>
                  <td className="px-4 py-3">
                    {item.quantidade === 0
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-gray-100 text-gray-400 border border-gray-200">⊘ Saldo 0</span>
                      : <span className="font-mono font-bold text-gray-800">{item.quantidade}</span>
                    }
                  </td>
                  <td className="px-4 py-3"><ZoneCell validade={item.validade} /></td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditItem(item); setShowForm(true) }}
                        className="text-blue-500 hover:text-blue-700 font-semibold"
                      >Editar</button>
                      <button
                        onClick={() => setDeleteTarget(item)}
                        className="text-red-400 hover:text-red-600 font-semibold"
                      >Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ItemForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditItem(null) }}
        onSave={handleSave}
        initial={editItem ?? undefined}
        title={editItem ? 'Editar Item' : 'Cadastrar Item'}
      />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Confirmar exclusão">
        <p className="text-sm text-gray-600 mb-6">
          Tem certeza que deseja excluir <strong>{deleteTarget?.sku}</strong> — {deleteTarget?.descricao}?
          Esta ação não pode ser desfeita.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Excluir</Button>
        </div>
      </Modal>
    </div>
  )
}
