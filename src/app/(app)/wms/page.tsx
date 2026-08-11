'use client'
import { useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { semControleValidade } from '@/lib/utils'
import { usePerfílContext } from '@/lib/perfil-context'

export default function WmsPage() {
  const { fetchItens } = useItens()
  const { toast } = useToast()
  const { can } = usePerfílContext()
  const valRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<{
    atualizados: number; criados: number; erros: number; ignoradas: number
    semValidade: number; excluidos: number; exemploInvalido: string; total: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null)

  // mdy=true interpreta datas com barra/traço como Mês/Dia/Ano (padrão americano,
  // ex.: planilha "Validades" com coluna ValidadeTransPallet "7/26/27" = 26/07/2027).
  function excelSerialToISO(v: unknown, mdy = false): string | null {
    if (v === null || v === undefined || v === '') return null

    // Date object (algumas leituras do xlsx retornam Date)
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    }

    // Número serial do Excel — aceita número ou texto numérico ("46234", "46234,5")
    const n = typeof v === 'number'
      ? v
      : (/^\d+([.,]\d+)?$/.test(String(v).trim()) ? parseFloat(String(v).trim().replace(',', '.')) : NaN)
    if (!isNaN(n) && n > 10000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000))
      return d.toISOString().split('T')[0]
    }

    const s = String(v).trim()

    // DD/MM/AAAA (ou M/D/AA se mdy) — com ou sem hora depois
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(\s.*)?$/)
    if (m) {
      const dia = (mdy ? m[2] : m[1]).padStart(2, '0')
      const mes = (mdy ? m[1] : m[2]).padStart(2, '0')
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3]
      const iso = `${ano}-${mes}-${dia}`
      return isNaN(new Date(iso).getTime()) ? null : iso
    }

    // DD-MM-AAAA (ou M-D-AAAA se mdy)
    m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(\s.*)?$/)
    if (m) {
      const dia = (mdy ? m[2] : m[1]).padStart(2, '0')
      const mes = (mdy ? m[1] : m[2]).padStart(2, '0')
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3]
      const iso = `${ano}-${mes}-${dia}`
      return isNaN(new Date(iso).getTime()) ? null : iso
    }

    // AAAA-MM-DD (ISO)
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([T\s].*)?$/)
    if (m) {
      const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      return isNaN(new Date(iso).getTime()) ? null : iso
    }

    return null
  }

  // Monta endereço no padrão "R - P - N - A" — segmento vazio vira 0, sem zeros à esquerda
  function fmtEnd(rua: unknown, pred: unknown, niv: unknown, apto: unknown) {
    const partes = [rua, pred, niv, apto].map(v => String(v ?? '').trim())
    if (partes.every(p => !p)) return ''
    return partes.map(p => (p || '0').replace(/^0+(?=\d)/, '')).join(' - ')
  }

  // Normaliza nome de coluna: minúsculas, sem acentos, sem espaços
  function normCol(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '')
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

    // Mapa de cabeçalhos normalizado — aceita "Descrição", "descricao", "DESCRICAO" etc.
    const headerMap = new Map<string, string>()
    for (const k of Object.keys(rows[0] ?? {})) headerMap.set(normCol(k), k)
    const col = (r: Record<string, unknown>, nome: string): unknown => {
      const key = headerMap.get(normCol(nome))
      return key !== undefined ? r[key] : undefined
    }

    // Layout "TransPallet" (planilha Validades): coluna única "Endereco" separada
    // por pontos (04.101.02.000), "ValidadeTransPallet" em M/D/AA e "Produto".
    // O formato padrão usa colunas Rua/Predio/Nivel — na dúvida, ele prevalece.
    const layoutTransPallet =
      headerMap.has(normCol('ValidadeTransPallet')) ||
      (headerMap.has(normCol('Endereco')) && !headerMap.has(normCol('Rua')))

    let atualizados = 0, criados = 0, erros = 0, ignoradas = 0, semValidade = 0, excluidos = 0
    let exemploInvalido = ''
    let linha = 0
    setProgresso({ atual: 0, total: rows.length })

    for (const r of rows) {
      linha++
      setProgresso({ atual: linha, total: rows.length })
      const sku = String(col(r, 'idProduto') ?? '').trim()

      // Quantidade: célula vazia é desconsiderada (mantém saldo do sistema);
      // valor presente é aplicado, negativo vira zero.
      const qtdeCell = col(r, 'Qtde')
      const qtdeVazia = qtdeCell === '' || qtdeCell === null || qtdeCell === undefined
      const qtdeNum = Number(qtdeCell)
      const quantidade = qtdeVazia || isNaN(qtdeNum) ? null : Math.max(0, qtdeNum)

      let descricao: string, endereco: string, nivel: string
      let validadeRaw: unknown, validadeISO: string | null

      if (layoutTransPallet) {
        // Produto + Endereco (04.101.02.000) + ValidadeTransPallet (M/D/AA)
        descricao = String(col(r, 'Produto') ?? col(r, 'Descricao') ?? '').trim()
        const p = String(col(r, 'Endereco') ?? '').trim().split(/[.\-]/)
        nivel = String(p[2] ?? '').replace(/^0+(?=\d)/, '').trim()
        endereco = fmtEnd(p[0], p[1], p[2], p[3])
        validadeRaw = col(r, 'ValidadeTransPallet')
        validadeISO = excelSerialToISO(validadeRaw, true)
      } else {
        // Layout padrão: colunas Rua/Predio/Nivel/Apartamento + validade DD/MM/AAAA
        descricao = String(col(r, 'Descricao') ?? col(r, 'Produto') ?? '').trim()
        const rua = String(col(r, 'Rua') ?? '').trim()
        const predio = String(col(r, 'Predio') ?? '').trim()
        nivel = String(col(r, 'Nivel') ?? '').trim()
        const apto = String(col(r, 'Apartamento') ?? '').trim()
        endereco = fmtEnd(rua, predio, nivel, apto)
        validadeRaw = col(r, 'validade') || col(r, 'ValidadeNova')
        validadeISO = excelSerialToISO(validadeRaw)
      }
      const isPicking = (nivel || '0') === '0'

      if (!sku || !endereco) { ignoradas++; continue }

      // Bebidas de validade indeterminada (destilados/afins): não entram no controle
      // via importação. A inspeção continua livre para registrar qualquer item.
      if (semControleValidade(descricao)) { excluidos++; continue }

      if (!validadeISO) {
        semValidade++
        const raw = String(validadeRaw ?? '').trim()
        if (!exemploInvalido && raw) exemploInvalido = raw
      }

      const { data: existentes } = await supabase
        .from('itens')
        .select('id')
        .eq('sku', sku)
        .or(`endereco_frac.eq.${endereco},endereco_gran.eq.${endereco}`)
        .limit(1)

      if (existentes && existentes.length > 0) {
        // Célula vazia (qtde/validade/descrição) nunca sobrescreve o cadastro existente
        const { error } = await supabase.from('itens').update({
          ...(quantidade !== null ? { quantidade } : {}),
          ...(validadeISO ? { validade: validadeISO } : {}),
          ...(descricao ? { descricao } : {}),
        }).eq('id', existentes[0].id)
        if (error) erros++
        else atualizados++
      } else {
        const { error } = await supabase.from('itens').insert({
          sku, descricao: descricao || '(sem descrição)', lote: 'S/L',
          endereco_frac: isPicking ? endereco : '',
          endereco_gran: isPicking ? '' : endereco,
          quantidade: quantidade ?? 0, validade: validadeISO ?? '9999-12-31', status: 'ativo', user_id: user!.id,
        })
        if (error) erros++
        else criados++
      }
    }

    await supabase.from('historico').insert({
      descricao: `Importação de endereços: ${rows.length} linhas — ${atualizados} atualizados, ${criados} criados, ${excluidos} fora do controle, ${ignoradas} ignoradas, ${semValidade} sem validade válida, ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setStatus({ atualizados, criados, erros, ignoradas, semValidade, excluidos, exemploInvalido, total: rows.length })
    setProgresso(null)
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
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-gray-600">Formato 1 — <span className="font-mono font-bold">Validades WMS.xls</span></p>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-500 font-mono">
                <span>· idProduto</span><span>· Descricao</span>
                <span>· Rua</span><span>· Predio</span>
                <span>· Nivel</span><span>· Apartamento</span>
                <span>· Qtde</span><span>· ValidadeNova</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 border-t border-gray-200 pt-3">
              <p className="text-xs font-semibold text-gray-600">Formato 2 — <span className="font-mono font-bold">Validades.xls</span> <span className="font-normal text-gray-400">(pulmão)</span></p>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-500 font-mono">
                <span>· idProduto</span><span>· Produto</span>
                <span>· Endereco <span className="text-gray-400">(04.101.02.000)</span></span><span>· ValidadeTransPallet</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400">O sistema detecta o formato automaticamente pelo cabeçalho.</p>
          </div>

          <input ref={valRef} type="file" accept=".xls,.xlsx" onChange={processarValidades} className="hidden" />

          {/* Progresso da importação */}
          {loading && progresso && progresso.total > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-blue-700">Importando…</span>
                <span className="font-mono font-bold text-blue-600">
                  {progresso.atual} / {progresso.total} linhas · {Math.round((progresso.atual / progresso.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-blue-100">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-150"
                  style={{ width: `${(progresso.atual / progresso.total) * 100}%` }}
                />
              </div>
              <p className="text-[11px] text-blue-400">Não feche esta tela durante a importação</p>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="primary" onClick={() => valRef.current?.click()} disabled={loading || !can('wms.importar')}>
              {loading ? '⏳ Processando…' : '📋 Carregar planilha'}
            </Button>
            {!can('wms.importar') && <span className="text-xs text-gray-400">Sem permissão para importar</span>}
            {status && (
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded font-semibold">{status.total} linhas</span>
                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-semibold">✓ {status.atualizados} atualizados</span>
                <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-semibold">+ {status.criados} criados</span>
                {status.excluidos > 0 && <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded font-semibold">🚫 {status.excluidos} fora do controle</span>}
                {status.ignoradas > 0 && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded font-semibold">⊘ {status.ignoradas} ignoradas</span>}
                {status.semValidade > 0 && (
                  <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded font-semibold">
                    ⚠ {status.semValidade} sem validade válida{status.exemploInvalido ? ` (ex: "${status.exemploInvalido}")` : ''}
                  </span>
                )}
                {status.erros > 0 && <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">✕ {status.erros} erros</span>}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
            <p className="text-[11px] text-gray-400">
              Endereços já cadastrados são atualizados (validade + quantidade). Endereços novos são criados com lote <span className="font-mono">S/L</span>.
              Para ajustes pontuais, use a aba <strong>Estoque</strong>.
            </p>
            <p className="text-[11px] text-purple-500">
              🚫 <strong>Fora do controle:</strong> destilados e bebidas de validade indeterminada (whisky, gin, vodka, cachaça,
              aguardente, rum, conhaque, tequila, vinho, aperitivo, espumante/champagne com álcool, catuaba, Licor 43, Amarula)
              são pulados na importação. Exceções com validade (sem álcool, coquetéis, RTD/lata) entram normalmente.
              <strong> A inspeção não é afetada</strong> — o inspetor pode cadastrar qualquer item.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
