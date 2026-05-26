import type { Metadata } from 'next'
import { Manrope, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ToastProvider } from '@/components/layout/Toast'

const manrope = Manrope({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'VALIDITY · Gestão de Validade de Estoque',
  description: 'Sistema de controle de validade de estoque',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${jetbrains.variable}`}>
      <body
        className="antialiased min-h-screen bg-[#f5f6f8] text-[#1a1d24]"
        style={{
          fontFamily: 'var(--font-sans), sans-serif',
          backgroundImage:
            'radial-gradient(circle at 15% 0%, rgba(31,111,235,.04), transparent 40%), radial-gradient(circle at 90% 100%, rgba(22,163,74,.03), transparent 40%)',
        }}
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
