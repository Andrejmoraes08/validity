'use client'
import { getZone } from '@/lib/zones'
import { fmtDate } from '@/lib/utils'

export function ZoneCell({ validade }: { validade: string }) {
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
