'use client'
import { clsx } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  color?: string
  bg?: string
  textColor?: string
  className?: string
}

export function Badge({ children, color, bg, textColor, className }: BadgeProps) {
  return (
    <span
      className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold font-mono', className)}
      style={{ background: bg, color: textColor, borderColor: color, border: '1px solid' }}
    >
      {children}
    </span>
  )
}
