'use client'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

export function Topbar() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-50 bg-white/92 backdrop-blur-md border-b border-gray-100 px-6 py-3.5 shadow-sm">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 text-white grid place-items-center font-extrabold text-lg rounded-md shadow-md shadow-blue-200">V</div>
          <div className="flex flex-col leading-tight">
            <span className="font-extrabold text-[17px] tracking-tight text-gray-900">VALIDITY</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-widest">Gestão de Validade</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-gray-500 border border-gray-200 rounded px-3 py-1.5 bg-gray-50 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            {time}
          </div>
          {user && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="hidden sm:block font-mono">{user.email}</span>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-red-600 border border-gray-200 rounded-lg hover:border-red-200 transition-colors"
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
