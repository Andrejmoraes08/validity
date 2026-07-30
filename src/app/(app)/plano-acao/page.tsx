'use client'
import { useMemo, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/layout/Toast'
import { diasParaVencer, getZone } from '@/lib/zones'
import { fmtDate, fmtDateTime } from '@/lib/utils'
import { usePerfílContext } from '@/lib/perfil-context'
import { supabase } from '@/lib/supabase'
import type { Item } from '@/lib/types'

export default function PlanoAcaoPage() {
  const { itens, loading, bloquearItem, enviarQuarentena, bloquearQuarentena, estornarItem } = useItens()
  const { toast } = useToast()
  const { can } = usePerfílContext()
  const [bloqueioTarget, setBloqueioTarget] = useState<Item | null>(null)
  const [estornoTarget, setEstornoTarget] = useState<Item | null>(null)
  const [quarentenaTarget, setQuarentenaTarget] = useState<Item | null>(null)
  const [resolverQuar, setResolverQuar] = useState<{ sku: string; descricao: string; motivo: string } | null>(null)
  const [solicitarTarget, setSolicitarTarget] = useState<Item | null>(null)
  const [responsavel, setResponsavel] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resumoAberto, setResumoAberto] = useState(true)

  // Dispara o e-mail de notificação para os usuários com acesso ao Plano de Ação
  type DadosEmail = { sku: string; descricao: string; endereco?: string; validade?: string; quantidade?: number | string }
  const itemParaDados = (i: Item): DadosEmail => ({
    sku: i.sku, descricao: i.descricao, validade: i.validade,
    quantidade: i.quantidade, endereco: i.endereco_frac || i.endereco_gran,
  })

  const notificar = async (acao: string, dados: DadosEmail, resp: string, observacao = '') => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/plano-acao/notificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ acao, responsavel: resp, obs: observacao, item: dados }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast(json.error ?? 'Ação registrada, mas o e-mail falhou', 'error'); return }
      if (json.semProvedor) toast('Ação registrada — envio de e-mail ainda não configurado', 'info')
      else toast(`E-mail enviado a ${json.enviados} usuário(s)`)
    } catch {
      toast('Ação registrada, mas o e-mail falhou', 'error')
    }
  }

  const ativos = useMemo(() => itens.filter(i => i.status === 'ativo'), [itens])

  const segregados = useMemo(() =>
    itens.filter(i => i.status === 'segregado')
      .sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade)),
    [itens]
  )

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

  // Produtos em quarentena — consolidados por produto (SKU), somando a quantidade
  const quarentenaItens = useMemo(() => itens.filter(i => i.status === 'quarentena'), [itens])
  const quarentenaConsolidada = useMemo(() => {
    const mapa = new Map<string, { sku: string; descricao: string; quantidade: number; ids: string[] }>()
    for (const i of quarentenaItens) {
      const g = mapa.get(i.sku) ?? { sku: i.sku, descricao: i.descricao, quantidade: 0, ids: [] }
      g.quantidade += i.quantidade
      g.ids.push(i.id)
      mapa.set(i.sku, g)
    }
    return Array.from(mapa.values()).sort((a, b) => a.descricao.localeCompare(b.descricao))
  }, [quarentenaItens])

  // Resumo consolidado: agrupa por SKU + validade, soma quantidades de todos os endereços.
  // Apenas o que precisa ser definido no plano de ação: segregados + vencido/crítico (<30d).
  // A zona de atenção (30-90d) é só monitoramento e fica de fora. Respeita as permissões.
  const consolidado = useMemo(() => {
    const fonte: Item[] = []
    if (can('plano.ver_segregados')) fonte.push(...segregados)
    if (can('plano.ver_zonas')) fonte.push(...vermelhos)

    const mapa = new Map<string, { sku: string; descricao: string; validade: string; quantidade: number; enderecos: number; segregados: number }>()
    for (const i of fonte) {
      const key = `${i.sku}||${i.validade}`
      const g = mapa.get(key) ?? { sku: i.sku, descricao: i.descricao, validade: i.validade, quantidade: 0, enderecos: 0, segregados: 0 }
      g.quantidade += i.quantidade
      g.enderecos += 1
      if (i.status === 'segregado') g.segregados += 1
      mapa.set(key, g)
    }
    return Array.from(mapa.values()).sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade))
  }, [segregados, vermelhos, can])

  const totalConsolidado = useMemo(() => consolidado.reduce((s, g) => s + g.quantidade, 0), [consolidado])

  // Solicitar bloqueio (Zona Crítica): NÃO muda o status, só notifica por e-mail
  const handleSolicitar = async () => {
    if (!solicitarTarget || !responsavel) return
    setEnviando(true)
    await notificar('solicitar_bloqueio', itemParaDados(solicitarTarget), responsavel, obs)
    setEnviando(false)
    setSolicitarTarget(null)
    setResponsavel('')
    setObs('')
  }

  const handleBloqueio = async () => {
    if (!bloqueioTarget || !responsavel) return
    setEnviando(true)
    const alvo = bloqueioTarget
    const { error } = await bloquearItem(alvo.id, responsavel)
    if (error) { toast('Erro ao bloquear item', 'error'); setEnviando(false); return }
    toast(`${alvo.sku} bloqueado`)
    await notificar('bloqueio_confirmado', itemParaDados(alvo), responsavel, obs)
    setEnviando(false)
    setBloqueioTarget(null)
    setResponsavel('')
    setObs('')
  }

  const handleEstorno = async () => {
    if (!estornoTarget || !responsavel) return
    setEnviando(true)
    const alvo = estornoTarget
    const { error } = await estornarItem(alvo.id, responsavel)
    if (error) { toast('Erro ao estornar', 'error'); setEnviando(false); return }
    toast(`${alvo.sku} retornou ao estoque ativo`)
    await notificar('estorno', itemParaDados(alvo), responsavel, obs)
    setEnviando(false)
    setEstornoTarget(null)
    setResponsavel('')
    setObs('')
  }

  // Enviar segregado para quarentena (não muda saldo; só move de fila)
  const handleQuarentena = async () => {
    if (!quarentenaTarget || !responsavel) return
    setEnviando(true)
    const alvo = quarentenaTarget
    const { error } = await enviarQuarentena(alvo.id, responsavel)
    if (error) { toast('Erro ao enviar para quarentena', 'error'); setEnviando(false); return }
    toast(`${alvo.sku} enviado para quarentena`)
    await notificar('quarentena', itemParaDados(alvo), responsavel)
    setEnviando(false)
    setQuarentenaTarget(null)
    setResponsavel('')
  }

  // Resolver quarentena por SKU: baixa TODOS os itens daquele produto (devolução/descarte)
  const handleResolverQuar = async () => {
    if (!resolverQuar || !responsavel) return
    setEnviando(true)
    const grupo = quarentenaItens.filter(i => i.sku === resolverQuar.sku)
    const totalQtd = grupo.reduce((s, i) => s + i.quantidade, 0)
    let erros = 0
    for (const i of grupo) {
      const { error } = await bloquearQuarentena(i.id, resolverQuar.motivo, responsavel)
      if (error) erros++
    }
    if (erros > 0) { toast(`Concluído com ${erros} erro(s)`, 'error'); setEnviando(false); return }
    toast(`${resolverQuar.sku}: enviado para Bloqueados (${resolverQuar.motivo}) — aguardando NF`)
    await notificar(
      resolverQuar.motivo === 'Descarte' ? 'descarte' : 'devolucao',
      { sku: resolverQuar.sku, descricao: resolverQuar.descricao, quantidade: totalQtd },
      responsavel,
    )
    setEnviando(false)
    setResolverQuar(null)
    setResponsavel('')
  }

  // Helper de dias restantes em texto
  const diasTexto = (validade: string) => {
    const d = diasParaVencer(validade)
    return d < 0 ? `${Math.abs(d)}d vencido` : `${d}d`
  }

  // ── PDF GERAL: todas as seções do Plano de Ação num único documento ──────────
  const exportarPDFGeral = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    type DocComAuto = InstanceType<typeof jsPDF> & { lastAutoTable?: { finalY: number }; internal: { getNumberOfPages: () => number } }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as DocComAuto
    const hoje = new Date().toLocaleDateString('pt-BR')
    const hexToRgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
    ]

    // Cabeçalho principal
    doc.setFillColor(26, 29, 36)
    doc.rect(0, 0, 297, 20, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text('VALIDITY — Plano de Ação (Geral)', 10, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(`Gerado em: ${hoje}`, 10, 17)

    let y = 26
    const secao = (titulo: string, cor: string, head: string[], body: (string | number)[][], corValidadeCol?: number, fonteZona?: { validade: string }[]) => {
      if (body.length === 0) return
      if (y > 175) { doc.addPage(); y = 15 }
      const [r, g, b] = hexToRgb(cor)
      doc.setFillColor(r, g, b)
      doc.rect(10, y, 277, 7, 'F')
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text(`${titulo}  (${body.length})`, 12, y + 5)
      y += 9
      autoTable(doc, {
        startY: y,
        head: [head], body,
        styles: { fontSize: 7.5, cellPadding: 2, font: 'helvetica', overflow: 'linebreak' },
        headStyles: { fillColor: [55, 60, 70], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [248, 249, 251] },
        margin: { left: 10, right: 10 },
        didParseCell: (data) => {
          if (corValidadeCol !== undefined && data.section === 'body' && data.column.index === corValidadeCol && fonteZona) {
            const linha = fonteZona[data.row.index]
            if (!linha) return
            const z = getZone(linha.validade)
            data.cell.styles.fillColor = hexToRgb(z.color)
            data.cell.styles.textColor = z.textColor === '#ffffff' ? [255, 255, 255] : [26, 29, 36]
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })
      y = (doc.lastAutoTable?.finalY ?? y) + 8
    }

    // 1. Resumo consolidado
    secao('Resumo Consolidado (vencido + crítico + segregados)', '#1a1d24',
      ['SKU', 'Descrição', 'Validade', 'Dias', 'Qtde Total'],
      consolidado.map(gp => [gp.sku, gp.descricao, fmtDate(gp.validade), diasTexto(gp.validade), gp.quantidade]),
      2, consolidado)

    // 2. Segregados
    secao('Segregados — aguardando confirmação de bloqueio', '#ea580c',
      ['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade', 'Segregado por', 'Em'],
      segregados.map(i => [i.sku, i.descricao, i.lote, i.endereco_frac || i.endereco_gran, i.quantidade,
        fmtDate(i.validade), i.segregado_por || '—', i.segregado_em ? new Date(i.segregado_em).toLocaleDateString('pt-BR') : '—']),
      5, segregados)

    // 3. Produtos em quarentena (consolidado)
    secao('Produtos em Quarentena — aguardando devolução/descarte', '#7c3aed',
      ['SKU', 'Descrição', 'Qtde Total'],
      quarentenaConsolidada.map(gp => [gp.sku, gp.descricao, gp.quantidade]))

    // 4. Zona crítica
    secao('Zona Crítica — Vencidos e <30 dias', '#dc2626',
      ['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade', 'Dias'],
      vermelhos.map(i => [i.sku, i.descricao, i.lote, i.endereco_frac, i.quantidade, fmtDate(i.validade), diasTexto(i.validade)]),
      5, vermelhos)

    // 5. Zona atenção
    secao('Zona Atenção — 30 a 90 dias', '#d4a017',
      ['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade', 'Dias', 'Últ. Inspeção'],
      amarelos.map(i => [i.sku, i.descricao, i.lote, i.endereco_frac, i.quantidade, fmtDate(i.validade), diasTexto(i.validade),
        i.ultima_inspecao ? fmtDateTime(i.ultima_inspecao) : 'nunca']),
      5, amarelos)

    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150)
      doc.text(`Página ${i} de ${pageCount}`, 287, 205, { align: 'right' })
      doc.text('VALIDITY · Gestão de Validade de Estoque · GRF Distribuição', 10, 205)
    }
    doc.save(`plano-acao-geral-${new Date().toISOString().split('T')[0]}.pdf`)
    toast('PDF geral gerado')
  }

  // ── EXCEL: uma aba por tabela (xlsx-js-style p/ células coloridas) ───────────
  const exportarExcel = async () => {
    const XLSX = (await import('xlsx-js-style')).default
    const wb = XLSX.utils.book_new()

    // Resumo consolidado — com formatação colorida por zona
    const resumoRows = consolidado.map(gp => ({
      SKU: gp.sku, Descrição: gp.descricao, Validade: fmtDate(gp.validade),
      Dias: diasTexto(gp.validade), 'Qtde Total': gp.quantidade,
    }))
    const wsResumo = XLSX.utils.json_to_sheet(resumoRows)
    wsResumo['!cols'] = [{ wch: 10 }, { wch: 48 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
    // Cor de fundo na célula de validade (coluna C) conforme a zona
    consolidado.forEach((gp, idx) => {
      const ref = XLSX.utils.encode_cell({ r: idx + 1, c: 2 })
      const z = getZone(gp.validade)
      const cell = wsResumo[ref]
      if (cell) {
        cell.s = {
          fill: { patternType: 'solid', fgColor: { rgb: z.color.replace('#', '').toUpperCase() } },
          font: { color: { rgb: z.textColor === '#ffffff' ? 'FFFFFF' : '1A1D24' }, bold: true },
        }
      }
    })
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Consolidado')

    // Segregados
    const wsSeg = XLSX.utils.json_to_sheet(segregados.map(i => ({
      SKU: i.sku, Descrição: i.descricao, Lote: i.lote, Endereço: i.endereco_frac || i.endereco_gran,
      Qtd: i.quantidade, Validade: fmtDate(i.validade), Dias: diasTexto(i.validade),
      'Segregado por': i.segregado_por || '', Em: i.segregado_em ? fmtDateTime(i.segregado_em) : '',
    })))
    wsSeg['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsSeg, 'Segregados')

    // Produtos em quarentena
    const wsQuar = XLSX.utils.json_to_sheet(quarentenaConsolidada.map(gp => ({
      SKU: gp.sku, Descrição: gp.descricao, 'Qtde Total': gp.quantidade,
    })))
    wsQuar['!cols'] = [{ wch: 10 }, { wch: 48 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, wsQuar, 'Quarentena')

    // Zona crítica
    const wsVerm = XLSX.utils.json_to_sheet(vermelhos.map(i => ({
      SKU: i.sku, Descrição: i.descricao, Lote: i.lote, Endereço: i.endereco_frac,
      Qtd: i.quantidade, Validade: fmtDate(i.validade), Dias: diasTexto(i.validade),
    })))
    wsVerm['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, wsVerm, 'Zona Crítica')

    // Zona atenção
    const wsAmar = XLSX.utils.json_to_sheet(amarelos.map(i => ({
      SKU: i.sku, Descrição: i.descricao, Lote: i.lote, Endereço: i.endereco_frac,
      Qtd: i.quantidade, Validade: fmtDate(i.validade), Dias: diasTexto(i.validade),
      'Últ. Inspeção': i.ultima_inspecao ? fmtDateTime(i.ultima_inspecao) : 'nunca',
      Inspetor: i.inspecionado_por || '',
    })))
    wsAmar['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsAmar, 'Zona Atenção')

    XLSX.writeFile(wb, `plano-acao-${new Date().toISOString().split('T')[0]}.xlsx`)
    toast('Excel gerado')
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

  const exportarSegregadosPDF = async () => {
    if (segregados.length === 0) { toast('Nenhum item segregado para exportar', 'info'); return }
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const hoje = new Date().toLocaleDateString('pt-BR')

    doc.setFillColor(26, 29, 36)
    doc.rect(0, 0, 297, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('VALIDITY — Produtos Segregados', 10, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Aguardando confirmação de bloqueio   |   Gerado em: ${hoje}   |   Total: ${segregados.length} itens`, 10, 17.5)

    const rows = segregados.map(i => {
      const dias = diasParaVencer(i.validade)
      const diasLabel = dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d restantes`
      return [
        i.sku, i.descricao, i.lote,
        i.endereco_frac || i.endereco_gran, String(i.quantidade),
        fmtDate(i.validade), diasLabel,
        i.segregado_por || '—',
        i.segregado_em ? new Date(i.segregado_em).toLocaleDateString('pt-BR') : '—',
      ]
    })

    const hexToRgb = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    })

    autoTable(doc, {
      startY: 22,
      head: [['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtde', 'Validade', 'Dias', 'Segregado por', 'Em']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', overflow: 'linebreak' },
      headStyles: { fillColor: [26, 29, 36], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 20, fontStyle: 'bold' },
        1: { cellWidth: 62 },
        2: { cellWidth: 20 },
        3: { cellWidth: 30 },
        4: { cellWidth: 14, halign: 'center' },
        5: { cellWidth: 24, halign: 'center' },
        6: { cellWidth: 26, halign: 'center' },
        7: { cellWidth: 40 },
        8: { cellWidth: 22, halign: 'center' },
      },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 5) {
          const item = segregados[data.row.index]
          if (!item) return
          const z = getZone(item.validade)
          const rgb = hexToRgb(z.color)
          data.cell.styles.fillColor = [rgb.r, rgb.g, rgb.b]
          data.cell.styles.textColor = z.textColor === '#ffffff' ? [255, 255, 255] : [26, 29, 36]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    const pageCount = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`Página ${i} de ${pageCount}`, 287, 205, { align: 'right' })
      doc.text('VALIDITY · Gestão de Validade de Estoque · GRF Distribuição', 10, 205)
    }

    doc.save(`segregados-${new Date().toISOString().split('T')[0]}.pdf`)
    toast('PDF de segregados gerado')
  }

  const exportarConsolidadoPDF = async () => {
    if (consolidado.length === 0) { toast('Nada a consolidar', 'info'); return }
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const hoje = new Date().toLocaleDateString('pt-BR')

    doc.setFillColor(26, 29, 36)
    doc.rect(0, 0, 210, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('VALIDITY — Resumo Consolidado', 10, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Por SKU e validade   |   Gerado em: ${hoje}   |   Total: ${totalConsolidado} un`, 10, 17.5)

    const rows = consolidado.map(g => {
      const dias = diasParaVencer(g.validade)
      const diasLabel = dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`
      return [
        g.sku, g.descricao, fmtDate(g.validade), diasLabel,
        String(g.quantidade),
      ]
    })

    const hexToRgb = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    })

    autoTable(doc, {
      startY: 22,
      head: [['SKU', 'Descrição', 'Validade', 'Dias', 'Qtde Total']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2.5, font: 'helvetica', overflow: 'linebreak' },
      headStyles: { fillColor: [26, 29, 36], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' },
        1: { cellWidth: 92 },
        2: { cellWidth: 28, halign: 'center' },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const g = consolidado[data.row.index]
          if (!g) return
          const z = getZone(g.validade)
          const rgb = hexToRgb(z.color)
          data.cell.styles.fillColor = [rgb.r, rgb.g, rgb.b]
          data.cell.styles.textColor = z.textColor === '#ffffff' ? [255, 255, 255] : [26, 29, 36]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    const pageCount = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`Página ${i} de ${pageCount}`, 200, 290, { align: 'right' })
      doc.text('VALIDITY · Gestão de Validade de Estoque · GRF Distribuição', 10, 290)
    }

    doc.save(`resumo-consolidado-${new Date().toISOString().split('T')[0]}.pdf`)
    toast('PDF do resumo gerado')
  }

  const ItemTable = ({ items, onBloqueio, mostrarInspecao }: { items: Item[]; onBloqueio?: (i: Item) => void; mostrarInspecao?: boolean }) => (
    <div className="overflow-x-auto">
      {items.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">Nenhum item nesta zona</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade',
                ...(mostrarInspecao ? ['Últ. Inspeção'] : []),
                ...(onBloqueio ? ['Ação'] : [])].map(h => (
                <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
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
                {mostrarInspecao && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {item.ultima_inspecao ? (
                      <div className="flex flex-col">
                        <span className="text-gray-600 font-mono text-[11px]">{fmtDateTime(item.ultima_inspecao)}</span>
                        {item.inspecionado_por && <span className="text-gray-400 text-[10px] truncate max-w-[110px]">{item.inspecionado_por}</span>}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-[11px]">— nunca</span>
                    )}
                  </td>
                )}
                {onBloqueio && (
                  <td className="px-4 py-3">
                    {can('plano.bloquear')
                      ? <Button size="sm" variant="danger" onClick={() => onBloqueio(item)}>Solicitar Bloqueio</Button>
                      : <span className="text-[11px] text-gray-300">—</span>}
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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Plano de Ação</h1>
          <p className="text-sm text-gray-400">Itens que requerem atenção imediata ou monitoramento</p>
        </div>
        {can('plano.exportar') && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportarPDFGeral}>📄 PDF Geral</Button>
            <Button variant="secondary" size="sm" onClick={exportarExcel}>📊 Excel</Button>
          </div>
        )}
      </div>

      {/* Resumo Consolidado — por SKU + validade (somente consulta) */}
      {consolidado.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setResumoAberto(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-gray-400">{resumoAberto ? '▾' : '▸'}</span>
              <h2 className="font-bold text-gray-700">Resumo Consolidado</h2>
              <span className="bg-gray-700 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{consolidado.length} SKU/validade</span>
              <span className="text-xs text-gray-400 font-mono">{totalConsolidado} un no total</span>
            </div>
            {can('plano.exportar') && (
              <span
                onClick={(e) => { e.stopPropagation(); exportarConsolidadoPDF() }}
                className="text-xs font-semibold text-blue-600 border border-blue-200 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Exportar PDF
              </span>
            )}
          </button>
          {resumoAberto && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-white border-b border-gray-100">
                  <tr>
                    {['SKU', 'Descrição', 'Validade', 'Qtde Total'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {consolidado.map((g, i) => (
                    <tr key={`${g.sku}-${g.validade}-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-bold text-gray-800">{g.sku}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[260px] truncate">{g.descricao}</td>
                      <td className="px-4 py-3"><ZoneCell validade={g.validade} /></td>
                      <td className="px-4 py-3 font-mono font-extrabold text-gray-900">{g.quantidade}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="px-4 py-3 font-bold text-gray-700" colSpan={3}>Total geral</td>
                    <td className="px-4 py-3 font-mono font-extrabold text-gray-900">{totalConsolidado}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Segregados — aguardando confirmação de bloqueio */}
      {can('plano.ver_segregados') && (
      <div className="bg-white rounded-xl border border-orange-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-orange-50 border-b border-orange-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-orange-500" />
            <h2 className="font-bold text-orange-700">Segregados na Inspeção — aguardando confirmação de bloqueio</h2>
            <span className="bg-orange-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{segregados.length}</span>
          </div>
          {can('plano.exportar') && (
            <Button size="sm" variant="secondary" onClick={exportarSegregadosPDF}>
              Exportar PDF
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          {segregados.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">Nenhum item segregado</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['SKU', 'Descrição', 'Lote', 'Endereço', 'Qtd', 'Validade', 'Segregado por', 'Em',
                    ...((can('plano.bloquear') || can('plano.quarentena') || can('plano.estornar')) ? ['Ação'] : [])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segregados.map(item => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-gray-800">{item.sku}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate">{item.descricao}</td>
                    <td className="px-4 py-3 font-mono text-gray-500">{item.lote}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">{item.endereco_frac || item.endereco_gran}</td>
                    <td className="px-4 py-3 font-mono font-bold">{item.quantidade}</td>
                    <td className="px-4 py-3"><ZoneCell validade={item.validade} /></td>
                    <td className="px-4 py-3 text-gray-500">{item.segregado_por || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.segregado_em ? fmtDateTime(item.segregado_em) : '—'}</td>
                    {(can('plano.bloquear') || can('plano.quarentena') || can('plano.estornar')) && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {can('plano.bloquear') && <Button size="sm" variant="danger" onClick={() => { setBloqueioTarget(item); setResponsavel(''); setObs('') }}>Confirmar Bloqueio</Button>}
                          {can('plano.quarentena') && <Button size="sm" variant="ghost" className="!bg-amber-500 hover:!bg-amber-600 !text-white !border-transparent" onClick={() => { setQuarentenaTarget(item); setResponsavel('') }}>Enviar p/ Quarentena</Button>}
                          {can('plano.estornar') && <Button size="sm" variant="ghost" className="!bg-green-600 hover:!bg-green-700 !text-white !border-transparent" onClick={() => { setEstornoTarget(item); setResponsavel(''); setObs('') }}>Estornar p/ Venda</Button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      {/* Produtos em Quarentena — consolidado por produto */}
      {can('plano.ver_quarentena') && (
      <div className="bg-white rounded-xl border border-purple-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-purple-50 border-b border-purple-100">
          <div className="w-3 h-3 rounded-full bg-purple-500" />
          <h2 className="font-bold text-purple-700">Produtos em Quarentena — aguardando devolução ou descarte</h2>
          <span className="bg-purple-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{quarentenaConsolidada.length}</span>
        </div>
        <div className="overflow-x-auto">
          {quarentenaConsolidada.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">Nenhum produto em quarentena</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['SKU', 'Descrição', 'Qtde Total', ...(can('plano.quarentena_resolver') ? ['Ação'] : [])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quarentenaConsolidada.map(g => (
                  <tr key={g.sku} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-bold text-gray-800">{g.sku}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[260px] truncate">{g.descricao}</td>
                    <td className="px-4 py-3 font-mono font-extrabold text-gray-900">{g.quantidade}</td>
                    {can('plano.quarentena_resolver') && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="secondary" onClick={() => { setResolverQuar({ sku: g.sku, descricao: g.descricao, motivo: 'Devolução ao fornecedor' }); setResponsavel('') }}>Devolução p/ fornecedor</Button>
                          <Button size="sm" variant="danger" onClick={() => { setResolverQuar({ sku: g.sku, descricao: g.descricao, motivo: 'Descarte' }); setResponsavel('') }}>Descartar</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      {/* Zona Vermelha */}
      {can('plano.ver_zonas') && (
      <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-600" />
            <h2 className="font-bold text-red-700">Zona Crítica — Vencidos e &lt;30 dias</h2>
            <span className="bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{vermelhos.length}</span>
          </div>
          {can('plano.exportar') && (
            <Button size="sm" variant="secondary" onClick={() => exportarPDF(vermelhos, 'Crítico')}>
              Exportar PDF
            </Button>
          )}
        </div>
        <ItemTable items={vermelhos} onBloqueio={(i) => { setSolicitarTarget(i); setResponsavel(''); setObs('') }} />
      </div>
      )}

      {/* Zona Amarela */}
      {can('plano.ver_zonas') && (
      <div className="bg-white rounded-xl border border-yellow-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-yellow-50 border-b border-yellow-100">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <h2 className="font-bold text-yellow-700">Zona Atenção — 30 a 90 dias</h2>
            <span className="bg-yellow-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{amarelos.length}</span>
          </div>
          {can('plano.exportar') && (
            <Button size="sm" variant="secondary" onClick={() => exportarPDF(amarelos, 'Atenção')}>
              Exportar detalhes
            </Button>
          )}
        </div>
        <ItemTable items={amarelos} mostrarInspecao />
      </div>
      )}

      {/* Modal de solicitação de bloqueio (Zona Crítica) — só notifica por e-mail */}
      <Modal open={!!solicitarTarget} onClose={() => { setSolicitarTarget(null); setResponsavel(''); setObs('') }} title="Solicitar Bloqueio">
        <p className="text-sm text-gray-600 mb-3">
          Solicitando bloqueio de <strong>{solicitarTarget?.sku}</strong> — {solicitarTarget?.descricao}
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
          <p className="text-xs text-amber-700">
            O item <strong>não</strong> será bloqueado agora. Um e-mail será enviado aos usuários com
            acesso ao Plano de Ação sinalizando a solicitação.
          </p>
        </div>
        <div className="flex flex-col gap-1 mb-3">
          <label className="text-xs font-semibold text-gray-600">Solicitante *</label>
          <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)}
            placeholder="Seu nome"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            placeholder="Motivo / instrução…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300" />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setSolicitarTarget(null); setResponsavel(''); setObs('') }}>Cancelar</Button>
          <Button variant="danger" onClick={handleSolicitar} disabled={!responsavel || enviando}>
            {enviando ? 'Enviando…' : 'Enviar Solicitação'}
          </Button>
        </div>
      </Modal>

      {/* Modal de bloqueio */}
      <Modal open={!!bloqueioTarget} onClose={() => setBloqueioTarget(null)} title="Confirmar Bloqueio">
        <p className="text-sm text-gray-600 mb-3">
          Bloqueando <strong>{bloqueioTarget?.sku}</strong> — {bloqueioTarget?.descricao}
        </p>
        <p className="text-xs text-gray-400 mb-4">Ao confirmar, os usuários do Plano de Ação são notificados por e-mail.</p>
        <div className="flex flex-col gap-1 mb-3">
          <label className="text-xs font-semibold text-gray-600">Responsável *</label>
          <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300" />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setBloqueioTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleBloqueio} disabled={!responsavel || enviando}>
            {enviando ? 'Processando…' : 'Confirmar Bloqueio'}
          </Button>
        </div>
      </Modal>

      {/* Modal de estorno de segregação */}
      <Modal open={!!estornoTarget} onClose={() => { setEstornoTarget(null); setResponsavel('') }} title="Estornar Segregação">
        <p className="text-sm text-gray-600 mb-3">
          Estornando <strong>{estornoTarget?.sku}</strong> — {estornoTarget?.descricao}
        </p>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 mb-4">
          <p className="text-xs text-blue-700">
            O item retornará ao <strong>estoque ativo</strong> e voltará a aparecer nas zonas do
            Plano de Ação e nas próximas inspeções. Os usuários do Plano de Ação são notificados por e-mail.
          </p>
        </div>
        <div className="flex flex-col gap-1 mb-3">
          <label className="text-xs font-semibold text-gray-600">Responsável *</label>
          <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300" />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setEstornoTarget(null); setResponsavel('') }}>Cancelar</Button>
          <Button variant="primary" onClick={handleEstorno} disabled={!responsavel || enviando}>
            {enviando ? 'Processando…' : 'Confirmar Estorno'}
          </Button>
        </div>
      </Modal>

      {/* Modal enviar para quarentena */}
      <Modal open={!!quarentenaTarget} onClose={() => { setQuarentenaTarget(null); setResponsavel('') }} title="Enviar para Quarentena">
        <p className="text-sm text-gray-600 mb-3">
          Enviando <strong>{quarentenaTarget?.sku}</strong> — {quarentenaTarget?.descricao}
        </p>
        <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 mb-4">
          <p className="text-xs text-purple-700">
            O item sai dos segregados e vai para <strong>Produtos em Quarentena</strong>, onde aguardará
            devolução ao fornecedor ou descarte. O saldo é mantido até a resolução.
          </p>
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-600">Responsável *</label>
          <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setQuarentenaTarget(null); setResponsavel('') }}>Cancelar</Button>
          <Button variant="primary" onClick={handleQuarentena} disabled={!responsavel || enviando}>
            {enviando ? 'Enviando…' : 'Enviar para Quarentena'}
          </Button>
        </div>
      </Modal>

      {/* Modal resolver quarentena (devolução/descarte) */}
      <Modal open={!!resolverQuar} onClose={() => { setResolverQuar(null); setResponsavel('') }} title={resolverQuar?.motivo ?? 'Resolver Quarentena'}>
        <p className="text-sm text-gray-600 mb-3">
          <strong>{resolverQuar?.motivo}</strong> de <strong>{resolverQuar?.sku}</strong> — {resolverQuar?.descricao}
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
          <p className="text-xs text-amber-700">
            Todos os itens deste produto em quarentena
            {' '}({quarentenaItens.filter(i => i.sku === resolverQuar?.sku).reduce((s, i) => s + i.quantidade, 0)} un
            em {quarentenaItens.filter(i => i.sku === resolverQuar?.sku).length} posição(ões)) irão para
            <strong> Bloqueios e Perdas</strong> com o motivo <strong>{resolverQuar?.motivo}</strong>,
            aguardando a <strong>logística lançar a NF</strong> para a baixa efetiva.
          </p>
        </div>
        <div className="flex flex-col gap-1 mb-6">
          <label className="text-xs font-semibold text-gray-600">Responsável *</label>
          <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do responsável"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => { setResolverQuar(null); setResponsavel('') }}>Cancelar</Button>
          <Button variant="danger" onClick={handleResolverQuar} disabled={!responsavel || enviando}>
            {enviando ? 'Processando…' : `Confirmar ${resolverQuar?.motivo === 'Descarte' ? 'Descarte' : 'Devolução'}`}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
