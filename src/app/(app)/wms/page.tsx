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

  const [status, setStatus] = useState<{ atualizados: number; criados: number; erros: number } | null>(null)
  const [loading, setLoading] = useState(false)

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
    setLoading(true)
    setStatus(null)

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
      const validade = excelSerialToISO(r['validade'] ?? r['ValidadeNova']) ?? '9999-12-31'
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
      descricao: `Importação de endereços: ${atualizados} atualizados, ${criados} criados, ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setStatus({ atualizados, criados, erros })
    setLoading(false)
    fetchItens()
    toast(`Importação concluída: ${atualizados} atualizados, ${criados} criados`)
    if (valRef.current) valRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Importação de Endereços</h1>
        <p className="text-sm text-gray-400">Carregue a planilha do WMS para atualizar endereços, quantidades e validades</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 text-sm">Atualizar a partir do WMS</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Picking (nível = 0): atualiza validade e saldo · Pulmão (nível &gt; 0): cadastra posição · Qtde negativa → zero
          </p>
        </div>
        <div className="p-6 flex flex-col gap-5">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-600">Arquivo esperado: <span className="font-mono font-bold">Validades WMS.xls</span></p>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-500 font-mono">
              <span>· idProduto</span><span>· Descricao</span>
              <span>· Rua</span><span>· Predio</span>
              <span>· Nivel</span><span>· Apartamento</span>
              <span>· Qtde</span><span>· ValidadeNova</span>
            </div>
          </div>

          <input ref={valRef} type="file" accept=".xls,.xlsx" onChange={processarValidades} className="hidden" />

          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="primary" onClick={() => valRef.current?.click()} disabled={loading}>
              {loading ? '⏳ Processando…' : '📋 Carregar planilha'}
            </Button>
            {status && (
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-semibold">✓ {status.atualizados} atualizados</span>
                <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">+ {status.criados} criados</span>
                {status.erros > 0 && <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">✕ {status.erros} erros</span>}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-4">
            Endereços já cadastrados são atualizados (validade + quantidade). Endereços novos são criados com lote <span className="font-mono">S/L</span>.
            Para ajustes pontuais, use a aba <strong>Estoque</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}
