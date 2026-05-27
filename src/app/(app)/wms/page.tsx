'use client'
import { useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'

export default function WmsPage() {
  const { fetchItens } = useItens()
  const { toast } = useToast()
  const valRef = useRef<HTMLInputElement>(null)
  const movRef = useRef<HTMLInputElement>(null)

  const [wmsValStatus, setWmsValStatus] = useState<{ atualizados: number; criados: number; erros: number } | null>(null)
  const [wmsMovStatus, setWmsMovStatus] = useState<{ processados: number; entradas: number; saidas: number; movs: number; erros: number; ignorados: number } | null>(null)
  const [loadingWmsVal, setLoadingWmsVal] = useState(false)
  const [loadingWmsMov, setLoadingWmsMov] = useState(false)

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

      const { data: existentes } = await supabase
        .from('itens')
        .select('id')
        .eq('sku', sku)
        .or(`endereco_frac.eq.${endereco},endereco_gran.eq.${endereco}`)
        .limit(1)

      if (existentes && existentes.length > 0) {
        const { error } = await supabase.from('itens').update({ validade, quantidade, descricao }).eq('id', existentes[0].id)
        if (error) erros++
        else atualizados++
      } else {
        const { error } = await supabase.from('itens').insert({
          sku, descricao, lote: 'S/L',
          endereco_frac: isPicking ? endereco : '',
          endereco_gran: isPicking ? '' : endereco,
          quantidade, validade, status: 'ativo', user_id: user!.id,
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
    toast(`Validades processadas: ${atualizados} atualizados, ${criados} criados`)
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

    const iTipoMovto=4, iProxTarefa=5
    const iRuaOrig=7, iPredOrig=8, iNivOrig=9, iAptoOrig=10
    const iRuaDest=13, iPredDest=14, iNivDest=15, iAptoDest=16
    const iIdProduto=19, iQtde=21

    const ENTRADA = ['Recebimento', 'Retorno']
    const SAIDA = ['Separacao-Fracionado', 'Separacao-Grandeza']
    const MOV = ['Transferencia', 'Reposicao']

    const concluidos = dataRows.filter(r => String(r[iProxTarefa]).toLowerCase() === 'concluido')

    const { data: itensCadastrados } = await supabase.from('itens').select('sku')
    const skusCadastrados = new Set((itensCadastrados ?? []).map(i => String(i.sku)))

    let processados = 0, entradas = 0, saidas = 0, movs = 0, erros = 0, ignorados = 0

    const findItem = async (sku: string, endereco: string) => {
      const { data } = await supabase
        .from('itens').select('id, quantidade')
        .eq('sku', sku)
        .or(`endereco_frac.eq.${endereco},endereco_gran.eq.${endereco}`)
        .limit(1)
      return data?.[0] ?? null
    }

    const upsertEndereco = async (sku: string, endereco: string, delta: number) => {
      if (!endereco || endereco.startsWith('0 -')) return
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
      if (!skusCadastrados.has(sku)) { ignorados++; continue }

      try {
        if (ENTRADA.includes(tipo)) { await upsertEndereco(sku, endDest, +qtde); entradas++ }
        else if (SAIDA.includes(tipo)) { await upsertEndereco(sku, endOrig, -qtde); saidas++ }
        else if (MOV.includes(tipo)) { await upsertEndereco(sku, endOrig, -qtde); await upsertEndereco(sku, endDest, +qtde); movs++ }
        processados++
      } catch { erros++ }
    }

    await supabase.from('historico').insert({
      descricao: `WMS Movimentações: ${processados} processadas — ${entradas} entradas, ${saidas} saídas, ${movs} movs, ${ignorados} ignorados, ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setWmsMovStatus({ processados, entradas, saidas, movs, erros, ignorados })
    setLoadingWmsMov(false)
    fetchItens()
    toast(`Movimentações processadas: ${processados} aplicadas`)
    if (movRef.current) movRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">WMS</h1>
        <p className="text-sm text-gray-400">Processamento de relatórios do sistema de armazém</p>
      </div>

      {/* Atualizar Validades */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-sm">1. Atualizar Validades</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Picking (nível=0): atualiza validade e saldo · Pulmão (nível &gt; 0): cadastra posição · Qtde negativa → zero
          </p>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono">
            Arquivo esperado: <strong>Validades WMS.xls</strong><br />
            Colunas: Rua · Predio · Nivel · Apartamento · idProduto · Descricao · Qtde · ValidadeNova
          </div>
          <input ref={valRef} type="file" accept=".xls,.xlsx" onChange={processarValidades} className="hidden" />
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="primary" onClick={() => valRef.current?.click()} disabled={loadingWmsVal}>
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
      </div>

      {/* Processar Movimentações */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-sm">2. Processar Movimentações</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Apenas movimentações com status <strong>Concluído</strong> · Produtos sem cadastro são ignorados
          </p>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            <div className="bg-green-50 rounded-lg p-3 text-center border border-green-100">
              <div className="font-bold text-green-700 mb-1">ENTRADA</div>
              <div className="text-green-600">Recebimento</div>
              <div className="text-green-600">Retorno</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center border border-red-100">
              <div className="font-bold text-red-700 mb-1">SAÍDA</div>
              <div className="text-red-600">Separação Frac.</div>
              <div className="text-red-600">Separação Gran.</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-100">
              <div className="font-bold text-blue-700 mb-1">MOVIMENTAÇÃO</div>
              <div className="text-blue-600">Transferência</div>
              <div className="text-blue-600">Reposição</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono">
            Arquivo esperado: <strong>Movimentação WMS.xls</strong>
          </div>
          <input ref={movRef} type="file" accept=".xls,.xlsx" onChange={processarMovimentacoes} className="hidden" />
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="primary" onClick={() => movRef.current?.click()} disabled={loadingWmsMov}>
              {loadingWmsMov ? '⏳ Processando…' : '🔄 Carregar Movimentações WMS'}
            </Button>
            {wmsMovStatus && (
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded font-semibold">{wmsMovStatus.processados} processadas</span>
                <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">↑ {wmsMovStatus.entradas} entradas</span>
                <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">↓ {wmsMovStatus.saidas} saídas</span>
                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-semibold">⇄ {wmsMovStatus.movs} movs.</span>
                {wmsMovStatus.ignorados > 0 && <span className="bg-gray-50 text-gray-400 px-2 py-1 rounded font-semibold border">⊘ {wmsMovStatus.ignorados} ignorados</span>}
                {wmsMovStatus.erros > 0 && <span className="bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">✕ {wmsMovStatus.erros} erros</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
