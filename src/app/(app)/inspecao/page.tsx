'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useItens } from '@/hooks/useItens'
import { useInspecao, type EntradaFila, type InspecaoAberta, type TipoEndereco } from '@/hooks/useInspecao'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { QrScanner } from '@/components/qr/QrScanner'
import { getZone, diasParaVencer } from '@/lib/zones'
import { fmtDate, fmtDateTime, normalizarEndereco } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/layout/Toast'
import { usePerfílContext } from '@/lib/perfil-context'
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

const DIA_MS = 86400000
type RecenciaInspecao = '' | 'nunca' | '30' | '60' | '90'

// Lado da rua pela paridade do prédio (2º segmento): "6 - 53 - 4 - 0" → ímpar
type LadoRua = 'par' | 'impar'
function extrairLado(endereco: string): LadoRua | null {
  const predio = parseInt(endereco.split('-')[1]?.trim() ?? '', 10)
  if (isNaN(predio)) return null
  return predio % 2 === 0 ? 'par' : 'impar'
}

// Normaliza texto para busca: sem acentos, minúsculo, espaços colapsados
function normalizarBusca(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const novoItemVazio = {
  sku: '', descricao: '', lote: '', tipo: 'frac' as 'frac' | 'gran',
  endereco: '', quantidade: '', validadeTexto: '', validadeISO: '',
}

export default function InspecaoPage() {
  const { itens, loading, addItem } = useItens()
  const { state, iniciar, iniciarQr, validarQr, retomar, buscarAbertas, cancelarAberta, confirmar, baixarEndereco, encerrar, reiniciar, registrarExtra } = useInspecao()
  const { toast } = useToast()
  const { can } = usePerfílContext()

  // Inspeções em aberto no banco — várias simultâneas, uma por responsável
  const [abertas, setAbertas] = useState<InspecaoAberta[]>([])
  const [confirmNova, setConfirmNova] = useState(false)
  const [iniciando, setIniciando] = useState(false)

  useEffect(() => {
    if (state.phase !== 'idle') return
    let ativo = true
    buscarAbertas().then(a => { if (ativo) setAbertas(a) })
    return () => { ativo = false }
  }, [state.phase, buscarAbertas])
  const [responsavel, setResponsavel] = useState('')
  // Inspeção por QR: card de confirmação temporário sobre a câmera (contínuo)
  type QrCard = { tipo: 'ok' | 'erro' | 'dup'; sku?: string; descricao?: string; validade?: string; endereco?: string; msg?: string }
  const [qrCard, setQrCard] = useState<QrCard | null>(null)
  const qrTimerRef = useRef<number | null>(null)
  const qrValidadosRef = useRef<Set<string>>(new Set())
  // Busca de item por código (SKU ou IT-) para inspeção individual
  const [buscaItem, setBuscaItem] = useState('')
  const [mostrarBuscaItem, setMostrarBuscaItem] = useState(false)
  const [validadeEncontrada, setValidadeEncontrada] = useState('') // ISO YYYY-MM-DD
  const [validadeTexto, setValidadeTexto] = useState('')           // exibição DD/MM/AAAA
  const [obs, setObs] = useState('')
  const [foto, setFoto] = useState<string | undefined>()
  const [processing, setProcessing] = useState(false)
  const [showSegregar, setShowSegregar] = useState(false)
  const [qtdSegregar, setQtdSegregar] = useState('')
  const [showBaixa, setShowBaixa] = useState(false)
  const [validadeConfirmada, setValidadeConfirmada] = useState(false)
  const [qtdInspecao, setQtdInspecao] = useState('') // quantidade conferida no endereço

  // Endereço vazio (saldo zero) — registrar produto encontrado
  const [mostrarEncontrado, setMostrarEncontrado] = useState(false)
  const [qtdEncontrada, setQtdEncontrada] = useState('')

  // Encerramento antecipado
  const [confirmEncerrar, setConfirmEncerrar] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Novo endereço durante inspeção ativa: popup mínimo → inspeção complementar
  const [showAddModal, setShowAddModal] = useState(false)
  const [faseComplemento, setFaseComplemento] = useState(false)
  const [novoItem, setNovoItem] = useState(novoItemVazio)
  const [complObs, setComplObs] = useState('')
  const [complSegregar, setComplSegregar] = useState(false)
  const [complQtdSegregar, setComplQtdSegregar] = useState('')
  const [savingNovo, setSavingNovo] = useState(false)

  // Busca de produto por descrição/código na modal de novo endereço
  const [buscaProduto, setBuscaProduto] = useState('')
  const [mostrarBuscaResultados, setMostrarBuscaResultados] = useState(false)
  const [entradaManualSku, setEntradaManualSku] = useState(false)

  // Filtros da tela inicial
  const [ruasSelecionadas, setRuasSelecionadas] = useState<string[]>([])
  const [zonasSelecionadas, setZonasSelecionadas] = useState<ZoneName[]>([])
  const [tiposSelecionados, setTiposSelecionados] = useState<TipoEndereco[]>([])
  const [ladosSelecionados, setLadosSelecionados] = useState<LadoRua[]>([])
  const [recencia, setRecencia] = useState<RecenciaInspecao>('')
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
    const agora = Date.now()
    return todasEntradas.filter(e => {
      if (!incluirSaldoZero && e.item.quantidade === 0) return false
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(e.tipo)) return false
      if (ladosSelecionados.length > 0) {
        const lado = extrairLado(e.endereco)
        if (!lado || !ladosSelecionados.includes(lado)) return false
      }
      if (ruasSelecionadas.length > 0) {
        if (!ruasSelecionadas.includes(extrairRua(e.endereco))) return false
      }
      if (zonasSelecionadas.length > 0) {
        if (!zonasSelecionadas.includes(getZone(e.item.validade).name)) return false
      }
      if (recencia) {
        const ui = e.item.ultima_inspecao
        if (recencia === 'nunca') {
          if (ui) return false
        } else {
          // "há mais de N dias" — inclui os nunca inspecionados (mais críticos)
          if (ui && (agora - new Date(ui).getTime()) / DIA_MS < Number(recencia)) return false
        }
      }
      return true
    })
  }, [todasEntradas, ruasSelecionadas, zonasSelecionadas, tiposSelecionados, ladosSelecionados, recencia, incluirSaldoZero])

  const toggleRua = (rua: string) =>
    setRuasSelecionadas(prev => prev.includes(rua) ? prev.filter(r => r !== rua) : [...prev, rua])

  const toggleZona = (zona: ZoneName) =>
    setZonasSelecionadas(prev => prev.includes(zona) ? prev.filter(z => z !== zona) : [...prev, zona])

  const toggleTipo = (tipo: TipoEndereco) =>
    setTiposSelecionados(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo])

  const toggleLado = (lado: LadoRua) =>
    setLadosSelecionados(prev => prev.includes(lado) ? prev.filter(l => l !== lado) : [...prev, lado])

  const entradaAtual = state.phase === 'active' ? state.fila[state.atual] : null
  const itemAtual = entradaAtual?.item ?? null
  const zonaAtual = itemAtual ? getZone(itemAtual.validade) : null

  // Preenche a quantidade conferida com o saldo cadastrado ao mudar de endereço
  useEffect(() => {
    if (itemAtual) setQtdInspecao(String(itemAtual.quantidade))
  }, [itemAtual])
  const qtdAlterada = !!itemAtual && qtdInspecao !== '' && Number(qtdInspecao) !== itemAtual.quantidade
  // Picking com saldo contado como zero: mantém o endereço ativo (não é baixa)
  const zeradoNaInspecao = !!itemAtual && itemAtual.quantidade > 0 && qtdInspecao.trim() !== '' && Number(qtdInspecao) === 0

  // Validade efetiva = o que o inspetor informou (ou a cadastrada se não alterou)
  const validadeEfetiva = validadeEncontrada || (itemAtual?.validade ?? '')
  const zonaEncontrada = validadeEfetiva ? getZone(validadeEfetiva) : null
  const validadeAlterada = !!validadeEncontrada && validadeEncontrada !== itemAtual?.validade

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

  // Máscara de endereço: digita só números, aplica "X - XXX - X - XX" (rua, prédio 3 díg., nível, apto 2 díg.)
  // Prédio menor que 100: usar zeros à esquerda (053) — removidos automaticamente ao continuar
  const handleEnderecoTexto = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 7)
    const segs: string[] = []
    if (digits.length > 0) segs.push(digits.slice(0, 1))
    if (digits.length > 1) segs.push(digits.slice(1, 4))
    if (digits.length > 4) segs.push(digits.slice(4, 5))
    if (digits.length > 5) segs.push(digits.slice(5, 7))
    setNovoItem(p => ({ ...p, endereco: segs.join(' - ') }))
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

  // Catálogo de produtos (SKU único → descrição) para busca por nome
  const catalogoProdutos = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of itens) {
      if (!i.sku) continue
      const atual = map.get(i.sku)
      // Mantém a primeira descrição não vazia encontrada para o SKU
      if (atual === undefined || (!atual && i.descricao)) map.set(i.sku, i.descricao ?? '')
    }
    return Array.from(map, ([sku, descricao]) => ({ sku, descricao }))
  }, [itens])

  // Resultados filtrados pela digitação (nome do produto ou código), até 30
  const resultadosBusca = useMemo(() => {
    const q = normalizarBusca(buscaProduto)
    if (!q) return []
    const termos = q.split(/\s+/).filter(Boolean)
    const res = catalogoProdutos.filter(p => {
      const alvo = normalizarBusca(`${p.sku} ${p.descricao}`)
      return termos.every(t => alvo.includes(t))
    })
    // Ordena por descrição para leitura previsível
    res.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
    return res.slice(0, 30)
  }, [buscaProduto, catalogoProdutos])

  const selecionarProduto = (p: { sku: string; descricao: string }) => {
    setNovoItem(prev => ({ ...prev, sku: p.sku, descricao: p.descricao }))
    setBuscaProduto(`${p.sku} — ${p.descricao}`)
    setMostrarBuscaResultados(false)
    setEntradaManualSku(false)
  }

  // Reset completo do formulário de novo endereço (inclui estados da busca)
  const resetNovoEndereco = () => {
    setNovoItem(novoItemVazio)
    setBuscaProduto('')
    setMostrarBuscaResultados(false)
    setEntradaManualSku(false)
  }

  // Popup mínimo confirmado → segue para inspeção complementar
  const handleContinuarNovo = () => {
    if (!novoItem.sku || !novoItem.endereco) return
    const enderecoNorm = normalizarEndereco(novoItem.endereco)
    setNovoItem(p => ({
      ...p,
      endereco: enderecoNorm,
      ...(produtoExistente ? { descricao: produtoExistente.descricao } : {}),
    }))
    setShowAddModal(false)
    setFaseComplemento(true)
  }

  const cancelarComplemento = () => {
    setFaseComplemento(false)
    setNovoItem(novoItemVazio)
    setComplObs('')
    setComplSegregar(false)
    setComplQtdSegregar('')
  }

  // Zona da validade informada no complemento — define se o produto está fora do prazo
  const zonaComplemento = novoItem.validadeISO ? getZone(novoItem.validadeISO) : null
  const complementoForaPrazo = !!zonaComplemento && (zonaComplemento.name === 'vencido' || zonaComplemento.name === 'vermelho')

  // Inspeção complementar confirmada → cria o item já inspecionado
  const handleConfirmarComplemento = async () => {
    const { sku, descricao, lote, tipo, endereco, quantidade, validadeISO } = novoItem
    if (!descricao || !validadeISO) return
    // Segrega somente se estiver fora do prazo e o inspetor optar por segregar
    const segregar = !!complementoForaPrazo && complSegregar
    setSavingNovo(true)
    const now = new Date().toISOString()
    const { error } = await addItem({
      sku, descricao, lote: lote.trim() || 'S/L',
      endereco_frac: tipo === 'frac' ? endereco : '',
      endereco_gran: tipo === 'gran' ? endereco : '',
      quantidade: Number(quantidade) || 0,
      validade: validadeISO,
      status: segregar ? 'segregado' : 'ativo',
      ...(segregar ? { segregado_em: now, segregado_por: state.responsavel } : {}),
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
    const qtdSeg = segregar && complQtdSegregar ? ` | Qtd: ${complQtdSegregar}` : ''
    await supabase.from('historico').insert({
      descricao: segregar
        ? `Inspeção complementar: ${sku} — endereço ${endereco} localizado fora do programado | Segregado (fora do prazo)${qtdSeg}`
        : `Inspeção complementar: ${sku} — endereço ${endereco} localizado fora do programado`,
      responsavel: state.responsavel,
      user_id: user!.id,
    })
    if (novo) {
      registrarExtra({
        entrada: { item: novo as Item, tipo, endereco },
        ok: !segregar,
        acao: segregar ? 'segregado' : 'ok',
        validadeEncontrada: validadeISO,
        validadeAlterada: false,
        obs: complObs,
      })
    }
    toast(segregar
      ? `Endereço ${endereco} cadastrado e segregado — enviado ao Plano de Ação`
      : `Endereço ${endereco} inspecionado e cadastrado`)
    // Notifica o grupo do Plano de Ação por e-mail quando o item foi segregado
    if (segregar) {
      await notificarSegregacao({
        sku, descricao, endereco, validade: validadeISO,
        quantidade: complQtdSegregar ? Number(complQtdSegregar) : (Number(quantidade) || 0),
      }, complObs)
    }
    cancelarComplemento()
    setSavingNovo(false)
  }

  // Inspeção em aberto do MESMO responsável (comparação sem caixa/espaços)
  const abertaMesmoResp = abertas.find(
    a => a.responsavel.trim().toLowerCase() === responsavel.trim().toLowerCase()
  ) ?? null

  const handleIniciar = async () => {
    if (!responsavel || entradasFiltradas.length === 0) return
    // Só bloqueia se o próprio responsável já tem uma inspeção aberta
    if (abertaMesmoResp) { setConfirmNova(true); return }
    await doIniciar()
  }

  const doIniciar = async () => {
    setIniciando(true)
    if (abertaMesmoResp) await cancelarAberta(abertaMesmoResp)
    const { error } = await iniciar(entradasFiltradas, responsavel)
    setIniciando(false)
    setConfirmNova(false)
    if (error) {
      toast('Erro ao iniciar inspeção — verifique a migration 005', 'error')
    } else {
      setAbertas([])
      limparEstado()
    }
  }

  const handleRetomar = (aberta: InspecaoAberta) => {
    retomar(aberta, itens)
    limparEstado()
  }

  // Busca de item ativo por código (SKU ou codigo_qr IT-) para inspeção individual
  const resultadosBuscaItem = useMemo(() => {
    const q = normalizarBusca(buscaItem)
    if (!q) return []
    const termos = q.split(/\s+/).filter(Boolean)
    const res = itens.filter(i => {
      if (i.status !== 'ativo') return false
      const alvo = normalizarBusca(`${i.sku} ${i.codigo_qr ?? ''}`)
      return termos.every(t => alvo.includes(t))
    })
    return res.slice(0, 30)
  }, [buscaItem, itens])

  // Inicia inspeção apenas do item selecionado (fluxo normal, fila = endereços do item)
  const inspecionarItem = async (item: Item) => {
    if (!responsavel.trim()) { toast('Informe o responsável primeiro', 'info'); return }
    if (abertaMesmoResp) { toast('Você já tem uma inspeção aberta — retome ou cancele antes', 'info'); return }
    const entradas: EntradaFila[] = []
    if (item.endereco_frac) entradas.push({ item, tipo: 'frac', endereco: item.endereco_frac })
    if (item.endereco_gran) entradas.push({ item, tipo: 'gran', endereco: item.endereco_gran })
    if (entradas.length === 0) { toast('Item sem endereço para inspecionar', 'info'); return }
    setMostrarBuscaItem(false); setBuscaItem('')
    setIniciando(true)
    const { error } = await iniciar(entradas, responsavel)
    setIniciando(false)
    if (error) toast('Erro ao iniciar inspeção — verifique a migration 005', 'error')
    else { setAbertas([]); limparEstado() }
  }

  // Inicia a SESSÃO de inspeção por QR Code (validação contínua de paletes)
  const iniciarInspecaoQr = async () => {
    if (!responsavel.trim()) { toast('Informe o responsável primeiro', 'info'); return }
    if (abertaMesmoResp) { toast('Você já tem uma inspeção aberta — retome ou cancele antes de usar o QR', 'info'); return }
    setIniciando(true)
    qrValidadosRef.current = new Set()
    const { error } = await iniciarQr(responsavel)
    setIniciando(false)
    if (error) { toast('Erro ao iniciar inspeção por QR — verifique a migration 005', 'error'); return }
    setAbertas([]); setQrCard(null)
  }

  // Mostra o card de confirmação por um tempo e depois libera a próxima leitura
  const mostrarQrCard = (card: QrCard, ms: number) => {
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current)
    setQrCard(card)
    qrTimerRef.current = window.setTimeout(() => { setQrCard(null); qrTimerRef.current = null }, ms)
  }

  // Cada leitura de QR na sessão contínua: valida a existência do palete
  const handleQrScan = async (codigo: string) => {
    if (state.phase !== 'qr' || qrCard) return
    const cod = codigo.trim()
    const item = itens.find(i => i.codigo_qr === cod)
    if (!item) { mostrarQrCard({ tipo: 'erro', msg: `Palete não encontrado: ${cod}` }, 3500); return }
    if (item.status !== 'ativo') { mostrarQrCard({ tipo: 'erro', sku: item.sku, msg: `Item não está ativo (${item.status})` }, 3500); return }
    if (qrValidadosRef.current.has(item.id)) {
      mostrarQrCard({ tipo: 'dup', sku: item.sku, descricao: item.descricao, msg: 'Palete já validado nesta inspeção' }, 3000)
      return
    }
    const tipo: TipoEndereco = item.endereco_gran ? 'gran' : 'frac'
    const endereco = item.endereco_gran || item.endereco_frac || '—'
    qrValidadosRef.current.add(item.id)
    mostrarQrCard({ tipo: 'ok', sku: item.sku, descricao: item.descricao, validade: item.validade, endereco }, 5000)
    await validarQr(item, tipo, endereco)
  }

  // Limpa o timer do card ao sair da sessão de QR
  useEffect(() => {
    if (state.phase !== 'qr' && qrTimerRef.current) {
      clearTimeout(qrTimerRef.current); qrTimerRef.current = null
    }
  }, [state.phase])

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
    setMostrarEncontrado(false)
    setQtdEncontrada('')
  }

  // Quantidade a gravar: só envia se o inspetor alterou o saldo cadastrado
  const qtdParaSalvar = () => (qtdAlterada ? Number(qtdInspecao) : undefined)

  // Notifica por e-mail o grupo com acesso ao Plano de Ação quando há segregação.
  // Best-effort: a segregação já está gravada; falha de e-mail não bloqueia a inspeção.
  const notificarSegregacao = async (
    dados: { sku: string; descricao: string; endereco: string; validade: string; quantidade: number | string },
    observacao: string,
  ) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/plano-acao/notificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ acao: 'segregacao', responsavel: state.responsavel, obs: observacao, item: dados }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.enviados) toast(`Plano de Ação notificado por e-mail (${json.enviados})`, 'info')
    } catch {
      /* e-mail é best-effort — a segregação já foi registrada */
    }
  }

  const handleConfirmarOk = async () => {
    setProcessing(true)
    await confirmar(true, validadeEfetiva, obs, foto, undefined, qtdParaSalvar())
    limparEstado()
    setProcessing(false)
  }

  const handleConfirmarSegregacao = async () => {
    if (!qtdSegregar || !itemAtual || !entradaAtual) return
    setProcessing(true)
    // Captura os dados do item antes de confirmar (confirmar avança a fila e troca o item atual)
    const dadosSegregacao = {
      sku: itemAtual.sku,
      descricao: itemAtual.descricao,
      endereco: entradaAtual.endereco,
      validade: validadeEfetiva,
      quantidade: Number(qtdSegregar),
    }
    const obsSegregacao = obs
    await confirmar(false, validadeEfetiva, obs, foto, Number(qtdSegregar), qtdParaSalvar())
    await notificarSegregacao(dadosSegregacao, obsSegregacao)
    limparEstado()
    setProcessing(false)
  }

  const handleEncerrar = async () => {
    setProcessing(true)
    await encerrar()
    setConfirmEncerrar(false)
    limparEstado()
    setProcessing(false)
  }

  const handleBaixaEndereco = async () => {
    setProcessing(true)
    await baixarEndereco(obs)
    limparEstado()
    setProcessing(false)
  }

  // Produto localizado em endereço com saldo zero: registra quantidade + validade
  const handleConfirmarEncontrado = async () => {
    if (!validadeEncontrada || !qtdEncontrada || Number(qtdEncontrada) < 1) return
    setProcessing(true)
    await confirmar(true, validadeEncontrada, obs, foto, undefined, Number(qtdEncontrada))
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

      {/* Inspeções em aberto — retomar (uma por responsável) */}
      {abertas.length > 0 && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-blue-800">
              {abertas.length === 1 ? 'Inspeção em aberto' : `${abertas.length} inspeções em aberto`}
            </span>
          </div>
          {abertas.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-blue-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-800">Inspeção #{a.numero}</span>
                  <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
                    {a.atual}/{a.fila.length}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  <strong>{a.responsavel}</strong> · {fmtDateTime(a.iniciada_em)}
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => handleRetomar(a)} className="flex-shrink-0">
                ▶ Retomar
              </Button>
            </div>
          ))}
        </div>
      )}

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
          <div className="text-xs text-gray-400 mt-1">Picking</div>
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

      {/* Filtro por Lado da Rua */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-gray-700">Filtrar por Lado da Rua</span>
            <p className="text-xs text-gray-400 mt-0.5">Definido pelo número do prédio</p>
          </div>
          {ladosSelecionados.length > 0 && (
            <button onClick={() => setLadosSelecionados([])} className="text-xs text-blue-500 hover:text-blue-700">
              Limpar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {([['par', 'Par', '#0e7490', '#ecfeff'], ['impar', 'Ímpar', '#b45309', '#fffbeb']] as const).map(([lado, label, cor, bg]) => {
            const ativo = ladosSelecionados.includes(lado)
            const count = todasEntradas.filter(e =>
              extrairLado(e.endereco) === lado && (incluirSaldoZero || e.item.quantidade > 0)
            ).length
            return (
              <button
                key={lado}
                onClick={() => toggleLado(lado)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
                style={ativo
                  ? { background: cor, color: '#fff', borderColor: cor }
                  : { background: bg, color: cor, borderColor: cor + '40' }
                }
              >
                {label}
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

      {/* Filtro por Última Inspeção — foco em endereços atrasados */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-gray-700">Filtrar por Última Inspeção</span>
            <p className="text-xs text-gray-400 mt-0.5">Priorize endereços sem conferência recente</p>
          </div>
          {recencia && (
            <button onClick={() => setRecencia('')} className="text-xs text-blue-500 hover:text-blue-700">Limpar</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {([['', 'Todas'], ['nunca', 'Nunca inspecionado'], ['30', '> 30 dias'], ['60', '> 60 dias'], ['90', '> 90 dias']] as const).map(([val, label]) => {
            const ativo = recencia === val
            const count = val === ''
              ? todasEntradas.filter(e => incluirSaldoZero || e.item.quantidade > 0).length
              : todasEntradas.filter(e => {
                  if (!incluirSaldoZero && e.item.quantidade === 0) return false
                  const ui = e.item.ultima_inspecao
                  if (val === 'nunca') return !ui
                  return !ui || (Date.now() - new Date(ui).getTime()) / DIA_MS >= Number(val)
                }).length
            return (
              <button
                key={val}
                onClick={() => setRecencia(val)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors"
                style={ativo
                  ? { background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }
                  : { background: '#faf5ff', color: '#7c3aed', borderColor: '#e9d5ff' }
                }
              >
                {label}
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: ativo ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.06)' }}>
                  {count}
                </span>
              </button>
            )
          })}
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

      {/* Filtro por Tipo de Endereço */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Filtrar por Tipo de Endereço</span>
          {tiposSelecionados.length > 0 && (
            <button onClick={() => setTiposSelecionados([])} className="text-xs text-blue-500 hover:text-blue-700">
              Limpar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {([['frac', 'Picking', '#1d4ed8', '#eff6ff'], ['gran', 'Pulmão', '#7e22ce', '#faf5ff']] as const).map(([tipo, label, cor, bg]) => {
            const ativo = tiposSelecionados.includes(tipo)
            const count = todasEntradas.filter(e => e.tipo === tipo && (incluirSaldoZero || e.item.quantidade > 0)).length
            return (
              <button
                key={tipo}
                onClick={() => toggleTipo(tipo)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
                style={ativo
                  ? { background: cor, color: '#fff', borderColor: cor }
                  : { background: bg, color: cor, borderColor: cor + '40' }
                }
              >
                {label}
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
          disabled={!responsavel || entradasFiltradas.length === 0 || iniciando}
          className="w-full justify-center py-3"
        >
          {iniciando ? 'Abrindo…' : `Iniciar Inspeção (${entradasFiltradas.length} endereços)`}
        </Button>
        {entradasFiltradas.length === 0 && (ruasSelecionadas.length > 0 || zonasSelecionadas.length > 0) && (
          <p className="text-xs text-center text-amber-600">Nenhum endereço corresponde aos filtros selecionados</p>
        )}
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="flex-1 border-t border-gray-100" /> ou <span className="flex-1 border-t border-gray-100" />
        </div>
        <Button
          variant="secondary"
          onClick={iniciarInspecaoQr}
          disabled={iniciando}
          className="w-full justify-center py-2.5"
        >
          📷 Iniciar Inspeção por QR (Pulmão)
        </Button>
        <p className="text-[11px] text-center text-gray-400">Leia os QR das etiquetas em sequência — cada palete é validado e a leitura segue sozinha.</p>

        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="flex-1 border-t border-gray-100" /> ou <span className="flex-1 border-t border-gray-100" />
        </div>
        {/* Busca por código — inspeção individual do item selecionado */}
        <div className="relative">
          <input
            type="text"
            value={buscaItem}
            onChange={e => { setBuscaItem(e.target.value); setMostrarBuscaItem(true) }}
            onFocus={() => setMostrarBuscaItem(true)}
            placeholder="Buscar item por código (SKU ou IT-…)"
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm w-full font-mono focus:outline-none focus:border-blue-500"
          />
          {mostrarBuscaItem && buscaItem.trim() && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
              {resultadosBuscaItem.length > 0 ? resultadosBuscaItem.map(i => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => inspecionarItem(i)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700">{i.sku}</span>
                    <span className="font-mono text-[10px] text-gray-400">{i.codigo_qr ?? ''}</span>
                  </div>
                  <div className="text-xs text-gray-700 truncate">{i.descricao}</div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono mt-0.5">
                    <span>{i.endereco_gran || i.endereco_frac || '—'}</span>
                    <span>·</span>
                    <span>{fmtDate(i.validade)}</span>
                  </div>
                </button>
              )) : (
                <div className="px-3 py-3 text-xs text-gray-500">Nenhum item ativo encontrado para esse código.</div>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-center text-gray-400">Busque pelo código e selecione um item para inspecioná-lo individualmente.</p>
      </div>

      {/* Modal — o mesmo responsável já tem inspeção em aberto */}
      <Modal open={confirmNova} onClose={() => setConfirmNova(false)} title="Responsável com inspeção em aberto">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            <strong>{abertaMesmoResp?.responsavel}</strong> já tem a <strong>Inspeção #{abertaMesmoResp?.numero}</strong> em
            aberto (progresso {abertaMesmoResp?.atual}/{abertaMesmoResp?.fila.length}, iniciada em{' '}
            {abertaMesmoResp ? fmtDateTime(abertaMesmoResp.iniciada_em) : ''}).
          </p>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs text-blue-700">
              Para continuar a anterior, feche esta janela e use <strong>▶ Retomar</strong>.
              Outros responsáveis podem manter suas inspeções abertas normalmente.
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">
              Ao abrir uma nova para este responsável, a Inspeção #{abertaMesmoResp?.numero} será
              <strong> cancelada</strong> e o progresso restante não poderá ser retomado.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmNova(false)}>Voltar</Button>
            <Button variant="danger" onClick={doIniciar} disabled={iniciando}>
              {iniciando ? 'Abrindo…' : 'Cancelar anterior e iniciar nova'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )

  // ── INSPEÇÃO POR QR CODE (validação contínua de paletes) ─────
  if (state.phase === 'qr') {
    const validados = state.resultados.length
    const zonaCard = qrCard?.validade ? getZone(qrCard.validade) : null
    return (
      <>
        <QrScanner
          open
          continuo
          pausado={qrCard != null || confirmEncerrar}
          onDetect={handleQrScan}
          onClose={() => setConfirmEncerrar(true)}
          title={`Inspeção por QR #${state.numero}`}
          overlay={qrCard && (
            <div className={`w-full h-full flex flex-col items-center justify-center gap-2 p-5 text-center ${
              qrCard.tipo === 'ok' ? 'bg-green-600/95'
              : qrCard.tipo === 'dup' ? 'bg-amber-500/95'
              : 'bg-red-600/95'
            }`}>
              <div className="text-4xl">{qrCard.tipo === 'ok' ? '✓' : qrCard.tipo === 'dup' ? '⚠' : '✕'}</div>
              <div className="text-white text-lg font-extrabold">
                {qrCard.tipo === 'ok' ? 'Palete Validado' : qrCard.tipo === 'dup' ? 'Já validado' : 'Não validado'}
              </div>
              {qrCard.sku && (
                <div className="text-white/95 font-mono text-2xl font-extrabold">{qrCard.sku}</div>
              )}
              {qrCard.descricao && (
                <div className="text-white/90 text-sm leading-tight">{qrCard.descricao}</div>
              )}
              {qrCard.tipo === 'ok' && (
                <>
                  {qrCard.endereco && <div className="text-white/80 font-mono text-xs">{qrCard.endereco}</div>}
                  <div className="mt-1 bg-white/95 rounded-lg px-3 py-1.5">
                    <span className="text-[11px] text-gray-500 mr-2">Validade</span>
                    <span className="font-mono font-bold" style={{ color: zonaCard?.color }}>
                      {qrCard.validade ? fmtDate(qrCard.validade) : '—'}
                    </span>
                  </div>
                </>
              )}
              {qrCard.msg && qrCard.tipo !== 'ok' && (
                <div className="text-white/95 text-sm font-semibold">{qrCard.msg}</div>
              )}
              <div className="text-white/70 text-[11px] mt-1">seguindo para a próxima leitura…</div>
            </div>
          )}
          footer={
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span><strong className="font-mono text-gray-800 text-sm">{validados}</strong> paletes validados</span>
                <span className="truncate">{state.responsavel}</span>
              </div>
              <Button variant="danger" onClick={() => setConfirmEncerrar(true)} className="w-full justify-center py-3">
                ■ Encerrar Inspeção
              </Button>
            </div>
          }
        />
        <Modal open={confirmEncerrar} onClose={() => setConfirmEncerrar(false)} title="Encerrar Inspeção por QR">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              Encerrar a <strong>Inspeção #{state.numero}</strong> por QR agora?
            </p>
            <div className="rounded-lg border border-green-100 bg-green-50 p-3">
              <p className="text-xs text-green-700">
                ✓ Os <strong>{validados} paletes validados</strong> já estão salvos — cada leitura é gravada na hora.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmEncerrar(false)} disabled={processing}>Voltar</Button>
              <Button variant="danger" onClick={handleEncerrar} disabled={processing}>
                {processing ? 'Encerrando…' : 'Encerrar e ver relatório'}
              </Button>
            </div>
          </div>
        </Modal>
      </>
    )
  }

  // ── TELA DE CONCLUSÃO ────────────────────────────────────────
  if (state.phase === 'done') return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="bg-white rounded-xl border border-green-100 p-6 shadow-sm text-center">
        <div className="text-4xl mb-3">✓</div>
        <h2 className="text-lg font-extrabold text-gray-900">
          Inspeção {state.numero ? `#${state.numero} ` : ''}Concluída!
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          {state.resultados.length} itens inspecionados por {state.responsavel}
          {state.iniciadaEm ? ` · iniciada em ${fmtDateTime(state.iniciadaEm)}` : ''}
        </p>
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
                    {r.entrada.tipo === 'frac' ? 'Picking' : 'Pulmão'}
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
            End. {novoItem.tipo === 'frac' ? 'Picking' : 'Pulmão'}
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
          <div className="flex items-center gap-2">
            <input type="text" inputMode="numeric" value={novoItem.validadeTexto}
              onChange={e => handleNovoValidadeTexto(e.target.value)}
              placeholder="DD/MM/AAAA"
              maxLength={10}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:border-blue-500" />
            {novoItem.validadeISO && <ZoneCell validade={novoItem.validadeISO} />}
          </div>
        </div>

        {/* Produto fora do prazo → perguntar sobre segregação */}
        {complementoForaPrazo && (
          <div className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none">⚠</span>
              <div>
                <p className="text-sm font-bold text-orange-800">Produto fora do prazo</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  A validade informada está {zonaComplemento?.name === 'vencido' ? 'vencida' : 'em zona crítica'}.
                  Deseja segregar o material e enviar ao Plano de Ação?
                </p>
              </div>
            </div>
            <label className="flex items-center justify-between cursor-pointer gap-4 bg-white rounded-lg border border-orange-100 px-3 py-2.5">
              <span className="text-sm font-semibold text-gray-700">Segregar e enviar ao Plano de Ação</span>
              <button
                type="button"
                onClick={() => {
                  setComplSegregar(v => {
                    const novo = !v
                    if (novo && !complQtdSegregar) setComplQtdSegregar(novoItem.quantidade || '')
                    return novo
                  })
                }}
                className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
                style={{ background: complSegregar ? '#ea580c' : '#d1d5db' }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                  style={{ transform: complSegregar ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
            </label>
            {complSegregar && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Quantidade a segregar</label>
                <input
                  type="number"
                  min={1}
                  value={complQtdSegregar}
                  onChange={e => setComplQtdSegregar(e.target.value)}
                  placeholder="Quantidade"
                  className="border border-orange-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:border-orange-400"
                />
                <p className="text-[11px] text-orange-600">
                  O item será cadastrado como <strong>Segregado</strong> — o bloqueio é confirmado no Plano de Ação
                </p>
              </div>
            )}
          </div>
        )}

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
            variant={complementoForaPrazo && complSegregar ? 'danger' : 'primary'}
            onClick={handleConfirmarComplemento}
            disabled={savingNovo || !novoItem.descricao || !novoItem.validadeISO || (complementoForaPrazo && complSegregar && (!complQtdSegregar || Number(complQtdSegregar) < 1))}
            className="justify-center py-3"
          >
            {savingNovo
              ? 'Salvando…'
              : complementoForaPrazo && complSegregar ? 'Cadastrar e segregar' : 'Confirmar inspeção'}
          </Button>
        </div>
      </div>
    </div>
  )

  // ── INSPEÇÃO ATIVA ───────────────────────────────────────────
  if (!entradaAtual || !itemAtual || !zonaAtual) return null

  const saldoZero = itemAtual.quantidade === 0
  const tipoLabel = entradaAtual.tipo === 'frac' ? 'Picking' : 'Pulmão'
  const enderecoAtual = entradaAtual.endereco

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">
            Inspeção {state.numero ? `#${state.numero}` : 'Ativa'}
          </h1>
          <p className="text-sm text-gray-400">
            Item {state.atual + 1} de {state.fila.length} — {state.responsavel}
            {state.iniciadaEm ? ` · ${new Date(state.iniciadaEm).toLocaleDateString('pt-BR')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-gray-400">{Math.round((state.atual / state.fila.length) * 100)}% concluído</div>
            <div className="w-28 bg-gray-200 rounded-full h-1.5 mt-1">
              <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${(state.atual / state.fila.length) * 100}%` }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => { resetNovoEndereco(); setShowAddModal(true) }}
              className="flex items-center justify-center gap-1 text-xs font-semibold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Endereço
            </button>
            <button
              onClick={() => setConfirmEncerrar(true)}
              className="flex items-center justify-center gap-1 text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              ■ Encerrar
            </button>
          </div>
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
            <div className="text-gray-400">End. Picking</div>
            <div className="font-mono font-bold text-gray-800 mt-0.5">{itemAtual.endereco_frac || '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-gray-400">End. Pulmão</div>
            <div className="font-mono font-bold text-gray-800 mt-0.5">{itemAtual.endereco_gran || '—'}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: qtdAlterada ? '#fffbeb' : '#f9fafb' }}>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Quantidade conferida</span>
              {qtdAlterada && <span className="text-[10px] font-bold text-amber-600">✎ {itemAtual.quantidade} → {qtdInspecao || 0}</span>}
            </div>
            {saldoZero ? (
              <div className="font-mono font-bold mt-0.5 text-gray-400">⊘ zero</div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1">
                <input
                  type="number"
                  min={0}
                  value={qtdInspecao}
                  onChange={e => setQtdInspecao(e.target.value)}
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm font-mono font-bold bg-white focus:outline-none focus:ring-1"
                  style={{
                    borderColor: qtdAlterada ? '#f59e0b' : '#e1e4ea',
                    boxShadow: qtdAlterada ? '0 0 0 1px #f59e0b' : undefined,
                  }}
                />
                {!zeradoNaInspecao && (
                  <button
                    onClick={() => setQtdInspecao('0')}
                    className="text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 hover:bg-gray-100 whitespace-nowrap"
                  >
                    Zerar
                  </button>
                )}
              </div>
            )}
            {zeradoNaInspecao && (
              <p className="text-[10px] text-blue-600 mt-1 leading-tight">
                Endereço permanece <strong>ativo</strong> com saldo zero — segue nas próximas inspeções
              </p>
            )}
          </div>
          {itemAtual.ultima_inspecao && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-gray-400">Última inspeção</div>
              <div className="font-mono text-gray-600 mt-0.5 text-[11px]">{fmtDateTime(itemAtual.ultima_inspecao)}</div>
            </div>
          )}
        </div>

        {/* Input de foto compartilhado entre os fluxos */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />

        {/* SALDO ZERO — fluxo simplificado */}
        {saldoZero && !mostrarEncontrado && (
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
                placeholder="Ex: endereço limpo…"
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
            <button
              onClick={() => setMostrarEncontrado(true)}
              disabled={processing}
              className="w-full py-2.5 rounded-lg text-sm font-semibold border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              ➕ Encontrei produto neste endereço
            </button>
          </div>
        )}

        {/* SALDO ZERO — produto localizado: registrar quantidade e validade */}
        {saldoZero && mostrarEncontrado && (
          <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-800">
              Registrar produto localizado em <span className="font-mono">{enderecoAtual}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Quantidade encontrada *</label>
                <input
                  type="number"
                  min={1}
                  value={qtdEncontrada}
                  onChange={e => setQtdEncontrada(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="border border-blue-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Validade encontrada *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={validadeTexto}
                  onChange={e => handleValidadeTexto(e.target.value)}
                  placeholder="DD/MM/AAAA"
                  maxLength={10}
                  className="border border-blue-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
            {validadeEncontrada && zonaEncontrada && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Zona:</span>
                <ZoneCell validade={validadeEncontrada} />
              </div>
            )}
            {/* Foto opcional */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">
                Foto <span className="text-gray-400">(opcional)</span>
              </label>
              {foto ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto} alt="foto inspecao" className="rounded-lg w-full max-h-40 object-cover" />
                  <button onClick={() => setFoto(undefined)} className="absolute top-2 right-2 bg-red-600 text-white w-6 h-6 rounded-full text-xs">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed rounded-lg py-4 text-sm transition-colors bg-white"
                  style={{ borderColor: '#bfdbfe', color: '#60a5fa' }}
                >
                  📷 Tirar foto
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-400">Observação (opcional)</label>
              <textarea
                value={obs}
                onChange={e => setObs(e.target.value)}
                rows={2}
                placeholder="Ex: produto sem registro de movimentação…"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-300 text-gray-600 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setMostrarEncontrado(false); setQtdEncontrada(''); limparValidade() }} disabled={processing} className="justify-center">
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmarEncontrado}
                disabled={processing || !qtdEncontrada || Number(qtdEncontrada) < 1 || !validadeEncontrada}
                className="justify-center"
              >
                {processing ? 'Salvando…' : 'Registrar e continuar'}
              </Button>
            </div>
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
                Foto <span className="text-gray-400">(opcional)</span>
              </label>
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
                  style={{ borderColor: '#e1e4ea', color: '#9ca3af' }}
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
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setShowSegregar(false); setQtdSegregar('') }} className="justify-center">
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleConfirmarSegregacao}
                    disabled={processing || !qtdSegregar || Number(qtdSegregar) < 1}
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
                <div className={can('inspecao.segregar') ? 'grid grid-cols-2 gap-3' : ''}>
                  {can('inspecao.segregar') && (
                    <Button
                      variant="danger"
                      onClick={() => setShowSegregar(true)}
                      disabled={processing || !validadeConfirmada || zeradoNaInspecao}
                      className="justify-center py-3"
                    >
                      Segregar
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={handleConfirmarOk}
                    disabled={processing || (!validadeConfirmada && !zeradoNaInspecao)}
                    className="justify-center py-3 w-full"
                  >
                    {processing ? 'Salvando…' : zeradoNaInspecao ? 'Confirmar saldo zero' : 'Confirmar OK'}
                  </Button>
                </div>
                {!validadeConfirmada && !zeradoNaInspecao && (
                  <p className="text-[11px] text-center text-gray-400">Confirme a validade do produto para prosseguir</p>
                )}
                {zeradoNaInspecao && (
                  <p className="text-[11px] text-center text-blue-500">Saldo zero não exige validade — o picking continua ativo</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Baixa de endereço — disponível em ambos os fluxos (requer permissão) */}
        {can('inspecao.baixar') && (
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
        )}
      </div>
      {/* Modal — encerramento antecipado */}
      <Modal open={confirmEncerrar} onClose={() => setConfirmEncerrar(false)} title="Encerrar Inspeção">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Encerrar a <strong>Inspeção #{state.numero}</strong> agora?
          </p>
          <div className="rounded-lg border border-green-100 bg-green-50 p-3">
            <p className="text-xs text-green-700">
              ✓ Os <strong>{state.resultados.length} endereços já confirmados estão salvos</strong> —
              cada confirmação é gravada na hora, nada se perde.
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">
              Os <strong>{Math.max(0, state.fila.length - state.atual)} endereços restantes</strong> ficarão
              de fora e a inspeção será concluída. Para inspecioná-los depois, inicie uma nova inspeção.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirmEncerrar(false)} disabled={processing}>Voltar</Button>
            <Button variant="danger" onClick={handleEncerrar} disabled={processing}>
              {processing ? 'Encerrando…' : 'Encerrar e salvar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal — incluir novo endereço de inspeção (popup mínimo) */}
      <Modal open={showAddModal} onClose={() => { setShowAddModal(false); resetNovoEndereco() }} title="Incluir Endereço de Inspeção">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-gray-500">
            Produto localizado fora do programado? Informe o endereço e busque o produto pelo nome —
            a próxima tela segue para a inspeção complementar.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Endereço *</label>
            <input type="text" inputMode="numeric" value={novoItem.endereco}
              onChange={e => handleEnderecoTexto(e.target.value)}
              placeholder="Digite os números: ex 6106410"
              maxLength={16}
              autoFocus
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400">
              Só os números — padrão <span className="font-mono">Rua - Prédio(3) - Nível - Apto(2)</span>.
              Prédio abaixo de 100: use zero à esquerda (<span className="font-mono">053</span> = prédio 53)
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Produto *</label>

            {/* Produto selecionado */}
            {novoItem.sku && !entradaManualSku ? (
              <div className="flex items-center justify-between gap-2 border border-green-200 bg-green-50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-bold text-gray-800">{novoItem.sku}</div>
                  <div className="text-[11px] text-gray-600 truncate">
                    {novoItem.descricao || produtoExistente?.descricao || 'Descrição na próxima tela'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setNovoItem(p => ({ ...p, sku: '', descricao: '' })); setBuscaProduto(''); setMostrarBuscaResultados(false) }}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex-shrink-0"
                >
                  Trocar
                </button>
              </div>
            ) : entradaManualSku ? (
              /* Entrada manual do código (produto novo / não cadastrado) */
              <div className="flex flex-col gap-1">
                <input type="text" value={novoItem.sku}
                  onChange={e => setNovoItem(p => ({ ...p, sku: e.target.value }))}
                  placeholder="Código SKU do produto novo"
                  autoFocus
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
                <button
                  type="button"
                  onClick={() => { setEntradaManualSku(false); setNovoItem(p => ({ ...p, sku: '' })) }}
                  className="self-start text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                >
                  ← Voltar à busca por nome
                </button>
                <p className="text-[11px] text-amber-600">Produto sem cadastro — a descrição é informada na próxima tela</p>
              </div>
            ) : (
              /* Busca por nome ou código */
              <div className="relative">
                <input
                  type="text"
                  value={buscaProduto}
                  onChange={e => { setBuscaProduto(e.target.value); setMostrarBuscaResultados(true) }}
                  onFocus={() => setMostrarBuscaResultados(true)}
                  placeholder="Digite o nome ou o código do produto"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-blue-500"
                />
                {mostrarBuscaResultados && buscaProduto.trim() && (
                  <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                    {resultadosBusca.length > 0 ? (
                      resultadosBusca.map(p => (
                        <button
                          key={p.sku}
                          type="button"
                          onClick={() => selecionarProduto(p)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                        >
                          <span className="font-mono text-xs font-bold text-blue-700">{p.sku}</span>
                          <span className="text-xs text-gray-700 ml-2">{p.descricao}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-xs text-gray-500">
                        Nenhum produto encontrado.{' '}
                        <button
                          type="button"
                          onClick={() => { setEntradaManualSku(true); setMostrarBuscaResultados(false) }}
                          className="text-blue-600 font-semibold hover:text-blue-800"
                        >
                          Informar código manualmente
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-1">
                  Busque pelo nome — com mais de mil itens ativos não é preciso decorar os códigos.
                </p>
              </div>
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
                  {t === 'frac' ? 'Picking' : 'Pulmão'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowAddModal(false); resetNovoEndereco() }}>Cancelar</Button>
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
