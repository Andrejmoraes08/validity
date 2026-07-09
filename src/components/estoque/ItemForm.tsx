'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { Item } from '@/lib/types'

interface ItemFormProps {
  open: boolean
  onClose: () => void
  onSave: (data: Partial<Item>) => Promise<void>
  initial?: Partial<Item>
  title: string
}

const empty: Partial<Item> = {
  sku: '', descricao: '', lote: '', endereco_frac: '', endereco_gran: '',
  quantidade: 0, validade: '', status: 'ativo',
}

function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const inputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
const labelClass = 'text-xs font-semibold text-gray-600'

export function ItemForm({ open, onClose, onSave, initial, title }: ItemFormProps) {
  const [form, setForm] = useState<Partial<Item>>(initial ?? empty)
  const [validadeTexto, setValidadeTexto] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const base = initial ?? empty
    setForm(base)
    setValidadeTexto(isoToDisplay(base.validade ?? ''))
  }, [open, initial])

  const set = (key: keyof Item) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: key === 'quantidade' ? Number(e.target.value) : e.target.value }))

  const handleValidadeTexto = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let masked = digits
    if (digits.length > 2) masked = digits.slice(0, 2) + '/' + digits.slice(2)
    if (digits.length > 4) masked = masked.slice(0, 5) + '/' + digits.slice(4)
    setValidadeTexto(masked)
    if (digits.length === 8) {
      const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8)
      const iso = `${y}-${m}-${d}`
      if (!isNaN(new Date(iso).getTime())) setForm(f => ({ ...f, validade: iso }))
    } else {
      setForm(f => ({ ...f, validade: '' }))
    }
  }

  const handleSave = async () => {
    if (!form.sku || !form.descricao || !form.lote || !form.endereco_frac || !form.validade) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className={labelClass}>SKU <span className="text-red-500">*</span></label>
          <input type="text" value={form.sku ?? ''} onChange={set('sku')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Lote <span className="text-red-500">*</span></label>
          <input type="text" value={form.lote ?? ''} onChange={set('lote')} className={inputClass} />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label className={labelClass}>Descrição <span className="text-red-500">*</span></label>
          <input type="text" value={form.descricao ?? ''} onChange={set('descricao')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Endereço Fracionado <span className="text-red-500">*</span></label>
          <input type="text" value={form.endereco_frac ?? ''} onChange={set('endereco_frac')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Endereço Grandeza</label>
          <input type="text" value={form.endereco_gran ?? ''} onChange={set('endereco_gran')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Quantidade <span className="text-red-500">*</span></label>
          <input type="number" min={0} value={form.quantidade ?? 0} onChange={set('quantidade')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Validade <span className="text-red-500">*</span></label>
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
        <div className="col-span-2 flex flex-col gap-1">
          <label className={labelClass}>Status</label>
          <select value={form.status} onChange={set('status')}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="ativo">Ativo</option>
            <option value="bloqueado">Bloqueado</option>
            <option value="baixado">Baixado</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Modal>
  )
}
