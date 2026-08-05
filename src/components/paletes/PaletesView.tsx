'use client'
import { useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { usePaletes } from '@/hooks/usePaletes'
import { PaleteForm } from '@/components/paletes/PaleteForm'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { useToast } from '@/components/layout/Toast'
import { usePerfílContext } from '@/lib/perfil-context'
import { fmtDateTime } from '@/lib/utils'
import { gerarZplLote, type Dpi } from '@/lib/zpl'
import { imprimirZpl, baixarZpl, browserPrintDisponivel, impressoraPadrao } from '@/lib/browserprint'
import type { Palete, PaleteStatus } from '@/lib/types'
import type { PaleteDados } from '@/hooks/usePaletes'

const STATUS_INFO: Record<PaleteStatus, { label: string; cls: string }> = {
  vazio:        { label: 'Em branco',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  ativo:        { label: 'Ativo',        cls: 'bg-green-50 text-green-700 border-green-200' },
  movimentando: { label: 'Em trânsito',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  baixado:      { label: 'Baixado',      cls: 'bg-gray-800 text-white border-gray-800' },
}

function StatusBadge({ status }: { status: PaleteStatus }) {
  const s = STATUS_INFO[status] ?? STATUS_INFO.vazio
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${s.cls}`}>{s.label}</span>
}

export function PaletesView() {
  const { itens } = useItens()
  const { paletes, loading, criarComDados, criarPool, vincular, excluir, marcarImpressas } = usePaletes()
  const { toast } = useToast()
  const { perfil } = usePerfílContext()
  const responsavel = perfil?.nome?.trim() || perfil?.email || 'sistema'

  const [search, setSearch] = useState('')
  const [statusFiltro, setStatusFiltro] = useState<'' | PaleteStatus>('')
  const [formAberto, setFormAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Palete | null>(null)
  const [poolAberto, setPoolAberto] = useState(false)
  const [poolQtd, setPoolQtd] = useState('10')
  const [processando, setProcessando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [dpi, setDpi] = useState<Dpi>(203)
  const [imprimindo, setImprimindo] = useState(false)

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return paletes.filter(p => {
      if (statusFiltro && p.status !== statusFiltro) return false
      if (!q) return true
      return (
        p.codigo.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.descricao ?? '').toLowerCase().includes(q) ||
        (p.endereco_atual ?? '').toLowerCase().includes(q)
      )
    })
  }, [paletes, search, statusFiltro])

  const contagem = useMemo(() => {
    const c: Record<string, number> = { vazio: 0, ativo: 0, movimentando: 0, baixado: 0 }
    for (const p of paletes) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [paletes])

  const idsVisiveis = useMemo(() => filtrados.map(p => p.id), [filtrados])
  const todosSel = idsVisiveis.length > 0 && idsVisiveis.every(id => selecionados.has(id))
  const totalSel = selecionados.size

  const toggle = (id: string) => setSelecionados(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const toggleTodos = () => setSelecionados(prev => {
    const n = new Set(prev)
    if (todosSel) idsVisiveis.forEach(id => n.delete(id))
    else idsVisiveis.forEach(id => n.add(id))
    return n
  })

  const abrirNovo = () => { setEmEdicao(null); setFormAberto(true) }
  const abrirEdicao = (p: Palete) => { setEmEdicao(p); setFormAberto(true) }

  // Impressão via Zebra Browser Print (ZPL 100x40)
  const imprimir = async (lista: Palete[]) => {
    if (lista.length === 0) { toast('Selecione ao menos um palete', 'info'); return }
    setImprimindo(true)
    try {
      const zpl = gerarZplLote(lista, dpi)
      const res = await imprimirZpl(zpl)
      if (res.ok) {
        await marcarImpressas(lista.map(p => p.id))
        toast(`Enviado para ${res.impressora ?? 'impressora'} (${lista.length} etiqueta(s))`, 'success')
      } else {
        toast(res.erro ?? 'Erro ao imprimir', 'error')
      }
    } finally {
      setImprimindo(false)
    }
  }

  const testarImpressora = async () => {
    const disp = await browserPrintDisponivel()
    if (!disp) {
      toast('Zebra Browser Print não detectado. Abra o utilitário na máquina da impressora.', 'error')
      return
    }
    const dev = await impressoraPadrao()
    if (dev) toast(`Impressora conectada: ${dev.name}`, 'success')
    else toast('Browser Print ativo, mas sem impressora padrão definida.', 'info')
  }

  const handleSalvar = async (dados: PaleteDados) => {
    if (emEdicao) {
      const { error } = await vincular(emEdicao.id, dados, responsavel)
      if (error) { toast('Erro ao salvar o palete', 'error'); return }
      toast(emEdicao.status === 'vazio' ? 'Etiqueta vinculada ao palete' : 'Palete atualizado')
    } else {
      const { error, palete } = await criarComDados(dados, responsavel)
      if (error) { toast('Erro ao criar o palete', 'error'); return }
      toast(`Palete ${palete?.codigo ?? ''} criado`)
    }
  }

  const handlePool = async () => {
    const n = Number(poolQtd)
    if (!Number.isFinite(n) || n < 1) { toast('Informe uma quantidade válida', 'info'); return }
    setProcessando(true)
    const { error, criados } = await criarPool(n)
    setProcessando(false)
    setPoolAberto(false)
    if (error && criados === 0) { toast('Erro ao gerar etiquetas', 'error'); return }
    toast(`${criados} etiqueta(s) em branco geradas`)
  }

  const handleExcluir = async (p: Palete) => {
    if (!confirm(`Excluir o palete ${p.codigo}? Esta ação não pode ser desfeita.`)) return
    const { error } = await excluir(p.id)
    if (error) { toast('Erro ao excluir', 'error'); return }
    toast('Palete excluído')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Paletes (QR Code)</h1>
          <p className="text-sm text-gray-400">
            Cadastro e vínculo de paletes do pulmão. Cada palete recebe um código único para o QR.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>DPI</span>
            <select
              value={dpi}
              onChange={e => setDpi(Number(e.target.value) as Dpi)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
              title="Resolução da impressora Zebra"
            >
              <option value={203}>203</option>
              <option value={300}>300</option>
            </select>
          </div>
          <Button variant="ghost" size="sm" onClick={testarImpressora}>Testar impressora</Button>
          <Button variant="secondary" onClick={() => setPoolAberto(true)}>Gerar etiquetas em branco</Button>
          {totalSel > 0 && (
            <Button variant="primary" onClick={() => imprimir(filtrados.filter(p => selecionados.has(p.id)))} disabled={imprimindo}>
              {imprimindo ? 'Imprimindo…' : `Imprimir (${totalSel})`}
            </Button>
          )}
          <Button variant="primary" onClick={abrirNovo}>Novo palete</Button>
        </div>
      </div>

      {/* Resumo por status */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-gray-400">{paletes.length} palete(s):</span>
        <span className="text-gray-500">{contagem.vazio} em branco</span>
        <span className="text-gray-300">·</span>
        <span className="text-green-600">{contagem.ativo} ativos</span>
        <span className="text-gray-300">·</span>
        <span className="text-amber-600">{contagem.movimentando} em trânsito</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">{contagem.baixado} baixados</span>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Buscar código, SKU, descrição ou endereço…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px] focus:outline-none focus:border-blue-500"
        />
        <select
          value={statusFiltro}
          onChange={e => setStatusFiltro(e.target.value as '' | PaleteStatus)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          <option value="vazio">Em branco</option>
          <option value="ativo">Ativo</option>
          <option value="movimentando">Em trânsito</option>
          <option value="baixado">Baixado</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            {paletes.length === 0 ? 'Nenhum palete cadastrado ainda. Comece com "Novo palete" ou gere etiquetas em branco.' : 'Nenhum palete corresponde ao filtro.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={todosSel}
                    onChange={toggleTodos}
                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                    title="Selecionar todos os visíveis"
                  />
                </th>
                {['Código', 'Status', 'SKU', 'Descrição', 'Qtd', 'Validade', 'End. Pulmão', 'Vínculo', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => (
                <tr key={p.id} className={`border-b border-gray-50 hover:bg-gray-50 ${selecionados.has(p.id) ? 'bg-blue-50/60' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selecionados.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-800 whitespace-nowrap">{p.codigo}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-800">{p.sku || '—'}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{p.descricao || '—'}</td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-800">{typeof p.quantidade === 'number' ? p.quantidade : '—'}</td>
                  <td className="px-4 py-3">{p.validade ? <ZoneCell validade={p.validade} /> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-gray-600 whitespace-nowrap">{p.endereco_atual || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {p.vinculado_por ? (
                      <div className="flex flex-col">
                        <span>{p.vinculado_por}</span>
                        {p.vinculado_em && <span className="text-[10px] text-gray-400">{fmtDateTime(p.vinculado_em)}</span>}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button
                        onClick={() => imprimir([p])}
                        disabled={imprimindo}
                        className="text-blue-500 hover:text-blue-700 font-semibold disabled:opacity-40"
                        title="Imprimir etiqueta na Zebra"
                      >Imprimir</button>
                      <span className="text-gray-200">|</span>
                      <button
                        onClick={() => baixarZpl(gerarZplLote([p], dpi), p.codigo)}
                        className="text-gray-500 hover:text-gray-700 font-semibold"
                        title="Baixar o ZPL desta etiqueta (fallback manual)"
                      >ZPL</button>
                      <span className="text-gray-200">|</span>
                      <button
                        onClick={() => abrirEdicao(p)}
                        className="text-blue-500 hover:text-blue-700 font-semibold"
                        title={p.status === 'vazio' ? 'Vincular dados a esta etiqueta' : 'Editar palete'}
                      >{p.status === 'vazio' ? 'Vincular' : 'Editar'}</button>
                      <span className="text-gray-200">|</span>
                      <button
                        onClick={() => handleExcluir(p)}
                        className="text-red-500 hover:text-red-700 font-semibold"
                        title="Excluir palete"
                      >Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PaleteForm
        open={formAberto}
        onClose={() => setFormAberto(false)}
        onSave={handleSalvar}
        itens={itens}
        initial={emEdicao ?? undefined}
        title={emEdicao ? (emEdicao.status === 'vazio' ? `Vincular etiqueta ${emEdicao.codigo}` : `Editar palete ${emEdicao.codigo}`) : 'Novo palete'}
      />

      {/* Modal: gerar pool de etiquetas em branco */}
      <Modal open={poolAberto} onClose={() => setPoolAberto(false)} title="Gerar etiquetas em branco" maxWidth="max-w-sm">
        <p className="text-sm text-gray-500 mb-4">
          Gera etiquetas somente com o código/QR (sem dados). Use quando quiser imprimir os rolos antecipadamente
          e vincular os dados na entrada.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Quantidade (máx. 200)</label>
          <input
            type="number" min={1} max={200}
            value={poolQtd}
            onChange={e => setPoolQtd(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 w-full"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setPoolAberto(false)}>Cancelar</Button>
          <Button variant="primary" onClick={handlePool} disabled={processando}>
            {processando ? 'Gerando…' : 'Gerar'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
