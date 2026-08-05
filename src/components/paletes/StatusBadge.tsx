'use client'
import type { PaleteStatus } from '@/lib/types'

export const STATUS_INFO: Record<PaleteStatus, { label: string; cls: string }> = {
  vazio:        { label: 'Em branco',   cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  ativo:        { label: 'Ativo',       cls: 'bg-green-50 text-green-700 border-green-200' },
  movimentando: { label: 'Em trânsito', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  baixado:      { label: 'Baixado',     cls: 'bg-gray-800 text-white border-gray-800' },
}

export function StatusBadge({ status }: { status: PaleteStatus }) {
  const s = STATUS_INFO[status] ?? STATUS_INFO.vazio
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${s.cls}`}>{s.label}</span>
}
