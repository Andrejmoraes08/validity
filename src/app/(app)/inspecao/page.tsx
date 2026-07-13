'use client'
import { useMemo, useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { useInspecao, type EntradaFila } from '@/hooks/useInspecao'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { getZone, diasParaVencer } from '@/lib/zones'
import { fmtDateTime } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/layout/Toast'
import type { Item, ZoneName } from '@/lib/types'

const ZONAS: { name: ZoneName; label: string; color: string; bg: string }[] = [
  { name: 'vencido',  label: 'Vencido',       color: '#1a1d24', bg: 'rgba(26,29,36,.08)'   },
  { name: 'vermelho', label: 'Crítico <30d',   color: '#dc2626', bg: 'rgba(220,38,38,.08)'  },
  { name: 'amarelo',  label: 'Atenção 30-90d', color: '#d4a017', bg: 'rgba(212,160,23,.10)' },
  { name: 'verde',    label: 'Seguro 90-180d', color: '#16a34a', bg: 'rgba(22,163,74,.08)'  },
  { name: 'azul',     label: 'OK >180d',       color: '#1f6feb', bg: 'rgba(31,111,235,.08)' },
]

function extrairRua(endereco: string): string {
  if (!endereco) return ''
  // Formato: "1 - 2 - 0" → rua "1"
  return endereco.split('-')[0].trim()
}

const novoItemVazio = {
  sku: '', descricao: '', lote: '', tipo: 'frac' as 'frac' | 'gran',
  endereco: '', quantidade: '', validadeTexto: '', validadeISO: '',
}

export default function InspecaoPage() {
  const { itens, loading, addItem } = useItens()
  const { state, iniciar, confirmar, baixarEndereco, reiniciar, registrarExtra } = useInspecao()
  const { toast } = useToast()
  const [responsavel, setResponsavel] = useState('')
  const [validadeEncontrada, setValidadeEncontrada] = useState('') // ISO YYYY-MM-DD
  const [validadeTexto, setValidadeTexto] = useState('')           // exibição DD/MM/AAAA
  const [obs, setObs] = useState('')
  const [foto, setFoto] = useState<string | undefined>()
  const [processing, setProcessing] = useState(false)
  const [showSegregar, setShowSegregar] = useState(false)
  const [qtdSegregar, setQtdSegregar] = useState('')
  const [showBaixa, setShowBaixa] = useState(false)
  const [validadeConfirmada, setValidadeConfirmada] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Novo endereço durante inspeção ativa: popup mínimo → inspeção complementar
  const [showAddModal, setShowAddModal] = useState(false)
  const [faseComplemento, setFaseComplemento] = useState(false)
  const [novoItem, setNovoItem] = useState(novoItemVazio)
  const [complObs, setComplObs] = useState('')
  const [savingNovo, setSavingNovo] = useState(false)

  // Filtros da tela inicial
  const [ruasSelecionadas, setRuasSelecionadas] = useState<string[]>([])
  const [zonasSelecionadas, setZonasSelecionadas] = useState<ZoneName[]>([])
  const [incluirSaldoZero, setIncluirSaldoZero] = useState(false)

  // Monta fila expandida: cada endereço (frac e gran) é uma entrada independente
  const todasEntradas = useMemo<EntradaFila[]>(() => {
    const parse = (end: string) => end.split('-').map(s => parseInt(s.trim(), 10) || 0)
    const cmp = (a: string, b: string) => {
      const pa = parse(a), pb = parse(b)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (diff !== 0) return diff
      }
      return 0
    }
    const entradas: EntradaFila[] = []
    for (const item of itens.filter(i => i.status === 'ativo')) {
      if (item.endereco_frac) entradas.push({ item, tipo: 'frac', endereco: item.endereco_frac })
      if (item.endereco_gran) entradas.push({ item, tipo: 'gran', endereco: item.endereco_gran })
    }
    return entradas.sort((a, b) => cmp(a.endereco, b.endereco))
  }, [itens])

  // Para contadores e filtros de rua/zona — baseados nos itens únicos
  const ativos = useMemo(() => itens.filter(i => i.status === 'ativo'), [itens])

  const ruas = useMemo(() => {
    const set = new Set<string>()
    for (const e of todasEntradas) {
      const r = extrairRua(e.endereco)
      if (r) set.add(r)
    }
    return Array.from(set).sort((a, b) => Number(a) - Number(b))
  }, [todasEntradas])

  const entradasFiltradas = useMemo(() => {
    return todasEntradas.filter(e => {
      if (!incluirSaldoZero && e.item.quantidade === 0) return false
      if (ruasSelecionadas.length > 0) {
        if (!ruasSelecionadas.includes(extrairRua(e.endereco))) return false
      }
      if (zonasSelecionadas.length > 0) {
        if (!zonasSelecionadas.includes(getZone(e.item.validade).name)) return false
      }
      return true
    })
  }, [todasEntradas, ruasSelecionadas, zonasSelecionadas, incluirSaldoZero])

  const toggleRua = (rua: string) =>
    setRuasSelecionadas(prev => prev.includes(rua) ? prev.filter(r => r !== rua) : [...prev, rua])

  const toggleZona = (zona: ZoneName) =>
    setZonasSelecionadas(prev => prev.includes(zona) ? prev.filter(z => z !== zona) : [...prev, zona])

  const entradaAtual = state.phase === 'active' ? state.fila[state.atual] : null
  const itemAtual = entradaAtual?.item ?? null
  const zonaAtual = itemAtual ? getZone(itemAtual.validade) : null

  // Validade efetiva = o que o inspetor informou (ou a cadastrada se não alterou)
  const validadeEfetiva = validadeEncontrada || (itemAtual?.validade ?? '')
  const zonaEncontrada = validadeEfetiva ? getZone(validadeEfetiva) : null
  const validadeAlterada = !!validadeEncontrada && validadeEncontrada !== itemAtual?.validade
  const zonaEncontradaCritica = zonaEncontrada && (zonaEncontrada.name === 'vermelho' || zonaEncontrada.name === 'vencido')

  // Foto obrigatória somente se houve alteração na validade e a nova zona é vermelha/vencido
  const fotoObrigatoria = validadeAlterada && zonaEncontradaCritica

  const handleValidadeTexto = (raw: string) => {
    // Remove tudo que não é dígito
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    // Aplica máscara DD/MM/AAAA
    let masked = digits
    if (digits.length > 2) masked = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) masked = masked.slice(0, 5) + '/' + digits.slice(4)
    setValidadeTexto(masked)
    setValidadeConfirmada(false)

    // Converte para ISO quando a data estiver completa (8 dígitos)
    if (digits.length === 8) {
      const d = digits.slice(0, 2)
      const m = digits.slice(2, 4)
      const y = digits.slice(4, 8)
      const iso = `${y}-${m}-${d}`
      const date = new Date(iso)
      if (!isNaN(date.getTime())) {
        setValidadeEncontrada(iso)
      } else {
        setValidadeEncontrada('')
      }
    } else {
      setValidadeEncontrada('')
    }
  }

  const limparValidade = () => {
    setValidadeEncontrada('')
    setValidadeTexto('')
    setValidadeConfirmada(false)
  }

  const handleNovoValidadeTexto = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let masked = digits
    if (digits.length > 2) masked = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) masked = masked.slice(0, 5) + '/' + digits.slice(4)
    let iso = ''
    if (digits.length === 8) {
      const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8)
      const date = new Date(`${y}-${m}-${d}`)
      if (!isNaN(date.getTime())) iso = `${y}-${m}-${d}`
    }
    setNovoItem(p => ({ ...p, validadeTexto: masked, validadeISO: iso }))
  }

  // Produto já cadastrado com o mesmo SKU — usado para autopreencher a descrição
  const produtoExistente = useMemo(() => {
    const sku = novoItem.sku.trim()
    if (!sku) return null
    return itens.find(i => i.sku === sku) ?? null
  }, [itens, novoItem.sku])

  // Popup mínimo confirmado → segue para inspeção complementar
  const handleContinuarNovo = () => {
    if (!novoItem.sku || !novoItem.endereco) return
    if (produtoExistente) {
      setNovoItem(p => ({ ...p, descricao: produtoExistente.descricao }))
    }
    setShowAddModal(false)
    setFaseComplemento(true)
  }

  const cancelarComplemento = () => {
    setFaseComplemento(false)
    setNovoItem(novoItemVazio)
    setComplObs('')
  }

  // Inspeção complementar confirmada → cria o item já inspecionado
  const handleConfirmarComplemento = async () => {
    const { sku, descricao, lote, tipo, endereco, quantidade, validadeISO } = novoItem
    if (!descricao || !validadeISO) return
    setSavingNovo(true)
    const now = new Date().toISOString()
    const { error } = await addItem({
      sku, descricao, lote: lote.trim() || 'S/L',
      endereco_frac: tipo === 'frac' ? endereco : '',
      endereco_gran: tipo === 'gran' ? endereco : '',
      quantidade: Number(quantidade) || 0,
      validade: validadeISO,
      status: 'ativo',
      ultima_inspecao: now,
      inspecionado_por: state.responsavel,
      observacao_inspecao: complObs || undefined,
    })
    if (error) {
      toast('Erro ao cadastrar endereço', 'error')
      setSavingNovo(false)
      return
    }
    const { data: novo } = await supabase
      .from('itens').select('*')
      .eq('sku', sku)
      .eq(tipo === 'frac' ? 'endereco_frac' : 'endereco_gran', endereco)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('historico').insert({
      descricao: `Inspeção complementar: ${sku} — endereço ${endereco} localizado fora do programado`,
      responsavel: state.responsavel,
      user_id: user!.id,
    })
    if (novo) {
      registrarExtra({
        entrada: { item: novo as Item, tipo, endereco },
        ok: true,
        acao: 'ok',
        validadeEncontrada: validadeISO,
        validadeAlterada: false,
        obs: complObs,
      })
    }
    toast(`Endereço ${endereco} inspecionado e cadastrado`)
    cancelarComplemento()
    setSavingNovo(false)
  }

  const handleIniciar = () => {
    if (!responsavel || entradasFiltradas.length === 0) return
    iniciar(entradasFiltradas, responsavel)
    limparEstado()
  }

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setFoto(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const limparEstado = () => {
    setValidadeEncontrada('')
    setValidadeTexto('')
    setValidadeConfirmada(false)
    setObs('')
    setFoto(undefined)
    setShowSegregar(false)
    setQtdSegregar('')
    setShowBaixa(false)
  }

  const handleConfirmarOk = async () => {
    if (fotoObrigatoria && !foto) return
    setProcessing(true)
    await confirmar(true, validadeEfetiva, obs, foto)
    limparEstado()
    setProcessing(false)
  }

  const handleConfirmarSegregacao = async () => {
    if (fotoObrigatoria && !foto) return
    if (!qtdSegregar) return
    setProcessing(true)
    await confirmar(false, validadeEfetiva, obs, foto, Number(qtdSegregar))
    limparEstado()
    setProcessing(false)
  }

  const handleBaixaEndereco = async () => {
    setProcessing(true)
    await baixarEndereco(obs)
    limparEstado()
    setProcessing(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // ── TELA INICIAL ──────────────────────────────────────────────
  if (state.phase === 'idle') return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Inspeção de Estoque</h1>
        <p className="text-sm text-gray-400">Filtre por rua e zona antes de iniciar</p>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="text-2xl font-extrabold font-mono text-gray-800">{entradasFiltradas.length}</div>
          <div className="text-xs text-gray-400 mt-1">Endereços</div>
        </div>
        <div className="bg-white rounded-xl border border-blue-50 p-4 shadow-sm">
          <div className="text-2xl font-extrabold font-mono text-blue-600">
            {entradasFiltradas.filter(e => e.tipo === 'frac').length}
          </div>
          <div className="text-xs text-gray-400 mt-1">Fracionado</div>
        </div>
        <div className="bg-white rounded-xl border border-red-50 p-4 shadow-sm">
          <div className="text-2xl font-extrabold font-mono text-red-600">
            {entradasFiltradas.filter(e => diasParaVencer(e.item.validade) < 30).length}
          </div>
          <div className="text-xs text-gray-400 mt-1">Críticos</div>
        </div>
      </div>

      {/* Filtro por Rua */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Filtrar por Rua</span>
          {ruasSelecionadas.length > 0 && (
            <button onClick={() => setRuasSelecionadas([])} className="text-xs text-blue-500 hover:text-blue-700">
              Limpar
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ruas.map(rua => {
            const ativo = ruasSelecionadas.includes(rua)
            return (
              <button
                key={rua}
                onClick={() => toggleRua(rua)}
                className="px-3 py-1.5 rounded-lg text-sm font-mono font-semibold border transition-colors"
                style={ativo
                  ? { background: '#1f6feb', color: '#fff', borderColor: '#1f6feb' }
                  : { background: '#f5f6f8', color: '#5a6070', borderColor: '#e1e4ea' }
                }
              >
                Rua {rua}
              </button>
            )
          })}
          {ruas.length === 0 && <span className="text-xs text-gray-400">Nenhuma rua encontrada</span>}
        </div>
      </div>

      {/* Filtro por Zona */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Filtrar por Zona de Vencimento</span>
          {zonasSelecionadas.length > 0 && (
            <button onClick={() => setZonasSelecionadas([])} className="text-xs text-blue-500 hover:text-blue-700">
              Limpar
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ZONAS.map(z => {
            const ativo = zonasSelecionadas.includes(z.name)
            const count = ativos.filter(i => getZone(i.validade).name === z.name).length
            return (
              <button
                key={z.name}
                onClick={() => toggleZona(z.name)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all"
                style={ativo
                  ? { background: z.color, color: z.name === 'amarelo' ? '#1a1d24' : '#fff', borderColor: z.color }
                  : { background: z.bg, color: z.color, borderColor: z.color + '40' }
                }
              >
                {z.label}
                <span
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: ativo ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.08)' }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Toggle saldo zero */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <label className="flex items-center justify-between cursor-pointer gap-4">
          <div>
            <span className="text-sm font-bold text-gray-700">Incluir itens com saldo zero</span>
            <p className="text-xs text-gray-400 mt-0.5">Endereços ativos sem saldo físico ({todasEntradas.filter(e => e.item.quantidade === 0).length} entradas)</p>
          </div>
          <button
            onClick={() => setIncluirSaldoZero(v => !v)}
            className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
            style={{ background: incluirSaldoZero ? '#1f6feb' : '#d1d5db' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
              style={{ transform: incluirSaldoZero ? 'translateX(20px)' : 'translateX(0)' }}
            />
          </button>
        </label>
      </div>

      {/* Responsável + Iniciar */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Seu nome (responsável) *</label>
          <input
            type="text"
            value={responsavel}
            onChange={e => setResponsavel(e.target.value)}
            placeholder="Nome do inspetor"
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <Button
          variant="primary"
          onClick={handleIniciar}
          disabled={!responsavel || entradasFiltradas.length === 0}
          className="w-full justify-center py-3"
        >
          Iniciar Inspeção ({entradasFiltradas.length} endereços)
        </Button>
        {entradasFiltradas.length === 0 && (ruasSelecionadas.length > 0 || zonasSelecionadas.length > 0) && (
          <p className="text-xs text-center text-amber-600">Nenhum endereço corresponde aos filtros selecionados</p>
        )}
      </div>
    </div>
  )

  // ── TELA DE CONCLUSÃO ────────────────────────────────────────
  if (state.phase === 'done') return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="bg-white rounded-xl border border-green-100 p-6 shadow-sm text-center">
        <div className="text-4xl mb-3">✓</div>
        <h2 className="text-lg font-extrabold text-gray-900">Inspeção Concluída!</h2>
        <p className="text-sm text-gray-400 mt-1">{state.resultados.length} itens inspecionados por {state.responsavel}</p>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-extrabold font-mono text-green-700">{state.resultados.filter(r => r.acao === 'ok').length}</div>
            <div className="text-xs text-green-600 mt-1">Aprovados</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-4">
            <div className="text-2xl font-extrabold font-mono text-orange-700">{state.resultados.filter(r => r.acao === 'segregado').length}</div>
            <div className="text-xs text-orange-600 mt-1">Segregados</div>
          </div>
          <div className="bg-gray-100 rounded-lg p-4">
            <div className="text-2xl font-extrabold font-mono text-gray-600">{state.resultados.filter(r => r.acao === 'baixa').length}</div>
            <div className="text-xs text-gray-500 mt-1">Baixados</div>
          </div>
        </div>
        <Button variant="primary" onClick={reiniciar} className="mt-6 w-full justify-center">
          Nova Inspeção
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-700 text-sm">Resumo da Inspeção</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Endereço', 'Tipo', 'SKU', 'Val. Cadastrada', 'Val. Encontrada', 'Resultado'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-gray-400 font-semibold text-[11px] uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.resultados.map((r, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="px-4 py-3 font-mono font-bold text-gray-700">{r.entrada.endereco}</td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={r.entrada.tipo === 'frac'
                      ? { background: '#eff6ff', color: '#1d4ed8' }
                      : { background: '#faf5ff', color: '#7e22ce' }}>
                    {r.entrada.tipo === 'frac' ? 'Frac.' : 'Gran.'}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono font-bold text-gray-800">{r.entrada.item.sku}</td>
                <td className="px-4 py-3"><ZoneCell validade={r.entrada.item.validade} /></td>
                <td className="px-4 py-3">
                  {r.validadeAlterada
                    ? <span className="flex items-center gap-1"><ZoneCell validade={r.validadeEncontrada} /><span className="text-[10px] text-amber-600 font-bold">✎</span></span>
                    : <span className="text-[10px] text-gray-400">Sem alteração</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    r.acao === 'ok' ? 'bg-green-100 text-green-700'
                    : r.acao === 'segregado' ? 'bg-orange-100 text-orange-700'
                    : 'bg-gray-200 text-gray-600'
                  }`}>
                    {r.acao === 'ok' ? 'OK' : r.acao === 'segregado' ? 'Segregado' : 'Baixado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  // ── INSPEÇÃO COMPLEMENTAR (endereço fora do programado) ──────
  if (faseComplemento) return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Inspeção Complementar</h1>
        <p className="text-sm text-gray-400">Endereço localizado fora do programado — complete as informações</p>
      </div>

      <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
            style={novoItem.tipo === 'frac'
              ? { background: '#eff6ff', color: '#1d4ed8' }
              : { background: '#faf5ff', color: '#7e22ce' }}>
            End. {novoItem.tipo === 'frac' ? 'Fracionado' : 'Grandeza'}
          </span>
          <span className="font-mono text-sm font-bold text-gray-800">{novoItem.endereco}</span>
          <span className="ml-auto font-mono text-lg font-extrabold text-gray-900">{novoItem.sku}</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Descrição do produto *</label>
          <input type="text" value={novoItem.descricao}
            onChange={e => setNovoItem(p => ({ ...p, descricao: e.target.value }))}
            placeholder="Nome do produto localizado"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Lote <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input type="text" value={novoItem.lote}
              onChange={e => setNovoItem(p => ({ ...p, lote: e.target.value }))}
              placeholder="S/L se não informado"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Quantidade</label>
            <input type="number" min={0} value={novoItem.quantidade}
              onChange={e => setNovoItem(p => ({ ...p, quantidade: e.target.value }))}
              placeholder="0"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Validade encontrada *</label>
          <input type="text" inputMode="numeric" value={novoItem.validadeTexto}
            onChange={e => handleNovoValidadeTexto(e.target.value)}
            placeholder="DD/MM/AAAA"
            maxLength={10}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
          <textarea value={complObs}
            onChange={e => setComplObs(e.target.value)}
            rows={2}
            placeholder="Ex: produto encontrado sem registro no sistema…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300 text-gray-600" />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button variant="ghost" onClick={cancelarComplemento} disabled={savingNovo} className="justify-center py-3">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirmarComplemento}
            disabled={savingNovo || !novoItem.descricao || !novoItem.validadeISO}
            className="justify-center py-3"
          >
            {savingNovo ? 'Salvando…' : 'Confirmar inspeção'}
          </Button>
        </div>
      </div>
    </div>
  )

  // ── INSPEÇÃO ATIVA ───────────────────────────────────────────
  if (!entradaAtual || !itemAtual || !zonaAtual) return null

  const saldoZero = itemAtual.quantidade === 0
  const tipoLabel = entradaAtual.tipo === 'frac' ? 'Fracionado' : 'Grandeza'
  const enderecoAtual = entradaAtual.endereco

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Inspeção Ativa</h1>
          <p className="text-sm text-gray-400">Item {state.atual + 1} de {state.fila.length} — {state.responsavel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-gray-400">{Math.round((state.atual / state.fila.length) * 100)}% concluído</div>
            <div className="w-28 bg-gray-200 rounded-full h-1.5 mt-1">
              <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${(state.atual / state.fila.length) * 100}%` }} />
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Endereço
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col gap-4"
        style={{ borderColor: saldoZero ? '#d1d5db' : zonaAtual.color + '40' }}>

        {/* Tipo de endereço inspecionado */}
        <div className="flex items-center gap-2 -mb-1">
          <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
            style={entradaAtual.tipo === 'frac'
              ? { background: '#eff6ff', color: '#1d4ed8' }
              : { background: '#faf5ff', color: '#7e22ce' }}>
            End. {tipoLabel}
          </span>
          <span className="font-mono text-sm font-bold text-gray-800">{enderecoAtual}</span>
        </div>

        {/* Cabeçalho do item */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl font-mono text-gray-900">{itemAtual.sku}</span>
              {saldoZero && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-gray-100 text-gray-400 border border-gray-200">⊘ Saldo 0</span>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">{itemAtual.descricao}</div>
            <div className="text-xs text-gray-400 mt-1 font-mono">Lote: {itemAtual.lote}</div>
          </div>
          <ZoneCell validade={itemAtual.validade} />
        </div>

        {/* Info do item */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-gray-400">End. Fracionado</div>
            <div className="font-mono font-bold text-gray-800 mt-0.5">{itemAtual.endereco_frac || '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-gray-400">End. Grandeza</div>
            <div className="font-mono font-bold text-gray-800 mt-0.5">{itemAtual.endereco_gran || '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-gray-400">Quantidade</div>
            <div className="font-mono font-bold mt-0.5" style={{ color: saldoZero ? '#9ca3af' : '#1a1d24' }}>
              {saldoZero ? '⊘ zero' : itemAtual.quantidade}
            </div>
          </div>
          {itemAtual.ultima_inspecao && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-gray-400">Última inspeção</div>
              <div className="font-mono text-gray-600 mt-0.5 text-[11px]">{fmtDateTime(itemAtual.ultima_inspecao)}</div>
            </div>
          )}
        </div>

        {/* SALDO ZERO — fluxo simplificado */}
        {saldoZero && (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">
              Confirme se o endereço <strong className="font-mono">{enderecoAtual}</strong> ({tipoLabel}) está <strong>fisicamente vazio</strong>.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
              <textarea
                value={obs}
                onChange={e => setObs(e.target.value)}
                rows={2}
                placeholder="Ex: endereço limpo, produto encontrado sem registro…"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300 text-gray-600"
              />
            </div>
            <Button
              variant="ghost"
              onClick={handleConfirmarOk}
              disabled={processing}
              className="w-full justify-center py-3 border-gray-300 text-gray-600"
            >
              {processing ? 'Salvando…' : '✓ Confirmar endereço vazio'}
            </Button>
          </div>
        )}

        {/* COM SALDO — fluxo completo de validade */}
        {!saldoZero && (
          <>
            {/* Validade */}
            <div className="flex flex-col gap-2 rounded-xl border p-4"
              style={{ borderColor: zonaAtual.color + '30', background: zonaAtual.color + '06' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">Validade</span>
                {validadeAlterada && zonaEncontrada && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                    style={{ background: zonaEncontrada.color, color: zonaEncontrada.textColor }}>
                    Alterada → {zonaEncontrada.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0">Cadastrada:</span>
                <ZoneCell validade={itemAtual.validade} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0">Encontrada:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={validadeTexto}
                  onChange={e => handleValidadeTexto(e.target.value)}
                  placeholder="DD/MM/AAAA"
                  maxLength={10}
                  className="border rounded-lg px-3 py-1.5 text-sm font-mono flex-1 focus:outline-none focus:ring-1"
                  style={{
                    borderColor: validadeAlterada ? zonaEncontrada?.color ?? '#e1e4ea' : '#e1e4ea',
                    boxShadow: validadeAlterada ? `0 0 0 1px ${zonaEncontrada?.color}` : undefined,
                  }}
                />
                {validadeTexto && (
                  <button onClick={limparValidade} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                )}
              </div>
              {validadeAlterada && (
                <p className="text-[11px] text-amber-600 font-medium">
                  ⚠ Validade será atualizada no sistema ao confirmar
                </p>
              )}
              <button
                onClick={() => setValidadeConfirmada(true)}
                disabled={validadeConfirmada}
                className="mt-1 py-2 rounded-lg text-sm font-bold border transition-colors"
                style={validadeConfirmada
                  ? { background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0', cursor: 'default' }
                  : { background: '#1f6feb', color: '#fff', borderColor: '#1f6feb' }}
              >
                {validadeConfirmada ? '✓ Validade confirmada' : 'Confirmar validade'}
              </button>
            </div>

            {/* Foto */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">
                Foto{' '}
                {fotoObrigatoria
                  ? <span className="text-red-500">* obrigatória — validade alterada para zona crítica</span>
                  : <span className="text-gray-400">(opcional)</span>
                }
              </label>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
              {foto ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto} alt="foto inspecao" className="rounded-lg w-full max-h-40 object-cover" />
                  <button onClick={() => setFoto(undefined)} className="absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full text-xs">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed rounded-lg py-6 text-sm transition-colors"
                  style={fotoObrigatoria
                    ? { borderColor: '#dc2626', color: '#dc2626' }
                    : { borderColor: '#e1e4ea', color: '#9ca3af' }
                  }
                >
                  📷 Tirar foto
                </button>
              )}
            </div>

            {/* Observação auxiliar */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-400">Observação auxiliar (opcional)</label>
              <textarea
                value={obs}
                onChange={e => setObs(e.target.value)}
                rows={2}
                placeholder="Informações adicionais…"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300 text-gray-600"
              />
            </div>

            {/* Formulário de segregação inline */}
            {showSegregar && (
              <div className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-xs font-semibold text-orange-700">Informe a quantidade a segregar</p>
                <p className="text-[11px] text-orange-600">O item ficará como <strong>Segregado</strong> — o bloqueio é confirmado no Plano de Ação</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={itemAtual.quantidade}
                    value={qtdSegregar}
                    onChange={e => setQtdSegregar(e.target.value)}
                    placeholder={`Máx: ${itemAtual.quantidade}`}
                    className="border border-orange-200 rounded-lg px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:border-orange-400 bg-white"
                    autoFocus
                  />
                  <span className="text-xs text-orange-400 font-mono">/ {itemAtual.quantidade}</span>
                </div>
                {fotoObrigatoria && !foto && (
                  <p className="text-[11px] text-red-600 font-medium">⚠ Foto obrigatória — validade alterada para zona crítica</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setShowSegregar(false); setQtdSegregar('') }} className="justify-center">
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleConfirmarSegregacao}
                    disabled={processing || !qtdSegregar || Number(qtdSegregar) < 1 || (!!fotoObrigatoria && !foto)}
                    className="justify-center"
                  >
                    {processing ? 'Salvando…' : 'Confirmar Segregação'}
                  </Button>
                </div>
              </div>
            )}

            {/* Botões principais */}
            {!showSegregar && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="danger"
                    onClick={() => setShowSegregar(true)}
                    disabled={processing || !validadeConfirmada}
                    className="justify-center py-3"
                  >
                    Segregar
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleConfirmarOk}
                    disabled={processing || !validadeConfirmada || (!!fotoObrigatoria && !foto)}
                    className="justify-center py-3"
                  >
                    {processing ? 'Salvando…' : 'Confirmar OK'}
                  </Button>
                </div>
                {!validadeConfirmada && (
                  <p className="text-[11px] text-center text-gray-400">Confirme a validade do produto para prosseguir</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Baixa de endereço — disponível em ambos os fluxos */}
        <div className="border-t border-gray-100 pt-4">
          {!showBaixa ? (
            <button
              onClick={() => setShowBaixa(true)}
              disabled={processing}
              className="w-full py-2.5 rounded-lg text-sm font-semibold border border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              🗑 Realizar baixa de endereço
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-semibold text-red-700">Confirmar baixa do endereço {enderecoAtual}?</p>
              <p className="text-[11px] text-red-600">
                O saldo será zerado e o item <strong>baixado</strong> — não constará mais no estoque,
                nas inspeções nem nos relatórios.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowBaixa(false)} disabled={processing} className="justify-center">
                  Cancelar
                </Button>
                <Button variant="danger" size="sm" onClick={handleBaixaEndereco} disabled={processing} className="justify-center">
                  {processing ? 'Salvando…' : 'Confirmar Baixa'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Modal — incluir novo endereço de inspeção (popup mínimo) */}
      <Modal open={showAddModal} onClose={() => { setShowAddModal(false); setNovoItem(novoItemVazio) }} title="Incluir Endereço de Inspeção">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-gray-500">
            Produto localizado fora do programado? Informe o endereço e o código — a próxima tela
            segue para a inspeção complementar.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Endereço * <span className="text-gray-400 font-normal">(ex: 1 - 2 - 0 - 1)</span></label>
            <input type="text" value={novoItem.endereco}
              onChange={e => setNovoItem(p => ({ ...p, endereco: e.target.value }))}
              placeholder="Rua - Prédio - Nível - Apto"
              autoFocus
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Código do produto (SKU) *</label>
            <input type="text" value={novoItem.sku}
              onChange={e => setNovoItem(p => ({ ...p, sku: e.target.value }))}
              placeholder="Código SKU"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            {novoItem.sku.trim() && (
              produtoExistente
                ? <p className="text-[11px] text-green-600 font-medium">✓ {produtoExistente.descricao}</p>
                : <p className="text-[11px] text-amber-600">Produto sem cadastro — informe a descrição na próxima tela</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600">Tipo de endereço *</label>
            <div className="flex gap-2">
              {(['frac', 'gran'] as const).map(t => (
                <button key={t}
                  onClick={() => setNovoItem(p => ({ ...p, tipo: t }))}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors"
                  style={novoItem.tipo === t
                    ? { background: '#1f6feb', color: '#fff', borderColor: '#1f6feb' }
                    : { background: '#f5f6f8', color: '#5a6070', borderColor: '#e1e4ea' }}>
                  {t === 'frac' ? 'Fracionado' : 'Grandeza'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowAddModal(false); setNovoItem(novoItemVazio) }}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={handleContinuarNovo}
              disabled={!novoItem.sku || !novoItem.endereco}
            >
              Continuar para inspeção →
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
