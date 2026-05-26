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

export function ItemForm({ open, onClose, onSave, initial, title }: ItemFormProps) {
  const [form, setForm] = useState<Partial<Item>>(initial ?? empty)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(initial ?? empty)
  }, [open, initial])

  const field = (key: keyof Item) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: key === 'quantidade' ? Number(e.target.value) : e.target.value }))

  const handleSave = async () => {
    if (!form.sku || !form.descricao || !form.lote || !form.endereco_frac || !form.validade) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  const F = ({ label, name, type = 'text', required }: { label: string; name: keyof Item; type?: string; required?: boolean }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input
        type={type}
        value={(form[name] ?? '') as string}
        onChange={field(name)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="grid grid-cols-2 gap-4">
        <F label="SKU" name="sku" required />
        <F label="Lote" name="lote" required />
        <div className="col-span-2">
          <F label="Descrição" name="descricao" required />
        </div>
        <F label="Endereço Fracionado" name="endereco_frac" required />
        <F label="Endereço Grandeza" name="endereco_gran" />
        <F label="Quantidade" name="quantidade" type="number" required />
        <F label="Validade" name="validade" type="date" required />
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">Status</label>
          <select
            value={form.status}
            onChange={field('status')}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
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
