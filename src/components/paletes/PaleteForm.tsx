'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { normalizarEndereco, semValidade } from '@/lib/utils'
import type { Item, Palete } from '@/lib/types'
import type { PaleteDados } from '@/hooks/usePaletes'

interface PaleteFormProps {
  open: boolean
  onClose: () => void
  onSave: (dados: PaleteDados) => Promise<void>
  itens: Item[]
  initial?: Partial<Palete>
  title: string
}

const inputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
const labelClass = 'text-xs font-semibold text-gray-600'

// remove acentos e caixa para busca tolerante
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function PaleteForm({ open, onClose, onSave, itens, initial, title }: PaleteFormProps) {
  const [sku, setSku] = useState('')
  const [descricao, setDescricao] = useState('')
  const [lote, setLote] = useState('')
  const [quantidade, setQuantidade] = useState<number | ''>('')
  const [validade, setValidade] = useState('')          // ISO
  const [validadeTexto, setValidadeTexto] = useState('') // DD/MM/AAAA
  const [endereco, setEndereco] = useState('')
  const [itemId, setItemId] = useState<string | undefined>(undefined)
  const [observacao, setObservacao] = useState('')
  const [saving, setSaving] = useState(false)

  const [buscaSku, setBuscaSku] = useState('')
  const [dropdownAberto, setDropdownAberto] = useState(false)
  const buscaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const i = initial ?? {}
    setSku(i.sku ?? '')
    setDescricao(i.descricao ?? '')
    setLote(i.lote ?? '')
    setQuantidade(typeof i.quantidade === 'number' ? i.quantidade : '')
    const val = semValidade(i.validade ?? '') ? '' : (i.validade ?? '')
    setValidade(val)
    setValidadeTexto(isoToDisplay(val))
    setEndereco(i.endereco_atual ?? '')
    setItemId(i.item_id)
    setObservacao(i.observacao ?? '')
    setBuscaSku('')
    setDropdownAberto(false)
  }, [open, initial])

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!dropdownAberto) return
    const handler = (e: MouseEvent) => {
      if (buscaRef.current && !buscaRef.current.contains(e.target as Node)) setDropdownAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownAberto])

  // Catálogo de SKUs distintos (do estoque) para a busca — prioriza itens com pulmão
  const catalogo = useMemo(() => {
    const porSku = new Map<string, Item>()
    for (const it of itens) {
      if (!it.sku) continue
      const existente = porSku.get(it.sku)
      // prefere a linha que tem endereço de pulmão preenchido
      if (!existente || (!existente.endereco_gran && it.endereco_gran)) porSku.set(it.sku, it)
    }
    return Array.from(porSku.values())
  }, [itens])

  const sugestoes = useMemo(() => {
    const termos = norm(buscaSku).split(/\s+/).filter(Boolean)
    if (termos.length === 0) return []
    return catalogo
      .filter(it => {
        const alvo = norm(`${it.sku} ${it.descricao}`)
        return termos.every(t => alvo.includes(t))
      })
      .slice(0, 8)
  }, [buscaSku, catalogo])

  const selecionarItem = (it: Item) => {
    setSku(it.sku)
    setDescricao(it.descricao)
    setLote(it.lote && it.lote !== 'S/L' ? it.lote : '')
    setQuantidade(typeof it.quantidade === 'number' ? it.quantidade : '')
    const val = semValidade(it.validade ?? '') ? '' : (it.validade ?? '')
    setValidade(val)
    setValidadeTexto(isoToDisplay(val))
    setEndereco(it.endereco_gran || it.endereco_frac || '')
    setItemId(it.id)
    setBuscaSku('')
    setDropdownAberto(false)
  }

  const handleValidadeTexto = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let masked = digits
    if (digits.length > 2) masked = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) masked = masked.slice(0, 5) + '/' + digits.slice(4)
    setValidadeTexto(masked)
    if (digits.length === 8) {
      const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8)
      const iso = `${y}-${m}-${d}`
      setValidade(isNaN(new Date(iso).getTime()) ? '' : iso)
    } else {
      setValidade('')
    }
  }

  const podeSalvar = !!sku.trim() && !!endereco.trim()

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    await onSave({
      sku: sku.trim(),
      descricao: descricao.trim(),
      lote: lote.trim() || 'S/L',
      quantidade: quantidade === '' ? undefined : Number(quantidade),
      validade: validade || undefined,
      endereco_atual: normalizarEndereco(endereco),
      item_id: itemId,
      observacao: observacao.trim() || undefined,
    })
    setSaving(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-xl">
      {/* Busca de produto no catálogo */}
      <div className="flex flex-col gap-1 mb-4" ref={buscaRef}>
        <label className={labelClass}>Buscar produto no estoque <span className="text-gray-400 font-normal">(nome ou código)</span></label>
        <div className="relative">
          <input
            type="text"
            value={buscaSku}
            onChange={e => { setBuscaSku(e.target.value); setDropdownAberto(true) }}
            onFocus={() => setDropdownAberto(true)}
            placeholder="Digite para localizar e preencher automaticamente…"
            className={inputClass + ' w-full'}
          />
          {dropdownAberto && sugestoes.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {sugestoes.map(it => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => selecionarItem(it)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                >
                  <div className="font-mono font-bold text-sm text-gray-800">{it.sku}</div>
                  <div className="text-xs text-gray-500 truncate">{it.descricao}</div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    Pulmão: {it.endereco_gran || '—'} · qtd {it.quantidade}
                  </div>
                </button>
              ))}
            </div>
          )}
          {dropdownAberto && buscaSku.trim() && sugestoes.length === 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-400">
              Nenhum produto encontrado — preencha os campos manualmente abaixo
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className={labelClass}>SKU <span className="text-red-500">*</span></label>
          <input type="text" value={sku} onChange={e => setSku(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Lote <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input type="text" value={lote} onChange={e => setLote(e.target.value)} placeholder="S/L se não informado" className={inputClass} />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label className={labelClass}>Descrição</label>
          <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Endereço de Pulmão <span className="text-red-500">*</span></label>
          <input type="text" value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua - Prédio - Nível - Apto" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Quantidade</label>
          <input type="number" min={0} value={quantidade} onChange={e => setQuantidade(e.target.value === '' ? '' : Number(e.target.value))} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Validade</label>
          <input
            type="text"
            inputMode="numeric"
            value={validadeTexto}
            onChange={e => handleValidadeTexto(e.target.value)}
            placeholder="DD/MM/AAAA"
            maxLength={10}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Observação <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input type="text" value={observacao} onChange={e => setObservacao(e.target.value)} className={inputClass} />
        </div>
      </div>

      {!podeSalvar && (
        <p className="text-[11px] text-amber-600 mt-3">Informe ao menos o SKU e o endereço de pulmão.</p>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || !podeSalvar}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  )
}
