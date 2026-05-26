'use client'
import { useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/layout/Toast'
import { diasParaVencer, getZone } from '@/lib/zones'
import { fmtDate } from '@/lib/utils'
import type { Item } from '@/lib/types'

export default function PlanoAcaoPage() {
  const { itens, loading, bloquearItem } = useItens()
  const { toast } = useToast()
  const [bloqueioTarget, setBloqueioTarget] = useState<Item | null>(null)
  const [responsavel, setResponsavel] = useState('')

  const ativos = useMemo(() => itens.filter(i => i.status === 'ativo'), [itens])

  const amarelos = useMemo(() =>
    ativos.filter(i => { const d = diasParaVencer(i.validade); return d >= 30 && d < 91 })
      .sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade)),
    [ativos]
  )

  const vermelhos = useMemo(() =>
    ativos.filter(i => diasParaVencer(i.validade) < 30)
      .sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade)),
    [ativos]
  )

  const handleBloqueio = async () => {
    if (!bloqueioTarget || !responsavel) return
    const { error } = await bloquearItem(bloqueioTarget.id, responsavel)
    if (error) toast('Erro ao bloquear item', 'error')
    else toast(`${bloqueioTarget.sku} bloqueado`)
    setBloqueioTarget(null)
    setResponsavel('')
  }

  const exportarPDF = async (items: Item[], zonaLabel: string) => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const hoje = new Date().toLocaleDateString('pt-BR')

    // Cabeçalho
    doc.setFillColor(26, 29, 36)
    doc.rect(0, 0, 297, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('VALIDITY — Plano de Ação', 10, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Zona: ${zonaLabel}   |   Gerado em: ${hoje}   |   Total: ${items.length} itens`, 10, 17.5)

    // Tabela
    const rows = items.map(i => {
      const dias = diasParaVencer(i.validade)
      const diasLabel = dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d restantes`
      return [i.sku, i.descricao, i.lote, String(i.quantidade), fmtDate(i.validade), diasLabel]
    })

    // Cor da zona para células de validade
    const hexToRgb = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return { r, g, b }
    }

    autoTable(doc, {
      startY: 22,
      head: [['SKU', 'Descrição', 'Lote', 'Qtde', 'Validade', 'Dias Restantes']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', overflow: 'linebreak' },
      headStyles: { fillColor: [26, 29, 36], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' },
        1: { cellWidth: 80 },
        2: { cellWidth: 25 },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 28, halign: 'center' },
        5: { cellWidth: 32, halign: 'center' },
      },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const item = items[data.row.index]
          if (!item) return
          const z = getZone(item.validade)
          const rgb = hexToRgb(z.color)
          data.cell.styles.fillColor = [rgb.r, rgb.g, rgb.b]
          data.cell.styles.textColor = z.textColor === '#ffffff' ? [255, 255, 255] : [26, 29, 36]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    // Rodapé
    const pageCount = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`Página ${i} de ${pageCount}`, 287, 205, { align: 'right' })
      doc.text('VALIDITY · Gestão de Validade de Estoque · GRF Distribuição', 10, 205)
    }

    doc.save(`plano-acao-${zonaLabel.toLowerCase().replace(' ', '-')}-${new Date().toISOString().split('T')[0]}.pdf`)
    toast('PDF gerado com sucesso')
  }

  const ItemTable = ({ items, onBloqueio }: { items: Item[]; onBloqueio?: (i: Item) => void }) => (
    <div className="overflow-x-auto">
      {items.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">Nenhum item nesta zona</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade', ...(onBloqueio ? ['Ação'] : [])].map(h => (
                <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.sku}</td>
                <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">{item.descricao}</td>
                <td className="px-4 py-3 font-mono text-gray-500">{item.lote}</td>
                <td className="px-4 py-3 font-mono text-gray-600">{item.endereco_frac}</td>
                <td className="px-4 py-3">
                  {item.quantidade === 0
                    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-gray-100 text-gray-400 border border-gray-200">⊘ Saldo 0</span>
                    : <span className="font-mono font-bold text-gray-800">{item.quantidade}</span>
                  }
                </td>
                <td className="px-4 py-3"><ZoneCell validade={item.validade} /></td>
                {onBloqueio && (
                  <td className="px-4 py-3">
                    <Button size="sm" variant="danger" onClick={() => onBloqueio(item)}>Bloquear</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Plano de Ação</h1>
        <p className="text-sm text-gray-400">Itens que requerem atenção imediata ou monitoramento</p>
      </div>

      {/* Zona Vermelha */}
      <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-600" />
            <h2 className="font-bold text-red-700">Zona Crítica — Vencidos e &lt;30 dias</h2>
            <span className="bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{vermelhos.length}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => exportarPDF(vermelhos, 'Crítico')}>
            Exportar PDF
          </Button>
        </div>
        <ItemTable items={vermelhos} onBloqueio={setBloqueioTarget} />
      </div>

      {/* Zona Amarela */}
      <div className="bg-white rounded-xl border border-yellow-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-yellow-50 border-b border-yellow-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <h2 className="font-bold text-yellow-700">Zona Atenção — 30 a 90 dias</h2>
            <span className="bg-yellow-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{amarelos.length}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={() => exportarPDF(amarelos, 'Atenção')}>
            Exportar detalhes
          </Button>
        </div>
        <ItemTable items={amarelos} />
      </div>

      {/* Modal de bloqueio */}
      <Modal open={!!bloqueioTarget} onClose={() => setBloqueioTarget(null)} title="Bloquear Item">
        <p className="text-sm text-gray-600 mb-4">
          Bloqueando <strong>{bloqueioTarget?.sku}</strong> — {bloqueioTarget?.descricao}
        </p>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-600">Responsável *</label>
          <input
            type="text"
            value={responsavel}
            onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setBloqueioTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleBloqueio} disabled={!responsavel}>Confirmar Bloqueio</Button>
        </div>
      </Modal>
    </div>
  )
}
