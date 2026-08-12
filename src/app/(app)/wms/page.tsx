'use client'
import { useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { useToast } from '@/components/layout/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { semControleValidade, fmtDate } from '@/lib/utils'
import { usePerfílContext } from '@/lib/perfil-context'

// Resolução de um conflito de endereço escolhida pelo usuário
type ResolucaoTipo = 'ambos' | 'excluir_existente' | 'descartar'

// Item ativo já cadastrado (campos usados na análise de ocupação)
interface ItemLite {
  id: string; sku: string; descricao: string
  endereco_frac: string; endereco_gran: string; quantidade: number; validade: string
}

// Item candidato vindo da planilha
interface Incoming {
  sku: string; descricao: string; endereco: string; isPicking: boolean
  quantidade: number | null; validadeISO: string | null
}

// Endereço já ocupado por produto(s) diferente(s)
interface Conflito {
  id: string
  incoming: Incoming
  existentes: { id: string; sku: string; descricao: string; endereco: string; quantidade: number; validade: string }[]
}

interface Plano {
  criar: Incoming[]
  atualizar: { id: string; quantidade: number | null; validadeISO: string | null }[]
  conflitos: Conflito[]
  ignoradas: number; excluidos: number; semValidade: number; exemploInvalido: string; total: number
}

export default function WmsPage() {
  const { fetchItens } = useItens()
  const { toast } = useToast()
  const { can } = usePerfílContext()
  const valRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<{
    atualizados: number; criados: number; erros: number; ignoradas: number
    semValidade: number; excluidos: number; exemploInvalido: string; total: number
    conflitos: number; excluidosConflito: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null)
  // Plano pendente de aplicação quando há conflitos de endereço a resolver
  const [plano, setPlano] = useState<Plano | null>(null)
  const [resolucoes, setResolucoes] = useState<Record<string, ResolucaoTipo>>({})

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

  // Carrega os itens que OCUPAM endereço (todos menos os baixados), paginado.
  const carregarOcupacao = async (): Promise<ItemLite[]> => {
    const todos: ItemLite[] = []
    const pag = 1000
    for (let off = 0; ; off += pag) {
      const { data, error } = await supabase
        .from('itens')
        .select('id,sku,descricao,endereco_frac,endereco_gran,quantidade,validade')
        .neq('status', 'baixado')
        .range(off, off + pag - 1)
      if (error || !data) break
      todos.push(...(data as ItemLite[]))
      if (data.length < pag) break
    }
    return todos
  }

  // Executa o plano (atualizações, criações e resoluções de conflito)
  const aplicarPlano = async (p: Plano, resol: Record<string, ResolucaoTipo>) => {
    setLoading(true)
    setPlano(null)
    const { data: { user } } = await supabase.auth.getUser()

    const inserir = async (c: Incoming) =>
      (await supabase.from('itens').insert({
        sku: c.sku, descricao: c.descricao || '(sem descrição)', lote: 'S/L',
        endereco_frac: c.isPicking ? c.endereco : '',
        endereco_gran: c.isPicking ? '' : c.endereco,
        quantidade: c.quantidade ?? 0, validade: c.validadeISO ?? '9999-12-31',
        status: 'ativo', user_id: user!.id,
      })).error

    let atualizados = 0, criados = 0, excluidosConflito = 0, erros = 0
    const totalOps = p.atualizar.length + p.criar.length + p.conflitos.length
    let done = 0
    setProgresso({ atual: 0, total: totalOps })

    // Mesmo produto no mesmo endereço → só quantidade e validade
    for (const u of p.atualizar) {
      const { error } = await supabase.from('itens').update({
        ...(u.quantidade !== null ? { quantidade: u.quantidade } : {}),
        ...(u.validadeISO ? { validade: u.validadeISO } : {}),
      }).eq('id', u.id)
      if (error) { erros++ } else { atualizados++ }
      setProgresso({ atual: ++done, total: totalOps })
    }
    // Endereços livres → cria
    for (const c of p.criar) {
      const error = await inserir(c)
      if (error) { erros++ } else { criados++ }
      setProgresso({ atual: ++done, total: totalOps })
    }
    // Conflitos → conforme a decisão do usuário
    for (const cf of p.conflitos) {
      const res = resol[cf.id] ?? 'descartar'
      if (res !== 'descartar') {
        if (res === 'excluir_existente') {
          for (const ex of cf.existentes) {
            const { error } = await supabase.from('itens').delete().eq('id', ex.id)
            if (error) { erros++ } else { excluidosConflito++ }
          }
        }
        // 'ambos' e 'excluir_existente' inserem o item novo
        const error = await inserir(cf.incoming)
        if (error) { erros++ } else { criados++ }
      }
      setProgresso({ atual: ++done, total: totalOps })
    }

    await supabase.from('historico').insert({
      descricao: `Importação: ${p.total} linhas — ${atualizados} atualizados, ${criados} criados${excluidosConflito ? `, ${excluidosConflito} excluídos (conflito)` : ''}, ${p.conflitos.length} conflitos, ${p.excluidos} fora do controle, ${p.ignoradas} ignoradas, ${p.semValidade} sem validade, ${erros} erros`,
      responsavel: user!.email ?? 'sistema',
      user_id: user!.id,
    })

    setStatus({ atualizados, criados, erros, ignoradas: p.ignoradas, semValidade: p.semValidade, excluidos: p.excluidos, exemploInvalido: p.exemploInvalido, total: p.total, conflitos: p.conflitos.length, excluidosConflito })
    setProgresso(null)
    setLoading(false)
    fetchItens()
    toast(`Importação concluída: ${atualizados} atualizados, ${criados} criados`)
    if (valRef.current) valRef.current.value = ''
  }

  const processarValidades = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setStatus(null)
    setPlano(null)

    const { read, utils } = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = read(buf)
    const rows = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })

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
    // Coluna de quantidade — aceita Qtde, Qtd ou Quantidade
    const qtdCol = ['Qtde', 'Qtd', 'Quantidade'].find(n => headerMap.has(normCol(n)))

    // Índice de ocupação: endereço → itens que ocupam a posição
    const atuais = await carregarOcupacao()
    const porEndereco = new Map<string, ItemLite[]>()
    for (const it of atuais) {
      for (const e2 of [it.endereco_frac, it.endereco_gran]) {
        if (e2 && String(e2).trim()) {
          const a = porEndereco.get(e2) ?? []
          a.push(it); porEndereco.set(e2, a)
        }
      }
    }

    const criar: Incoming[] = []
    const atualizar: Plano['atualizar'] = []
    const conflitos: Conflito[] = []
    let ignoradas = 0, excluidos = 0, semValidade = 0, exemploInvalido = ''

    for (const r of rows) {
      const sku = String(col(r, 'idProduto') ?? '').trim()

      // Quantidade: célula vazia é desconsiderada (mantém saldo); negativo vira zero.
      const qtdeCell = qtdCol ? col(r, qtdCol) : undefined
      const qtdeVazia = qtdeCell === '' || qtdeCell === null || qtdeCell === undefined
      const qtdeNum = Number(qtdeCell)
      const quantidade = qtdeVazia || isNaN(qtdeNum) ? null : Math.max(0, qtdeNum)

      let descricao: string, endereco: string, nivel: string
      let validadeRaw: unknown, validadeISO: string | null

      if (layoutTransPallet) {
        descricao = String(col(r, 'Produto') ?? col(r, 'Descricao') ?? '').trim()
        const p = String(col(r, 'Endereco') ?? '').trim().split(/[.\-]/)
        nivel = String(p[2] ?? '').replace(/^0+(?=\d)/, '').trim()
        endereco = fmtEnd(p[0], p[1], p[2], p[3])
        validadeRaw = col(r, 'ValidadeTransPallet')
        validadeISO = excelSerialToISO(validadeRaw, true)
      } else {
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
      if (semControleValidade(descricao)) { excluidos++; continue }
      if (!validadeISO) {
        semValidade++
        const raw = String(validadeRaw ?? '').trim()
        if (!exemploInvalido && raw) exemploInvalido = raw
      }

      const ocupantes = porEndereco.get(endereco) ?? []
      const mesmo = ocupantes.find(o => o.sku === sku)
      const incoming: Incoming = { sku, descricao, endereco, isPicking, quantidade, validadeISO }

      if (mesmo) {
        atualizar.push({ id: mesmo.id, quantidade, validadeISO })
      } else if (ocupantes.length > 0) {
        conflitos.push({
          id: `c${conflitos.length}`,
          incoming,
          existentes: ocupantes.map(o => ({ id: o.id, sku: o.sku, descricao: o.descricao, endereco, quantidade: o.quantidade, validade: o.validade })),
        })
      } else {
        criar.push(incoming)
      }
    }

    const novoPlano: Plano = { criar, atualizar, conflitos, ignoradas, excluidos, semValidade, exemploInvalido, total: rows.length }

    if (conflitos.length === 0) {
      await aplicarPlano(novoPlano, {})
    } else {
      // Sem conflitos resolvidos ainda: padrão seguro é "descartar" (mantém o existente)
      const padrao: Record<string, ResolucaoTipo> = {}
      for (const c of conflitos) padrao[c.id] = 'descartar'
      setResolucoes(padrao)
      setPlano(novoPlano)
      setLoading(false)
      if (valRef.current) valRef.current.value = ''
    }
  }

  const definirTodasResolucoes = (tipo: ResolucaoTipo) => {
    if (!plano) return
    const novo: Record<string, ResolucaoTipo> = {}
    for (const c of plano.conflitos) novo[c.id] = tipo
    setResolucoes(novo)
  }

  const cancelarImportacao = () => {
    setPlano(null)
    setResolucoes({})
    toast('Importação cancelada', 'info')
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
            <p className="text-[11px] text-gray-400">
              Detecta o formato automaticamente pelo cabeçalho. Quantidade aceita <span className="font-mono">Qtde</span>, <span className="font-mono">Qtd</span> ou <span className="font-mono">Quantidade</span> (opcional).
              Endereço já ocupado por <strong>outro produto</strong> abre uma janela para você decidir.
            </p>
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
                {status.conflitos > 0 && <span className="bg-orange-50 text-orange-700 px-2 py-1 rounded font-semibold">⚠ {status.conflitos} conflito(s)</span>}
                {status.excluidosConflito > 0 && <span className="bg-red-50 text-red-700 px-2 py-1 rounded font-semibold">🗑 {status.excluidosConflito} excluídos</span>}
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

      {/* Modal de conflitos de endereço */}
      <Modal open={!!plano} onClose={cancelarImportacao} title={`Conflitos de endereço (${plano?.conflitos.length ?? 0})`} maxWidth="max-w-3xl">
        <p className="text-sm text-gray-600 mb-3">
          Estes endereços já estão ocupados por <strong>outro produto</strong>. Escolha o que fazer em cada um.
          <span className="text-gray-400"> Produtos iguais (mesmo código no mesmo endereço) já foram atualizados automaticamente.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="text-gray-500">Aplicar a todos:</span>
          <button onClick={() => definirTodasResolucoes('descartar')} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Descartar novos</button>
          <button onClick={() => definirTodasResolucoes('ambos')} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Manter os dois</button>
          <button onClick={() => definirTodasResolucoes('excluir_existente')} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Substituir todos</button>
        </div>
        <div className="flex flex-col gap-3 max-h-[50vh] overflow-auto pr-1">
          {plano?.conflitos.map(cf => {
            const sel = resolucoes[cf.id] ?? 'descartar'
            const opt = (tipo: ResolucaoTipo, label: string) => (
              <button
                onClick={() => setResolucoes(prev => ({ ...prev, [cf.id]: tipo }))}
                className={`px-2.5 py-1 rounded text-xs font-semibold border ${sel === tipo ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >{label}</button>
            )
            return (
              <div key={cf.id} className="border border-gray-200 rounded-lg p-3">
                <div className="font-mono text-xs font-bold text-gray-700 mb-2">📍 {cf.incoming.endereco}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-gray-50 border border-gray-100 p-2">
                    <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">No sistema</div>
                    {cf.existentes.map(ex => (
                      <div key={ex.id} className="leading-tight mb-1 last:mb-0">
                        <span className="font-mono font-bold text-gray-800">{ex.sku}</span> · <span className="text-gray-600">{ex.descricao}</span>
                        <div className="text-[10px] text-gray-400 font-mono">qtd {ex.quantidade} · {fmtDate(ex.validade)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded bg-blue-50 border border-blue-100 p-2">
                    <div className="text-[10px] uppercase text-blue-400 font-semibold mb-1">Na planilha (novo)</div>
                    <span className="font-mono font-bold text-gray-800">{cf.incoming.sku}</span> · <span className="text-gray-600">{cf.incoming.descricao}</span>
                    <div className="text-[10px] text-gray-400 font-mono">qtd {cf.incoming.quantidade ?? '—'} · {cf.incoming.validadeISO ? fmtDate(cf.incoming.validadeISO) : '—'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {opt('descartar', 'Descartar novo')}
                  {opt('ambos', 'Manter os dois')}
                  {opt('excluir_existente', 'Excluir existente')}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-3 mt-4 border-t border-gray-100 pt-4">
          <Button variant="ghost" onClick={cancelarImportacao}>Cancelar importação</Button>
          <Button variant="primary" onClick={() => plano && aplicarPlano(plano, resolucoes)}>Aplicar importação</Button>
        </div>
      </Modal>
    </div>
  )
}
