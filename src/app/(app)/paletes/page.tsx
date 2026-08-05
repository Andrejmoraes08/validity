'use client'
import { useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/layout/Toast'
import { diasParaVencer, getZone } from '@/lib/zones'
import { fmtDate, fmtDateTime, semValidade, LABEL_SEM_VALIDADE } from '@/lib/utils'
import { usePerfílContext } from '@/lib/perfil-context'
import { PaletesView } from '@/components/paletes/PaletesView'
import { ConsultaView } from '@/components/paletes/ConsultaView'
import type { Item } from '@/lib/types'

// Dados mínimos para identificar um palete na etiqueta
interface PaleteData {
  sku: string
  descricao: string
  lote: string
  quantidade: number
  endereco_frac: string
  endereco_gran: string
  validade: string
}

// Quebra o endereço "Rua - Prédio - Nível - Apto" em partes (tolerante a variações)
function partesEndereco(e: string): { rua: string; predio: string; nivel: string; apto: string } | null {
  if (!e || !e.trim()) return null
  const p = e.split('-').map(s => s.trim())
  return { rua: p[0] ?? '', predio: p[1] ?? '', nivel: p[2] ?? '', apto: p[3] ?? '' }
}

// Visual da validade (cor da zona + rótulos), tratando "sem validade" com tom neutro
function zonaVisual(validade: string) {
  if (semValidade(validade)) {
    return { color: '#e5e7eb', textColor: '#374151', dataLabel: LABEL_SEM_VALIDADE, diasLabel: '—' }
  }
  const z = getZone(validade)
  const d = z.dias
  const diasLabel = d < 0 ? `${Math.abs(d)} dia(s) vencido` : `${d} dia(s) restantes`
  return { color: z.color, textColor: z.textColor, dataLabel: fmtDate(validade), diasLabel }
}

export default function PaletesPage() {
  const [aba, setAba] = useState<'paletes' | 'consultar' | 'etiquetas'>('paletes')
  const tab = (key: typeof aba, label: string) => (
    <button
      onClick={() => setAba(key)}
      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${aba === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
    >{label}</button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {tab('paletes', 'Paletes (QR)')}
        {tab('consultar', 'Consultar (QR)')}
        {tab('etiquetas', 'Etiquetas por item')}
      </div>
      {aba === 'paletes' ? <PaletesView /> : aba === 'consultar' ? <ConsultaView /> : <EtiquetasView />}
    </div>
  )
}

function EtiquetasView() {
  const { itens, loading } = useItens()
  const { toast } = useToast()
  const { perfil } = usePerfílContext()
  const responsavel = perfil?.nome?.trim() || perfil?.email || 'sistema'

  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [filtroRua, setFiltroRua] = useState('')
  const [predioDe, setPredioDe] = useState('')
  const [predioAte, setPredioAte] = useState('')
  const [filtroNivel, setFiltroNivel] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  // Base: itens ativos, com saldo E com endereço de PULMÃO (picking não gera etiqueta de palete).
  // Também alimenta as opções dos seletores de rua/nível.
  const comSaldo = useMemo(
    () => itens.filter(i => i.status === 'ativo' && i.quantidade > 0 && !!(i.endereco_gran && i.endereco_gran.trim())),
    [itens],
  )

  // Valores distintos de Rua e Nível no endereço de PULMÃO (para os seletores)
  const ruasPulmao = useMemo(() => {
    const s = new Set<string>()
    for (const i of comSaldo) { const p = partesEndereco(i.endereco_gran); if (p?.rua) s.add(p.rua) }
    return Array.from(s).sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b))
  }, [comSaldo])
  const niveisPulmao = useMemo(() => {
    const s = new Set<string>()
    for (const i of comSaldo) { const p = partesEndereco(i.endereco_gran); if (p?.nivel) s.add(p.nivel) }
    return Array.from(s).sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b))
  }, [comSaldo])

  const temFiltroPulmao = !!(filtroRua || filtroNivel || predioDe.trim() || predioAte.trim())
  const temAlgumFiltro = !!(search || zoneFilter || temFiltroPulmao)

  const disponiveis = useMemo(() => {
    const de = predioDe.trim() ? Number(predioDe) : null
    const ate = predioAte.trim() ? Number(predioAte) : null
    const filtrada = comSaldo.filter(i => {
      // Zona (inclui tratamento de "sem validade")
      if (zoneFilter === 'sem') { if (!semValidade(i.validade)) return false }
      else if (zoneFilter && (semValidade(i.validade) || getZone(i.validade).name !== zoneFilter)) return false

      if (search) {
        const q = search.toLowerCase()
        // Picking não gera etiqueta de palete → busca só no endereço de pulmão
        if (!i.sku.toLowerCase().includes(q) &&
            !i.descricao.toLowerCase().includes(q) &&
            !i.lote.toLowerCase().includes(q) &&
            !(i.endereco_gran ?? '').toLowerCase().includes(q)) return false
      }

      // Filtros de endereço de pulmão: Rua (exata), Nível (exato), Prédio (intervalo de/até)
      if (temFiltroPulmao) {
        const p = partesEndereco(i.endereco_gran)
        if (!p) return false
        if (filtroRua && p.rua !== filtroRua) return false
        if (filtroNivel && p.nivel !== filtroNivel) return false
        if (de !== null || ate !== null) {
          const pv = Number(p.predio)
          if (p.predio === '' || !Number.isFinite(pv)) return false
          if (de !== null && pv < de) return false
          if (ate !== null && pv > ate) return false
        }
      }
      return true
    })
    // Mais crítico (menor validade) primeiro
    return [...filtrada].sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade))
  }, [comSaldo, zoneFilter, search, filtroRua, filtroNivel, predioDe, predioAte, temFiltroPulmao])

  const limparFiltros = () => {
    setSearch(''); setZoneFilter(''); setFiltroRua(''); setPredioDe(''); setPredioAte(''); setFiltroNivel('')
  }

  const idsVisiveis = useMemo(() => disponiveis.map(i => i.id), [disponiveis])
  const todosSelecionados = idsVisiveis.length > 0 && idsVisiveis.every(id => selecionados.has(id))

  const toggle = (id: string) => {
    setSelecionados(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
    setPreviewId(id)
  }

  const toggleTodos = () => {
    setSelecionados(prev => {
      const n = new Set(prev)
      if (todosSelecionados) idsVisiveis.forEach(id => n.delete(id))
      else idsVisiveis.forEach(id => n.add(id))
      return n
    })
  }

  const limpar = () => { setSelecionados(new Set()); setPreviewId(null) }

  // Item exibido no preview: o último clicado, senão o primeiro selecionado, senão o primeiro da lista
  const itemPreview = useMemo(() => {
    const byId = (id: string | null) => id ? disponiveis.find(i => i.id === id) ?? itens.find(i => i.id === id) : undefined
    return byId(previewId)
      ?? disponiveis.find(i => selecionados.has(i.id))
      ?? disponiveis[0]
  }, [previewId, selecionados, disponiveis, itens])

  // Monta o documento (uma etiqueta por página) a partir dos itens
  const construirDoc = async (alvo: Item[]) => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const geradoEm = fmtDateTime(new Date().toISOString())
    alvo.forEach((it, i) => {
      if (i > 0) doc.addPage()
      desenharEtiqueta(doc, it, i + 1, alvo.length, responsavel, geradoEm)
    })
    return doc
  }

  // Envia o PDF para o diálogo de impressão sem baixar arquivo (via iframe oculto)
  const imprimirDoc = (doc: Doc) => {
    doc.autoPrint()
    const url = String(doc.output('bloburl'))
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'; iframe.style.bottom = '0'
    iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    iframe.src = url
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print() } catch (e) { console.error('print', e) }
    }
    document.body.appendChild(iframe)
    // Remove o iframe depois que o diálogo já foi aberto
    setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url) }, 60000)
  }

  // Ação única para imprimir ou baixar, seja em lote (seleção) ou item avulso
  const gerarEtiquetas = async (modo: 'imprimir' | 'pdf', alvo: Item[], nomeArquivo: string) => {
    if (alvo.length === 0) { toast('Selecione ao menos um item para gerar etiquetas', 'info'); return }
    setGerando(true)
    try {
      const doc = await construirDoc(alvo)
      if (modo === 'pdf') {
        doc.save(nomeArquivo)
        toast(`${alvo.length} etiqueta(s) em PDF`)
      } else {
        imprimirDoc(doc)
        toast(`Enviado para impressão (${alvo.length})`)
      }
    } catch (e) {
      console.error('etiquetas', e)
      toast('Erro ao gerar as etiquetas', 'error')
    } finally {
      setGerando(false)
    }
  }

  const hoje = () => new Date().toISOString().split('T')[0]
  const alvoSelecionado = disponiveis.filter(i => selecionados.has(i.id))
  const totalSelecionados = selecionados.size

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Identificação de Paletes</h1>
          <p className="text-sm text-gray-400">
            Selecione os itens e gere etiquetas A4 (paisagem) para impressão — SKU, quantidade, endereço e validade
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalSelecionados > 0 && (
            <Button variant="ghost" size="sm" onClick={limpar}>Limpar seleção</Button>
          )}
          <Button variant="secondary" onClick={() => gerarEtiquetas('pdf', alvoSelecionado, `paletes-${hoje()}.pdf`)} disabled={gerando || totalSelecionados === 0}>
            Baixar PDF
          </Button>
          <Button variant="primary" onClick={() => gerarEtiquetas('imprimir', alvoSelecionado, '')} disabled={gerando || totalSelecionados === 0}>
            {gerando ? 'Gerando…' : `Imprimir (${totalSelecionados})`}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(340px,420px)] gap-4 items-start">
        {/* Coluna esquerda: filtros + tabela de seleção */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3">
            {/* Linha 1 — busca por código + zona */}
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                placeholder="Buscar código (SKU), descrição, lote, endereço de pulmão…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px] focus:outline-none focus:border-blue-500"
              />
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
                <option value="sem">Sem validade</option>
              </select>
            </div>

            {/* Linha 2 — endereço de pulmão: Rua, Prédio (de/até), Nível */}
            <div className="flex flex-wrap gap-3 items-end border-t border-gray-100 pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Rua</label>
                <select
                  value={filtroRua}
                  onChange={e => setFiltroRua(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[110px] focus:outline-none focus:border-blue-500"
                >
                  <option value="">Todas</option>
                  {ruasPulmao.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Prédio (de / até)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="de"
                    value={predioDe}
                    onChange={e => setPredioDe(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-[80px] focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-gray-300">—</span>
                  <input
                    type="number" inputMode="numeric" min={0} placeholder="até"
                    value={predioAte}
                    onChange={e => setPredioAte(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-[80px] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Nível</label>
                <select
                  value={filtroNivel}
                  onChange={e => setFiltroNivel(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[110px] focus:outline-none focus:border-blue-500"
                >
                  <option value="">Todos</option>
                  {niveisPulmao.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {temAlgumFiltro && (
                <Button variant="ghost" size="sm" onClick={limparFiltros} className="mb-0.5">Limpar filtros</Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-1 -mb-1">
            <span className="text-xs text-gray-400">
              {disponiveis.length} {disponiveis.length === 1 ? 'item' : 'itens'}{temAlgumFiltro ? ' (filtrado)' : ''} · {totalSelecionados} selecionado(s)
            </span>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : disponiveis.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">Nenhum item disponível para etiqueta</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={todosSelecionados}
                        onChange={toggleTodos}
                        className="w-4 h-4 accent-blue-600 cursor-pointer"
                        title="Selecionar todos os visíveis"
                      />
                    </th>
                    {['SKU', 'Descrição', 'End. Pulmão', 'Qtd', 'Validade', ''].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {disponiveis.map(item => {
                    const sel = selecionados.has(item.id)
                    const focado = itemPreview?.id === item.id
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setPreviewId(item.id)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${sel ? 'bg-blue-50/60' : focado ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={sel}
                            onChange={() => toggle(item.id)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.sku}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate">{item.descricao}</td>
                        <td className="px-4 py-3 font-mono text-gray-600">{item.endereco_gran || '—'}</td>
                        <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.quantidade}</td>
                        <td className="px-4 py-3"><ZoneCell validade={item.validade} /></td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <button
                              onClick={() => gerarEtiquetas('imprimir', [item], '')}
                              disabled={gerando}
                              className="text-blue-500 hover:text-blue-700 font-semibold disabled:opacity-40"
                              title="Imprimir etiqueta deste item"
                            >Imprimir</button>
                            <span className="text-gray-200">|</span>
                            <button
                              onClick={() => gerarEtiquetas('pdf', [item], `palete-${item.sku}-${hoje()}.pdf`)}
                              disabled={gerando}
                              className="text-gray-500 hover:text-gray-700 font-semibold disabled:opacity-40"
                              title="Baixar etiqueta deste item em PDF"
                            >PDF</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Coluna direita: pré-visualização da etiqueta */}
        <div className="lg:sticky lg:top-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700">Pré-visualização da etiqueta</h2>
            <span className="text-[11px] text-gray-400">A4 · Paisagem</span>
          </div>
          {itemPreview ? (
            <LabelPreview data={itemPreview} responsavel={responsavel} />
          ) : (
            <div className="aspect-[297/210] rounded-xl border-2 border-dashed border-gray-200 grid place-items-center text-gray-400 text-sm p-6 text-center">
              Selecione um item para visualizar a etiqueta
            </div>
          )}
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Clique numa linha para pré-visualizar. Marque os itens e use <strong>Gerar etiquetas</strong> para
            um PDF com uma etiqueta por página. O espaço à direita é reservado para o <strong>QR Code de validação</strong> (em breve).
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Pré-visualização HTML (espelha o layout do PDF) ────────────────────────
function LabelPreview({ data, responsavel }: { data: PaleteData; responsavel: string }) {
  const zv = zonaVisual(data.validade)
  return (
    <div className="aspect-[297/210] w-full rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-[4%] py-[3%] text-white" style={{ background: '#1a1d24' }}>
        <div>
          <div className="font-extrabold leading-tight" style={{ fontSize: 'clamp(11px,2.4vw,18px)' }}>IDENTIFICAÇÃO DE PALETE</div>
          <div className="text-white/50" style={{ fontSize: 'clamp(7px,1.2vw,10px)' }}>Etiqueta de palete · rastreio e validação</div>
        </div>
        <div className="text-right">
          <div className="font-extrabold" style={{ fontSize: 'clamp(9px,1.8vw,14px)' }}>VALIDITY</div>
          <div className="text-white/50" style={{ fontSize: 'clamp(6px,1.1vw,9px)' }}>GRF Distribuição</div>
        </div>
      </div>

      {/* Corpo */}
      <div className="flex-1 flex flex-col min-h-0 px-[4%] py-[3%] gap-[3%]">
        {/* Topo: dados à esquerda + QR reduzido à direita */}
        <div className="flex gap-[4%]">
          <div className="flex-1 min-w-0">
            <Field label="Código do produto (SKU)">
              <span className="font-mono font-extrabold text-gray-900 truncate block leading-none" style={{ fontSize: 'clamp(26px,6vw,50px)' }}>{data.sku}</span>
            </Field>
            <Field label="Descrição">
              <span className="text-gray-800 leading-snug line-clamp-2" style={{ fontSize: 'clamp(9px,1.5vw,13px)' }}>{data.descricao}</span>
            </Field>
            <div className="flex gap-[8%] mt-[2%]">
              <Field label="Quantidade">
                <span className="font-mono font-extrabold text-gray-900" style={{ fontSize: 'clamp(18px,4vw,34px)' }}>{data.quantidade}</span>
              </Field>
              <Field label="Endereço de pulmão">
                <span className="font-mono font-bold text-gray-900 truncate block" style={{ fontSize: 'clamp(13px,2.8vw,24px)' }}>{data.endereco_gran || '—'}</span>
              </Field>
            </div>
          </div>

          {/* QR reservado (reduzido) */}
          <div className="flex flex-col items-center shrink-0" style={{ width: '18%' }}>
            <div className="w-full aspect-square rounded-md border-2 border-dashed border-gray-300 relative grid place-items-center text-center p-1">
              <span className="absolute top-1 left-1 w-[26%] aspect-square border-2 border-gray-200 rounded-[1px]" />
              <span className="absolute top-1 right-1 w-[26%] aspect-square border-2 border-gray-200 rounded-[1px]" />
              <span className="absolute bottom-1 left-1 w-[26%] aspect-square border-2 border-gray-200 rounded-[1px]" />
              <span className="text-gray-400 font-bold uppercase" style={{ fontSize: 'clamp(6px,1.1vw,9px)' }}>QR</span>
            </div>
            <p className="text-gray-400 text-center mt-1 leading-tight" style={{ fontSize: 'clamp(5px,0.9vw,8px)' }}>
              validação (futuro)
            </p>
          </div>
        </div>

        {/* Validade — moldura preta, sem preenchimento (impressão P&B); data preenche a caixa */}
        <div className="rounded-lg border-[2.5px] border-gray-900 px-[3%] py-[2%] flex-1 flex flex-col justify-center">
          <div className="uppercase tracking-wide text-gray-500 font-semibold" style={{ fontSize: 'clamp(7px,1.2vw,10px)' }}>Validade</div>
          <div className="flex-1 flex items-center justify-center">
            <span className="font-mono font-extrabold text-gray-900 leading-none" style={{ fontSize: 'clamp(30px,9vw,76px)' }}>{zv.dataLabel}</span>
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <div className="border-t border-gray-100 px-[4%] py-[2%] flex items-center justify-between text-gray-400" style={{ fontSize: 'clamp(6px,1vw,9px)' }}>
        <span className="truncate">Responsável: {responsavel}</span>
        <span className="whitespace-nowrap ml-2">VALIDITY · GRF Distribuição</span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-[3%]">
      <div className="uppercase tracking-wide text-gray-400 font-semibold mb-0.5" style={{ fontSize: 'clamp(7px,1.1vw,9px)' }}>{label}</div>
      {children}
    </div>
  )
}

// ─── Desenho da etiqueta no PDF (A4 paisagem 297×210mm) ─────────────────────
type Doc = import('jspdf').jsPDF

function desenharEtiqueta(doc: Doc, d: PaleteData, idx: number, total: number, responsavel: string, geradoEm: string) {
  const DARK: [number, number, number] = [26, 29, 36]
  const GRAY: [number, number, number] = [107, 114, 128]
  const LIGHT: [number, number, number] = [215, 219, 226]

  // Cabeçalho (topo arredondado)
  doc.setFillColor(...DARK)
  doc.roundedRect(10, 8, 277, 24, 3, 3, 'F')
  doc.rect(10, 19, 277, 13, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('IDENTIFICAÇÃO DE PALETE', 18, 21)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(180, 190, 205)
  doc.text('Etiqueta de palete · rastreio e validação', 18, 28)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(255, 255, 255)
  doc.text('VALIDITY', 280, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(180, 190, 205)
  doc.text('GRF Distribuição', 280, 27, { align: 'right' })

  // Rótulo de campo pequeno
  const label = (txt: string, x: number, y: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRAY)
    doc.text(txt.toUpperCase(), x, y)
  }

  // Área reservada para o QR Code (menor, canto superior direito)
  const qx = 235, qy = 40, qs = 46
  doc.setDrawColor(...LIGHT); doc.setLineWidth(0.6)
  doc.setLineDashPattern([2, 2], 0)
  doc.roundedRect(qx, qy, qs, qs, 2.5, 2.5, 'S')
  doc.setLineDashPattern([], 0)
  const finder = (fx: number, fy: number) => {
    const s = 9
    doc.setDrawColor(205, 210, 218); doc.setLineWidth(1)
    doc.roundedRect(fx, fy, s, s, 0.8, 0.8, 'S')
    doc.setFillColor(226, 232, 240)
    doc.rect(fx + s * 0.3, fy + s * 0.3, s * 0.4, s * 0.4, 'F')
  }
  finder(qx + 4, qy + 4)
  finder(qx + qs - 13, qy + 4)
  finder(qx + 4, qy + qs - 13)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(150, 156, 165)
  doc.text('QR', qx + qs / 2, qy + qs / 2 + 1, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRAY)
  const cap = doc.splitTextToSize('QR de validação (futuro)', qs)
  doc.text(cap, qx + qs / 2, qy + qs + 5, { align: 'center' })

  // SKU (destaque principal)
  label('Código do produto (SKU)', 16, 44)
  doc.setFont('courier', 'bold'); doc.setFontSize(50); doc.setTextColor(...DARK)
  doc.text(String(d.sku || '—'), 16, 66)

  // Descrição (até 2 linhas)
  label('Descrição', 16, 78)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(40, 44, 52)
  const desc = doc.splitTextToSize(d.descricao || '—', 210).slice(0, 2)
  doc.text(desc, 16, 86)

  // Quantidade + Endereço de pulmão
  label('Quantidade', 16, 104)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.setTextColor(...DARK)
  doc.text(String(d.quantidade), 16, 120)
  label('Endereço de pulmão', 120, 104)
  doc.setFont('courier', 'bold'); doc.setFontSize(24); doc.setTextColor(...DARK)
  doc.text(String(d.endereco_gran || '—'), 120, 119)

  // Validade — moldura preta sem preenchimento (impressão P&B); data grande centralizada
  const zv = zonaVisual(d.validade)
  doc.setDrawColor(...DARK); doc.setLineWidth(0.8)
  doc.roundedRect(16, 126, 263, 58, 3, 3, 'S')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRAY)
  doc.text('VALIDADE', 22, 138)
  doc.setFont('courier', 'bold'); doc.setFontSize(80); doc.setTextColor(...DARK)
  doc.text(zv.dataLabel, 147.5, 172, { align: 'center' })

  // Rodapé
  doc.setDrawColor(...LIGHT); doc.setLineWidth(0.3); doc.setLineDashPattern([], 0)
  doc.line(16, 186, 280, 186)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY)
  doc.text(`Gerado em ${geradoEm}   ·   Responsável: ${responsavel}`, 16, 193)
  doc.text(`Palete ${idx} de ${total}`, 280, 193, { align: 'right' })
  doc.setFontSize(7.5); doc.setTextColor(160, 166, 175)
  doc.text('VALIDITY · Gestão de Validade de Estoque · GRF Distribuição', 16, 199)

  // Moldura externa
  doc.setDrawColor(...LIGHT); doc.setLineWidth(0.5)
  doc.roundedRect(10, 8, 277, 194, 3, 3, 'S')
}
