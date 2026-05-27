'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from '@/lib/utils'

const ALL_TABS = [
  { key: 'dashboard',  href: '/dashboard',   label: 'Dashboard' },
  { key: 'estoque',    href: '/estoque',      label: 'Estoque' },
  { key: 'plano-acao', href: '/plano-acao',   label: 'Plano de Ação' },
  { key: 'inspecao',   href: '/inspecao',     label: 'Inspeção' },
  { key: 'wms',        href: '/wms',          label: 'WMS' },
  { key: 'bloqueios',  href: '/bloqueios',    label: 'Bloqueios e Perdas' },
  { key: 'config',     href: '/config',       label: 'Configurações' },
]

interface TabNavProps {
  tabsPermitidas: string[]
}

export function TabNav({ tabsPermitidas }: TabNavProps) {
  const pathname = usePathname()
  const tabs = ALL_TABS.filter(t => tabsPermitidas.includes(t.key))

  return (
    <nav className="bg-white border-b border-gray-100 px-6 overflow-x-auto">
      <div className="max-w-[1600px] mx-auto flex gap-0">
        {tabs.map(tab => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={clsx(
                'px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors',
                active
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
