'use client'
import { getZone } from '@/lib/zones'
import { fmtDate, semValidade, LABEL_SEM_VALIDADE } from '@/lib/utils'

export function ZoneCell({ validade }: { validade: string }) {
  // Validade indefinida (9999): badge neutro, sem contagem de dias
  if (semValidade(validade)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold w-fit bg-gray-100 text-gray-500 border border-gray-200">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        {LABEL_SEM_VALIDADE}
      </span>
    )
  }

  const z = getZone(validade)
  const dias = z.dias ?? 0
  const diasLabel = dias < 0
    ? `${Math.abs(dias)}d vencido`
    : `${dias}d restantes`

  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold font-mono w-fit"
        style={{ background: z.color, color: z.textColor }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: z.textColor, opacity: 0.7 }} />
        {fmtDate(validade)}
      </span>
      <span className="text-[10px] text-gray-400 font-mono">{diasLabel}</span>
    </div>
  )
}
