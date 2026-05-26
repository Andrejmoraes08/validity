'use client'
import { worstZone } from '@/lib/zones'

interface ItemResumo {
  validade: string
  quantidade: number
}

interface EnderecoTagProps {
  endereco: string
  itens: ItemResumo[]
}

export function EnderecoTag({ endereco, itens }: EnderecoTagProps) {
  if (!endereco) return <span className="text-gray-400 text-xs font-mono">—</span>

  const z = worstZone(itens.map(i => i.validade))
  if (!z) return <span className="font-mono text-xs text-gray-500">{endereco}</span>

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold"
      style={{ background: z.bg, color: z.color, border: `1px solid ${z.color}30` }}
    >
      {endereco}
    </span>
  )
}
