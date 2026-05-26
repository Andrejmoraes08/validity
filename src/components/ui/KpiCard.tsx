'use client'

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
  icon?: React.ReactNode
}

export function KpiCard({ label, value, sub, color, icon }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col gap-2" style={{ borderLeftColor: color, borderLeftWidth: color ? 3 : undefined }}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</span>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <div className="text-3xl font-extrabold font-mono" style={{ color: color || '#1a1d24' }}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}
